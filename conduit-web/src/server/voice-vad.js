import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { SILERO_VAD_ARTIFACT } from "./voice-model-manifests.js";

export const SILERO_VAD_POLICY = Object.freeze({
  sampleRate: 16_000,
  frameSamples: 512,
  contextSamples: 64,
  threshold: 0.5,
  entryThreshold: 0.5,
  exitThreshold: 0.35,
  preRollMs: 240,
  hangoverMs: 320,
  trailingPaddingMs: 240,
  maxRegionMs: 30_000,
});

export const SILERO_MAX_SEGMENTS = 16;

const SILERO_STATE_SIZE = 2 * 128;
const MODEL_FILE = SILERO_VAD_ARTIFACT.name;

function vadError(code, message) {
  return Object.assign(new Error(message), { code });
}

function roundedProbability(value) {
  return Math.round(Math.min(1, Math.max(0, Number(value) || 0)) * 1_000_000) / 1_000_000;
}

function roundedMean(values) {
  if (!values.length) return 0;
  return roundedProbability(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function relativeSource(root, filePath) {
  const relative = path.relative(root, filePath);
  return relative && !relative.startsWith("..") ? relative : "configured";
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const file = await fs.open(filePath, "r");
  try {
    for await (const chunk of file.createReadStream()) hash.update(chunk);
    return hash.digest("hex");
  } finally {
    await file.close().catch(() => {});
  }
}

async function verifyModel(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw vadError("voice_vad_model_invalid", "The Silero VAD artifact is not a regular file");
  if (stat.size !== SILERO_VAD_ARTIFACT.size) {
    throw vadError("voice_vad_model_size", "The Silero VAD artifact has an unexpected size");
  }
  const sha256 = await sha256File(filePath);
  if (sha256 !== SILERO_VAD_ARTIFACT.sha256) {
    throw vadError("voice_vad_model_checksum", "The Silero VAD artifact checksum does not match the pinned manifest");
  }
  return { size: stat.size, sha256 };
}

async function candidatePaths(root, explicitPath) {
  if (explicitPath) return [path.resolve(explicitPath)];
  const candidates = [
    path.join(root, "silero-vad", MODEL_FILE),
    path.join(root, MODEL_FILE),
  ];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      candidates.push(path.join(root, entry.name, "models", MODEL_FILE));
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return [...new Set(candidates)];
}

async function locateModel(root, explicitPath) {
  let lastError = null;
  for (const filePath of await candidatePaths(root, explicitPath)) {
    try {
      const verification = await verifyModel(filePath);
      return { filePath, verification };
    } catch (error) {
      if (error.code !== "ENOENT") lastError = error;
    }
  }
  if (lastError) throw lastError;
  throw vadError("voice_vad_model_unavailable", "No pinned Silero VAD artifact is installed");
}

async function defaultSessionFactory(filePath) {
  const ort = await import("onnxruntime-node");
  const session = await ort.InferenceSession.create(filePath, { executionProviders: ["cpu"] });
  return { ort, session };
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function policyValues(overrides = {}) {
  const policy = { ...SILERO_VAD_POLICY, ...overrides };
  policy.sampleRate = 16_000;
  policy.frameSamples = 512;
  policy.contextSamples = 64;
  const entryThreshold = finiteOr(overrides.entryThreshold, finiteOr(overrides.threshold, SILERO_VAD_POLICY.entryThreshold));
  policy.entryThreshold = Math.min(1, Math.max(0, entryThreshold));
  policy.threshold = policy.entryThreshold;
  policy.exitThreshold = Math.min(policy.entryThreshold, Math.max(0, finiteOr(policy.exitThreshold, SILERO_VAD_POLICY.exitThreshold)));
  policy.preRollMs = Math.max(0, Math.round(finiteOr(policy.preRollMs, SILERO_VAD_POLICY.preRollMs)));
  policy.hangoverMs = Math.max(0, Math.round(finiteOr(policy.hangoverMs, SILERO_VAD_POLICY.hangoverMs)));
  policy.trailingPaddingMs = Math.max(0, Math.round(finiteOr(policy.trailingPaddingMs, SILERO_VAD_POLICY.trailingPaddingMs)));
  policy.maxRegionMs = Math.max(policy.frameSamples * 1_000 / policy.sampleRate, Math.round(finiteOr(policy.maxRegionMs, SILERO_VAD_POLICY.maxRegionMs)));
  return policy;
}

function regionFromFrames(frames, startFrame, lastActiveFrame, sampleCount, policy, closure = {}) {
  const coreStartSample = frames[startFrame].startSample;
  const coreEndSample = frames[lastActiveFrame].endSample;
  const paddedStartSample = Math.max(0, coreStartSample - Math.round(policy.preRollMs * policy.sampleRate / 1_000));
  const paddedEndSample = Math.min(sampleCount, coreEndSample + Math.round(policy.trailingPaddingMs * policy.sampleRate / 1_000));
  const endFrame = Math.max(lastActiveFrame, Number.isInteger(closure.exitDecisionFrame) ? closure.exitDecisionFrame : lastActiveFrame);
  const span = frames.slice(startFrame, endFrame + 1);
  const active = span.filter((frame) => frame.probability >= policy.exitThreshold);
  const hangoverFrames = Math.ceil(policy.hangoverMs * policy.sampleRate / 1_000 / policy.frameSamples);
  const exitDecisionFrame = Number.isInteger(closure.exitDecisionFrame) ? closure.exitDecisionFrame : null;
  return {
    coreStartSample,
    coreEndSample,
    paddedStartSample,
    paddedEndSample,
    submittedStartSample: paddedStartSample,
    submittedEndSample: paddedEndSample,
    startSample: paddedStartSample,
    endSample: paddedEndSample,
    startMs: Math.round(paddedStartSample / 16),
    endMs: Math.round(paddedEndSample / 16),
    durationMs: Math.round((paddedEndSample - paddedStartSample) / 16),
    speechStartSample: coreStartSample,
    speechEndSample: coreEndSample,
    speechStartMs: Math.round(coreStartSample / 16),
    speechEndMs: Math.round(coreEndSample / 16),
    onsetFrame: startFrame,
    lastActiveFrame,
    silenceStartFrame: Number.isInteger(closure.silenceStartFrame) ? closure.silenceStartFrame : null,
    exitDecisionFrame,
    closureReason: closure.closureReason || "end_of_stream",
    spanFrameCount: span.length,
    activeFrameCount: active.length,
    meanSpanProbability: roundedMean(span.map((frame) => frame.probability)),
    meanActiveProbability: roundedMean(active.map((frame) => frame.probability)),
    entryFrame: startFrame,
    exitFrame: lastActiveFrame,
    hangoverEndFrame: exitDecisionFrame,
    hangoverFrames,
    preRollSamples: coreStartSample - paddedStartSample,
    trailingPaddingSamples: paddedEndSample - coreEndSample,
    speechFrameCount: active.length,
    meanProbability: roundedMean(active.map((frame) => frame.probability)),
    maxProbability: roundedProbability(Math.max(...span.map((frame) => frame.probability))),
  };
}

function normalizeRegionBoundaries(regions) {
  for (let index = 0; index + 1 < regions.length; index += 1) {
    const current = regions[index];
    const next = regions[index + 1];
    if (current.submittedEndSample <= next.submittedStartSample) continue;
    const boundary = Math.round((current.coreEndSample + next.coreStartSample) / 2);
    current.submittedEndSample = Math.max(current.coreEndSample, boundary);
    next.submittedStartSample = Math.min(next.coreStartSample, boundary);
    current.endSample = current.submittedEndSample;
    next.startSample = next.submittedStartSample;
    current.endMs = Math.round(current.endSample / 16);
    next.startMs = Math.round(next.startSample / 16);
    current.durationMs = Math.round((current.endSample - current.startSample) / 16);
    next.durationMs = Math.round((next.endSample - next.startSample) / 16);
  }
  return regions;
}

function sampleValue(value, sampleCount, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(sampleCount, Math.max(0, Math.round(number)));
}

function mergeSelectedRanges(ranges) {
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (!previous || range.startSample > previous.endSample) {
      merged.push({ ...range, regionIndices: [range.regionIndex] });
      continue;
    }
    previous.endSample = Math.max(previous.endSample, range.endSample);
    previous.regionIndices.push(range.regionIndex);
    previous.speechSamples += range.speechSamples;
  }
  return merged;
}

export function selectSileroVadRanges(observation, sampleCount, { maxSegments = SILERO_MAX_SEGMENTS } = {}) {
  const safeSampleCount = Math.max(0, Math.floor(Number(sampleCount) || 0));
  const safeMaxSegments = Math.max(1, Math.trunc(Number(maxSegments) || SILERO_MAX_SEGMENTS));
  const sourceRegions = Array.isArray(observation?.regions) ? observation.regions : [];
  const ranges = sourceRegions.map((region, regionIndex) => {
    const startSample = sampleValue(
      region?.submittedStartSample ?? region?.paddedStartSample ?? region?.startSample,
      safeSampleCount,
      0,
    );
    const endSample = sampleValue(
      region?.submittedEndSample ?? region?.paddedEndSample ?? region?.endSample,
      safeSampleCount,
      0,
    );
    const speechStartSample = sampleValue(region?.speechStartSample, safeSampleCount, startSample);
    const speechEndSample = sampleValue(region?.speechEndSample, safeSampleCount, endSample);
    return {
      startSample,
      endSample,
      regionIndex,
      speechSamples: Math.max(0, speechEndSample - speechStartSample),
    };
  }).filter((range) => range.endSample > range.startSample)
    .sort((left, right) => left.startSample - right.startSample || left.endSample - right.endSample);
  const merged = mergeSelectedRanges(ranges);
  const normalizedRegionCount = merged.length;
  const available = observation?.available === true;
  let selected = available ? merged : [];
  let guardAction = "none";
  if (available && selected.length > safeMaxSegments) {
    const head = selected.slice(0, safeMaxSegments - 1);
    const tail = selected.slice(safeMaxSegments - 1);
    selected = [
      ...head,
      {
        startSample: tail[0].startSample,
        endSample: tail.at(-1).endSample,
        regionIndices: tail.flatMap((range) => range.regionIndices),
        speechSamples: tail.reduce((sum, range) => sum + range.speechSamples, 0),
      },
    ];
    guardAction = "merged_tail";
  }
  const status = available ? (selected.length ? "speech" : "silence") : observation?.status || "unavailable";
  return {
    source: "silero_authoritative",
    available,
    status,
    segments: selected.map((range) => [range.startSample, range.endSample]),
    regionIndices: selected.map((range) => range.regionIndices),
    speechSamples: selected.reduce((sum, range) => sum + range.speechSamples, 0),
    sourceRegionCount: sourceRegions.length,
    normalizedRegionCount,
    segmentGuard: {
      maxSegments: safeMaxSegments,
      sourceRegionCount: sourceRegions.length,
      normalizedRegionCount,
      submittedSegmentCount: selected.length,
      overflowed: normalizedRegionCount > safeMaxSegments,
      action: guardAction,
    },
    policy: observation?.policy || null,
  };
}

export function proposeSileroRegions(frames, sampleCount, overrides = {}) {
  const policy = policyValues(overrides);
  const hangoverFrames = Math.ceil(policy.hangoverMs * policy.sampleRate / 1_000 / policy.frameSamples);
  const maxRegionFrames = Math.max(1, Math.ceil(policy.maxRegionMs * policy.sampleRate / 1_000 / policy.frameSamples));
  const regions = [];
  let startFrame = -1;
  let lastActiveFrame = -1;
  let silentFrameCount = 0;
  let silenceStartFrame = -1;
  const closeRegion = ({ exitDecisionFrame = null, closureReason = "end_of_stream" } = {}) => {
    if (startFrame < 0 || lastActiveFrame < startFrame) return;
    regions.push(regionFromFrames(frames, startFrame, lastActiveFrame, sampleCount, policy, {
      exitDecisionFrame,
      silenceStartFrame,
      closureReason,
    }));
    startFrame = -1;
    lastActiveFrame = -1;
    silentFrameCount = 0;
    silenceStartFrame = -1;
  };

  for (let index = 0; index < frames.length; index += 1) {
    const probability = frames[index].probability;
    if (startFrame < 0) {
      if (probability >= policy.entryThreshold) {
        startFrame = index;
        lastActiveFrame = index;
      }
      continue;
    }
    if (probability >= policy.exitThreshold) {
      lastActiveFrame = index;
      silentFrameCount = 0;
      silenceStartFrame = -1;
      if (index - startFrame + 1 >= maxRegionFrames) closeRegion({ exitDecisionFrame: index, closureReason: "maximum_duration" });
      continue;
    }
    if (silenceStartFrame < 0) silenceStartFrame = index;
    silentFrameCount += 1;
    if (silentFrameCount >= Math.max(1, hangoverFrames)) closeRegion({ exitDecisionFrame: index, closureReason: "silence" });
  }
  closeRegion({ closureReason: "end_of_stream" });

  return {
    policy,
    regions: normalizeRegionBoundaries(regions),
    regionCount: regions.length,
    speechFrameCount: frames.filter((frame) => frame.probability >= policy.entryThreshold).length,
    maxProbability: roundedProbability(frames.length ? Math.max(...frames.map((frame) => frame.probability)) : 0),
    meanProbability: roundedMean(frames.map((frame) => frame.probability)),
  };
}

function deploymentInfo() {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  return {
    platform: process.platform,
    architecture: process.arch,
    executionProvider: "cpu",
    unprivileged: uid === null ? null : uid !== 0,
  };
}

function unavailableObservation({ status = "unavailable", sampleCount = 0, error = null, policy = SILERO_VAD_POLICY } = {}) {
  return {
    type: "silero_vad_observation",
    available: false,
    status,
    model: null,
    deployment: deploymentInfo(),
    policy: policyValues(policy),
    sampleCount,
    frameCount: 0,
    frames: [],
    regions: [],
    summary: {
      regionCount: 0,
      speechFrameCount: 0,
      maxProbability: 0,
      meanProbability: 0,
    },
    ...(error ? { errorCode: error.code || "voice_vad_unavailable", error: error.message || "Silero VAD is unavailable" } : {}),
  };
}

const DEFAULT_VAD_QUEUE_MAX_PENDING = 2;
const DEFAULT_VAD_QUEUE_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_VAD_TIMEOUT_MS = 30_000;

export class VoiceVadObservationQueue {
  constructor({ observer, concurrency = 1, maxPending = DEFAULT_VAD_QUEUE_MAX_PENDING, maxPendingBytes = DEFAULT_VAD_QUEUE_MAX_BYTES, timeoutMs = DEFAULT_VAD_TIMEOUT_MS } = {}) {
    if (typeof observer !== "function") throw new Error("VoiceVadObservationQueue requires an observer");
    this.observer = observer;
    this.concurrency = Math.max(1, Math.trunc(Number(concurrency) || 1));
    this.maxPending = Math.max(0, Math.trunc(Number(maxPending) || DEFAULT_VAD_QUEUE_MAX_PENDING));
    this.maxPendingBytes = Math.max(1, Math.trunc(Number(maxPendingBytes) || DEFAULT_VAD_QUEUE_MAX_BYTES));
    this.timeoutMs = Math.max(1_000, Math.trunc(Number(timeoutMs) || DEFAULT_VAD_TIMEOUT_MS));
    this.pending = [];
    this.active = 0;
    this.pendingBytes = 0;
    this.controllers = new Set();
  }

  enqueue(pcm) {
    const buffer = Buffer.isBuffer(pcm) ? Buffer.from(pcm) : Buffer.from(pcm || []);
    const sampleCount = Math.floor(buffer.length / 2);
    const queuedAt = performance.now();
    if (this.pending.length >= this.maxPending || this.pendingBytes + buffer.length > this.maxPendingBytes) {
      return Promise.resolve({
        ...unavailableObservation({ status: "capacity_skipped", sampleCount }),
        queue: { status: "capacity_skipped", queuedAt, startedAt: null, completedAt: performance.now(), queueDelayMs: null, executionMs: null },
      });
    }
    return new Promise((resolve) => {
      this.pending.push({ buffer, queuedAt, resolve });
      this.pendingBytes += buffer.length;
      this.pump();
    });
  }

  pump() {
    while (this.active < this.concurrency && this.pending.length) {
      const job = this.pending.shift();
      this.pendingBytes -= job.buffer.length;
      this.active += 1;
      void this.run(job);
    }
  }

  async run(job) {
    const startedAt = performance.now();
    const controller = new AbortController();
    this.controllers.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(Object.assign(new Error("Silero VAD observation timed out"), { code: "voice_vad_timeout" }));
    }, this.timeoutMs);
    let observation;
    try {
      observation = await this.observer(job.buffer, { signal: controller.signal });
    } catch (error) {
      observation = unavailableObservation({ status: timedOut ? "timed_out" : "error", sampleCount: Math.floor(job.buffer.length / 2), error });
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
      this.active -= 1;
    }
    const completedAt = performance.now();
    if (timedOut) observation = unavailableObservation({ status: "timed_out", sampleCount: Math.floor(job.buffer.length / 2) });
    else if (controller.signal.aborted && observation?.available !== true) observation = unavailableObservation({ status: "cancelled", sampleCount: Math.floor(job.buffer.length / 2) });
    job.resolve({
      ...(observation || unavailableObservation({ status: "unavailable", sampleCount: Math.floor(job.buffer.length / 2) })),
      queue: {
        status: observation?.available === true ? "observed" : observation?.status || "unavailable",
        queuedAt: job.queuedAt,
        startedAt,
        completedAt,
        queueDelayMs: Math.max(0, Math.round(startedAt - job.queuedAt)),
        executionMs: Math.max(0, Math.round(completedAt - startedAt)),
      },
    });
    this.pump();
  }

  stop() {
    this.controllers.forEach((controller) => controller.abort(Object.assign(new Error("Silero VAD observation cancelled"), { code: "voice_vad_cancelled" })));
    const queued = this.pending.splice(0);
    this.pendingBytes = 0;
    queued.forEach((job) => job.resolve({
      ...unavailableObservation({ status: "cancelled", sampleCount: Math.floor(job.buffer.length / 2) }),
      queue: { status: "cancelled", queuedAt: job.queuedAt, startedAt: null, completedAt: performance.now(), queueDelayMs: null, executionMs: null },
    }));
  }
}

