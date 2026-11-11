/**
 * The share of input served from cache is diluted by whatever is new; the eligible hit rate asks only of the previous
 * request's prompt, which the next one repeats, how much the provider reused. Requests come in order as
 * { input, cacheRead, cacheWrite }, input excluding cache reads.
 */
const count = (value, fallback = null) => {
  if (value == null) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function promptTokenParts(usage) {
  if (!usage || typeof usage !== "object") return null;
  const input = count(usage.input ?? usage.inputTokens);
  if (input == null) return null;
  const cacheRead = count(usage.cacheRead ?? usage.cachedInputTokens, 0);
  const cacheWrite = count(usage.cacheWrite, 0);
  if (cacheRead == null || cacheWrite == null) return null;
  return { promptTokens: input + cacheRead + cacheWrite, cacheRead };
}

function emptyCacheStats() {
  return { eligibleTokens: 0, cacheHits: 0, cacheMissedTokens: 0, eligibleRequests: 0, eligibleHitRate: null };
}

function finishCacheStats(stats) {
  return { ...stats, eligibleHitRate: stats.eligibleTokens > 0 ? stats.cacheHits / stats.eligibleTokens : null };
}

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
function resetCachePrefix(tracker) { if (tracker) tracker.previousPromptTokens = null; }

/** A null in `requests` is a compaction. */
export function usageFromRequests(requests, { contextWindow = null, model = null, cost = null, compactAt = null, plan = null } = {}) {
  const tracker = { stats: null, previousPromptTokens: null };
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let last = null;
  let compactions = 0;
  for (const usage of requests) {
    if (!usage) { resetCachePrefix(tracker); compactions += 1; continue; }
    countCacheRequest(tracker, usage);
    for (const key of Object.keys(tokens)) tokens[key] += count(usage[key], 0) || 0;
    last = usage;
  }
  if (!last) return null;
  const used = (last.input || 0) + (last.cacheRead || 0) + (last.cacheWrite || 0) + (last.output || 0);
  const window = count(contextWindow);
  return {
    contextUsage: { tokens: used, contextWindow: window || null, percent: window ? (used / window) * 100 : null,
      model: model || null, lastRequestUsage: last, source: "history", compactions, compactAt: compactAt || null, plan: plan || null },
    sessionStats: { tokens: { ...tokens, total: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite }, cost: cost ?? 0 },
    cacheStats: tracker.stats,
  };
}

export function planWindowLabel(minutes) {
  if (minutes === 300) return "5-hour";
  if (minutes === 10080) return "Weekly";
  if (!minutes) return "Window";
  return minutes % 1440 === 0 ? `${minutes / 1440}-day` : `${Math.round(minutes / 60)}-hour`;
}
