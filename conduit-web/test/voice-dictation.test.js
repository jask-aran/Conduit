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
  assert.deepEqual(loadVoiceDictationSettings(storage), { shortcut: "Ctrl+Shift+D", activation: "push_to_talk", autoSend: false, inputDeviceId: "", captureProfile: "raw", warmMicrophone: false });
  storage.setItem("conduit:voice-dictation", JSON.stringify({ shortcut: "Super+D" }));
  assert.deepEqual(loadVoiceDictationSettings(storage), { shortcut: "Ctrl+Shift+D", activation: "push_to_talk", autoSend: false, inputDeviceId: "", captureProfile: "raw", warmMicrophone: false });
  assert.deepEqual(saveVoiceDictationSettings({ shortcut: "Ctrl+Shift+V", activation: "toggle", autoSend: true, inputDeviceId: "mic-2", captureProfile: "processed", warmMicrophone: true }, storage), { shortcut: "Ctrl+Shift+V", activation: "toggle", autoSend: true, inputDeviceId: "mic-2", captureProfile: "processed", warmMicrophone: true });
  assert.deepEqual(loadVoiceDictationSettings(storage), { shortcut: "Ctrl+Shift+V", activation: "toggle", autoSend: true, inputDeviceId: "mic-2", captureProfile: "processed", warmMicrophone: true });
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

