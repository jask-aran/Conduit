/**
 * Cache efficiency every harness can report the same way. The share of input
 * served from cache is diluted by whatever is new; the eligible hit rate asks
 * only of what could have been cached -- the previous request's prompt, which
 * the next one repeats -- how much the provider actually reused.
 *
 * Each adapter feeds its requests in order as Conduit's request usage
 * ({ input, cacheRead, cacheWrite }, input excluding cache reads).
 */
const count = (value, fallback = null) => {
  if (value == null) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function promptTokenParts(usage) {
  if (!usage || typeof usage !== "object") return null;
  const input = count(usage.input ?? usage.inputTokens);
  if (input == null) return null;
  const cacheRead = count(usage.cacheRead ?? usage.cachedInputTokens, 0);
  const cacheWrite = count(usage.cacheWrite, 0);
  if (cacheRead == null || cacheWrite == null) return null;
  return { promptTokens: input + cacheRead + cacheWrite, cacheRead };
}

export function emptyCacheStats() {
  return { eligibleTokens: 0, cacheHits: 0, cacheMissedTokens: 0, eligibleRequests: 0, eligibleHitRate: null };
}

export function finishCacheStats(stats) {
  return { ...stats, eligibleHitRate: stats.eligibleTokens > 0 ? stats.cacheHits / stats.eligibleTokens : null };
}

/** Counts one request against a tracker ({ stats, previousPromptTokens }) and returns the stats. */
export function countCacheRequest(tracker, usage) {
  const request = promptTokenParts(usage);
  if (!request) return tracker.stats || null;
  if (tracker.previousPromptTokens != null) {
    const eligibleTokens = Math.min(tracker.previousPromptTokens, request.promptTokens);
    const cacheHits = Math.min(request.cacheRead, eligibleTokens);
    const stats = tracker.stats || emptyCacheStats();
    stats.eligibleTokens += eligibleTokens;
    stats.cacheHits += cacheHits;
    stats.cacheMissedTokens += Math.max(0, eligibleTokens - cacheHits);
    stats.eligibleRequests += 1;
    tracker.stats = finishCacheStats(stats);
  }
  tracker.previousPromptTokens = request.promptTokens;
  return tracker.stats || null;
}

/** After a compaction the next prompt repeats nothing. */
export function resetCachePrefix(tracker) { if (tracker) tracker.previousPromptTokens = null; }
