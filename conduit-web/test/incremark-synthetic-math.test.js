import assert from "node:assert/strict";
import test from "node:test";
import katex from "katex";
import { repairSyntheticMathSource } from "../src/client/chat/incremark-synthetic-math.ts";

function rendersStrict(source) {
  const html = katex.renderToString(source, { throwOnError: true });
  assert.equal(html.includes("katex-error"), false, source);
}

test("synthetic math repairs incomplete commands into strict-valid candidates", () => {
  for (const source of ["x^", "\\frac{", "\\frac{1}", "\\sqrt{", "\\sum_{"]) {
    rendersStrict(repairSyntheticMathSource(source));
  }
});

test("synthetic math preserves complete formulas", () => {
  const source = "\\frac{1}{2} + x^2";
  assert.equal(repairSyntheticMathSource(source), source);
  rendersStrict(source);
});
