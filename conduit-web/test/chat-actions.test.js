import assert from "node:assert/strict";
import test from "node:test";
import { detectCommandToken, replaceCommandToken } from "../src/client/slash-token.js";
import { mergeContinuation } from "../src/continuation.js";

test("slash tokens are limited to the first token and preserve unknown commands as text", () => {
  assert.deepEqual(detectCommandToken("  /atta rest", 7), { trigger: "/", query: "atta", start: 2, end: 7 });
  assert.equal(detectCommandToken("say /attach", 11), null);
  assert.deepEqual(detectCommandToken("$future", 7), { trigger: "$", query: "future", start: 0, end: 7 });
  const token = detectCommandToken("  /attach hello", 9);
  assert.equal(replaceCommandToken("  /attach hello", token), "   hello");
});

test("continuation removes only exact normalized overlap", () => {
  assert.equal(mergeContinuation("First line\r\nsecond", "second and third"), "First line\nsecond and third");
  assert.equal(mergeContinuation("Answer", "Different"), "AnswerDifferent");
  assert.equal(mergeContinuation("aaaaab", "aaab plus"), "aaaaab plus");
  assert.equal(mergeContinuation("abcabc", "abc again"), "abcabc again");
});
