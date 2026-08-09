import assert from "node:assert/strict";
import test from "node:test";
import { mergeContinuation } from "../src/continuation.js";

test("continuation removes only exact normalized overlap", () => {
  assert.equal(mergeContinuation("First line\r\nsecond", "second and third"), "First line\nsecond and third");
  assert.equal(mergeContinuation("Answer", "Different"), "AnswerDifferent");
  assert.equal(mergeContinuation("aaaaab", "aaab plus"), "aaaaab plus");
  assert.equal(mergeContinuation("abcabc", "abc again"), "abcabc again");
});
