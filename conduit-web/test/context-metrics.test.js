import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTEXT_METRIC_STORAGE_KEY,
  ALL_CONTEXT_METRICS,
  CONTEXT_METRIC_PRESETS,
  DEFAULT_CONTEXT_METRICS,
  contextMetricPreset,
  formatContextMetrics,
  metricsForContextMetricPreset,
  normalizeContextMetrics,
  saveContextMetrics,
  selectedContextMetrics,
} from "../src/client/chat/context-metrics.ts";

test("context metric preferences use canonical order and keep an explicit empty selection", () => {
  assert.deepEqual(normalizeContextMetrics(["toolResults", "contextPercentRemaining", "toolResults", "unknown"]), ["contextPercentRemaining", "toolResults"]);
  assert.deepEqual(normalizeContextMetrics([]), []);
  assert.deepEqual(normalizeContextMetrics(null), DEFAULT_CONTEXT_METRICS);
});

test("context metric presets cover compact, full, cache diagnostics, and custom", () => {
  assert.equal(contextMetricPreset(DEFAULT_CONTEXT_METRICS), "compact");
  assert.equal(metricsForContextMetricPreset("full").length, ALL_CONTEXT_METRICS.length);
  assert.equal(contextMetricPreset(metricsForContextMetricPreset("cacheDiagnostics")), "cacheDiagnostics");
  assert.equal(contextMetricPreset([...DEFAULT_CONTEXT_METRICS, "toolResults"]), "custom");
  assert.deepEqual(CONTEXT_METRIC_PRESETS.map((preset) => preset.id), ["compact", "full", "cacheDiagnostics"]);
});

test("context metric preferences persist in browser storage", () => {
  const previous = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  try {
    assert.deepEqual(selectedContextMetrics(), DEFAULT_CONTEXT_METRICS);
    saveContextMetrics(["toolResults", "contextTokens"]);
    assert.equal(values.get(CONTEXT_METRIC_STORAGE_KEY), '["contextTokens","toolResults"]');
    assert.deepEqual(selectedContextMetrics(), ["contextTokens", "toolResults"]);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test("context metrics format the complete Pi usage stream in canonical order", () => {
  const value = formatContextMetrics({
    enabled: ALL_CONTEXT_METRICS,
    contextUsage: {
      tokens: 12400,
      contextWindow: 128000,
      percent: 9.6875,
      lastRequestUsage: {
        input: 8200,
        output: 1100,
        cacheRead: 7000,
        cacheWrite: 200,
        cacheWrite1h: 100,
        reasoning: 300,
        totalTokens: 16500,
        cost: { input: 0.01, output: 0.02, cacheRead: 0.003, cacheWrite: 0.004, total: 0.037 },
      },
    },
    sessionStats: {
      userMessages: 8,
      assistantMessages: 8,
      toolCalls: 12,
      toolResults: 12,
      totalMessages: 28,
      tokens: { input: 240000, output: 31000, cacheRead: 180000, cacheWrite: 12000, total: 463000 },
      cost: 0.84,
    },
    cacheStats: { eligibleTokens: 100000, cacheHits: 80000, cacheMissedTokens: 20000, eligibleRequests: 5, eligibleHitRate: 0.8 },
  });
  assert.match(value, /^Context used 12,400 · window 128,000 · used 10% · remaining 115,600 · remaining 90%/);
  assert.match(value, /Last request input 8,200 · output 1,100 · cache-read 7,000 · cache-write 200 · 1h cache-write 100 · cache-read 45% · uncached 53% · reasoning 300 · total 16,500/);
  assert.match(value, /input cost \$0\.010 · output cost \$0\.020 · cache-read cost \$0\.003 · cache-write cost \$0\.004 · total cost \$0\.037/);
  assert.match(value, /Session input 240,000 · output 31,000 · cache-read 180,000 · cache-write 12,000 · cache-read 42% · uncached 56% · eligible 100,000 · hits 80,000 · missed 20,000 · eligible hit 80% · total 463,000 · cost \$0\.840/);
  assert.match(value, /Messages user 8 · assistant 8 · total 28 · Tools calls 12 · results 12$/);
  assert.ok(value.indexOf("Context ") < value.indexOf("Last request "));
  assert.ok(value.indexOf("Last request ") < value.indexOf("Session "));
  assert.ok(value.indexOf("Session ") < value.indexOf("Messages "));
  assert.ok(value.indexOf("Messages ") < value.indexOf("Tools "));
});

test("unknown context values remain visible as unknown", () => {
  const value = formatContextMetrics({
    enabled: ["contextTokens", "contextWindow", "contextPercentUsed", "contextTokensRemaining", "contextPercentRemaining"],
    contextUsage: { tokens: null, contextWindow: 128000, percent: null },
    sessionStats: null,
  });
  assert.equal(value, "Context used ? · window 128,000 · used ?% · remaining ? · remaining ?%");
});

test("derives context remaining values when Pi omits the percentage", () => {
  assert.equal(formatContextMetrics({
    enabled: ["contextPercentUsed", "contextTokensRemaining", "contextPercentRemaining"],
    contextUsage: { tokens: 400, contextWindow: 1000, percent: null },
    sessionStats: null,
  }), "Context used 40% · remaining 600 · remaining 60%");
});

test("formats cumulative eligible cache-hit measures", () => {
  assert.equal(formatContextMetrics({
    enabled: ["sessionCacheEligibleTokens", "sessionCacheHits", "sessionCacheMissedTokens", "sessionCacheEligibleHitPercent"],
    contextUsage: null,
    sessionStats: null,
    cacheStats: { eligibleTokens: 1000, cacheHits: 850, cacheMissedTokens: 150, eligibleRequests: 3, eligibleHitRate: 0.85 },
  }), "Session eligible 1,000 · hits 850 · missed 150 · eligible hit 85%");
});

test("does not reserve the status line for unavailable metrics", () => {
  assert.equal(formatContextMetrics({
    enabled: ALL_CONTEXT_METRICS,
    contextUsage: null,
    sessionStats: null,
  }), "");
});
