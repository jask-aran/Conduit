import assert from "node:assert/strict";
import test from "node:test";
import katex from "katex";
import { createSyntheticMathPreviewNode, repairSyntheticMathSource } from "../src/client/chat/incremark-synthetic-math.ts";
import { createIncremarkParser } from "@incremark/core";

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

test("synthetic inline preview preserves the existing paragraph shape", () => {
  const parser = createIncremarkParser({ gfm: true, math: { tex: true } });
  const pending = parser.append("The answer is $E = mc^2").pending[0];
  assert.ok(pending);
  const preview = createSyntheticMathPreviewNode(pending.node, { kind: "math-inline", body: "E = mc^2" });
  assert.equal(preview.type, "paragraph");
  assert.deepEqual(preview.children, [
    { type: "text", value: "The answer is " },
    { type: "inlineMath", value: "E = mc^2", __conduitMathSource: "E = mc^2" },
  ]);
});

test("synthetic inline preview patches a table cell without reparsing the table", () => {
  const parser = createIncremarkParser({ gfm: true, math: { tex: true } });
  const pending = parser.append("| Topic | Formula |\n| --- | --- |\n| A | $x^2").pending[0];
  assert.ok(pending);
  const preview = createSyntheticMathPreviewNode(pending.node, { kind: "math-inline", body: "x^2" });
  assert.equal(preview.type, "table");
  assert.equal(preview.children[1].children[1].children[0].type, "inlineMath");
  assert.equal(preview.children[1].children[1].children[0].value, "x^2");
});

test("synthetic TeX inline preview patches the existing paragraph shape", () => {
  const parser = createIncremarkParser({ gfm: true, math: { tex: true } });
  const pending = parser.append("The answer is \\(E = mc^2").pending[0];
  assert.ok(pending);
  const preview = createSyntheticMathPreviewNode(pending.node, { kind: "math-inline", body: "E = mc^2", opening: "\\(" });
  assert.equal(preview.type, "paragraph");
  assert.equal(preview.children[1].type, "inlineMath");
  assert.equal(preview.children[1].value, "E = mc^2");
});

test("synthetic block preview becomes one atomic math node", () => {
  const parser = createIncremarkParser({ gfm: true, math: { tex: true } });
  const pending = parser.append("Before\n\n$$\n\\frac{").pending[0];
  assert.ok(pending);
  const preview = createSyntheticMathPreviewNode(pending.node, { kind: "math-block", body: "\\frac{" });
  assert.equal(preview.type, "math");
  assert.equal(preview.value, "\\frac{");
});
