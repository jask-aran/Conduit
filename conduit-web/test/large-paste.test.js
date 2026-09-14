import assert from "node:assert/strict";
import test from "node:test";
import {
  fileFromPastedText, insertTextAt, LARGE_PASTE_BYTES, pastedTextByteLength,
  pastedTextFilename, shouldAttachPastedText,
} from "../src/client/chat/large-paste.ts";

const options = (patch = {}) => ({ attachmentsSupported: true, ...patch });

test("pasted text size is measured in UTF-8 bytes, not code units", () => {
  assert.equal(pastedTextByteLength("abc"), 3);
  assert.equal(pastedTextByteLength("é"), 2);
  assert.equal(pastedTextByteLength("🙂"), 4);
});

test("only pastes at or above the threshold become attachments", () => {
  const large = "x".repeat(LARGE_PASTE_BYTES);
  assert.equal(shouldAttachPastedText(large, options()), true);
  assert.equal(shouldAttachPastedText(large.slice(1), options()), false);
  assert.equal(shouldAttachPastedText("", options()), false);
  assert.equal(shouldAttachPastedText("short", options({ threshold: 4 })), true);
});

test("surfaces without attachments keep the paste in the draft", () => {
  const large = "x".repeat(LARGE_PASTE_BYTES);
  assert.equal(shouldAttachPastedText(large, options({ attachmentsSupported: false })), false);
});

test("undo puts the text back at the caret and replaces any selection", () => {
  assert.deepEqual(insertTextAt("ab", 1, 1, "XY"), { text: "aXYb", caret: 3 });
  assert.deepEqual(insertTextAt("abcd", 1, 3, "X"), { text: "aXd", caret: 2 });
  assert.deepEqual(insertTextAt("ab", 99, 99, "X"), { text: "abX", caret: 3 });
  assert.deepEqual(insertTextAt("ab", -5, 1, "X"), { text: "Xb", caret: 1 });
});

test("the attachment is a plain-text file named for the paste time", () => {
  const at = new Date("2026-09-14T12:34:56.789Z");
  assert.equal(pastedTextFilename(at), "pasted-text-2026-09-14-12-34-56.txt");
  const file = fileFromPastedText("hello", at);
  assert.equal(file.name, "pasted-text-2026-09-14-12-34-56.txt");
  assert.equal(file.type, "text/plain");
  assert.equal(file.size, 5);
});
