import type { CacheStats, ContextUsage, RequestUsage, SessionStats, UsageCost } from "../api/contracts";

export const CONTEXT_METRIC_STORAGE_KEY = "conduit:context-metrics";

export const CONTEXT_METRIC_GROUPS = [
  { id: "context", label: "Context" },
  { id: "lastRequest", label: "Last request" },
  { id: "session", label: "Session totals" },
  { id: "messages", label: "Messages" },
  { id: "tools", label: "Tools" },
] as const;

export const CONTEXT_METRIC_OPTIONS = [
  { id: "contextTokens", group: "context", label: "Context tokens used", description: "Current tokens in the context window." },
  { id: "contextWindow", group: "context", label: "Context window", description: "The model context-window limit." },
  { id: "contextPercentUsed", group: "context", label: "Context percent used", description: "Current context as a percentage of the window." },
  { id: "contextTokensRemaining", group: "context", label: "Context tokens remaining", description: "Window capacity remaining after current context." },
  { id: "contextPercentRemaining", group: "context", label: "Context percent remaining", description: "Window capacity remaining as a percentage." },
  { id: "lastInputTokens", group: "lastRequest", label: "Last input tokens", description: "Non-cached input tokens from the latest request." },
  { id: "lastOutputTokens", group: "lastRequest", label: "Last output tokens", description: "Output tokens from the latest request." },
  { id: "lastCacheReadTokens", group: "lastRequest", label: "Last cache-read tokens", description: "Cache-read tokens from the latest request." },
  { id: "lastCacheWriteTokens", group: "lastRequest", label: "Last cache-write tokens", description: "Cache-write tokens from the latest request." },
  { id: "lastCacheWrite1hTokens", group: "lastRequest", label: "Last 1h cache-write tokens", description: "One-hour cache-write tokens when the provider reports them." },
  { id: "lastCacheReadPercent", group: "lastRequest", label: "Last cache-read percent", description: "Cache-read share of the latest request input." },
  { id: "lastUncachedInputPercent", group: "lastRequest", label: "Last uncached-input percent", description: "Non-cached input share of the latest request input." },
  { id: "lastReasoningTokens", group: "lastRequest", label: "Last reasoning tokens", description: "Reasoning tokens when the provider reports them." },
  { id: "lastTotalTokens", group: "lastRequest", label: "Last total tokens", description: "Total tokens from the latest request." },
  { id: "lastCostInput", group: "lastRequest", label: "Last input cost", description: "Pi-calculated input cost for the latest request." },
  { id: "lastCostOutput", group: "lastRequest", label: "Last output cost", description: "Pi-calculated output cost for the latest request." },
  { id: "lastCostCacheRead", group: "lastRequest", label: "Last cache-read cost", description: "Pi-calculated cache-read cost for the latest request." },
  { id: "lastCostCacheWrite", group: "lastRequest", label: "Last cache-write cost", description: "Pi-calculated cache-write cost for the latest request." },
  { id: "lastCostTotal", group: "lastRequest", label: "Last total cost", description: "Pi-calculated total cost for the latest request." },
  { id: "sessionInputTokens", group: "session", label: "Session input tokens", description: "Cumulative non-cached input tokens." },
  { id: "sessionOutputTokens", group: "session", label: "Session output tokens", description: "Cumulative output tokens." },
  { id: "sessionCacheReadTokens", group: "session", label: "Session cache-read tokens", description: "Cumulative cache-read tokens." },
  { id: "sessionCacheWriteTokens", group: "session", label: "Session cache-write tokens", description: "Cumulative cache-write tokens." },
  { id: "sessionCacheReadPercent", group: "session", label: "Session cache-read percent", description: "Cache-read share of cumulative input usage." },
  { id: "sessionUncachedInputPercent", group: "session", label: "Session uncached-input percent", description: "Non-cached input share of cumulative input usage." },
  { id: "sessionCacheEligibleTokens", group: "session", label: "Session cache-eligible tokens", description: "Cumulative request tokens eligible for a cache hit." },
  { id: "sessionCacheHits", group: "session", label: "Session cache hits", description: "Cumulative eligible tokens served from the cache." },
  { id: "sessionCacheMissedTokens", group: "session", label: "Session cache-missed tokens", description: "Cumulative eligible tokens not served from the cache." },
  { id: "sessionCacheEligibleHitPercent", group: "session", label: "Session eligible cache-hit percent", description: "Cumulative cache hits divided by cumulative eligible tokens." },
  { id: "sessionTotalTokens", group: "session", label: "Session total tokens", description: "Cumulative total tokens." },
  { id: "sessionCost", group: "session", label: "Session total cost", description: "Pi-calculated cumulative session cost." },
  { id: "userMessages", group: "messages", label: "User messages", description: "Cumulative user-message count." },
  { id: "assistantMessages", group: "messages", label: "Assistant messages", description: "Cumulative assistant-message count." },
  { id: "totalMessages", group: "messages", label: "Total messages", description: "Cumulative total-message count." },
  { id: "toolCalls", group: "tools", label: "Tool calls", description: "Cumulative tool-call count." },
  { id: "toolResults", group: "tools", label: "Tool results", description: "Cumulative tool-result count." },
] as const;

