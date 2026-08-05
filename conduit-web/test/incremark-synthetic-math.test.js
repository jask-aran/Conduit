import assert from "node:assert/strict";
import test from "node:test";
import katex from "katex";
import { createSyntheticMathPreviewNode, repairSyntheticMathSource } from "../src/client/chat/incremark-synthetic-math.ts";
import { projectTableMathSource, promoteTableCellDisplayMath, restoreTableMathAst } from "../src/client/chat/table-math.ts";
import { splitStreamingMarkdown } from "../src/client/chat/streaming-markdown.ts";
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

test("table math projection protects pipes without changing ordinary table separators", () => {
  const source = [
    "| Name | Formula |",
    "| --- | --- |",
    "| Reciprocal | $\\ln|x|$ |",
  ].join("\n");
  const projection = projectTableMathSource(source);
  assert.equal(projection.pipeRepairs, 2);
  assert.equal(projection.source.split("\n")[2]?.split("|").length, 4);
  assert.equal(projection.source.replaceAll(projection.sentinel, "|"), source);
});

test("table math projection keeps TeX display delimiters parser-compatible", () => {
  const source = ["| Name | Formula |", "| --- | --- |", "| A | \\[x|y\\] |"].join("\n");
  const projection = projectTableMathSource(source, { convertTexDisplayDelimiters: true });
  assert.equal(projection.source.replaceAll(projection.sentinel, "|"), ["| Name | Formula |", "| --- | --- |", "| A | $$x|y$$ |"].join("\n"));
  assert.equal(projection.source.split("\n")[2]?.split("|").length, 4);
});

test("Incremark promotes display math and restores protected math pipes in table cells", () => {
  const source = [
    "| Name | Inline | Display | TeX display |",
    "| --- | --- | --- | --- |",
    "| Reciprocal | $\\ln|x|$ | $$\\frac{1}{x}$$ | \\[a|b\\] |",
  ].join("\n");
  const projection = projectTableMathSource(source, { convertTexDisplayDelimiters: true });
  const parser = createIncremarkParser({ gfm: true, math: { tex: true } });
  parser.render(projection.source);
  const restored = promoteTableCellDisplayMath(restoreTableMathAst(parser.getAst(), projection.sentinel));
  const row = restored.children[0].children[1];
  const cells = row.children;
  assert.equal(cells.length, 4);
  assert.equal(cells[1].children[0].type, "inlineMath");
  assert.equal(cells[1].children[0].value, "\\ln|x|");
  assert.equal(cells[2].children[0].type, "math");
  assert.equal(cells[2].children[0].value, "\\frac{1}{x}");
  assert.equal(cells[3].children[0].type, "math");
  assert.equal(cells[3].children[0].value, "a|b");
});

test("projected pending table prefixes retain completed math cell positions", () => {
  const source = [
    "| Topic | Inline | Display | TeX display | Notes |",
    "| --- | --- | --- | --- | --- |",
    "| Reciprocal | $\\ln|x|$ | $$\\frac{1}{x}$$ | \\[a|b",
  ].join("\n");
  const projection = projectTableMathSource(source, { convertTexDisplayDelimiters: true });
  const parser = createIncremarkParser({ gfm: true, math: { tex: true } });
  parser.render(projection.source);
  const table = promoteTableCellDisplayMath(restoreTableMathAst(parser.getAst().children[0], projection.sentinel));
  assert.deepEqual(table.children.map((row) => row.children.length), [5, 5]);
  assert.equal(table.children[1].children[1].children[0].value, "\\ln|x|");
  assert.equal(table.children[1].children[2].children[0].type, "math");
});

test("synthetic table previews keep every cell and finalize every equation", () => {
  const source = [
    "# Table-cell math compatibility",
    "",
    "| Topic | Inline math | Display math | TeX display | Notes |",
    "| --- | --- | --- | --- | --- |",
    "| Reciprocal | $\\ln|x|$ | $$\\frac{1}{x}$$ | \\[a|b\\] | The pipe stays inside the formula. |",
    "| Fourier | $X(f)$ | $$X(f) = \\int_{-\\infty}^{\\infty} x(t) e^{-i2\\pi ft}\\,dt$$ | \\[x(t) \\leftrightarrow X(f)\\] | Display math remains in one cell. |",
  ].join("\n");
  const parser = createIncremarkParser({ gfm: true, math: { tex: true }, htmlTree: true, containers: true });
  const projection = projectTableMathSource(source, { convertTexDisplayDelimiters: true });
  parser.render(projection.source);
  const table = promoteTableCellDisplayMath(restoreTableMathAst(parser.getAst(), projection.sentinel)).children[1];
  assert.deepEqual(table.children.map((row) => row.children.length), [5, 5, 5]);

  const mathNodes = [];
  const rawText = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "math" || node.type === "inlineMath") mathNodes.push(node);
    if (node.type === "text") rawText.push(String(node.value || ""));
    for (const child of node.children || []) visit(child);
  };
  visit(table);
  assert.equal(mathNodes.length, 6);
  assert.equal(rawText.some((value) => /(?:\$\$?|\\\[|\\\])/.test(value)), false);
});

test("synthetic table previews do not leak raw math across streamed prefixes", () => {
  const source = [
    "| Topic | Inline math | Display math | TeX display | Notes |",
    "| --- | --- | --- | --- | --- |",
    "| Reciprocal | $\\ln|x|$ | $$\\frac{1}{x}$$ | \\[a|b\\] | The pipe stays inside the formula. |",
    "| Fourier | $X(f)$ | $$X(f) = \\int_{-\\infty}^{\\infty} x(t) e^{-i2\\pi ft}\\,dt$$ | \\[x(t) \\leftrightarrow X(f)\\] | Display math remains in one cell. |",
  ].join("\n");
  const parser = createIncremarkParser({ gfm: true, math: { tex: true }, htmlTree: true, containers: true });
  const visit = (node, callback) => {
    if (!node || typeof node !== "object") return;
    callback(node);
    for (const child of node.children || []) visit(child, callback);
  };

  for (let end = 1; end <= source.length; end += 1) {
    const prefix = source.slice(0, end);
    const split = splitStreamingMarkdown(prefix, { tableMath: true });
    const projection = projectTableMathSource(prefix, { convertTexDisplayDelimiters: true });
    parser.reset();
    const update = parser.append(projection.source);
    let node = update.pending?.[0]?.node || parser.getAst().children?.[0];
    if (!node) continue;
    node = promoteTableCellDisplayMath(restoreTableMathAst(node, projection.sentinel));
    if (split.pending?.kind.startsWith("math")) {
      const preview = createSyntheticMathPreviewNode(node, {
        kind: split.pending.kind,
        body: split.pending.body,
        opening: split.pending.opening,
      });
      assert.ok(preview, `missing preview at source offset ${end}`);
      node = preview;
    }
    visit(node, (current) => {
      if (current.type === "table") {
        for (const row of current.children || []) assert.ok((row.children || []).length <= 5);
      }
      if (current.type === "text") assert.equal(/(?:\$\$?|\\\[|\\\])/.test(String(current.value || "")), false, `raw math at source offset ${end}`);
    });
  }
});
