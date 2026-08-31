import assert from "node:assert/strict";
import test from "node:test";
import {
  CODE_BLOCK_COLLAPSE_DEFAULT_LINES,
  codeBlockExpandLabel,
  codeBlockMarkup,
  codeBlockState,
  countCodeLines,
  normalizeCodeLanguage,
  shouldCollapseCodeBlock,
} from "../src/client/chat/code-block.ts";

test("countCodeLines ignores the trailing newline a fence always carries", () => {
  assert.equal(countCodeLines(""), 0);
  assert.equal(countCodeLines("\n"), 0);
  assert.equal(countCodeLines("one"), 1);
  assert.equal(countCodeLines("one\n"), 1);
  assert.equal(countCodeLines("one\ntwo"), 2);
  assert.equal(countCodeLines("one\ntwo\n"), 2);
  assert.equal(countCodeLines("one\n\nthree\n"), 3);
});

test("a block still streaming never collapses", () => {
  assert.equal(shouldCollapseCodeBlock(400, "long", 15, true), false);
  assert.equal(shouldCollapseCodeBlock(400, "all", 15, true), false);
});

test("long mode folds only past the threshold", () => {
  assert.equal(shouldCollapseCodeBlock(15, "long", 15, false), false);
  assert.equal(shouldCollapseCodeBlock(16, "long", 15, false), true);
  assert.equal(shouldCollapseCodeBlock(16, "long", 25, false), false);
});

test("off never folds and all folds anything past one line", () => {
  assert.equal(shouldCollapseCodeBlock(9000, "off", 15, false), false);
  assert.equal(shouldCollapseCodeBlock(1, "all", 15, false), false);
  assert.equal(shouldCollapseCodeBlock(2, "all", 15, false), true);
});

test("the expander names how much is hidden", () => {
  assert.equal(codeBlockExpandLabel(60, 15), "Show 45 more lines");
  assert.equal(codeBlockExpandLabel(16, 15), "Show 1 more line");
  assert.equal(codeBlockExpandLabel(10, 15), "Show more");
});

test("state reports lines, collapsibility and the label together", () => {
  const long = codeBlockState("x\n".repeat(60), "long", CODE_BLOCK_COLLAPSE_DEFAULT_LINES, false);
  assert.equal(long.lines, 60);
  assert.equal(long.collapsed, true);
  assert.equal(long.collapsible, true);
  assert.equal(long.expandLabel, "Show 45 more lines");

  const short = codeBlockState("x\ny\n", "long", CODE_BLOCK_COLLAPSE_DEFAULT_LINES, false);
  assert.equal(short.collapsed, false);
  assert.equal(short.collapsible, false);
});

test("normalizeCodeLanguage takes the first token and defaults to text", () => {
  assert.equal(normalizeCodeLanguage(undefined), "text");
  assert.equal(normalizeCodeLanguage(""), "text");
  assert.equal(normalizeCodeLanguage("TypeScript title=x"), "typescript");
});

test("markup escapes the body and language", () => {
  const html = codeBlockMarkup({
    language: '"><script>',
    text: "<b>&</b>",
    state: codeBlockState("<b>&</b>", "long", 15, false),
  });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;b&gt;&amp;&lt;/b&gt;"));
  assert.ok(!html.includes('data-collapsed="true"'));
});

test("a collapsed card carries the attributes the delegated handler toggles", () => {
  const text = "x\n".repeat(40);
  const html = codeBlockMarkup({
    language: "ts",
    text,
    state: codeBlockState(text, "long", 15, false),
  });
  assert.ok(html.includes('data-lines="40"'));
  assert.ok(html.includes('data-collapsible="true"'));
  assert.ok(html.includes('data-collapsed="true"'));
  assert.ok(html.includes("data-expand-code"));
  assert.ok(html.includes("Show 25 more lines"));
  // Both controls exist: the footer button and the toggle pinned in the header.
  assert.equal(html.split("data-expand-code").length - 1, 2);
  assert.ok(html.includes('class="artifact-toggle"'));
  assert.ok(html.includes('aria-label="Expand code"'));
});

test("a streaming fence renders open with no expander", () => {
  const text = "x\n".repeat(40);
  const html = codeBlockMarkup({
    language: "ts",
    text,
    streaming: true,
    pending: true,
    state: codeBlockState(text, "long", 15, true),
  });
  assert.ok(html.includes('data-streaming-pending="fence"'));
  assert.ok(!html.includes('data-collapsed="true"'));
  assert.ok(!html.includes("data-expand-code"));
  assert.ok(!html.includes("artifact-toggle"));
});
