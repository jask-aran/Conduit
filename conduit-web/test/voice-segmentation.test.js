import assert from "node:assert/strict";
import test from "node:test";
import {
  HEURISTIC_SEGMENTATION_POLICY,
  SEGMENTATION_CALIBRATION_MANIFEST,
  createHeuristicSegmentationProvider,
} from "../src/server/voice-segmentation.js";

function pcmWith(parts) {
  return Buffer.concat(parts.map(({ samples, level }) => {
    const buffer = Buffer.alloc(samples * 2);
    for (let index = 0; index < samples; index += 1) buffer.writeInt16LE(Math.round(level * 32767), index * 2);
    return buffer;
  }));
}

test("heuristic segmentation uses calibrated margins and preserves a long pause boundary", async () => {
  const provider = createHeuristicSegmentationProvider();
  const audio = pcmWith([
    { samples: 16_000, level: 0.1 },
    { samples: 16_000, level: 0 },
    { samples: 16_000, level: 0.1 },
  ]);
  const result = await provider.observe(audio);

  assert.equal(result.type, "heuristic_segmentation_observation");
  assert.equal(result.available, true);
  assert.equal(result.policy.entryMarginDb, HEURISTIC_SEGMENTATION_POLICY.entryMarginDb);
  assert.equal(result.policy.calibrationVersion, SEGMENTATION_CALIBRATION_MANIFEST.version);
  assert.equal(result.regions.length, 2);
  assert.ok(result.regions[0].startSample < 16_000);
  assert.ok(result.regions[0].endSample > 16_000);
  assert.ok(result.regions[1].startSample < 32_000);
});

test("heuristic segmentation never mutates the accepted PCM and keeps short activity", async () => {
  const provider = createHeuristicSegmentationProvider({ onsetConfirmationMs: 20, exitSilenceMs: 600 });
  const audio = pcmWith([
    { samples: 2_000, level: 0 },
    { samples: 2_000, level: 0.08 },
    { samples: 12_000, level: 0 },
  ]);
  const before = Buffer.from(audio);
  const result = await provider.observe(audio);

  assert.deepEqual(audio, before);
  assert.ok(result.regions.length >= 1);
  assert.ok(result.regions[0].speechEndSample > result.regions[0].speechStartSample);
});

test("heuristic streaming flush includes trailing speech at Stop", async () => {
  const provider = createHeuristicSegmentationProvider({ onsetConfirmationMs: 20 });
  const stream = provider.createStream();
  const first = pcmWith([{ samples: 16_000, level: 0.1 }]);
  const second = pcmWith([{ samples: 1_000, level: 0.1 }]);
  assert.deepEqual(await stream.push(first), []);
  assert.deepEqual(await stream.push(second), []);
  const result = await stream.finish();
  assert.equal(result.regions.length, 1);
  assert.equal(result.regions[0].speechEndSample, 17_000);
});
