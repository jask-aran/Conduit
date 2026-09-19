import assert from "node:assert/strict";
import test from "node:test";
import { preferredThinkingLevel } from "../src/client/state/thinking-levels.ts";

test("a model with no thinking levels asks for none", () => {
  // The picker draws an absent level as "off". Sending that word as a level is
  // what a harness whose models have none answered with invalid_thinking_level,
  // and the composer surfaced as a red toast on every speed change.
  assert.equal(preferredThinkingLevel([], "off", ""), "");
  assert.equal(preferredThinkingLevel([], "medium", "high"), "");
});

test("a level is taken when the model offers it, and ignored when it does not", () => {
  assert.equal(preferredThinkingLevel(["low", "medium", "high"], "high", "low"), "high");
  // Remembered from another model that did offer it: not this model's business.
  assert.equal(preferredThinkingLevel(["low", "high"], "medium", "high"), "high");
});

test("without a usable choice it falls to the model's own default, then the middle, then the first", () => {
  assert.equal(preferredThinkingLevel(["low", "medium", "high"], "", "low"), "low");
  assert.equal(preferredThinkingLevel(["low", "medium", "high"], "", "unknown"), "medium");
  assert.equal(preferredThinkingLevel(["minimal", "extreme"], "", ""), "minimal");
});
