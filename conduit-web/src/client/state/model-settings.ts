import { createSignal } from "solid-js";
import { api, asList } from "../api/client";
import type { ModelOption, ModelState } from "../api/contracts";

type ErrorHandler = (error: unknown) => void;
type ThinkingLevelRecoveryHandler = (details: { from: string; to: string }) => void;

export function createModelSettings(onError: ErrorHandler, onThinkingLevelRecovered: ThinkingLevelRecoveryHandler = () => {}) {
  const [allModels, setAllModels] = createSignal<ModelOption[]>([]);
  const [enabledModels, setEnabledModels] = createSignal<string[]>([]);
  const [models, setModels] = createSignal<ModelOption[]>([]);
  const [settingsDefaultModel, setSettingsDefaultModel] = createSignal("");
  const [model, setModel] = createSignal("");
  const [effort, setEffort] = createSignal("");
  const [modelThinkingLevels, setModelThinkingLevels] = createSignal<Record<string, string>>({});
  const [notice, setNotice] = createSignal("");
  const [settingsError, setSettingsError] = createSignal("");
  const [settingsLoading, setSettingsLoading] = createSignal(true);
  const [chatLoading, setChatLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  let activeProjectId = "";
  let activeChatId = "";
  let requestSequence = 0;
  let initialCatalogRefresh = true;
  const pendingThinkingLevels = new Map<string, string>();
  const notifiedRecoveryChats = new Set<string>();

  const applyChatSelection = (selection?: { model?: string; thinkingLevel?: string }) => {
    if (selection?.model) setModel(selection.model);
    if (selection?.thinkingLevel) setEffort(selection.thinkingLevel);
  };

  const applySettings = (settings: ModelState, catalog?: ModelState) => {
    const nextAll = asList<ModelOption>(settings.models);
    const enabled = asList<string>(settings.enabledModels);
    const fallback = enabled.includes(settings.defaultModel || "") ? settings.defaultModel! : enabled[0] || "";
    setAllModels(nextAll);
    setEnabledModels(enabled);
    setSettingsDefaultModel(fallback);
    if (catalog) setNotice(catalog.requiresAuthentication ? "Authenticate with conduit-pi, then run /login." : "");
  };

  const reload = async (projectId = activeProjectId, refreshCatalog = false) => {
    if (!projectId) return;
    activeProjectId = projectId;
    setSettingsLoading(true);
    setSettingsError("");
    try {
      const refresh = initialCatalogRefresh || refreshCatalog;
      const [settings, catalog] = await Promise.all([
        api<ModelState>(`/v0/settings?projectId=${encodeURIComponent(projectId)}`),
        api<ModelState>(`/v0/models?projectId=${encodeURIComponent(projectId)}`),
      ]);
      if (activeProjectId === projectId) applySettings(settings, catalog);
      if (refresh) void (async () => {
        const refreshedCatalog = await api<ModelState>(`/v0/models?projectId=${encodeURIComponent(projectId)}&refresh=true`);
        const refreshedSettings = await api<ModelState>(`/v0/settings?projectId=${encodeURIComponent(projectId)}`);
        initialCatalogRefresh = false;
        if (activeProjectId === projectId) applySettings(refreshedSettings, refreshedCatalog);
      })().catch(onError);
    } catch (error) { setSettingsError((error as Error).message); onError(error); }
    finally { if (activeProjectId === projectId) setSettingsLoading(false); }
  };

  const reloadChat = async (chatId = activeChatId) => {
    if (!chatId) return;
    activeChatId = chatId;
    const requestId = ++requestSequence;
    setChatLoading(true);
    try {
      const catalog = await api<ModelState>(`/v0/chats/${encodeURIComponent(chatId)}/models`);
      if (activeChatId !== chatId || requestId !== requestSequence) return;
      const nextModels = asList<ModelOption>(catalog.models);
      const selected = nextModels.find((item) => item.spec === catalog.model);
      const levels = asList<string>(selected?.thinkingLevels);
      const pendingThinkingLevel = pendingThinkingLevels.get(chatId);
      const rememberedLevels = catalog.modelThinkingLevels && typeof catalog.modelThinkingLevels === "object"
        ? catalog.modelThinkingLevels : {};
      const nextEffort = levels.includes(catalog.thinkingLevel) ? catalog.thinkingLevel
        : levels.includes(catalog.defaultThinkingLevel || "") ? catalog.defaultThinkingLevel!
          : levels.includes("medium") ? "medium" : levels[0] || "off";
      setModels(nextModels);
      setModelThinkingLevels(rememberedLevels);
      setModel(catalog.model || nextModels[0]?.spec || "");
      setEffort(nextEffort);
      if (pendingThinkingLevel && !levels.includes(pendingThinkingLevel) && pendingThinkingLevel !== nextEffort && !notifiedRecoveryChats.has(chatId)) {
        notifiedRecoveryChats.add(chatId);
        onThinkingLevelRecovered({ from: pendingThinkingLevel, to: nextEffort });
      }
      pendingThinkingLevels.delete(chatId);
      setNotice(catalog.requiresAuthentication
        ? `Authenticate ${catalog.runtimeKind === "native_pi" ? "Host Pi" : "Isolated Pi"} to use models.`
        : "");
    } catch (error) {
      if (activeChatId === chatId && requestId === requestSequence) onError(error);
    } finally {
      if (activeChatId === chatId && requestId === requestSequence) setChatLoading(false);
    }
  };

  const select = (
    projectId: string,
    chatId: string,
    selection?: { model?: string; thinkingLevel?: string },
    { reloadChat: shouldReloadChat = true }: { reloadChat?: boolean } = {},
  ) => {
    const changedProject = activeProjectId !== projectId;
    const changedChat = activeChatId !== chatId;
    activeProjectId = projectId;
    activeChatId = chatId;
    if (changedChat) {
      setModelThinkingLevels({});
      if (selection?.thinkingLevel) pendingThinkingLevels.set(chatId, selection.thinkingLevel);
      else pendingThinkingLevels.delete(chatId);
    }
    applyChatSelection(selection);
    if (changedProject) void reload(projectId);
    if (changedChat && shouldReloadChat) void reloadChat(chatId);
  };

  const saveScope = async (nextEnabled: string[], defaultModel = settingsDefaultModel()) => {
    const previousEnabled = enabledModels();
    const previousDefault = settingsDefaultModel();
    const allowedDefault = nextEnabled.includes(defaultModel) ? defaultModel : nextEnabled[0] || "";
    setEnabledModels(nextEnabled);
    setSettingsDefaultModel(allowedDefault);
    setSaving(true);
    setSettingsError("");
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
      setSettingsError((error as Error).message);
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
      const remembered = previousLevels[spec];
      const nextEffort = remembered && levels.includes(remembered) ? remembered
        : levels.includes("medium") ? "medium" : levels[0] || "off";
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
    allModels, enabledModels, models, settingsDefaultModel, model, effort, modelThinkingLevels, notice, settingsError, settingsLoading, chatLoading, saving,
    select, reload, reloadChat, saveScope, chooseModel, chooseEffort,
  };
}

export type ModelSettings = ReturnType<typeof createModelSettings>;
