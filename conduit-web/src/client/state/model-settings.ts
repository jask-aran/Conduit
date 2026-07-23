import { createSignal } from "solid-js";
import { api, asList } from "../api/client";
import type { ModelOption, ModelState } from "../api/contracts";

type ErrorHandler = (message: string) => void;

export function createModelSettings(onError: ErrorHandler) {
  const [allModels, setAllModels] = createSignal<ModelOption[]>([]);
  const [enabledModels, setEnabledModels] = createSignal<string[]>([]);
  const [models, setModels] = createSignal<ModelOption[]>([]);
  const [settingsDefaultModel, setSettingsDefaultModel] = createSignal("");
  const [model, setModel] = createSignal("");
  const [effort, setEffort] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [settingsError, setSettingsError] = createSignal("");
  const [settingsLoading, setSettingsLoading] = createSignal(true);
  const [chatLoading, setChatLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  let activeProjectId = "";
  let activeChatId = "";
  let requestSequence = 0;

  const applySettings = (settings: ModelState, catalog?: ModelState) => {
    const nextAll = asList<ModelOption>(settings.models);
    const enabled = asList<string>(settings.enabledModels);
    const fallback = enabled.includes(settings.defaultModel || "") ? settings.defaultModel! : enabled[0] || "";
    setAllModels(nextAll);
    setEnabledModels(enabled);
    setSettingsDefaultModel(fallback);
    if (catalog) setNotice(catalog.requiresAuthentication ? "Authenticate the Isolated Pi runtime in Settings → Auth." : "");
  };

  const reload = async (projectId = activeProjectId) => {
    if (!projectId) return;
    activeProjectId = projectId;
    setSettingsLoading(true);
    setSettingsError("");
    try {
      const [settings, catalog] = await Promise.all([
        api<ModelState>(`/v0/settings?projectId=${encodeURIComponent(projectId)}`),
        api<ModelState>(`/v0/models?projectId=${encodeURIComponent(projectId)}`),
      ]);
      if (activeProjectId === projectId) applySettings(settings, catalog);
    } catch (error) { setSettingsError((error as Error).message); onError((error as Error).message); }
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
      setModels(nextModels);
      setModel(catalog.model || nextModels[0]?.spec || "");
      setEffort(levels.includes(catalog.thinkingLevel) ? catalog.thinkingLevel
        : levels.includes(catalog.defaultThinkingLevel || "") ? catalog.defaultThinkingLevel!
          : levels.includes("medium") ? "medium" : levels[0] || "off");
      setNotice(catalog.requiresAuthentication
        ? `Authenticate ${catalog.runtimeKind === "native_pi" ? "Host Pi" : "Isolated Pi"} to use models.`
        : "");
    } catch (error) {
      if (activeChatId === chatId && requestId === requestSequence) onError((error as Error).message);
    } finally {
      if (activeChatId === chatId && requestId === requestSequence) setChatLoading(false);
    }
  };

  const select = (projectId: string, chatId: string) => {
    const changedProject = activeProjectId !== projectId;
    const changedChat = activeChatId !== chatId;
    activeProjectId = projectId;
    activeChatId = chatId;
    if (changedProject) void reload(projectId);
    if (changedChat) void reloadChat(chatId);
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
      onError((error as Error).message);
      return false;
    } finally { setSaving(false); }
  };

  const chooseModel = async (spec: string) => {
    if (!activeChatId || !models().some((item) => item.spec === spec)) return false;
    const previousModel = model();
    const previousEffort = effort();
    setModel(spec);
    try {
      const selected = models().find((item) => item.spec === spec);
      const levels = asList<string>(selected?.thinkingLevels);
      const nextEffort = levels.includes(previousEffort) ? previousEffort : levels.includes("medium") ? "medium" : levels[0] || "off";
      const payload = await api<ModelState>(`/v0/chats/${encodeURIComponent(activeChatId)}/models`, {
        method: "PATCH",
        body: JSON.stringify({ model: spec, thinkingLevel: nextEffort }),
      });
      setModel(payload.model || spec);
      setEffort(payload.thinkingLevel || nextEffort);
      return true;
    } catch (error) {
      setModel(previousModel);
      setEffort(previousEffort);
      onError((error as Error).message);
      return false;
    }
  };

  const chooseEffort = async (level: string) => {
    if (!activeChatId || !model()) return false;
    const previous = effort();
    setEffort(level);
    try {
      const payload = await api<ModelState>(`/v0/chats/${encodeURIComponent(activeChatId)}/models`, {
        method: "PATCH",
        body: JSON.stringify({ model: model(), thinkingLevel: level }),
      });
      setEffort(payload.thinkingLevel || level);
      return true;
    } catch (error) {
      setEffort(previous);
      onError((error as Error).message);
      return false;
    }
  };

  return {
    allModels, enabledModels, models, settingsDefaultModel, model, effort, notice, settingsError, settingsLoading, chatLoading, saving,
    select, reload, reloadChat, saveScope, chooseModel, chooseEffort,
  };
}

export type ModelSettings = ReturnType<typeof createModelSettings>;
