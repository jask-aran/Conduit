import assert from "node:assert/strict";
import test from "node:test";
import { resolveHighlightLanguage } from "../src/client/chat/code-highlight.ts";

test("language aliases resolve to the registered grammar", () => {
  assert.equal(resolveHighlightLanguage("TS"), "typescript");
  assert.equal(resolveHighlightLanguage("sh"), "bash");
  assert.equal(resolveHighlightLanguage("  JSX "), "javascript");
  assert.equal(resolveHighlightLanguage("c++"), "cpp");
  assert.equal(resolveHighlightLanguage("html"), "xml");
});

test("an unaliased language passes through untouched", () => {
  assert.equal(resolveHighlightLanguage("python"), "python");
  assert.equal(resolveHighlightLanguage("wingdings"), "wingdings");
  assert.equal(resolveHighlightLanguage(""), "");
});
