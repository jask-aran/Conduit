import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const list = (value) => Array.isArray(value) ? value : [];

async function api(url, options) {
  const response = await fetch(url, { headers: { "content-type": "application/json" }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error || "Request failed");
  return body;
}

export function useModelSettings(projectId, chatId, { onError } = {}) {
  const [allModels, setAllModels] = useState([]);
  const [enabledModels, setEnabledModels] = useState([]);
  const [chatModels, setChatModels] = useState([]);
  const [settingsDefaultModel, setSettingsDefaultModel] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const currentChatId = useRef(chatId);
  const chatRequestSequence = useRef(0);
  currentChatId.current = chatId;

  const applySettings = useCallback((settings, catalog = null) => {
    const nextAll = list(settings.models);
    const enabled = list(settings.enabledModels);
    const nextModel = enabled.includes(settings.defaultModel) ? settings.defaultModel : enabled[0] || "";
    setAllModels(nextAll);
    setEnabledModels(enabled);
    setSettingsDefaultModel(nextModel);
    if (catalog) setNotice(catalog.requiresAuthentication ? "Authenticate with conduit-pi, then run /login." : "");
  }, []);

  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [settings, catalog] = await Promise.all([
        api(`/v0/settings?projectId=${encodeURIComponent(projectId)}`),
        api(`/v0/models?projectId=${encodeURIComponent(projectId)}`),
      ]);
      applySettings(settings, catalog);
    } catch (error) { onError?.(error.message); }
    finally { setLoading(false); }
  }, [applySettings, onError, projectId]);

  useEffect(() => { reload(); }, [reload]);

  const reloadChat = useCallback(async () => {
    if (!chatId) return;
    const requestedChatId = chatId;
    const requestId = ++chatRequestSequence.current;
    setLoading(true);
    try {
      const catalog = await api(`/v0/chats/${encodeURIComponent(chatId)}/models`);
      if (currentChatId.current !== requestedChatId || chatRequestSequence.current !== requestId) return;
      const models = list(catalog.models);
      const selectedModel = models.find((item) => item.spec === catalog.model) || null;
      const levels = list(selectedModel?.thinkingLevels);
      setChatModels(models);
      setModel(catalog.model || models[0]?.spec || "");
      setEffort(levels.includes(catalog.thinkingLevel)
        ? catalog.thinkingLevel
        : levels.includes(catalog.defaultThinkingLevel) ? catalog.defaultThinkingLevel
          : levels.includes("medium") ? "medium" : levels[0] || "off");
      setNotice(catalog.requiresAuthentication
        ? `Authenticate ${catalog.runtimeKind === "native_pi" ? "Host Pi" : "Isolated Pi"} to use models.`
        : "");
    } catch (error) {
      if (currentChatId.current === requestedChatId && chatRequestSequence.current === requestId) onError?.(error.message);
    } finally {
      if (currentChatId.current === requestedChatId && chatRequestSequence.current === requestId) setLoading(false);
    }
  }, [chatId, onError]);

  useEffect(() => { reloadChat(); }, [reloadChat]);

  const save = useCallback(async (nextEnabled, defaultModel = settingsDefaultModel) => {
    const previous = { enabledModels, settingsDefaultModel };
    const allowedDefault = nextEnabled.includes(defaultModel) ? defaultModel : nextEnabled[0] || "";
    setEnabledModels(nextEnabled);
    setSettingsDefaultModel(allowedDefault);
    setSaving(true);
    try {
      const payload = await api("/v0/settings", {
        method: "PATCH",
        body: JSON.stringify({ projectId, enabledModels: nextEnabled, defaultModel: allowedDefault }),
      });
      applySettings(payload);
      await reloadChat();
      return true;
    } catch (error) {
      setEnabledModels(previous.enabledModels);
      setSettingsDefaultModel(previous.settingsDefaultModel);
      onError?.(error.message);
      return false;
    } finally { setSaving(false); }
  }, [applySettings, enabledModels, onError, projectId, reloadChat, settingsDefaultModel]);

  const chooseModel = useCallback(async (spec) => {
    if (!chatId || !chatModels.some((item) => item.spec === spec)) return false;
    const previous = { model, effort };
    setModel(spec);
    try {
      const selected = chatModels.find((item) => item.spec === spec);
      const levels = list(selected?.thinkingLevels);
      const nextEffort = levels.includes(effort) ? effort : levels.includes("medium") ? "medium" : levels[0] || "off";
      const payload = await api(`/v0/chats/${encodeURIComponent(chatId)}/models`, {
        method: "PATCH",
        body: JSON.stringify({ model: spec, thinkingLevel: nextEffort }),
      });
      setModel(payload.model || spec);
      setEffort(payload.thinkingLevel || nextEffort);
      return true;
    } catch (error) {
      setModel(previous.model);
      setEffort(previous.effort);
      onError?.(error.message);
      return false;
    }
  }, [chatId, chatModels, effort, model, onError]);

  const chooseEffort = useCallback(async (level) => {
    if (!chatId || !model) return false;
    const previous = effort;
    setEffort(level);
    try {
      const payload = await api(`/v0/chats/${encodeURIComponent(chatId)}/models`, {
        method: "PATCH",
        body: JSON.stringify({ model, thinkingLevel: level }),
      });
      setEffort(payload.thinkingLevel || level);
      return true;
    } catch (error) {
      setEffort(previous);
      onError?.(error.message);
      return false;
    }
  }, [chatId, effort, model, onError]);

  const models = useMemo(() => chatModels, [chatModels]);

  return {
    allModels, enabledModels, models, model, effort, notice, loading, saving,
    chooseModel, chooseEffort, saveScope: save, reload, reloadChat,
  };
}
