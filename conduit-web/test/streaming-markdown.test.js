import assert from "node:assert/strict";
import test from "node:test";
import { splitStreamingMarkdown } from "../src/client/chat/streaming-markdown.ts";

test("keeps complete Markdown in the stable source", () => {
  assert.deepEqual(splitStreamingMarkdown("# Heading\n\nInline $E=mc^2$\n\n$$\nx^2\n$$"), {
    stable: "# Heading\n\nInline $E=mc^2$\n\n$$\nx^2\n$$",
    pending: null,
  });
});

test("classifies an open block math tail without its delimiters", () => {
  const result = splitStreamingMarkdown("Before\n\n$$\n\\Delta x, \\Delta p \\ge");
  assert.equal(result.stable, "Before\n\n");
  assert.deepEqual(result.pending, {
    kind: "math-block",
    start: 8,
    body: "\\Delta x, \\Delta p \\ge",
  });
});

test("classifies an open inline math tail but ignores currency", () => {
  const source = "The price is $5.00. The answer is $E=mc";
  const result = splitStreamingMarkdown(source);
  assert.equal(result.stable, "The price is $5.00. The answer is ");
  assert.deepEqual(result.pending, {
    kind: "math-inline",
    start: source.indexOf("$E=mc"),
    body: "E=mc",
  });
});

test("does not hide shell variables behind an incomplete math tail", () => {
  for (const source of ["Cost is $PATH and $HOME.", "Use $PATH.", "Use $x."]) {
    assert.equal(splitStreamingMarkdown(source).pending, null);
  }
});

test("does not mistake a trailing space in a partial formula for a shell variable", () => {
  const result = splitStreamingMarkdown("The answer is $E ");
  assert.equal(result.pending?.kind, "math-inline");
  assert.equal(result.pending?.body, "E ");
});

test("treats a single uppercase symbol as a partial formula", () => {
  const result = splitStreamingMarkdown("The answer is $E");
  assert.equal(result.pending?.kind, "math-inline");
  assert.equal(result.pending?.body, "E");
});

test("does not classify an unclosed math tail after streaming ends", () => {
  assert.equal(splitStreamingMarkdown("The answer is $E=mc", { allowUnclosedMath: false }).pending, null);
  assert.equal(splitStreamingMarkdown("Before\n\n$$\nx^2", { allowUnclosedMath: false }).pending, null);
  assert.equal(splitStreamingMarkdown("Before\n\n\\(x^2", { allowUnclosedMath: false }).pending, null);
});

test("does not classify escaped or code-span dollars", () => {
  assert.equal(splitStreamingMarkdown("Escaped \\$E=mc and `$E=mc`.").pending, null);
});

test("supports TeX inline delimiters and keeps an open formula hidden", () => {
  const source = "The answer is \\(E = mc^2";
  const result = splitStreamingMarkdown(source);
  assert.equal(result.stable, "The answer is ");
  assert.deepEqual(result.pending, {
    kind: "math-inline",
    start: source.indexOf("\\("),
    body: "E = mc^2",
  });
  assert.equal(splitStreamingMarkdown("The answer is \\(E = mc^2\\)").pending, null);
});

test("supports TeX display delimiters", () => {
  const source = "Before\n\n\\[\nE = mc^2";
  const result = splitStreamingMarkdown(source);
  assert.equal(result.stable, "Before\n\n");
  assert.deepEqual(result.pending, {
    kind: "math-block",
    start: 8,
    body: "E = mc^2",
  });
  assert.equal(splitStreamingMarkdown(`${source}\\]`).pending, null);
});

test("classifies an open dollar display formula inside a table cell", () => {
  const source = "| Name | Formula |\n| --- | --- |\n| A | $$\\frac{1}{x}";
  const result = splitStreamingMarkdown(source, { tableMath: true });
  assert.equal(result.pending?.kind, "math-block");
  assert.equal(result.pending?.opening, "$$");
  assert.equal(result.pending?.body, "\\frac{1}{x}");
});

test("classifies an open TeX display formula inside a table cell", () => {
  const source = "| Name | Formula |\n| --- | --- |\n| A | \\[x|y";
  const result = splitStreamingMarkdown(source, { tableMath: true });
  assert.equal(result.pending?.kind, "math-block");
  assert.equal(result.pending?.opening, "\\[");
  assert.equal(result.pending?.body, "x|y");
});

test("does not treat a partial table formula as a shell variable", () => {
  const source = "| Name | Formula |\n| --- | --- |\n| Fourier | $X";
  assert.equal(splitStreamingMarkdown(source, { tableMath: true }).pending?.kind, "math-inline");
});

test("hides a table formula opener when the delta ends on the dollar", () => {
  const source = "| Name | Formula |\n| --- | --- |\n| Fourier | $";
  assert.equal(splitStreamingMarkdown(source, { tableMath: true }).pending?.kind, "math-inline");
});

test("classifies an open fenced code tail and preserves its language", () => {
  const result = splitStreamingMarkdown("Before\n\n```javascript\nconst answer = 42;");
  assert.equal(result.stable, "Before\n\n");
  assert.deepEqual(result.pending, {
    kind: "fence",
    start: 8,
    body: "const answer = 42;",
    language: "javascript",
  });
});

test("fence state hides math-like source inside an open fence", () => {
  const result = splitStreamingMarkdown("```js\n$$\nE=mc");
  assert.equal(result.pending?.kind, "fence");
  assert.equal(result.pending?.body, "$$\nE=mc");
});

test("closed fences and math do not leave a pending tail", () => {
  const source = "```js\n$E=mc\n```\n\n$$\nE=mc\n$$";
  assert.equal(splitStreamingMarkdown(source).pending, null);
});
