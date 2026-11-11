export function createAllowCache({ ttlMs = 1_800_000, max = 500 } = {}) {
  const entries = new Map();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      if (entry.expires <= Date.now()) return undefined;
      entries.set(key, entry);
      return { ...entry.verdict, source: "cache" };
    },
    set(key, verdict) {
      if (verdict.outcome !== "allow" || !["low", "medium"].includes(verdict.risk)) return;
      if (!(max > 0) || !(ttlMs > 0)) return;
      entries.delete(key);
      entries.set(key, { verdict: { ...verdict }, expires: Date.now() + ttlMs });
      while (entries.size > max) entries.delete(entries.keys().next().value);
    },
    clear() { entries.clear(); },
  };
}
