import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createParakeetNormalizer } from "../src/server/dictation-stream.js";
import {
  audioTransferLost,
  beginDictatedRange,
  loadVoiceDictationSettings,
  matchesShortcut,
  normalizeActivation,
  releasesShortcut,
  replaceDictatedRange,
  saveVoiceDictationSettings,
  shortcutFromKeyboardEvent,
  shouldAutoSend,
  shouldReportNoSignal,
} from "../src/client/chat/voice-dictation.js";

test("dictation draft replacement preserves manual text and replaces provisional text in place", () => {
  const range = beginDictatedRange("ask  please", 4);
  const partial = replaceDictatedRange("ask  please", range, "Con");
  assert.deepEqual(partial, { text: "ask Con please", range: { start: 4, end: 7 } });
  const next = replaceDictatedRange(partial.text, partial.range, "Conduit");
  assert.deepEqual(next, { text: "ask Conduit please", range: { start: 4, end: 11 } });
});

test("dictation range preserves a native textarea selection", () => {
  assert.deepEqual(beginDictatedRange("before selected after", 7, 15), { start: 7, end: 15 });
  assert.deepEqual(replaceDictatedRange("before selected after", beginDictatedRange("before selected after", 7, 15), "new"), {
    text: "before new after",
    range: { start: 7, end: 10 },
  });
});

test("Parakeet normalizer does not duplicate a whitespace-normalized final", () => {
  const normalizer = createParakeetNormalizer();
  assert.deepEqual(normalizer.normalize(JSON.stringify({ type: "transcript.text.delta", delta: " This" })), [{ type: "partial", text: " This" }]);
  assert.deepEqual(normalizer.normalize(JSON.stringify({ type: "transcript.text.delta", delta: " is a long pause test" })), [{ type: "partial", text: " This is a long pause test" }]);
  assert.deepEqual(normalizer.normalize(JSON.stringify({ type: "transcript.text.done", text: "This is a long pause test" })), [{ type: "final", text: "This is a long pause test" }]);
  assert.equal(normalizer.text(), "This is a long pause test");
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
  const pressed = { key: "d", metaKey: false, ctrlKey: true, altKey: false, shiftKey: true };
  assert.equal(shortcutFromKeyboardEvent(pressed), "Ctrl+Shift+D");
  assert.equal(matchesShortcut(pressed, "Ctrl+Shift+D"), true);
  assert.equal(matchesShortcut({ ...pressed, ctrlKey: false }, "Ctrl+Shift+D"), false);
  assert.equal(releasesShortcut({ key: "d" }, "Ctrl+Shift+D"), true);
  assert.equal(releasesShortcut({ key: "Control" }, "Ctrl+Shift+D"), true);
});

test("voice settings remain draft-only by default and auto-send only a timely final", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(loadVoiceDictationSettings(storage), { shortcut: "Ctrl+Shift+D", activation: "push_to_talk", autoSend: false, inputDeviceId: "" });
  storage.setItem("conduit:voice-dictation", JSON.stringify({ shortcut: "Super+D" }));
  assert.deepEqual(loadVoiceDictationSettings(storage), { shortcut: "Ctrl+Shift+D", activation: "push_to_talk", autoSend: false, inputDeviceId: "" });
  assert.deepEqual(saveVoiceDictationSettings({ shortcut: "Ctrl+Shift+V", activation: "toggle", autoSend: true, inputDeviceId: "mic-2" }, storage), { shortcut: "Ctrl+Shift+V", activation: "toggle", autoSend: true, inputDeviceId: "mic-2" });
  assert.deepEqual(loadVoiceDictationSettings(storage), { shortcut: "Ctrl+Shift+V", activation: "toggle", autoSend: true, inputDeviceId: "mic-2" });
  assert.equal(normalizeActivation("unknown"), "push_to_talk");
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

test("short silent stops are intentional while sustained silence is a microphone failure", () => {
  assert.equal(shouldReportNoSignal({ inputSignalDetected: false, captureDurationMs: 4_999 }), false);
  assert.equal(shouldReportNoSignal({ inputSignalDetected: false, captureDurationMs: 5_000 }), true);
  assert.equal(shouldReportNoSignal({ inputSignalDetected: true, captureDurationMs: 60_000 }), false);
});

test("audio transfer diagnostics detect bytes lost before the server", () => {
  assert.equal(audioTransferLost({ audioBytesSent: 640, serverAudioBytes: 640 }), false);
  assert.equal(audioTransferLost({ audioBytesSent: 640, serverAudioBytes: 320 }), true);
  assert.equal(audioTransferLost({ audioBytesSent: 640, serverAudioBytes: null }), false);
});

test("capture worklet keeps audio across a pause and flushes its final residual", async () => {
  const source = await readFile(new URL("../public/voice-capture-worklet.js", import.meta.url), "utf8");
  const messages = [];
  let Processor;
  runInNewContext(source, {
    AudioWorkletProcessor: class {
      constructor() { this.port = { postMessage: (message) => messages.push(message) }; }
    },
    registerProcessor: (_name, value) => { Processor = value; },
    sampleRate: 48_000,
  });
  const processor = new Processor();
  processor.process([[Float32Array.from({ length: 96 }, () => 0.4)]]);
  for (let index = 0; index < 120; index += 1) processor.process([[new Float32Array(128)]]);
  processor.process([[Float32Array.from({ length: 1 }, () => 0.5)]]);
  const beforeFlush = messages.filter((message) => message.type === "pcm").length;
  processor.port.onmessage({ data: { type: "flush" } });
  const afterFlush = messages.filter((message) => message.type === "pcm").length;
  assert.ok(beforeFlush > 120);
  assert.equal(afterFlush, beforeFlush + 1);
  assert.deepEqual(messages.slice(-2).map((message) => message.type), ["pcm", "flush_complete"]);
});
