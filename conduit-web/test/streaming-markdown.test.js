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

test("does not classify escaped or code-span dollars", () => {
  assert.equal(splitStreamingMarkdown("Escaped \\$E=mc and `$E=mc`.").pending, null);
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
