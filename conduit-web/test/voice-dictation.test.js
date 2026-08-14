import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { calculateFinalizationTimeoutMs } from "../src/server/dictation-stream.js";
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

test("dictation leaves a trailing space at the end of the draft", () => {
  assert.deepEqual(replaceDictatedRange("hello", beginDictatedRange("hello", 5), "world"), {
    text: "hello world ",
    range: { start: 5, end: 12 },
  });
  assert.deepEqual(replaceDictatedRange("before selected after", beginDictatedRange("before selected after", 7, 15), "new"), {
    text: "before new after",
    range: { start: 7, end: 10 },
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

test("finalization timeout scales with audio duration and model cost", () => {
  const limits = { finalizationBaseMs: 30_000, finalizationMaxMs: 600_000, finalizationDefaultMultiplier: 12 };
  assert.equal(calculateFinalizationTimeoutMs({ audioBytes: 64_000, model: "parakeet-tdt-0.6b-v3-fp32", limits }), 36_000);
  assert.equal(calculateFinalizationTimeoutMs({ audioBytes: 64_000, model: "parakeet-tdt-0.6b-v3-int8", limits }), 30_000);
  assert.equal(calculateFinalizationTimeoutMs({ audioBytes: 64_000, model: "parakeet-tdt-0.6b-v2-int8", limits }), 30_000);
  assert.equal(calculateFinalizationTimeoutMs({ audioBytes: 64_000, model: "unknown-model", limits }), 30_000);
  assert.equal(calculateFinalizationTimeoutMs({ audioBytes: 32 * 60_000, model: "parakeet-tdt-0.6b-v3-fp32", limits }), 600_000);
});

const WORKLET_SOURCE = await readFile(new URL("../public/voice-capture-worklet.js", import.meta.url), "utf8");

function loadCaptureWorklet() {
  const messages = [];
  let Processor;
  runInNewContext(WORKLET_SOURCE, {
    AudioWorkletProcessor: class {
      constructor() { this.port = { postMessage: (message) => messages.push(message) }; }
    },
    registerProcessor: (_name, value) => { Processor = value; },
    sampleRate: 48_000,
  });
  return { messages, Processor };
}

function pcmSignal(message) {
  if (message.type !== "pcm") return null;
  const samples = new Int16Array(message.buffer);
  let sum = 0;
  let peak = 0;
  for (const value of samples) {
    sum += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  return { rms: Math.sqrt(sum / samples.length) / 32768, peak: peak / 32768 };
}

test("capture worklet keeps audio across a pause and flushes its final residual", () => {
  const { messages, Processor } = loadCaptureWorklet();
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

test("capture worklet normalizes quiet speech toward a healthy level without clipping", () => {
  const { messages, Processor } = loadCaptureWorklet();
  const processor = new Processor();
  const quiet = Float32Array.from({ length: 128 }, () => 0.015);
  for (let index = 0; index < 400; index += 1) processor.process([[quiet]]);
  const pcm = messages.filter((message) => message.type === "pcm");
  assert.ok(pcm.length >= 400);
  const first = pcmSignal(pcm[0]);
  const last = pcmSignal(pcm[pcm.length - 1]);
  assert.ok(first.rms < 0.03, "quiet input starts near its raw level");
  assert.ok(last.rms > 0.05 && last.rms < 0.2, `quiet speech converges toward -20 dBFS (got ${last.rms.toFixed(3)})`);
  assert.ok(last.rms > first.rms * 4, "quiet speech is amplified several times");
  assert.equal(pcm.some((message) => pcmSignal(message).peak >= 1), false);
});

test("capture worklet ducks loud input and holds gain across digital silence", () => {
  const { messages, Processor } = loadCaptureWorklet();
  const processor = new Processor();
  const loud = Float32Array.from({ length: 128 }, () => 0.9);
  for (let index = 0; index < 300; index += 1) processor.process([[loud]]);
  const loudPcm = messages.filter((message) => message.type === "pcm");
  assert.ok(pcmSignal(loudPcm[0]).rms > 0.5);
  const ducked = pcmSignal(loudPcm[loudPcm.length - 1]);
  assert.ok(ducked.rms < 0.3 && ducked.rms > 0.05, `loud input ducks toward the target (got ${ducked.rms.toFixed(3)})`);
  assert.equal(loudPcm.some((message) => pcmSignal(message).peak >= 1), false);
  const probe = () => {
    const settled = Float32Array.from({ length: 128 }, () => 0.4);
    const before = messages.filter((message) => message.type === "pcm").length;
    processor.process([[settled]]);
    const posted = messages.filter((message) => message.type === "pcm").slice(before);
    return pcmSignal(posted[0]).rms;
  };
  const beforeSilence = probe();
  for (let index = 0; index < 600; index += 1) processor.process([[new Float32Array(128)]]);
  const afterSilence = probe();
  assert.ok(Math.abs(afterSilence - beforeSilence) / beforeSilence < 0.5, "digital silence does not pump the gain");
});

test("capture worklet reports sustained exact-zero input as a silent microphone", () => {
  const { messages, Processor } = loadCaptureWorklet();
  const processor = new Processor();
  for (let index = 0; index < 40; index += 1) processor.process([[new Float32Array(128)]]);
  assert.equal(messages.filter((message) => message.type === "mic_silent").length, 0, "short zero runs do not warn");
  for (let index = 0; index < 260; index += 1) processor.process([[new Float32Array(128)]]);
  assert.equal(messages.filter((message) => message.type === "mic_silent").length, 1, "sustained zero input warns once");
  processor.process([[Float32Array.from({ length: 128 }, () => 0.1)]]);
  for (let index = 0; index < 260; index += 1) processor.process([[new Float32Array(128)]]);
  assert.equal(messages.filter((message) => message.type === "mic_silent").length, 2, "signal re-arms the warning");
});
