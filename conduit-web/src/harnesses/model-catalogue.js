/** Asking costs a throwaway daemon, so the answer is kept per folder and refreshed in the background. */
export function createHarnessModelCatalogue() {
  const cached = new Map();
  const inFlight = new Map();

  const refresh = (key, adapter, cwd) => {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const request = adapter.listAvailableModels(cwd)
      .then((models) => { cached.set(key, models); return models; })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, request);
    return request;
  };

  return {
    /**
     * A cached list without `require` is not evidence the model is gone: it may predate an install. So that one case
     * waits for a real answer.
     */
    async list(implementation, cwd, adapter, { require = "" } = {}) {
      const key = `${implementation}\0${cwd}`;
      const models = cached.get(key);
      if (!models) return refresh(key, adapter, cwd);
      if (require && !models.some((item) => item.spec === require)) return refresh(key, adapter, cwd);
      void refresh(key, adapter, cwd).catch(() => {});
      return models;
    },
  };
}
