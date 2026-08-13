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
    assert.equal(sidecar.transcript, record.transcript);
    assert.equal(sidecar.provider, "local");
    assert.equal(sidecar.model, "parakeet-tdt-0.6b-v3-int8");
    assert.equal((await fs.stat(root)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(root, record.audioFile))).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.join(root, `${record.id}.json`))).mode & 0o777, 0o600);
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
