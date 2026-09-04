import assert from "node:assert/strict";
import test from "node:test";
import { createIncremarkParser } from "@incremark/core";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import { conduitMathPlugin } from "../src/client/chat/incremark-math-extension.ts";
import { projectTableMathSource, promoteTableCellDisplayMath, restoreTableMathAst } from "../src/client/chat/table-math.ts";
import { splitStreamingMarkdown } from "../src/client/chat/streaming-markdown.ts";

/**
 * The symptom: a paragraph of prose about money renders as one run-together
 * italic formula because two unrelated `$` were read as math delimiters. These
 * three paragraphs are from a real transcript that showed it.
 */
const CURRENCY_PROSE = [
  "Customer x LDC sum = unique ItemId sum = **$163,711.34** on both LDCs (NB6201D $145,474.66, NB6102D $18,236.68). Diff **$0.00**.",
  "Item *row* sum is $174k because EA+QT10 duplicated the same orders; after one amount per ItemId they match. So the **$** in this file are the item extract.",
  "Top buyers (Fuji SMBE $12.4k, RN Baker $8.4k, Globetech $6.9k) are **L1 63%, L3 0**.",
  "- **73% of $** ($119.7k) has **L3 = 0**, and the next bucket is **L1 52% ~$32k**.",
];

const REAL_MATH = [
  ["$x^2 + y$", "x^2 + y"],
  ["$\\frac{a}{b}$", "\\frac{a}{b}"],
];

const incremarkOptions = { gfm: true, plugins: [conduitMathPlugin({ tex: true })], htmlTree: true, containers: true };

function incremarkMath(source) {
  const projection = projectTableMathSource(source, { convertTexDisplayDelimiters: true });
  const parser = createIncremarkParser(incremarkOptions);
  parser.append(projection.source);
  parser.finalize();
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === "inlineMath" || node.type === "math") found.push(String(node.value ?? ""));
    for (const key of Object.keys(node)) if (node[key] && typeof node[key] === "object") walk(node[key]);
  };
  walk(promoteTableCellDisplayMath(restoreTableMathAst(parser.getAst(), projection.sentinel)));
  return found;
}

function markedMath(source) {
  const instance = new Marked();
  instance.use(markedKatex({ throwOnError: false }));
  const html = instance.parse(source);
  return [...html.matchAll(/<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/g)].map((match) => match[1]);
}

test("currency prose is never parsed as math", () => {
  for (const source of CURRENCY_PROSE) {
    assert.deepEqual(incremarkMath(source), [], `incremark: ${source}`);
    assert.deepEqual(markedMath(source), [], `marked: ${source}`);
  }
});

test("real formulas still parse as math in both renderers", () => {
  for (const [source, expected] of REAL_MATH) {
    assert.deepEqual(incremarkMath(source), [expected], `incremark: ${source}`);
    assert.deepEqual(markedMath(source), [expected], `marked: ${source}`);
  }
});

test("tex delimiters still parse in incremark", () => {
  // marked reaches \\(...\\) through its own texInlineKatex extension, which lives
  // in marked-markdown.tsx rather than in marked-katex-extension.
  assert.deepEqual(incremarkMath("inline \\(a \\ne b\\) here"), ["a \\ne b"]);
});

test("display math survives in both delimiters", () => {
  assert.deepEqual(incremarkMath("$$\nE = mc^2\n$$\n"), ["E = mc^2"]);
  assert.deepEqual(incremarkMath("\\[\nE = mc^2\n\\]\n"), ["E = mc^2"]);
});

test("math inside a table cell still parses", () => {
  const table = ["| a | b |", "| --- | --- |", "| $x^2$ | $12.40 spent |"].join("\n");
  assert.deepEqual(incremarkMath(table), ["x^2"]);
});

test("the streaming split and the settled parse agree on what opens math", () => {
  // A mismatch is what made the paragraph stream as prose and then collapse:
  // the splitter refuses to open a pending formula on a `$` followed by a digit
  // or a space, so the parser must not find one there either.
  for (const source of CURRENCY_PROSE) {
    const streaming = splitStreamingMarkdown(source, { tableMath: true, allowUnclosedMath: true });
    if (streaming.pending) assert.match(source[streaming.pending.start + 1], /[^\s\d]/, `pending opens on currency: ${source}`);
    assert.equal(splitStreamingMarkdown(source, { tableMath: true, allowUnclosedMath: false }).pending, null, `settled pending: ${source}`);
    assert.deepEqual(incremarkMath(source), [], `settled: ${source}`);
  }
});
