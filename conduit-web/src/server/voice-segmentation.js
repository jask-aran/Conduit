import { performance } from "node:perf_hooks";

export const SEGMENTATION_CALIBRATION_MANIFEST = Object.freeze({
  version: "voice-segmentation-calibration-v1",
  sampleRate: 16_000,
  frameMs: 20,
  cases: Object.freeze([
    Object.freeze({ id: "quiet", expected: "no_regions" }),
    Object.freeze({ id: "boomy", expected: "one_region" }),
    Object.freeze({ id: "fan", expected: "speech_above_noise_floor" }),
    Object.freeze({ id: "keyboard", expected: "bounded_transients" }),
    Object.freeze({ id: "short-word", expected: "one_short_region" }),
    Object.freeze({ id: "pause", expected: "two_regions" }),
  ]),
});

export const HEURISTIC_SEGMENTATION_POLICY = Object.freeze({
  sampleRate: 16_000,
  frameSamples: 320,
  noiseFloorInitialDbfs: -60,
  noiseFloorMinDbfs: -90,
  noiseFloorMaxDbfs: -18,
  noiseFloorUpdateAlpha: 0.08,
  entryMarginDb: 12,
  exitMarginDb: 6,
  onsetConfirmationMs: 60,
  preRollMs: 240,
  exitSilenceMs: 800,
  trailingPaddingMs: 240,
  hangoverMs: 320,
  maxRegionMs: 30_000,
  calibrationVersion: SEGMENTATION_CALIBRATION_MANIFEST.version,
});

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback) {
  return Math.max(1, Math.round(finite(value, fallback)));
}

function policyValues(overrides = {}) {
  const policy = {
    ...HEURISTIC_SEGMENTATION_POLICY,
    ...overrides,
  };
  policy.sampleRate = 16_000;
  policy.frameSamples = positiveInteger(policy.frameSamples, HEURISTIC_SEGMENTATION_POLICY.frameSamples);
  policy.noiseFloorInitialDbfs = Math.min(-1, Math.max(-100, finite(policy.noiseFloorInitialDbfs, -60)));
  policy.noiseFloorMinDbfs = Math.min(policy.noiseFloorInitialDbfs, finite(policy.noiseFloorMinDbfs, -90));
  policy.noiseFloorMaxDbfs = Math.max(policy.noiseFloorInitialDbfs, Math.min(-1, finite(policy.noiseFloorMaxDbfs, -18)));
  policy.noiseFloorUpdateAlpha = Math.min(1, Math.max(0.001, finite(policy.noiseFloorUpdateAlpha, 0.08)));
  policy.entryMarginDb = Math.max(1, finite(policy.entryMarginDb, 12));
  policy.exitMarginDb = Math.max(0, Math.min(policy.entryMarginDb, finite(policy.exitMarginDb, 6)));
  policy.onsetConfirmationMs = Math.max(0, finite(policy.onsetConfirmationMs, 60));
  policy.preRollMs = Math.max(0, finite(policy.preRollMs, 240));
  policy.exitSilenceMs = Math.max(policy.frameSamples * 1_000 / policy.sampleRate, finite(policy.exitSilenceMs, 800));
  policy.trailingPaddingMs = Math.max(0, finite(policy.trailingPaddingMs, 240));
  policy.hangoverMs = Math.max(0, finite(policy.hangoverMs, 320));
  policy.maxRegionMs = Math.max(policy.frameSamples * 1_000 / policy.sampleRate, finite(policy.maxRegionMs, 30_000));
  policy.onsetFrames = Math.max(1, Math.ceil(policy.onsetConfirmationMs * policy.sampleRate / 1_000 / policy.frameSamples));
  policy.exitFrames = Math.max(1, Math.ceil(policy.exitSilenceMs * policy.sampleRate / 1_000 / policy.frameSamples));
  policy.preRollSamples = Math.round(policy.preRollMs * policy.sampleRate / 1_000);
  policy.trailingPaddingSamples = Math.round(policy.trailingPaddingMs * policy.sampleRate / 1_000);
  policy.maxRegionSamples = Math.round(policy.maxRegionMs * policy.sampleRate / 1_000);
  policy.hangoverFrames = Math.max(0, Math.ceil(policy.hangoverMs * policy.sampleRate / 1_000 / policy.frameSamples));
  policy.calibrationVersion = SEGMENTATION_CALIBRATION_MANIFEST.version;
  return Object.freeze(policy);
}

