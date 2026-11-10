import assert from "node:assert/strict";
import test from "node:test";
import { importClient } from "./helpers/client-module.js";

const { CODE_BLOCK_COLLAPSE_DEFAULT_LINES, codeBlockFold, countCodeLines, normalizeCodeLanguage, shouldCollapseCodeBlock } = await importClient('export { CODE_BLOCK_COLLAPSE_DEFAULT_LINES, codeBlockFold, countCodeLines, normalizeCodeLanguage, shouldCollapseCodeBlock } from "../src/client/chat/code-block.ts";');

test("countCodeLines ignores the trailing newline a fence always carries", () => {
  assert.equal(countCodeLines(""), 0);
  assert.equal(countCodeLines("\n"), 0);
  assert.equal(countCodeLines("one"), 1);
  assert.equal(countCodeLines("one\n"), 1);
  assert.equal(countCodeLines("one\ntwo"), 2);
  assert.equal(countCodeLines("one\ntwo\n"), 2);
  assert.equal(countCodeLines("one\n\nthree\n"), 3);
});

test("a block folds at the threshold whether or not it is still streaming", () => {
  assert.equal(shouldCollapseCodeBlock(400, "long", 15), true);
  assert.equal(shouldCollapseCodeBlock(400, "all", 15), true);
  assert.equal(shouldCollapseCodeBlock(15, "long", 15), false);
});

test("long mode folds only past the threshold", () => {
  assert.equal(shouldCollapseCodeBlock(15, "long", 15), false);
  assert.equal(shouldCollapseCodeBlock(16, "long", 15), true);
  assert.equal(shouldCollapseCodeBlock(16, "long", 25), false);
});

test("off never folds and all folds anything past one line", () => {
  assert.equal(shouldCollapseCodeBlock(9000, "off", 15), false);
  assert.equal(shouldCollapseCodeBlock(1, "all", 15), false);
  assert.equal(shouldCollapseCodeBlock(2, "all", 15), true);
});

test("fold depth follows the collapse preference", () => {
  assert.equal(codeBlockFold(60, "long", CODE_BLOCK_COLLAPSE_DEFAULT_LINES), 15);
  assert.equal(codeBlockFold(2, "all", 15), 1);
  assert.equal(codeBlockFold(15, "long", 15), undefined);
  assert.equal(codeBlockFold(60, "off", 15), undefined);
});

test("normalizeCodeLanguage takes the first token and defaults to text", () => {
  assert.equal(normalizeCodeLanguage(undefined), "text");
  assert.equal(normalizeCodeLanguage(""), "text");
  assert.equal(normalizeCodeLanguage("TypeScript title=x"), "typescript");
});