export class SileroVad {
  constructor({ root, modelPath = null, sessionFactory = defaultSessionFactory, policy = {} } = {}) {
    if (!root) throw new Error("SileroVad requires a model root");
    this.root = path.resolve(root);
    this.modelPath = modelPath;
    this.sessionFactory = sessionFactory;
    this.policy = policyValues(policy);
    this.loadPromise = null;
    this.runtime = null;
  }

  async load() {
    if (this.runtime) return this.runtime;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const located = await locateModel(this.root, this.modelPath);
        const loaded = await this.sessionFactory(located.filePath);
        if (!loaded?.session || !loaded?.ort?.Tensor) throw vadError("voice_vad_runtime_invalid", "The Silero VAD runtime did not provide an ONNX session");
        const runtime = {
          ...loaded,
          filePath: located.filePath,
          verification: located.verification,
          source: relativeSource(this.root, located.filePath),
        };
        this.runtime = runtime;
        return runtime;
      })().catch((error) => {
        this.loadPromise = null;
        throw error;
      });
    }
    return this.loadPromise;
  }

  async observe(pcm, { signal } = {}) {
    const buffer = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm || []);
    const sampleCount = Math.floor(buffer.length / 2);
    if (!sampleCount) return unavailableObservation({ status: "empty", sampleCount: 0, policy: this.policy });
    try {
      const runtime = await this.load();
      const { ort, session } = runtime;
      const frames = [];
      const state = new Float32Array(SILERO_STATE_SIZE);
      let context = new Float32Array(this.policy.contextSamples);
      const sampleRate = new ort.Tensor("int64", BigInt64Array.from([16_000n]), []);
      for (let startSample = 0; startSample < sampleCount; startSample += this.policy.frameSamples) {
        if (signal?.aborted) return unavailableObservation({ status: signal.reason?.code === "voice_vad_timeout" ? "timed_out" : "cancelled", sampleCount, policy: this.policy });
        const endSample = Math.min(sampleCount, startSample + this.policy.frameSamples);
        const input = new Float32Array(this.policy.contextSamples + this.policy.frameSamples);
        input.set(context);
        for (let sample = startSample; sample < endSample; sample += 1) input[this.policy.contextSamples + sample - startSample] = buffer.readInt16LE(sample * 2) / 32768;
        const result = await session.run({
          input: new ort.Tensor("float32", input, [1, input.length]),
          state: new ort.Tensor("float32", state, [2, 1, 128]),
          sr: sampleRate,
        });
        const nextState = result.stateN?.data;
        if (!nextState || nextState.length !== state.length) throw vadError("voice_vad_runtime_output", "The Silero VAD runtime returned an invalid recurrent state");
        state.set(nextState);
        context = input.slice(-this.policy.contextSamples);
        frames.push({
          startSample,
          endSample,
          probability: roundedProbability(result.output?.data?.[0]),
        });
      }
      const proposed = proposeSileroRegions(frames, sampleCount, this.policy);
      return {
        type: "silero_vad_observation",
        available: true,
        status: "observed",
        model: {
          name: MODEL_FILE,
          revision: SILERO_VAD_ARTIFACT.revision,
          size: runtime.verification.size,
          sha256: runtime.verification.sha256,
          license: SILERO_VAD_ARTIFACT.license,
          attribution: SILERO_VAD_ARTIFACT.attribution,
          source: runtime.source,
        },
        deployment: deploymentInfo(),
        policy: proposed.policy,
        sampleCount,
        frameCount: frames.length,
        frames,
        regions: proposed.regions,
        summary: {
          regionCount: proposed.regionCount,
          speechFrameCount: proposed.speechFrameCount,
          maxProbability: proposed.maxProbability,
          meanProbability: proposed.meanProbability,
        },
      };
    } catch (error) {
      return unavailableObservation({ sampleCount, error, policy: this.policy });
    }
  }

  createStream() {
    return new SileroVadStream(this);
  }

  async stop() {
    const runtime = this.runtime;
    this.runtime = null;
    this.loadPromise = null;
    if (runtime?.session?.release) await runtime.session.release().catch(() => {});
  }
}