export type ContextMetricId = typeof CONTEXT_METRIC_OPTIONS[number]["id"];

export const ALL_CONTEXT_METRICS: ContextMetricId[] = CONTEXT_METRIC_OPTIONS.map((option) => option.id);

const COMPACT_CONTEXT_METRICS = [
  "contextTokens", "contextWindow", "contextPercentUsed", "contextPercentRemaining",
  "lastInputTokens", "lastOutputTokens", "lastCacheReadTokens", "lastCacheWriteTokens", "lastCostTotal",
  "sessionInputTokens", "sessionOutputTokens", "sessionCacheReadTokens", "sessionCacheEligibleHitPercent", "sessionCost",
] as const satisfies readonly ContextMetricId[];

const CACHE_DIAGNOSTICS_CONTEXT_METRICS = [
  "contextTokens", "contextWindow", "contextPercentUsed", "contextPercentRemaining",
  "lastInputTokens", "lastOutputTokens", "lastCacheReadTokens", "lastCacheWriteTokens", "lastCacheReadPercent", "lastUncachedInputPercent",
  "sessionInputTokens", "sessionCacheReadTokens", "sessionCacheWriteTokens", "sessionCacheReadPercent", "sessionUncachedInputPercent",
  "sessionCacheEligibleTokens", "sessionCacheHits", "sessionCacheMissedTokens", "sessionCacheEligibleHitPercent",
] as const satisfies readonly ContextMetricId[];

export const CONTEXT_METRIC_PRESETS = [
  {
    id: "compact",
    label: "Compact",
    description: "Core context, latest request, session totals, cache-read tokens, and eligible hit rate.",
    metrics: COMPACT_CONTEXT_METRICS,
  },
  {
    id: "full",
    label: "Full",
    description: "Every available context, request, session, message, and tool measure.",
    metrics: ALL_CONTEXT_METRICS,
  },
  {
    id: "cacheDiagnostics",
    label: "Cache diagnostics",
    description: "Detailed current and cumulative cache-read, uncached, eligible, hit, and missed measures.",
    metrics: CACHE_DIAGNOSTICS_CONTEXT_METRICS,
  },
] as const;

export type ContextMetricPresetId = typeof CONTEXT_METRIC_PRESETS[number]["id"];
export type ContextMetricSelection = ContextMetricPresetId | "custom";
export const DEFAULT_CONTEXT_METRICS: ContextMetricId[] = [...COMPACT_CONTEXT_METRICS];

const knownMetricIds = new Set<ContextMetricId>(ALL_CONTEXT_METRICS);

export function normalizeContextMetrics(value: unknown): ContextMetricId[] {
  if (!Array.isArray(value)) return [...DEFAULT_CONTEXT_METRICS];
  const selected = new Set(value.filter((item): item is ContextMetricId => typeof item === "string" && knownMetricIds.has(item as ContextMetricId)));
  return ALL_CONTEXT_METRICS.filter((id) => selected.has(id));
}

export function metricsForContextMetricPreset(id: ContextMetricPresetId): ContextMetricId[] {
  const preset = CONTEXT_METRIC_PRESETS.find((item) => item.id === id);
  return [...(preset?.metrics || DEFAULT_CONTEXT_METRICS)];
}

export function contextMetricPreset(value: unknown): ContextMetricSelection {
  const normalized = normalizeContextMetrics(value);
  const matching = CONTEXT_METRIC_PRESETS.find((preset) => preset.metrics.length === normalized.length
    && preset.metrics.every((id, index) => normalized[index] === id));
  return matching?.id || "custom";
}

