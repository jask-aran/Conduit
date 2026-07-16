import { useCallback, useEffect, useMemo, useState } from "react";

const list = (value) => Array.isArray(value) ? value : [];

async function api(url, options) {
  const response = await fetch(url, { headers: { "content-type": "application/json" }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error || "Request failed");
  return body;
}

export function useModelSettings(projectId, { onError, socketRef } = {}) {
  const [allModels, setAllModels] = useState([]);
  const [enabledModels, setEnabledModels] = useState([]);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const apply = useCallback((settings, catalog = null) => {
    const nextAll = list(settings.models);
    const enabled = list(settings.enabledModels);
    const nextModel = enabled.includes(settings.defaultModel) ? settings.defaultModel : enabled[0] || "";
    setAllModels(nextAll);
    setEnabledModels(enabled);
    setModel((current) => enabled.includes(current) ? current : nextModel);
    const selected = nextAll.find((item) => item.spec === nextModel);
    const levels = list(selected?.thinkingLevels);
    setEffort((current) => levels.includes(current)
      ? current
      : levels.includes(catalog?.defaultThinkingLevel) ? catalog.defaultThinkingLevel
        : levels.includes("medium") ? "medium" : levels[0] || "off");
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
      apply(settings, catalog);
    } catch (error) { onError?.(error.message); }
    finally { setLoading(false); }
  }, [apply, onError, projectId]);

  useEffect(() => { reload(); }, [reload]);

  const save = useCallback(async (nextEnabled, defaultModel = model) => {
    const previous = { enabledModels, model };
    const allowedDefault = nextEnabled.includes(defaultModel) ? defaultModel : nextEnabled[0] || "";
    setEnabledModels(nextEnabled);
    setModel(allowedDefault);
    setSaving(true);
    try {
      const payload = await api("/v0/settings", {
        method: "PATCH",
        body: JSON.stringify({ projectId, enabledModels: nextEnabled, defaultModel: allowedDefault }),
      });
      apply(payload);
      return true;
    } catch (error) {
      setEnabledModels(previous.enabledModels);
      setModel(previous.model);
      onError?.(error.message);
      return false;
    } finally { setSaving(false); }
  }, [apply, enabledModels, model, onError, projectId]);

  const chooseModel = useCallback(async (spec) => {
    if (!enabledModels.includes(spec)) return false;
    const previous = model;
    setModel(spec);
    const saved = await save(enabledModels, spec);
    if (!saved) setModel(previous);
    if (saved && socketRef?.current?.readyState === WebSocket.OPEN) {
      const [provider, ...modelParts] = spec.split("/");
      socketRef.current.send(JSON.stringify({ type: "set_model", provider, modelId: modelParts.join("/") }));
    }
    return saved;
  }, [enabledModels, model, save, socketRef]);

  const chooseEffort = useCallback((level) => {
    setEffort(level);
    if (socketRef?.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "set_thinking_level", level }));
    }
  }, [socketRef]);

  const models = useMemo(() => {
    const enabled = new Set(enabledModels);
    return allModels.filter((item) => enabled.has(item.spec));
  }, [allModels, enabledModels]);

  return {
    allModels, enabledModels, models, model, effort, notice, loading, saving,
    chooseModel, chooseEffort, saveScope: save, reload,
  };
}
