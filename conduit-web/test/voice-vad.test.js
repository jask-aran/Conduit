import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { proposeSileroRegions, SILERO_VAD_POLICY, SileroVad, VoiceVadObservationQueue } from "../src/server/voice-vad.js";

function framesFor(parts) {
  const frames = [];
  let startSample = 0;
  for (const part of parts) {
    for (let index = 0; index < part.count; index += 1) {
      frames.push({ startSample, endSample: startSample + 512, probability: part.probability });
      startSample += 512;
    }
  }
  return { frames, sampleCount: startSample };
}

test("Silero boundary observation adds padding and closes after hangover", () => {
  const { frames, sampleCount } = framesFor([
    { count: 4, probability: 0.01 },
    { count: 6, probability: 0.92 },
    { count: 12, probability: 0.01 },
    { count: 5, probability: 0.88 },
    { count: 2, probability: 0.01 },
  ]);
  const result = proposeSileroRegions(frames, sampleCount);
  assert.equal(result.regions.length, 2);
  assert.equal(result.policy.preRollMs, SILERO_VAD_POLICY.preRollMs);
  assert.equal(result.regions[0].speechStartSample, 4 * 512);
  assert.equal(result.regions[0].preRollSamples, Math.min(4 * 512, SILERO_VAD_POLICY.preRollMs * 16));
  assert.equal(result.regions[0].speechEndSample, 10 * 512);
  assert.equal(result.regions[0].trailingPaddingSamples, SILERO_VAD_POLICY.trailingPaddingMs * 16);
  assert.equal(result.regions[0].hangoverFrames, 10);
  assert.equal(result.regions[1].speechStartSample, 22 * 512);
});

test("Silero boundary observation remains finite around non-speech transients", () => {
  const { frames, sampleCount } = framesFor([
    { count: 1, probability: 0.9 },
    { count: 20, probability: 0.01 },
    { count: 1, probability: 0.8 },
    { count: 20, probability: 0.01 },
    { count: 1, probability: 0.7 },
  ]);
  const result = proposeSileroRegions(frames, sampleCount, { hangoverMs: 64 });
  assert.equal(result.regions.length, 3);
  assert.ok(result.regions.every((region) => region.endSample > region.startSample));
  assert.ok(result.regions.every((region) => region.endSample <= sampleCount));
});

test("Silero boundary policy uses hysteresis and records actual closure semantics", () => {
  const { frames, sampleCount } = framesFor([
    { count: 2, probability: 0.8 },
    { count: 3, probability: 0.4 },
    { count: 10, probability: 0.1 },
  ]);
  const result = proposeSileroRegions(frames, sampleCount, { hangoverMs: 64 });
  assert.equal(result.policy.entryThreshold, 0.5);
  assert.equal(result.policy.exitThreshold, 0.35);
  assert.equal(result.regions.length, 1);
  assert.equal(result.regions[0].activeFrameCount, 5);
  assert.equal(result.regions[0].closureReason, "silence");
  assert.equal(result.regions[0].exitDecisionFrame, 6);
  assert.equal(result.regions[0].lastActiveFrame, 4);
  assert.equal(result.regions[0].spanFrameCount, 7);
});

test("Silero submission ranges do not overlap padded neighboring regions", () => {
  const { frames, sampleCount } = framesFor([
    { count: 4, probability: 0.9 },
    { count: 12, probability: 0.01 },
    { count: 4, probability: 0.9 },
  ]);
  const result = proposeSileroRegions(frames, sampleCount, { hangoverMs: 64, preRollMs: 240, trailingPaddingMs: 240 });
  assert.equal(result.regions.length, 2);
  assert.ok(result.regions[0].paddedEndSample > result.regions[1].paddedStartSample);
  assert.ok(result.regions[0].submittedEndSample <= result.regions[1].submittedStartSample);
  assert.ok(result.regions[0].coreEndSample <= result.regions[0].submittedEndSample);
  assert.ok(result.regions[1].coreStartSample >= result.regions[1].submittedStartSample);
});

test("Silero policy preserves explicit zero values and bounds long false-positive regions", () => {
  const { frames, sampleCount } = framesFor([{ count: 8, probability: 0.9 }]);
  const result = proposeSileroRegions(frames, sampleCount, {
    entryThreshold: 0,
    exitThreshold: 0,
    preRollMs: 0,
    hangoverMs: 0,
    trailingPaddingMs: 0,
    maxRegionMs: 64,
  });
  assert.equal(result.policy.entryThreshold, 0);
  assert.equal(result.policy.exitThreshold, 0);
  assert.equal(result.policy.preRollMs, 0);
  assert.equal(result.policy.hangoverMs, 0);
  assert.equal(result.policy.trailingPaddingMs, 0);
  assert.ok(result.regions.length >= 2);
  assert.equal(result.regions[0].closureReason, "maximum_duration");
});

test("Silero observation queue bounds capacity and times out observation-only work", async () => {
  let calls = 0;
  const queue = new VoiceVadObservationQueue({
    maxPending: 1,
    maxPendingBytes: 8,
    timeoutMs: 1_000,
    observer: (_pcm, { signal }) => {
      calls += 1;
      return new Promise((resolve) => signal.addEventListener("abort", () => resolve({ available: false, status: "cancelled", regions: [], frames: [] }), { once: true }));
    },
  });
  const first = queue.enqueue(Buffer.alloc(4));
  const second = queue.enqueue(Buffer.alloc(4));
  const third = await queue.enqueue(Buffer.alloc(4));
  assert.equal(third.status, "capacity_skipped");
  assert.equal((await first).status, "timed_out");
  assert.equal((await second).status, "timed_out");
  assert.equal(calls, 2);
  queue.stop();
});

test("Silero observation reports unavailable without changing the transcription path", async () => {
  const root = await fs.mkdtemp(path.join("/tmp", "conduit-vad-unavailable-"));
  try {
    const vad = new SileroVad({ root });
    const result = await vad.observe(Buffer.alloc(16_000 * 2));
    assert.equal(result.available, false);
    assert.equal(result.status, "unavailable");
    assert.equal(result.regions.length, 0);
    await vad.stop();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("installed Silero artifact produces auditable probabilities and no regions for digital silence", async (t) => {
  const root = path.resolve("../data/voice/models");
  try {
    await fs.access(path.join(root, "parakeet-tdt-0.6b-v2-int8", "models", "silero_vad.onnx"));
  } catch {
    t.skip("development voice model artifacts are not installed");
    return;
  }
  const vad = new SileroVad({ root });
  const result = await vad.observe(Buffer.alloc(16_000 * 2));
  assert.equal(result.available, true);
  assert.equal(result.status, "observed");
  assert.equal(result.model.license, "MIT");
  assert.equal(result.model.sha256, "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3");
  assert.equal(result.deployment.executionProvider, "cpu");
  assert.equal(result.deployment.unprivileged, true);
  assert.equal(result.frameCount, 32);
  assert.equal(result.frames.length, 32);
  assert.equal(result.regions.length, 0);
  await vad.stop();
});