export class SileroVadStream {
  constructor(vad) {
    this.vad = vad;
    this.policy = vad.policy;
    this.runtime = null;
    this.sampleRate = null;
    this.state = new Float32Array(SILERO_STATE_SIZE);
    this.context = new Float32Array(this.policy.contextSamples);
    this.pending = Buffer.alloc(0);
    this.frames = [];
    this.closedRegions = [];
    this.sampleCount = 0;
    this.processedSamples = 0;
    this.regionStartFrame = -1;
    this.lastActiveFrame = -1;
    this.silentFrameCount = 0;
    this.silenceStartFrame = -1;
    this.emittedRegionCount = 0;
    this.finished = false;
  }

  async load() {
    if (!this.runtime) {
      this.runtime = await this.vad.load();
      this.sampleRate = new this.runtime.ort.Tensor("int64", BigInt64Array.from([16_000n]), []);
    }
    return this.runtime;
  }

  async processFrame(buffer, sampleCount) {
    const runtime = await this.load();
    const input = new Float32Array(this.policy.contextSamples + this.policy.frameSamples);
    input.set(this.context);
    for (let sample = 0; sample < sampleCount; sample += 1) {
      input[this.policy.contextSamples + sample] = buffer.readInt16LE(sample * 2) / 32768;
    }
    const result = await runtime.session.run({
      input: new runtime.ort.Tensor("float32", input, [1, input.length]),
      state: new runtime.ort.Tensor("float32", this.state, [2, 1, 128]),
      sr: this.sampleRate,
    });
    const nextState = result.stateN?.data;
    if (!nextState || nextState.length !== this.state.length) {
      throw vadError("voice_vad_runtime_output", "The Silero VAD runtime returned an invalid recurrent state");
    }
    this.state.set(nextState);
    this.context = input.slice(-this.policy.contextSamples);
    const startSample = this.processedSamples;
    this.processedSamples += sampleCount;
    this.frames.push({
      startSample,
      endSample: this.processedSamples,
      probability: roundedProbability(result.output?.data?.[0]),
    });
    this.updateBoundaryState(this.frames.length - 1);
  }

