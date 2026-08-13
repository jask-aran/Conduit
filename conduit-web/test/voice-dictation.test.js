import assert from "node:assert/strict";
import test from "node:test";
import { createParakeetNormalizer } from "../src/server/dictation-stream.js";
import {
  beginDictatedRange,
  loadVoiceDictationSettings,
  matchesShortcut,
  releasesShortcut,
  replaceDictatedRange,
  saveVoiceDictationSettings,
  shortcutFromKeyboardEvent,
  shouldAutoSend,
} from "../src/client/chat/voice-dictation.js";

test("dictation draft replacement preserves manual text and replaces provisional text in place", () => {
  const range = beginDictatedRange("ask  please", 4);
  const partial = replaceDictatedRange("ask  please", range, "Con");
  assert.deepEqual(partial, { text: "ask Con please", range: { start: 4, end: 7 } });
  const next = replaceDictatedRange(partial.text, partial.range, "Conduit");
  assert.deepEqual(next, { text: "ask Conduit please", range: { start: 4, end: 11 } });
});

test("Parakeet events normalize deltas, cumulative partials, finals, and errors", () => {
  const normalizer = createParakeetNormalizer();
  assert.deepEqual(normalizer.normalize(JSON.stringify({ type: "transcript.text.delta", delta: "hel" })), [{ type: "partial", text: "hel" }]);
  assert.deepEqual(normalizer.normalize(JSON.stringify({ type: "transcript.text.delta", delta: "lo" })), [{ type: "partial", text: "hello" }]);
  assert.deepEqual(normalizer.normalize(JSON.stringify({ type: "transcript.text.done", text: "hello" })), [{ type: "final", text: "hello" }]);
  assert.deepEqual(normalizer.normalize(JSON.stringify({ type: "partial", text: "next wor" })), [{ type: "partial", text: "hello next wor" }]);
  assert.deepEqual(normalizer.normalize(JSON.stringify({ type: "final", text: "next words", speech_final: true })), [
    { type: "final", text: "hello next words" },
    { type: "end_of_speech" },
  ]);
  assert.equal(normalizer.text(), "hello next words");
  assert.equal(normalizer.hasFinal(), true);
  assert.deepEqual(normalizer.normalize(JSON.stringify({ type: "error", message: "model unavailable" })), [{ type: "error", code: "asr_error", message: "model unavailable" }]);
});

test("voice shortcut capture and push-to-talk release use the configured chord", () => {
  const pressed = { key: "d", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false };
  assert.equal(shortcutFromKeyboardEvent(pressed), "Super+D");
  assert.equal(matchesShortcut(pressed, "Super+D"), true);
  assert.equal(matchesShortcut({ ...pressed, metaKey: false }, "Super+D"), false);
  assert.equal(releasesShortcut({ key: "d" }, "Super+D"), true);
  assert.equal(releasesShortcut({ key: "Meta" }, "Super+D"), true);
});

test("voice settings remain draft-only by default and auto-send only a timely final", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(loadVoiceDictationSettings(storage), { shortcut: "Super+D", autoSend: false });
  assert.deepEqual(saveVoiceDictationSettings({ shortcut: "Ctrl+Shift+V", autoSend: true }, storage), { shortcut: "Ctrl+Shift+V", autoSend: true });
  assert.deepEqual(loadVoiceDictationSettings(storage), { shortcut: "Ctrl+Shift+V", autoSend: true });
  assert.equal(shouldAutoSend({ enabled: true, final: true, finalWithinDeadline: true }), true);
  assert.equal(shouldAutoSend({ enabled: true, final: false, finalWithinDeadline: true }), false);
  assert.equal(shouldAutoSend({ enabled: true, final: true, finalWithinDeadline: false }), false);
});

test("dictation adds word-boundary spacing once when inserted at a tight cursor", () => {
  const partial = replaceDictatedRange("askplease", beginDictatedRange("askplease", 3), "Con");
  assert.deepEqual(partial, { text: "ask Con please", range: { start: 3, end: 8 } });
  assert.deepEqual(replaceDictatedRange(partial.text, partial.range, "Conduit"), {
    text: "ask Conduit please",
    range: { start: 3, end: 12 },
  });
});
