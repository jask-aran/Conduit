import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAdaptiveRate,
  calculateBacklogAgeMs,
  calculateControlRate,
  chooseAdaptiveCharsPerTick,
  chooseAdaptiveTickInterval,
  chooseCharsPerTick,
  chooseFallbackMode,
  chooseTickInterval,
  isFrameHealthy,
  normalizeFrameInterval,
  prepareTypewriterNode,
  updateFrameInterval,
  updateRateEma,
  visibleAstCharacters,
} from "../src/client/chat/incremark-typewriter.ts";

test("the first observed rate seeds the EMA and later samples use alpha 0.25", () => {
  assert.equal(updateRateEma(null, 400), 400);
  assert.equal(updateRateEma(400, 800), 500);
});

test("a provider stall lowers the observed sample instead of creating catch-up credit", () => {
  const observed = updateRateEma(null, 20 / 1000 * 1000);
  assert.equal(observed, 20);
  assert.equal(updateRateEma(observed, 10 / 1000 * 1000), 17.5);
});

test("the lag controller targets both provider lead and backlog age", () => {
  assert.deepEqual(calculateAdaptiveRate(900, 0), {
    leadRate: 1000,
    catchUpRate: 0,
    targetRate: 1000,
  });
  assert.deepEqual(calculateAdaptiveRate(100, 100), {
    leadRate: 111.11111111111111,
    catchUpRate: 400,
    targetRate: 400,
  });
});

test("the control rate includes provider work while draining backlog", () => {
  assert.equal(calculateControlRate(1_000, 250), 2_000);
  assert.equal(calculateControlRate(1_000, 250, undefined, undefined, 1_000), 2_500);
});

test("backlog age measures provider-time distance, not time since backlog first appeared", () => {
  assert.equal(calculateBacklogAgeMs(125, 500), 250);
  assert.equal(calculateBacklogAgeMs(125, null), 0);
});

test("high-rate providers are not limited by a fixed visible-character ceiling", () => {
  const rate = calculateAdaptiveRate(7_000, 0);
  const step = chooseCharsPerTick(rate.targetRate, 16, 1_000, 0);
  assert.ok(rate.targetRate > 180);
  assert.ok(step > 180 * 16 / 1000);
});

test("frame work limits the step and relaxes the tick interval", () => {
  assert.equal(chooseTickInterval(2), 16);
  assert.equal(chooseTickInterval(12), 32);
  assert.equal(chooseCharsPerTick(10_000, 33, 100, 40), 20);
});

test("tick cadence follows the measured display refresh interval", () => {
  const refresh144Hz = 1000 / 144;
  assert.ok(Math.abs(normalizeFrameInterval(refresh144Hz) - refresh144Hz) < 0.001);
  assert.equal(normalizeFrameInterval(1), 16);
  assert.ok(Math.abs(updateFrameInterval(null, refresh144Hz) - refresh144Hz) < 0.001);
  assert.ok(Math.abs(chooseTickInterval(2, refresh144Hz) - refresh144Hz) < 0.001);
  assert.ok(Math.abs(chooseTickInterval(12, refresh144Hz) - refresh144Hz * 2) < 0.001);
});

test("source updates can ramp the step before the next display frame", () => {
  assert.equal(chooseCharsPerTick(10_000, 16, 1, 0, 8, true), 4);
  assert.equal(chooseCharsPerTick(10_000, 16, 4, 0, 8, true), 16);
});

test("adaptive Typewriter growth is gradual and only display frames may grow it", () => {
  assert.equal(chooseAdaptiveCharsPerTick(10_000, 16, 1, true, true), 2);
  assert.equal(chooseAdaptiveCharsPerTick(10_000, 16, 4, true, true), 5);
  assert.equal(chooseAdaptiveCharsPerTick(10_000, 16, 20, true, false), 20);
});

test("adaptive Typewriter reduces the step by a quarter when frame health degrades", () => {
  assert.equal(chooseAdaptiveCharsPerTick(10_000, 16, 20, false, true), 15);
  assert.equal(chooseAdaptiveCharsPerTick(10_000, 16, 2, false, true), 1);
});

test("adaptive frame health includes browser commit and frame-gap cost", () => {
  assert.equal(isFrameHealthy(4, 20, 18, 16), true);
  assert.equal(isFrameHealthy(9, 20, 18, 16), false);
  assert.equal(isFrameHealthy(4, 30, 18, 16), false);
  assert.equal(isFrameHealthy(4, 20, 30, 16), false);
  assert.equal(chooseAdaptiveTickInterval(4, 20, 18, 16), 16);
  assert.equal(chooseAdaptiveTickInterval(9, 20, 18, 16), 32);
});

test("frame work selects safe-step and safe-block fallback modes", () => {
  assert.equal(chooseFallbackMode(12, 1), "safe-step");
  assert.equal(chooseFallbackMode(12, 8, true), "safe-block");
  assert.equal(chooseFallbackMode(2, 8), "normal");
});

test("math is one visible atomic character while ordinary AST text is retained", () => {
  assert.equal(visibleAstCharacters({ type: "paragraph", children: [
    { type: "text", value: "before " },
    { type: "inlineMath", value: "x^2 + y^2" },
    { type: "text", value: " after" },
  ] }), 14);
});

test("nested math is prepared as an atomic leaf for the native slicer", () => {
  const node = prepareTypewriterNode({ type: "paragraph", children: [
    { type: "text", value: "before " },
    { type: "inlineMath", value: "\\frac{a}{b}" },
    { type: "text", value: " after" },
  ] });
  assert.equal(node.children[1].value, undefined);
  assert.equal(node.children[1].__conduitMathSource, "\\frac{a}{b}");
  assert.equal(visibleAstCharacters(node), 14);
});
