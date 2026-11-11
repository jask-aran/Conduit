import { createSignal } from "solid-js";
import { toast } from "@/components/ui/notifications";
import { api, apiWhenServed, asList } from "../api/client";
import type { ModelOption, ModelState } from "../api/contracts";
import { preferredThinkingLevel } from "./thinking-levels";
import { createLatest } from "./latest";

type ErrorHandler = (error: unknown) => void;
type ThinkingLevelRecoveryHandler = (details: { from: string; to: string }) => void;
type ModelFallbackHandler = (details: { from: string; to: string }) => void;

export const notifyModelFallback = ({ from, to }: { from: string; to: string }) => {
  toast.warning(`${from} is unavailable. Using ${to}.`, {
    id: "model-memory-fallback",
    duration: 8_000,
  });
};

export function createModelSettings(
  onError: ErrorHandler,
  onThinkingLevelRecovered: ThinkingLevelRecoveryHandler = () => {},
  onModelFallback: ModelFallbackHandler = () => {},
) {
  const [allModels, setAllModels] = createSignal<ModelOption[]>([]);
  const [enabledModels, setEnabledModels] = createSignal<string[]>([]);
  const [models, setModels] = createSignal<ModelOption[]>([]);
  const [settingsDefaultModel, setSettingsDefaultModel] = createSignal("");
  const [model, setModel] = createSignal("");
  const [effort, setEffort] = createSignal("");
  const [modelThinkingLevels, setModelThinkingLevels] = createSignal<Record<string, string>>({});
  const [notice, setNotice] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  let activeProjectId = "";
  let activeChatId = "";
  const [activeProfile, setActiveProfile] = createSignal("");
  const chatRequest = createLatest();
  let initialCatalogRefresh = true;
  const pendingThinkingLevels = new Map<string, string>();
  const notifiedRecoveryChats = new Set<string>();

  const applyChatSelection = (selection?: { model?: string; thinkingLevel?: string }) => {
    if (selection?.model) setModel(selection.model);
    if (selection?.thinkingLevel) setEffort(selection.thinkingLevel);
  };

  const applySettings = (settings: ModelState) => {
    const nextAll = asList<ModelOption>(settings.models);
    const enabled = asList<string>(settings.enabledModels);
    const fallback = enabled.includes(settings.defaultModel || "") ? settings.defaultModel! : enabled[0] || "";
    setAllModels(nextAll);
    setEnabledModels(enabled);
    setSettingsDefaultModel(fallback);
  };
  const applyCatalog = (catalog: ModelState) => {
    const enabled = asList<ModelOption>(catalog.models).map((item) => item.spec);
    setEnabledModels(enabled);
    setSettingsDefaultModel(enabled.includes(catalog.defaultModel || "") ? catalog.defaultModel! : enabled[0] || "");
    setNotice(catalog.requiresAuthentication ? "Authenticate this harness, then run /login." : "");
  };

  // Every model the harness has can be hundreds of KB, so it is fetched only once something reads it.
  let allFor = "";
  const loadAll = async (projectId: string) => {
    try {
      const settings = await apiWhenServed<ModelState>(`/v0/settings?projectId=${encodeURIComponent(projectId)}`);
      if (activeProjectId === projectId && allFor === projectId) applySettings(settings);
    } catch (error) { if (allFor === projectId) allFor = ""; onError(error); }
  };
  const allModelsWanted = () => {
    if (activeProjectId && allFor !== activeProjectId) {
      allFor = activeProjectId;
      void loadAll(activeProjectId);
    }
    return allModels();
  };

  const reload = async (projectId = activeProjectId, refreshCatalog = false) => {
    if (!projectId) return;
    if (activeProjectId !== projectId && allFor) {
      allFor = "";
      setAllModels([]);
    }
    activeProjectId = projectId;
    try {
      const refresh = initialCatalogRefresh || refreshCatalog;
      const catalog = await apiWhenServed<ModelState>(`/v0/models?projectId=${encodeURIComponent(projectId)}`);
      if (activeProjectId === projectId) applyCatalog(catalog);
      if (allFor === projectId) void loadAll(projectId);
      if (refresh) void (async () => {
        const refreshedCatalog = await apiWhenServed<ModelState>(`/v0/models?projectId=${encodeURIComponent(projectId)}&refresh=true`);
        initialCatalogRefresh = false;
        if (activeProjectId === projectId) applyCatalog(refreshedCatalog);
        if (allFor === projectId) await loadAll(projectId);
      })().catch(onError);
    } catch (error) { onError(error); }
  };

  const reloadChat = async (chatId = activeChatId) => {
    if (!chatId) return;
    activeChatId = chatId;
    const latest = chatRequest.next();
    try {
      const catalog = await apiWhenServed<ModelState>(`/v0/chats/${encodeURIComponent(chatId)}/models`);
      if (activeChatId !== chatId || !latest()) return;
      const nextModels = asList<ModelOption>(catalog.models);
      const selected = nextModels.find((item) => item.spec === catalog.model);
      const levels = asList<string>(selected?.thinkingLevels);
      const pendingThinkingLevel = pendingThinkingLevels.get(chatId);
      const rememberedLevels = catalog.modelThinkingLevels && typeof catalog.modelThinkingLevels === "object"
        ? catalog.modelThinkingLevels : {};
      const nextEffort = preferredThinkingLevel(levels, catalog.thinkingLevel, catalog.defaultThinkingLevel);
      setModels(nextModels);
      setModelThinkingLevels(rememberedLevels);
      setModel(catalog.model || nextModels[0]?.spec || "");
      setEffort(nextEffort);
      if (pendingThinkingLevel && !levels.includes(pendingThinkingLevel) && pendingThinkingLevel !== nextEffort && !notifiedRecoveryChats.has(chatId)) {
        notifiedRecoveryChats.add(chatId);
        onThinkingLevelRecovered({ from: pendingThinkingLevel, to: nextEffort });
      }
      pendingThinkingLevels.delete(chatId);
      if (catalog.modelFallback) onModelFallback(catalog.modelFallback);
      setNotice(catalog.requiresAuthentication
        ? "Authenticate this harness to use models."
        : "");
    } catch (error) {
      if (activeChatId === chatId && latest()) onError(error);
    }
  };

  const select = (
    projectId: string,
    chatId: string,
    selection?: { model?: string; thinkingLevel?: string },
    { reloadChat: shouldReloadChat = true, profile = "" }: { reloadChat?: boolean; profile?: string } = {},
  ) => {
    const changedProject = activeProjectId !== projectId;
    const changedChat = activeChatId !== chatId;
    // The catalogue and the remembered selection belong to the profile, not the chat or the harness: profiles can
    // share a harness.
    const changedProfile = Boolean(profile) && activeProfile() !== profile;
    activeProjectId = projectId;
    activeChatId = chatId;
    if (profile) setActiveProfile(profile);
    // A kept selection would launch with a model the new profile does not know, and the launch is refused.
    if (changedProfile) {
      setModels([]);
      setModel("");
      setEffort("");
      setNotice("");
    }
    if (changedChat || changedProfile) {
      setModelThinkingLevels({});
      if (selection?.thinkingLevel) pendingThinkingLevels.set(chatId, selection.thinkingLevel);
      else pendingThinkingLevels.delete(chatId);
    }
    applyChatSelection(selection);
    if (changedProject) void reload(projectId);
    // What the launch may ask for depends on the new profile's catalogue.
    return shouldReloadChat || changedProfile ? reloadChat(chatId) : Promise.resolve();
  };

  const saveScope = async (nextEnabled: string[], defaultModel = settingsDefaultModel()) => {
    const previousEnabled = enabledModels();
    const previousDefault = settingsDefaultModel();
    const allowedDefault = nextEnabled.includes(defaultModel) ? defaultModel : nextEnabled[0] || "";
    setEnabledModels(nextEnabled);
    setSettingsDefaultModel(allowedDefault);
    setSaving(true);
    try {
      const payload = await api<ModelState>("/v0/settings", {
        method: "PATCH",
        body: JSON.stringify({ projectId: activeProjectId, enabledModels: nextEnabled, defaultModel: allowedDefault }),
      });
      applySettings(payload);
      await reloadChat();
      return true;
    } catch (error) {
      setEnabledModels(previousEnabled);
      setSettingsDefaultModel(previousDefault);
      onError(error);
      return false;
    } finally { setSaving(false); }
  };

  const chooseModel = async (spec: string) => {
    if (!activeChatId || !models().some((item) => item.spec === spec)) return false;
    const previousModel = model();
    const previousEffort = effort();
    const previousLevels = modelThinkingLevels();
    setModel(spec);
    try {
      const selected = models().find((item) => item.spec === spec);
      const levels = asList<string>(selected?.thinkingLevels);
      const nextEffort = preferredThinkingLevel(levels, previousLevels[spec], selected?.defaultThinkingLevel);
      setEffort(nextEffort);
      const payload = await api<ModelState>(`/v0/chats/${encodeURIComponent(activeChatId)}/models`, {
        method: "PATCH",
        body: JSON.stringify({ model: spec, thinkingLevel: nextEffort }),
      });
      setModel(payload.model || spec);
      setEffort(payload.thinkingLevel || nextEffort);
      setModelThinkingLevels(payload.modelThinkingLevels || { ...previousLevels, [spec]: payload.thinkingLevel || nextEffort });
      return true;
    } catch (error) {
      setModel(previousModel);
      setEffort(previousEffort);
      setModelThinkingLevels(previousLevels);
      onError(error);
      return false;
    }
  };

  const chooseEffort = async (level: string) => {
    if (!activeChatId || !model()) return false;
    const previous = effort();
    const previousLevels = modelThinkingLevels();
    setEffort(level);
    setModelThinkingLevels({ ...previousLevels, [model()]: level });
    try {
      const payload = await api<ModelState>(`/v0/chats/${encodeURIComponent(activeChatId)}/models`, {
        method: "PATCH",
        body: JSON.stringify({ model: model(), thinkingLevel: level }),
      });
      setEffort(payload.thinkingLevel || level);
      setModelThinkingLevels(payload.modelThinkingLevels || { ...previousLevels, [model()]: payload.thinkingLevel || level });
      return true;
    } catch (error) {
      setEffort(previous);
      setModelThinkingLevels(previousLevels);
      onError(error);
      return false;
    }
  };

  return {
    allModels: allModelsWanted, enabledModels, models, settingsDefaultModel, model, effort, profile: activeProfile, modelThinkingLevels, notice, saving,
    select, reload, reloadChat, saveScope, chooseModel, chooseEffort,
  };
}

export type ModelSettings = ReturnType<typeof createModelSettings>;
