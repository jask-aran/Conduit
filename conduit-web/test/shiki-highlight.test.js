import assert from "node:assert/strict";
import test from "node:test";
import { highlightCode } from "../src/client/shiki-highlight.js";

test("highlightCode keeps equal-length sources with matching boundaries isolated", () => {
  const prefix = "a".repeat(100);
  const suffix = "z".repeat(100);
  const first = `${prefix}${"x".repeat(40)}${suffix}`;
  const second = `${prefix}${"y".repeat(40)}${suffix}`;

  const firstTokens = highlightCode(first, "unsupported");
  const secondTokens = highlightCode(second, "unsupported");

  assert.notStrictEqual(secondTokens, firstTokens);
  assert.equal(secondTokens.tokens[0][0].content, second);
});
