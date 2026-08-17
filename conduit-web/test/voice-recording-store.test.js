import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MIN_VOICE_DIAGNOSTIC_AUDIO_BYTES,
  VoiceRecordingStore,
} from "../src/server/voice-recording-store.js";

async function filesIn(root) {
  return (await fs.readdir(root)).sort();
}

test("voice recording store rejects empty and short transcript pairs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-recordings-"));
  try {
    const store = new VoiceRecordingStore({ root });
    assert.equal(await store.save({ audioChunks: [], audioBytes: 0, transcript: "ignored" }), null);
    assert.equal(await store.save({
      audioChunks: [Buffer.alloc(MIN_VOICE_DIAGNOSTIC_AUDIO_BYTES)],
      audioBytes: MIN_VOICE_DIAGNOSTIC_AUDIO_BYTES,
      transcript: "",
    }), null);
    assert.equal(await store.save({
      audioChunks: [Buffer.alloc(MIN_VOICE_DIAGNOSTIC_AUDIO_BYTES - 2)],
      audioBytes: MIN_VOICE_DIAGNOSTIC_AUDIO_BYTES - 2,
      transcript: "too short",
    }), null);
    assert.deepEqual(await filesIn(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("voice recording store writes a matching WAV and JSON sidecar", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-recordings-"));
  try {
    const store = new VoiceRecordingStore({ root });
    const pcm = Buffer.alloc(MIN_VOICE_DIAGNOSTIC_AUDIO_BYTES, 7);
    const record = await store.save({
      audioChunks: [pcm.subarray(0, 12_345), pcm.subarray(12_345)],
      audioBytes: pcm.length,
      transcript: "This is a diagnostic recording.",
      metadata: { provider: "local", model: "parakeet-tdt-0.6b-v3-int8" },
    });
    assert.equal(record.audioBytes, pcm.length);
    assert.equal(record.audioDurationMs, 1_000);
    assert.deepEqual((await filesIn(root)).filter((file) => file.endsWith(".wav")).length, 1);
    assert.deepEqual((await filesIn(root)).filter((file) => file.endsWith(".json")).length, 1);
    const audio = await fs.readFile(path.join(root, record.audioFile));
    assert.equal(audio.length, 44 + pcm.length);
    assert.equal(audio.subarray(0, 4).toString(), "RIFF");
    assert.equal(audio.subarray(8, 16).toString(), "WAVEfmt ");
    assert.equal(audio.readUInt32LE(24), 16_000);
    assert.equal(audio.readUInt16LE(34), 16);
    assert.equal(audio.readUInt32LE(40), pcm.length);
    assert.deepEqual(audio.subarray(44), pcm);
    const sidecar = JSON.parse(await fs.readFile(path.join(root, `${record.id}.json`), "utf8"));
    assert.equal(sidecar.schemaVersion, 2);
    assert.equal(sidecar.transcript, record.transcript);
    assert.equal(sidecar.provider, "local");
    assert.equal(sidecar.model, "parakeet-tdt-0.6b-v3-int8");
    assert.equal((await fs.stat(root)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(root, record.audioFile))).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.join(root, `${record.id}.json`))).mode & 0o777, 0o600);
    await store.updateMetadata(record, { diagnostics: { server: { schemaVersion: 2 } } });
    const updated = JSON.parse(await fs.readFile(path.join(root, `${record.id}.json`), "utf8"));
    assert.deepEqual(updated.diagnostics, { server: { schemaVersion: 2 } });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("voice recording store keeps diagnostic audio with an empty transcript when requested", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-recordings-"));
  try {
    const store = new VoiceRecordingStore({ root });
    const pcm = Buffer.alloc(MIN_VOICE_DIAGNOSTIC_AUDIO_BYTES, 9);
    const record = await store.save({
      audioChunks: [pcm],
      audioBytes: pcm.length,
      transcript: "",
      allowEmptyTranscript: true,
      metadata: { completionReason: "stopped" },
    });
    assert.equal(record.transcript, "");
    assert.equal(record.transcriptStatus, "empty");
    const sidecar = JSON.parse(await fs.readFile(path.join(root, `${record.id}.json`), "utf8"));
    assert.equal(sidecar.transcript, "");
    assert.equal(sidecar.transcriptStatus, "empty");
    assert.equal((await fs.stat(path.join(root, record.audioFile))).size, 44 + pcm.length);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("voice recording store keeps only the newest twenty complete pairs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-recordings-"));
  try {
    const store = new VoiceRecordingStore({ root });
    const pcm = Buffer.alloc(MIN_VOICE_DIAGNOSTIC_AUDIO_BYTES, 3);
    for (let index = 0; index < 21; index += 1) {
      await store.save({
        audioChunks: [pcm],
        audioBytes: pcm.length,
        transcript: `recording ${index}`,
      });
    }
    const files = await filesIn(root);
    assert.equal(files.filter((file) => file.endsWith(".wav")).length, 20);
    assert.equal(files.filter((file) => file.endsWith(".json")).length, 20);
    assert.equal(files.some((file) => file.startsWith(".pending-")), false);
    const records = await Promise.all(files.filter((file) => file.endsWith(".json")).map(async (file) => (
      JSON.parse(await fs.readFile(path.join(root, file), "utf8"))
    )));
    assert.equal(records.every((record) => record.audioFile.endsWith(".wav")), true);
    assert.equal(records.every((record) => record.transcript.startsWith("recording ")), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("short failure recordings use a separate bounded rotation quota", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-recordings-short-"));
  try {
    const store = new VoiceRecordingStore({ root, maxRecords: 2, maxShortRecords: 2 });
    const standard = Buffer.alloc(MIN_VOICE_DIAGNOSTIC_AUDIO_BYTES, 1);
    for (let index = 0; index < 3; index += 1) {
      await store.save({ audioChunks: [standard], audioBytes: standard.length, transcript: `standard ${index}` });
    }
    for (let index = 0; index < 4; index += 1) {
      const short = Buffer.alloc(320, index + 2);
      await store.save({ audioChunks: [short], audioBytes: short.length, transcript: "", allowEmptyTranscript: true, allowShortAudio: true, metadata: { completionReason: "failed" } });
    }
    const files = await filesIn(root);
    assert.equal(files.filter((file) => file.endsWith(".wav")).length, 4);
    const records = await Promise.all(files.filter((file) => file.endsWith(".json")).map(async (file) => JSON.parse(await fs.readFile(path.join(root, file), "utf8"))));
    assert.equal(records.filter((record) => record.audioClass === "standard").length, 2);
    assert.equal(records.filter((record) => record.audioClass === "short").length, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("archive queue owns copied PCM and drains accepted work", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-recordings-queue-"));
  let release;
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  try {
    const store = new VoiceRecordingStore({ root });
    const save = store.save.bind(store);
    store.save = async (...args) => {
      started();
      await gate;
      return save(...args);
    };
    const firstPcm = Buffer.alloc(MIN_VOICE_DIAGNOSTIC_AUDIO_BYTES, 7);
    const first = store.enqueue({
      audioChunks: [firstPcm],
      audioBytes: firstPcm.length,
      transcript: "first queued recording",
    });
    await startedPromise;
    firstPcm.fill(3);
    const secondPcm = Buffer.alloc(MIN_VOICE_DIAGNOSTIC_AUDIO_BYTES, 9);
    const second = store.enqueue({
      audioChunks: [secondPcm],
      audioBytes: secondPcm.length,
      transcript: "second queued recording",
    });
    const drain = store.drain({ timeoutMs: 1_000 });
    release();
    const [firstRecord, secondRecord, drainResult] = await Promise.all([first, second, drain]);
    assert.equal(firstRecord.archive.failure, null);
    assert.equal(typeof firstRecord.archive.queueDelayMs, "number");
    assert.equal(typeof firstRecord.archive.writeDurationMs, "number");
    assert.equal(firstRecord.archive.path.audioFile, firstRecord.audioFile);
    assert.equal(drainResult.drained, true);
    const firstWav = await fs.readFile(path.join(root, firstRecord.audioFile));
    assert.equal(firstWav[44], 7);
    assert.equal(secondRecord.archive.path.metadataFile, `${secondRecord.id}.json`);
    assert.equal((await filesIn(root)).some((file) => file.startsWith(".pending-")), false);
  } finally {
    release?.();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("archive drain drops queued work at its shutdown deadline", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-recordings-drain-"));
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  try {
    const store = new VoiceRecordingStore({ root });
    store.save = async () => gate;
    const pcm = Buffer.alloc(MIN_VOICE_DIAGNOSTIC_AUDIO_BYTES, 5);
    const active = store.enqueue({ audioChunks: [pcm], audioBytes: pcm.length, transcript: "active" });
    await new Promise((resolve) => setImmediate(resolve));
    const queued = store.enqueue({ audioChunks: [pcm], audioBytes: pcm.length, transcript: "queued" });
    const result = await store.drain({ timeoutMs: 20 });
    assert.equal(result.drained, false);
    assert.equal(result.timedOut, true);
    assert.equal(result.droppedRecords, 1);
    await assert.rejects(queued, (error) => error.code === "voice_archive_shutdown_timeout");
    release();
    await active;
  } finally {
    release?.();
    await fs.rm(root, { recursive: true, force: true });
  }
});