function rmsDbfs(buffer, sampleCount) {
  if (!sampleCount) return -90;
  let sumSquares = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const value = buffer.readInt16LE(index * 2) / 32768;
    sumSquares += value * value;
  }
  const rms = Math.sqrt(sumSquares / sampleCount);
  return Math.max(-90, 20 * Math.log10(Math.max(rms, 1e-5)));
}

function rounded(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function regionFromFrames(frames, startFrame, lastActiveFrame, sampleCount, policy, closureReason) {
  const coreStartSample = frames[startFrame].startSample;
  const coreEndSample = frames[lastActiveFrame].endSample;
  const startSample = Math.max(0, coreStartSample - policy.preRollSamples);
  const endSample = Math.min(sampleCount, coreEndSample + policy.trailingPaddingSamples);
  return {
    startSample,
    endSample,
    speechStartSample: coreStartSample,
    speechEndSample: coreEndSample,
    submittedStartSample: startSample,
    submittedEndSample: endSample,
    startMs: Math.round(startSample / 16),
    endMs: Math.round(endSample / 16),
    durationMs: Math.round((endSample - startSample) / 16),
    speechStartMs: Math.round(coreStartSample / 16),
    speechEndMs: Math.round(coreEndSample / 16),
    onsetFrame: startFrame,
    lastActiveFrame,
    closureReason,
    preRollSamples: coreStartSample - startSample,
    trailingPaddingSamples: endSample - coreEndSample,
    spanFrameCount: lastActiveFrame - startFrame + 1,
  };
}

function unavailable(sampleCount, policy, status = "unavailable", error = null) {
  return {
    type: "heuristic_segmentation_observation",
    available: false,
    status,
    policy,
    sampleCount,
    frameCount: 0,
    frames: [],
    regions: [],
    summary: { regionCount: 0, maxLevelDbfs: -90, noiseFloorDbfs: policy.noiseFloorInitialDbfs },
    ...(error ? { errorCode: error.code || "voice_segmentation_unavailable", error: error.message } : {}),
  };
}

class HeuristicSegmentationStream {
  constructor(policy) {
    this.policy = policy;
    this.pending = Buffer.alloc(0);
    this.frames = [];
    this.regions = [];
    this.sampleCount = 0;
    this.processedSamples = 0;
    this.noiseFloorDbfs = policy.noiseFloorInitialDbfs;
    this.regionStartFrame = -1;
    this.lastActiveFrame = -1;
    this.onsetFrame = -1;
    this.silentFrameCount = 0;
    this.emittedRegionCount = 0;
    this.finished = false;
  }

  updateNoiseFloor(levelDbfs) {
    if (this.regionStartFrame >= 0) return;
    if (levelDbfs >= this.noiseFloorDbfs + this.policy.entryMarginDb / 2) return;
    this.noiseFloorDbfs = Math.min(
      this.policy.noiseFloorMaxDbfs,
      Math.max(
        this.policy.noiseFloorMinDbfs,
        this.noiseFloorDbfs + (levelDbfs - this.noiseFloorDbfs) * this.policy.noiseFloorUpdateAlpha,
      ),
    );
  }

  closeRegion(reason) {
    if (this.regionStartFrame < 0 || this.lastActiveFrame < this.regionStartFrame) return;
    this.regions.push(regionFromFrames(
      this.frames,
      this.regionStartFrame,
      this.lastActiveFrame,
      this.sampleCount,
      this.policy,
      reason,
    ));
    this.regionStartFrame = -1;
    this.lastActiveFrame = -1;
    this.onsetFrame = -1;
    this.silentFrameCount = 0;
  }

  processFrame(buffer, sampleCount) {
    const startSample = this.processedSamples;
    const endSample = startSample + sampleCount;
    this.processedSamples = endSample;
    const levelDbfs = rmsDbfs(buffer, sampleCount);
    const frame = {
      startSample,
      endSample,
      levelDbfs: rounded(levelDbfs),
      noiseFloorDbfs: rounded(this.noiseFloorDbfs),
    };
    const frameIndex = this.frames.push(frame) - 1;
    const entry = levelDbfs >= this.noiseFloorDbfs + this.policy.entryMarginDb;
    const exit = levelDbfs >= this.noiseFloorDbfs + this.policy.exitMarginDb;

    if (this.regionStartFrame < 0) {
      this.updateNoiseFloor(levelDbfs);
      if (!entry) {
        this.onsetFrame = -1;
        return;
      }
      if (this.onsetFrame < 0) this.onsetFrame = frameIndex;
      if (frameIndex - this.onsetFrame + 1 >= this.policy.onsetFrames) {
        this.regionStartFrame = this.onsetFrame;
        this.lastActiveFrame = frameIndex;
        this.silentFrameCount = 0;
      }
      return;
    }

    if (exit) {
      this.lastActiveFrame = frameIndex;
      this.silentFrameCount = 0;
    } else {
      this.silentFrameCount += 1;
      if (this.silentFrameCount >= this.policy.exitFrames) this.closeRegion("silence");
    }
    if (this.regionStartFrame >= 0
      && this.frames[frameIndex].endSample - this.frames[this.regionStartFrame].startSample >= this.policy.maxRegionSamples) {
      this.closeRegion("maximum_duration");
    }
  }

  async push(pcm) {
    if (this.finished) throw Object.assign(new Error("The heuristic segmentation stream is already closed"), { code: "voice_segmentation_stream_closed" });
    const buffer = Buffer.isBuffer(pcm) ? Buffer.from(pcm) : Buffer.from(pcm || []);
    if (!buffer.length) return [];
    this.sampleCount += Math.floor(buffer.length / 2);
    this.pending = this.pending.length ? Buffer.concat([this.pending, buffer]) : buffer;
    while (this.pending.length >= this.policy.frameSamples * 2) {
      const frame = this.pending.subarray(0, this.policy.frameSamples * 2);
      this.processFrame(frame, this.policy.frameSamples);
      this.pending = this.pending.subarray(this.policy.frameSamples * 2);
    }
    return this.readyRegions();
  }

  readyRegions() {
    const regions = this.regions.slice(this.emittedRegionCount).map((region, offset) => ({
      ...region,
      regionIndex: this.emittedRegionCount + offset,
    }));
    this.emittedRegionCount = this.regions.length;
    return regions;
  }

  async finish() {
    if (this.finished) return this.observation();
    this.finished = true;
    if (this.pending.length >= 2) {
      const sampleCount = Math.floor(this.pending.length / 2);
      this.processFrame(this.pending, sampleCount);
      this.pending = Buffer.alloc(0);
    }
    if (this.regionStartFrame >= 0) this.closeRegion("end_of_stream");
    return this.observation();
  }

  observation() {
    return {
      type: "heuristic_segmentation_observation",
      available: true,
      status: this.regions.length ? "speech" : "silence",
      policy: this.policy,
      sampleCount: this.sampleCount,
      frameCount: this.frames.length,
      frames: this.frames.slice(),
      regions: this.regions.slice().map((region, index) => ({ ...region, regionIndex: index })),
      summary: {
        regionCount: this.regions.length,
        maxLevelDbfs: this.frames.length ? Math.max(...this.frames.map((frame) => frame.levelDbfs)) : -90,
        noiseFloorDbfs: rounded(this.noiseFloorDbfs),
      },
    };
  }

  cancel() {
    this.finished = true;
    this.pending = Buffer.alloc(0);
  }
}

export function createHeuristicSegmentationProvider(overrides = {}) {
  const policy = policyValues(overrides);
  return {
    mode: "heuristic",
    policy,
    createStream() { return new HeuristicSegmentationStream(policy); },
    async observe(pcm) {
      const stream = this.createStream();
      await stream.push(pcm);
      return stream.finish();
    },
  };
}

export function createSegmentationProvider({ mode = "none", silero = null, heuristicPolicy = {} } = {}) {
  if (mode === "heuristic") return createHeuristicSegmentationProvider(heuristicPolicy);
  if (mode === "silero" && silero && (typeof silero.observe === "function" || typeof silero.createStream === "function")) {
    return {
      mode: "silero",
      observe: typeof silero.observe === "function"
        ? (pcm) => silero.observe(pcm)
        : undefined,
      createStream: typeof silero.createStream === "function"
        ? () => silero.createStream()
        : undefined,
    };
  }
  return {
    mode: "none",
    observe: async (pcm) => unavailable(Math.floor(Buffer.byteLength(pcm || []) / 2), null, "not_configured"),
    createStream: () => null,
  };
}

export function segmentationObservationMetadata(observation) {
  return {
    source: observation?.type === "heuristic_segmentation_observation" ? "heuristic" : "silero",
    available: observation?.available === true,
    status: observation?.status || "unavailable",
    frameCount: Number(observation?.frameCount) || 0,
    regionCount: Array.isArray(observation?.regions) ? observation.regions.length : 0,
    calibrationVersion: observation?.policy?.calibrationVersion || null,
    capturedAtMs: Math.round(performance.now()),
  };
}