function loadCaptureWorklet(inputSampleRate = 48_000) {
  const messages = [];
  let Processor;
  runInNewContext(WORKLET_SOURCE, {
    AudioWorkletProcessor: class {
      constructor() { this.port = { postMessage: (message) => messages.push(message) }; }
    },
    registerProcessor: (_name, value) => { Processor = value; },
    sampleRate: inputSampleRate,
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

function pcmMessages(messages) {
  return messages.filter((message) => message.type === "pcm");
}

function processUntilPcm(processor, messages, input, maximum = 32) {
  const before = pcmMessages(messages).length;
  for (let index = 0; index < maximum && pcmMessages(messages).length === before; index += 1) processor.process([[input]]);
  const posted = pcmMessages(messages).slice(before);
  assert.ok(posted.length > 0, "the worklet emitted a packet");
  return posted[0];
}

test("capture worklet keeps audio across a pause and flushes its final residual", () => {
  const { messages, Processor } = loadCaptureWorklet();
  const processor = new Processor();
  processor.process([[Float32Array.from({ length: 96 }, () => 0.4)]]);
  for (let index = 0; index < 120; index += 1) processor.process([[new Float32Array(128)]]);
  processor.process([[Float32Array.from({ length: 1 }, () => 0.5)]]);
  const beforeFlush = pcmMessages(messages).length;
  assert.ok(beforeFlush > 0);
  assert.equal(pcmMessages(messages).every((message) => new Int16Array(message.buffer).length === 320), true);
  processor.port.onmessage({ data: { type: "flush" } });
  const packets = pcmMessages(messages);
  const afterFlush = packets.length;
  assert.equal(new Int16Array(packets.at(-1).buffer).length < 320, true);
  assert.equal(afterFlush, beforeFlush + 1);
  assert.deepEqual(messages.slice(-2).map((message) => message.type), ["pcm", "flush_complete"]);
});

test("capture worklet reports raw and processed signal diagnostics", () => {
  const { messages, Processor } = loadCaptureWorklet();
  const processor = new Processor();
  for (let index = 0; index < 8; index += 1) processor.process([[Float32Array.from({ length: 128 }, () => 0.5)]]);
  const message = pcmMessages(messages)[0];
  assert.ok(message);
  assert.equal(message.rawSampleCount, 1_024);
  assert.equal(message.sampleCount, 320);
  assert.ok(message.rawRms > 0.49 && message.rawRms < 0.51);
  assert.ok(message.rawPeak > 0.49 && message.rawPeak < 0.51);
  assert.equal(message.rawClipped, false);
  assert.equal(message.clipped, false);
  assert.equal(message.gain, 1);
  assert.equal(message.resampler.method, "windowed-sinc-fir");
  assert.equal(message.resampler.inputSampleRate, 48_000);
  assert.equal(message.resampler.outputSampleRate, 16_000);
  assert.equal(message.bands, undefined);
  assert.equal(message.rawBands, undefined);
});

function workletPcm(inputSampleRate, chunks) {
  const { messages, Processor } = loadCaptureWorklet(inputSampleRate);
  const processor = new Processor();
  for (const chunk of chunks) processor.process([[Float32Array.from({ length: chunk }, () => 0.25)]]);
  processor.port.onmessage({ data: { type: "flush" } });
  return Int16Array.from(messages.filter((message) => message.type === "pcm").flatMap((message) => Array.from(new Int16Array(message.buffer))));
}

test("capture resampler has an identity path, stable lengths, and chunk-independent output", () => {
  const identity = workletPcm(16_000, [128, 77]);
  assert.equal(identity.length, 205);
  assert.equal(identity.every((sample) => sample === 8_191), true);
  const oneChunk = workletPcm(48_000, [4_800]);
  const manyChunks = workletPcm(48_000, [...Array(37).fill(128), 64]);
  assert.equal(oneChunk.length, 1_600);
  assert.equal(manyChunks.length, oneChunk.length);
  assert.deepEqual(manyChunks, oneChunk);
  assert.equal(workletPcm(44_100, [4_410]).length, 1_600);
});

test("capture worklet preserves quiet speech without adaptive gain", () => {
  const { messages, Processor } = loadCaptureWorklet();
  const processor = new Processor();
  const quiet = Float32Array.from({ length: 128 }, () => 0.015);
  for (let index = 0; index < 400; index += 1) processor.process([[quiet]]);
  const pcm = pcmMessages(messages);
  assert.ok(pcm.length > 0);
  assert.equal(pcm.every((message) => new Int16Array(message.buffer).length === 320), true);
  const first = pcmSignal(pcm[0]);
  const last = pcmSignal(pcm[pcm.length - 1]);
  assert.ok(first.rms < 0.03, "quiet input starts near its raw level");
  assert.ok(last.rms < 0.03, `quiet input remains near its source level (got ${last.rms.toFixed(3)})`);
  assert.ok(Math.abs(last.rms - first.rms) / first.rms < 0.05, "quiet speech level remains stable");
  assert.equal(pcm.every((message) => message.gain === 1), true);
  assert.equal(pcm.some((message) => pcmSignal(message).peak >= 1), false);
});

test("capture worklet preserves loud input and does not pump across digital silence", () => {
  const { messages, Processor } = loadCaptureWorklet();
  const processor = new Processor();
  const loud = Float32Array.from({ length: 128 }, () => 0.9);
  for (let index = 0; index < 300; index += 1) processor.process([[loud]]);
  const loudPcm = pcmMessages(messages);
  assert.ok(loudPcm.length > 0);
  assert.ok(pcmSignal(loudPcm[0]).rms > 0.85);
  const settled = pcmSignal(loudPcm[loudPcm.length - 1]);
  assert.ok(settled.rms > 0.85 && settled.rms < 0.95, `loud input remains near its source level (got ${settled.rms.toFixed(3)})`);
  assert.equal(loudPcm.every((message) => message.gain === 1), true);
  assert.equal(loudPcm.some((message) => pcmSignal(message).peak >= 1), false);
  const probe = () => {
    const settled = Float32Array.from({ length: 128 }, () => 0.4);
    return pcmSignal(processUntilPcm(processor, messages, settled)).rms;
  };
  const beforeSilence = probe();
  for (let index = 0; index < 600; index += 1) processor.process([[new Float32Array(128)]]);
  const afterSilence = probe();
  assert.ok(afterSilence > 0.3 && afterSilence < 0.5, "digital silence does not pump the level");
});

test("capture worklet reports sustained exact-zero input as digital silence from a stalled device", () => {
  const { messages, Processor } = loadCaptureWorklet();
  const processor = new Processor();
  for (let index = 0; index < 40; index += 1) processor.process([[new Float32Array(128)]]);
  assert.equal(messages.filter((message) => message.type === "digital_silence").length, 0, "short zero runs do not warn");
  for (let index = 0; index < 260; index += 1) processor.process([[new Float32Array(128)]]);
  assert.equal(messages.filter((message) => message.type === "digital_silence").length, 1, "sustained zero input warns once");
  assert.equal(messages.find((message) => message.type === "digital_silence").diagnostic, "device_stall");
  processor.process([[Float32Array.from({ length: 128 }, () => 0.1)]]);
  for (let index = 0; index < 260; index += 1) processor.process([[new Float32Array(128)]]);
  assert.equal(messages.filter((message) => message.type === "digital_silence").length, 2, "signal re-arms the warning");
});
