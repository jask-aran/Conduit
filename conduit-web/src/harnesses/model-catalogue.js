/**
 * What models a harness offers, for a harness with no live process.
 *
 * Asking costs a throwaway daemon - Codex starts an app-server just to answer -
 * so the answer is kept per folder and refreshed in the background. A composer
 * opening on a chat that is not warm yet renders from the last answer instead
 * of waiting on a process start, which is the whole point of showing the model
 * selector from cache rather than behind a spinner.
 */
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
     * The catalogue, from cache when we have one, and always refreshed after.
     *
     * `require` names a model somebody is counting on. A cached list that does
     * not have it is not evidence it is gone -- it may simply predate an
     * install -- and the cache exists to make the catalogue quick, never to be
     * the reason a model looks unavailable. So that one case waits for a real
     * answer, and everything downstream can treat a miss as the truth.
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
