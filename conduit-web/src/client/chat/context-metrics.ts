import type { ContextCategory, ContextUsage, RequestUsage, SessionTokenUsage } from "../api/contracts";

const numberValue = (value: unknown): number | null => {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const contextTokens = (usage: ContextUsage | null) => numberValue(usage?.tokens ?? usage?.used);
export const contextWindow = (usage: ContextUsage | null) => numberValue(usage?.contextWindow ?? usage?.limit);

export function contextUsagePercent(usage: ContextUsage | null) {
  const reported = numberValue(usage?.percent);
  if (reported != null) return reported;
  const tokens = contextTokens(usage);
  const window = contextWindow(usage);
  return tokens != null && window != null && window > 0 ? (tokens / window) * 100 : null;
}

/**
 * What fills the window, in any harness: its own categories when it itemises
 * them, otherwise one "Used" against the free space -- so the breakdown always
 * draws, and a harness that learns to itemise only adds rows.
 */
export function contextBreakdown(usage: ContextUsage | null): ContextCategory[] {
  const reported = usage?.categories?.filter((category) => category.tokens > 0 || category.kind === "free");
  if (reported?.length) return reported;
  const tokens = contextTokens(usage);
  if (tokens == null) return [];
  const window = contextWindow(usage);
  return [
    { id: "used" as const, label: "Used", tokens, kind: "used" as const },
    ...(window != null ? [{ id: "free" as const, label: "Free space", tokens: Math.max(0, window - tokens), kind: "free" as const }] : []),
  ];
}

/** How much of the input the provider served from its cache: over the session
    when the harness keeps totals, else for the last request. */
export function cacheHitPercent(usage: RequestUsage | Partial<SessionTokenUsage> | null | undefined) {
  const read = numberValue(usage?.cacheRead);
  if (read == null) return null;
  const input = read + (numberValue(usage?.input) ?? 0) + (numberValue(usage?.cacheWrite) ?? 0);
  return input > 0 ? (read / input) * 100 : null;
}

export const compactTokens = (value: number) => value >= 1_000_000 ? `${+(value / 1_000_000).toFixed(1)}M`
  : value >= 1000 ? `${+(value / 1000).toFixed(1)}k` : String(Math.round(value));