  closeRegion({ exitDecisionFrame = null, closureReason = "end_of_stream" } = {}) {
    if (this.regionStartFrame < 0 || this.lastActiveFrame < this.regionStartFrame) return;
    this.closedRegions.push(regionFromFrames(this.frames, this.regionStartFrame, this.lastActiveFrame, this.processedSamples, this.policy, {
      exitDecisionFrame,
      silenceStartFrame: this.silenceStartFrame,
      closureReason,
    }));
    this.regionStartFrame = -1;
    this.lastActiveFrame = -1;
    this.silentFrameCount = 0;
    this.silenceStartFrame = -1;
  }

  updateBoundaryState(index) {
    const probability = this.frames[index].probability;
    const hangoverFrames = Math.ceil(this.policy.hangoverMs * this.policy.sampleRate / 1_000 / this.policy.frameSamples);
    const maxRegionFrames = Math.max(1, Math.ceil(this.policy.maxRegionMs * this.policy.sampleRate / 1_000 / this.policy.frameSamples));
    if (this.regionStartFrame < 0) {
      if (probability >= this.policy.entryThreshold) {
        this.regionStartFrame = index;
        this.lastActiveFrame = index;
      }
      return;
    }
    if (probability >= this.policy.exitThreshold) {
      this.lastActiveFrame = index;
      this.silentFrameCount = 0;
      this.silenceStartFrame = -1;
      if (index - this.regionStartFrame + 1 >= maxRegionFrames) {
        this.closeRegion({ exitDecisionFrame: index, closureReason: "maximum_duration" });
      }
      return;
    }
    if (this.silenceStartFrame < 0) this.silenceStartFrame = index;
    this.silentFrameCount += 1;
    if (this.silentFrameCount >= Math.max(1, hangoverFrames)) {
      this.closeRegion({ exitDecisionFrame: index, closureReason: "silence" });
    }
  }