export function selectedContextMetrics(): ContextMetricId[] {
  if (typeof localStorage === "undefined") return [...DEFAULT_CONTEXT_METRICS];
  try {
    const stored = localStorage.getItem(CONTEXT_METRIC_STORAGE_KEY);
    return stored == null ? [...DEFAULT_CONTEXT_METRICS] : normalizeContextMetrics(JSON.parse(stored));
  } catch {
    return [...DEFAULT_CONTEXT_METRICS];
  }
}

export function saveContextMetrics(value: unknown): ContextMetricId[] {
  const normalized = normalizeContextMetrics(value);
  if (typeof localStorage !== "undefined") {
    try { localStorage.setItem(CONTEXT_METRIC_STORAGE_KEY, JSON.stringify(normalized)); } catch { /* Browser storage can be unavailable. */ }
  }
  return normalized;
}

const numberValue = (value: unknown): number | null => {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const numberText = (value: unknown) => {
  const number = numberValue(value);
  return number == null ? "?" : number.toLocaleString();
};

const percentValue = (value: unknown) => {
  const number = numberValue(value);
  if (number == null) return null;
  return number <= 1 ? number * 100 : number;
};

const percentText = (value: unknown) => {
  const percent = percentValue(value);
  return percent == null ? "?%" : `${Math.round(percent)}%`;
};

const percentageText = (value: unknown) => {
  const percent = numberValue(value);
  return percent == null ? "?%" : `${Math.round(percent)}%`;
};

const costText = (value: unknown) => {
  const number = numberValue(value);
  return number == null ? "?" : `$${number.toFixed(3)}`;
};

const ratioText = (numerator: unknown, denominatorParts: unknown[]) => {
  const numeratorValue = numberValue(numerator);
  const denominatorValues = denominatorParts.map(numberValue);
  const knownDenominatorValues = denominatorValues.filter((value): value is number => value != null);
  if (numeratorValue == null || knownDenominatorValues.length !== denominatorValues.length) return "?%";
  const denominator = knownDenominatorValues.reduce((sum, value) => sum + value, 0);
  return denominator > 0 ? percentText(numeratorValue / denominator) : "?%";
};

const costValue = (cost: UsageCost | null | undefined, key: keyof UsageCost) => costText(cost?.[key]);

const requestInputParts = (usage: RequestUsage | null | undefined) => [usage?.input, usage?.cacheRead, usage?.cacheWrite];
const sessionInputParts = (stats: SessionStats | null) => [stats?.tokens.input, stats?.tokens.cacheRead, stats?.tokens.cacheWrite];

const contextTokens = (usage: ContextUsage | null) => numberValue(usage?.tokens ?? usage?.used);
const contextWindow = (usage: ContextUsage | null) => numberValue(usage?.contextWindow ?? usage?.limit);

export function contextUsagePercent(usage: ContextUsage | null) {
  const reported = numberValue(usage?.percent);
  if (reported != null) return reported;
  const tokens = contextTokens(usage);
  const window = contextWindow(usage);
  return tokens != null && window != null && window > 0 ? (tokens / window) * 100 : null;
}

const contextRemainingTokens = (usage: ContextUsage | null) => {
  const tokens = contextTokens(usage);
  const window = contextWindow(usage);
  return tokens != null && window != null ? Math.max(0, window - tokens) : null;
};

const contextRemainingPercent = (usage: ContextUsage | null) => {
  const used = contextUsagePercent(usage);
  return used == null ? null : Math.max(0, 100 - used);
};

const cacheMetricIds = new Set<ContextMetricId>([
  "sessionCacheEligibleTokens", "sessionCacheHits", "sessionCacheMissedTokens", "sessionCacheEligibleHitPercent",
]);

function formatMetric(id: ContextMetricId, contextUsage: ContextUsage | null, sessionStats: SessionStats | null, cacheStats: CacheStats | null) {
  const request = contextUsage?.lastRequestUsage;
  if (id.startsWith("context") && !contextUsage) return "";
  if (id.startsWith("last") && !request) return "";
  if (id.startsWith("session") && (cacheMetricIds.has(id) ? !cacheStats : !sessionStats)) return "";
  if (["userMessages", "assistantMessages", "totalMessages", "toolCalls", "toolResults"].includes(id) && !sessionStats) return "";

  switch (id) {
    case "contextTokens": return `used ${numberText(contextTokens(contextUsage))}`;
    case "contextWindow": return `window ${numberText(contextWindow(contextUsage))}`;
    case "contextPercentUsed": return `used ${percentageText(contextUsagePercent(contextUsage))}`;
    case "contextTokensRemaining": return `remaining ${numberText(contextRemainingTokens(contextUsage))}`;
    case "contextPercentRemaining": return `remaining ${percentageText(contextRemainingPercent(contextUsage))}`;
    case "lastInputTokens": return `input ${numberText(request?.input)}`;
    case "lastOutputTokens": return `output ${numberText(request?.output)}`;
    case "lastCacheReadTokens": return `cache-read ${numberText(request?.cacheRead)}`;
    case "lastCacheWriteTokens": return `cache-write ${numberText(request?.cacheWrite)}`;
    case "lastCacheWrite1hTokens": return `1h cache-write ${numberText(request?.cacheWrite1h)}`;
    case "lastCacheReadPercent": return `cache-read ${ratioText(request?.cacheRead, requestInputParts(request))}`;
    case "lastUncachedInputPercent": return `uncached ${ratioText(request?.input, requestInputParts(request))}`;
    case "lastReasoningTokens": return `reasoning ${numberText(request?.reasoning)}`;
    case "lastTotalTokens": return `total ${numberText(request?.totalTokens)}`;
    case "lastCostInput": return `input cost ${costValue(request?.cost, "input")}`;
    case "lastCostOutput": return `output cost ${costValue(request?.cost, "output")}`;
    case "lastCostCacheRead": return `cache-read cost ${costValue(request?.cost, "cacheRead")}`;
    case "lastCostCacheWrite": return `cache-write cost ${costValue(request?.cost, "cacheWrite")}`;
    case "lastCostTotal": return `total cost ${costValue(request?.cost, "total")}`;
    case "sessionInputTokens": return `input ${numberText(sessionStats?.tokens.input)}`;
    case "sessionOutputTokens": return `output ${numberText(sessionStats?.tokens.output)}`;
    case "sessionCacheReadTokens": return `cache-read ${numberText(sessionStats?.tokens.cacheRead)}`;
    case "sessionCacheWriteTokens": return `cache-write ${numberText(sessionStats?.tokens.cacheWrite)}`;
    case "sessionCacheReadPercent": return `cache-read ${ratioText(sessionStats?.tokens.cacheRead, sessionInputParts(sessionStats))}`;
    case "sessionUncachedInputPercent": return `uncached ${ratioText(sessionStats?.tokens.input, sessionInputParts(sessionStats))}`;
    case "sessionCacheEligibleTokens": return `eligible ${numberText(cacheStats?.eligibleTokens)}`;
    case "sessionCacheHits": return `hits ${numberText(cacheStats?.cacheHits)}`;
    case "sessionCacheMissedTokens": return `missed ${numberText(cacheStats?.cacheMissedTokens)}`;
    case "sessionCacheEligibleHitPercent": return `eligible hit ${percentText(cacheStats?.eligibleHitRate)}`;
    case "sessionTotalTokens": return `total ${numberText(sessionStats?.tokens.total)}`;
    case "sessionCost": return `cost ${costText(sessionStats?.cost)}`;
    case "userMessages": return `user ${numberText(sessionStats?.userMessages)}`;
    case "assistantMessages": return `assistant ${numberText(sessionStats?.assistantMessages)}`;
    case "totalMessages": return `total ${numberText(sessionStats?.totalMessages)}`;
    case "toolCalls": return `calls ${numberText(sessionStats?.toolCalls)}`;
    case "toolResults": return `results ${numberText(sessionStats?.toolResults)}`;
  }
}

export function formatContextMetrics({
  enabled,
  contextUsage,
  sessionStats,
  cacheStats,
}: {
  enabled: readonly ContextMetricId[];
  contextUsage: ContextUsage | null;
  sessionStats: SessionStats | null;
  cacheStats?: CacheStats | null;
}) {
  const grouped = new Map<string, string[]>();
  for (const option of CONTEXT_METRIC_OPTIONS) {
    if (!enabled.includes(option.id)) continue;
    const value = formatMetric(option.id, contextUsage, sessionStats, cacheStats || null);
    if (!value) continue;
    const values = grouped.get(option.group) || [];
    values.push(value);
    grouped.set(option.group, values);
  }
  return CONTEXT_METRIC_GROUPS
    .map((group) => {
      const values = grouped.get(group.id);
      return values?.length ? `${group.label.replace(" totals", "")} ${values.join(" · ")}` : "";
    })
    .filter(Boolean)
    .join(" · ");
}