  async processPending(final = false) {
    while (this.pending.length >= this.policy.frameSamples * 2) {
      const frame = this.pending.subarray(0, this.policy.frameSamples * 2);
      await this.processFrame(frame, this.policy.frameSamples);
      this.pending = this.pending.subarray(this.policy.frameSamples * 2);
    }
    if (final && this.pending.length >= 2) {
      const sampleCount = Math.floor(this.pending.length / 2);
      await this.processFrame(this.pending, sampleCount);
      this.pending = Buffer.alloc(0);
    }
  }

  readyRegions() {
    const regions = this.closedRegions.slice(this.emittedRegionCount).map((region, offset) => ({
      ...region,
      regionIndex: this.emittedRegionCount + offset,
    }));
    this.emittedRegionCount = this.closedRegions.length;
    return regions;
  }

  async push(pcm) {
    if (this.finished) throw vadError("voice_vad_stream_closed", "The Silero VAD stream is already closed");
    const buffer = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm || []);
    if (buffer.length) {
      this.pending = this.pending.length ? Buffer.concat([this.pending, buffer]) : Buffer.from(buffer);
      this.sampleCount += Math.floor(buffer.length / 2);
    }
    await this.processPending(false);
    return this.readyRegions();
  }

  observation() {
    const proposed = proposeSileroRegions(this.frames, this.sampleCount, this.policy);
    const runtime = this.runtime;
    return {
      type: "silero_vad_observation",
      available: true,
      status: "observed",
      model: runtime ? {
        name: MODEL_FILE,
        revision: SILERO_VAD_ARTIFACT.revision,
        size: runtime.verification.size,
        sha256: runtime.verification.sha256,
        license: SILERO_VAD_ARTIFACT.license,
        attribution: SILERO_VAD_ARTIFACT.attribution,
        source: runtime.source,
      } : null,
      deployment: deploymentInfo(),
      policy: proposed.policy,
      sampleCount: this.sampleCount,
      frameCount: this.frames.length,
      frames: this.frames,
      regions: proposed.regions,
      summary: {
        regionCount: proposed.regionCount,
        speechFrameCount: proposed.speechFrameCount,
        maxProbability: proposed.maxProbability,
        meanProbability: proposed.meanProbability,
      },
    };
  }

  async finish() {
    if (this.finished) return this.observation();
    this.finished = true;
    if (!this.sampleCount) return unavailableObservation({ status: "empty", sampleCount: 0, policy: this.policy });
    try {
      await this.processPending(true);
      const observation = this.observation();
      return observation;
    } catch (error) {
      return unavailableObservation({ sampleCount: this.sampleCount, error, policy: this.policy });
    }
  }

  cancel() {
    this.finished = true;
    this.pending = Buffer.alloc(0);
  }
}
