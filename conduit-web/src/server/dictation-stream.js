import { performance } from "node:perf_hooks";
import { selectSileroVadRanges } from "./voice-vad.js";

const DEFAULT_LIMITS = Object.freeze({
  maxSessions: 2,
  maxDurationMs: 300_000,
  maxAudioBytes: 16_000 * 2 * 300,
  maxFrameBytes: 64 * 1024,
  maxEventBytes: 64 * 1024,
  finalDeadlineMs: 1_000,
  finalizationBaseMs: 30_000,
  finalizationMaxMs: 600_000,
  finalizationDefaultMultiplier: 12,
  maxSegments: 16,
});

// Local full-precision models need much more CPU time than a remote streaming
// adapter. Keep these policies here so a deployment can tune the defaults
// through createDictationStream({ limits }) without changing the protocol.
export const FINALIZATION_MODEL_MULTIPLIERS = Object.freeze({
  "parakeet-tdt-0.6b-v2-fp32": 18,
  "parakeet-tdt-0.6b-v2-int8": 10,
  "parakeet-tdt-0.6b-v3-fp32": 18,
  "parakeet-tdt-0.6b-v3-int8": 10,
  "whisper-large-v3-turbo-q8": 14,
  "whisper-small-fp32": 14,
  "whisper-small-q8": 10,
  "whisper-base-fp32": 12,
  "whisper-base-q8": 8,
  "whisper-tiny-en-fp32": 10,
  "whisper-tiny-en-q8": 6,
});

function finalizationMultiplier({ adapter, model }, limits) {
  const exact = FINALIZATION_MODEL_MULTIPLIERS[String(model || "")];
  if (Number.isFinite(exact)) return exact;
  return Number.isFinite(Number(limits.finalizationDefaultMultiplier))
    ? Number(limits.finalizationDefaultMultiplier)
    : DEFAULT_LIMITS.finalizationDefaultMultiplier;
}

export function calculateFinalizationTimeoutMs({ audioBytes = 0, adapter = null, model = null, limits = DEFAULT_LIMITS } = {}) {
  const fixed = Number(limits.finalTimeoutMs);
  if (Number.isFinite(fixed) && fixed >= 1_000) return Math.round(fixed);
  const baseMs = Math.max(1_000, Number(limits.finalizationBaseMs) || DEFAULT_LIMITS.finalizationBaseMs);
  const maxMs = Math.max(baseMs, Number(limits.finalizationMaxMs) || DEFAULT_LIMITS.finalizationMaxMs);
  const audioDurationMs = Math.max(0, Number(audioBytes) || 0) / 32;
  const estimate = Math.max(baseMs, audioDurationMs * finalizationMultiplier({ adapter, model }, limits));
  return Math.min(maxMs, Math.ceil(estimate));
}

function dictationError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function transcriptText(event) {
  return String(event?.text ?? event?.transcript ?? event?.result?.text ?? "").trim();
}

function joinTranscript(left, right) {
  if (!left) return right;
  if (!right || right === left) return left;
  if (right.startsWith(left)) return right;
  return `${left}${/\s$/.test(left) || /^\s/.test(right) ? "" : " "}${right}`;
}

// Append two texts verbatim. Unlike joinTranscript this never deduplicates:
// segment transcripts are distinct utterances, so a sentence spoken twice must
// appear twice even when the model transcribes both segments identically.
function appendText(left, right) {
  if (!left) return right;
  if (!right) return left;
  return `${left}${/\s$/.test(left) || /^\s/.test(right) ? "" : " "}${right}`;
}

function appendProgressiveSegment(left, right, overlapSamples = 0) {
  if (!left) return right;
  if (!right) return left;
  if (!(Number(overlapSamples) > 0)) return appendText(left, right);
  const leftWords = String(left).trim().split(/\s+/);
  const rightWords = String(right).trim().split(/\s+/);
  const normalizeWord = (word) => word.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const maximum = Math.min(3, leftWords.length, rightWords.length);
  for (let count = maximum; count >= 1; count -= 1) {
    const suffix = leftWords.slice(-count).map(normalizeWord).join(" ");
    const prefix = rightWords.slice(0, count).map(normalizeWord).join(" ");
    if (!suffix || suffix !== prefix) continue;
    return appendText(left, rightWords.slice(count).join(" "));
  }
  return appendText(left, right);
}

// Merge an incoming finalized transcript into the accumulated text. Endpoints
// stream token deltas that differ from their final text only by whitespace
// (the local Parakeet runtime emits word-boundary tokens with a leading space
// and then a trimmed, collapsed `transcript.text.done`), so a plain append
// would print the transcript twice. When the two texts are whitespace-equal or
// one is a normalized prefix of the other, take the authoritative candidate
// instead of appending; distinct segments still merge with `joinTranscript`.
function mergeTranscript(left, right) {
  if (!left) return right;
  if (!right) return left;
  const normalize = (text) => String(text).trim().replace(/\s+/g, " ");
  const a = normalize(left);
  const b = normalize(right);
  if (a === b || b.startsWith(a)) return right;
  if (a.startsWith(b)) return left;
  return joinTranscript(left, right);
}

// Batch ASR models hallucinate over long mid-utterance silence: the local
// Parakeet TDT fills a 2s+ pause with invented text and drops the speech that
// follows. Split the buffered PCM at long silent runs before transcription so
// each segment is a self-contained utterance, then join the segment texts.
const SEGMENT_WINDOW_SAMPLES = 160; // 10ms at 16 kHz
const SEGMENT_SILENCE_RMS = 0.008; // -42 dBFS
const SEGMENT_SILENCE_MS = 2_000;
const SEGMENT_MIN_SEGMENT_MS = 500;
const SEGMENT_MAX_SEGMENTS = 16;
const SEGMENT_MERGE_ACTIVE_MS = 150;
const DIAGNOSTIC_SCHEMA_VERSION = 5;
const MAX_CLIENT_DIAGNOSTIC_BYTES = 32 * 1024;

function elapsed(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round(end - start));
}

function boundedNumber(value, { minimum = 0, maximum = 900_000, fallback = null } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function boundedInteger(value, { minimum = 0, maximum = 10_000_000, fallback = 0 } = {}) {
  const number = boundedNumber(value, { minimum, maximum, fallback: null });
  return number === null ? fallback : Math.round(number);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function precisionFor(model) {
  const value = String(model || "");
  if (value.endsWith("-fp32")) return "fp32";
  if (value.endsWith("-int8")) return "int8";
  if (value.endsWith("-q8")) return "q8";
  return null;
}

export function analyzeSilence(pcm, byteLength, options = {}) {
  const sampleCount = Math.max(0, Math.floor(byteLength / 2));
  const windowSamples = Number.isFinite(options.windowSamples) ? options.windowSamples : SEGMENT_WINDOW_SAMPLES;
  const silenceRms = Number.isFinite(options.silenceRms) ? options.silenceRms : SEGMENT_SILENCE_RMS;
  const silenceSamples = Math.max(1, Math.round((Number.isFinite(options.silenceMs) ? options.silenceMs : SEGMENT_SILENCE_MS) / 1_000 * 16_000));
  const minSegmentSamples = Math.max(1, Math.round((Number.isFinite(options.minSegmentMs) ? options.minSegmentMs : SEGMENT_MIN_SEGMENT_MS) / 1_000 * 16_000));
  const maxSegments = Math.max(2, Number.isFinite(options.maxSegments) ? options.maxSegments : SEGMENT_MAX_SEGMENTS);
  const windows = Math.ceil(sampleCount / windowSamples);
  const silent = new Array(windows);
  let silentSamples = 0;
  for (let windowIndex = 0; windowIndex < windows; windowIndex += 1) {
    const start = windowIndex * windowSamples;
    const end = Math.min(sampleCount, start + windowSamples);
    let sum = 0;
    for (let index = start; index < end; index += 1) {
      const value = pcm.readInt16LE(index * 2) / 32768;
      sum += value * value;
    }
    silent[windowIndex] = Math.sqrt(sum / (end - start)) < silenceRms;
    if (silent[windowIndex]) silentSamples += end - start;
  }
  // Collect silent runs; brief active blips (e.g. a click inside the pause)
  // merge into the surrounding run.
  const mergeWindows = Math.max(1, Math.round(SEGMENT_MERGE_ACTIVE_MS / 1_000 * 16_000 / windowSamples));
  const runs = [];
  let runStartWindow = -1;
  let activeWindowCount = 0;
  for (let windowIndex = 0; windowIndex <= windows; windowIndex += 1) {
    const isSilent = windowIndex < windows && silent[windowIndex];
    if (isSilent) {
      if (runStartWindow < 0) {
        runStartWindow = windowIndex;
        activeWindowCount = 0;
      }
    } else {
      activeWindowCount += 1;
      if (runStartWindow >= 0 && activeWindowCount >= mergeWindows) {
        const runEndWindow = windowIndex - activeWindowCount + 1;
        const durationSamples = (runEndWindow - runStartWindow) * windowSamples;
        if (durationSamples >= silenceSamples) runs.push([runStartWindow * windowSamples, Math.min(sampleCount, runEndWindow * windowSamples)]);
        runStartWindow = -1;
        activeWindowCount = 0;
      }
    }
  }
  if (runStartWindow >= 0 && (windows - runStartWindow) * windowSamples >= silenceSamples) {
    runs.push([runStartWindow * windowSamples, sampleCount]);
  }
  if (!runs.length) {
    return {
      segments: [[0, sampleCount]],
      silenceRuns: [],
      sampleCount,
      silentSamples,
      windowSamples,
      silenceRms,
      silenceMs: silenceSamples / 16,
      minSegmentMs: minSegmentSamples / 16,
      maxSegments,
    };
  }
  if (runs.length > maxSegments - 1) {
    runs.sort((left, right) => (right[1] - right[0]) - (left[1] - left[0]));
    runs.length = maxSegments - 1;
  }
  runs.sort((left, right) => left[0] - right[0]);
  const segments = [];
  let cursor = 0;
  for (const [runStart, runEnd] of runs) {
    if (runStart - cursor >= minSegmentSamples) segments.push([cursor, runStart]);
    cursor = runEnd;
  }
  if (sampleCount - cursor >= minSegmentSamples) segments.push([cursor, sampleCount]);
  return {
    segments,
    silenceRuns: runs,
    sampleCount,
    silentSamples,
    windowSamples,
    silenceRms,
    silenceMs: silenceSamples / 16,
    minSegmentMs: minSegmentSamples / 16,
    maxSegments,
  };
}

export function splitSilence(pcm, byteLength, options = {}) {
  return analyzeSilence(pcm, byteLength, options).segments;
}

function createSignalAccumulator() {
  return { sumSquares: 0, sampleCount: 0, peak: 0, clippedSamples: 0 };
}

function addPcmSignal(accumulator, data) {
  for (let offset = 0; offset + 1 < data.length; offset += 2) {
    const sample = data.readInt16LE(offset);
    const value = sample / 32768;
    accumulator.sumSquares += value * value;
    accumulator.sampleCount += 1;
    accumulator.peak = Math.max(accumulator.peak, Math.abs(value));
    if (sample === 32767 || sample === -32768 || value >= 1 || value <= -1) accumulator.clippedSamples += 1;
  }
}

function serializeSignal(accumulator) {
  return {
    rms: accumulator.sampleCount ? Math.sqrt(accumulator.sumSquares / accumulator.sampleCount) : 0,
    peak: accumulator.peak,
    clipping: accumulator.clippedSamples > 0,
    clippedSamples: accumulator.clippedSamples,
    bands: null,
  };
}

function sanitizeAudioMetadata(value, key = "", depth = 0) {
  if ((key === "deviceId" || key === "groupId") && value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(Object.keys(value).slice(0, 8).map((childKey) => [childKey, "[redacted]"]));
  }
  if (key === "deviceId" || key === "groupId") return "[redacted]";
  if (depth > 3) return null;
  if (Array.isArray(value)) return value.slice(0, 16).map((item) => sanitizeAudioMetadata(item, key, depth + 1));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).slice(0, 32).map(([childKey, childValue]) => [
      childKey,
      sanitizeAudioMetadata(childValue, childKey, depth + 1),
    ]));
  }
  if (typeof value === "string") return value.slice(0, 128);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  return null;
}

function safeAudioMetadata(value) {
  const result = sanitizeAudioMetadata(value);
  return isRecord(result) ? result : {};
}

function sanitizeSignal(value) {
  const source = isRecord(value) ? value : {};
  return {
    rms: boundedNumber(source.rms, { maximum: 2, fallback: 0 }),
    peak: boundedNumber(source.peak, { maximum: 2, fallback: 0 }),
    clipping: source.clipping === true,
    clippedSamples: boundedInteger(source.clippedSamples, { maximum: 10_000_000 }),
    bands: null,
  };
}

function sanitizeClientDiagnostics(value) {
  if (!isRecord(value)) return null;
  try {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_CLIENT_DIAGNOSTIC_BYTES) return null;
  } catch {
    return null;
  }
  const events = isRecord(value.events) ? value.events : {};
  const durations = isRecord(value.durations) ? value.durations : {};
  const transport = isRecord(value.transport) ? value.transport : {};
  const capture = isRecord(value.capture) ? value.capture : {};
  const gain = isRecord(capture.workletGain) ? capture.workletGain : {};
  return {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    clock: "performance.now",
    events: {
      shortcutAcceptedMs: boundedNumber(events.shortcutAcceptedMs, { maximum: 900_000, fallback: 0 }),
      digitalSilenceCount: boundedInteger(events.digitalSilenceCount, { maximum: 10_000 }),
      microphoneRequestStartMs: boundedNumber(events.microphoneRequestStartMs),
      microphoneRequestResolvedMs: boundedNumber(events.microphoneRequestResolvedMs),
      workletConnectedMs: boundedNumber(events.workletConnectedMs),
      firstWorkletPcmMs: boundedNumber(events.firstWorkletPcmMs),
      firstWebSocketSendMs: boundedNumber(events.firstWebSocketSendMs),
      stopRequestedMs: boundedNumber(events.stopRequestedMs),
      finalEventMs: boundedNumber(events.finalEventMs),
    },
    durations: {
      captureStartupMs: boundedNumber(durations.captureStartupMs),
      microphoneRequestMs: boundedNumber(durations.microphoneRequestMs),
      workletSetupMs: boundedNumber(durations.workletSetupMs),
      transportStartupMs: boundedNumber(durations.transportStartupMs),
      captureDurationMs: boundedNumber(durations.captureDurationMs),
      stopToFinalMs: boundedNumber(durations.stopToFinalMs),
    },
    transport: {
      packetCount: boundedInteger(transport.packetCount, { maximum: 1_000_000 }),
      pcmBytes: boundedInteger(transport.pcmBytes, { maximum: DEFAULT_LIMITS.maxAudioBytes }),
      maxWebSocketBufferedBytes: boundedInteger(transport.maxWebSocketBufferedBytes, { maximum: 16 * 1024 * 1024 }),
    },
    capture: {
      microphoneReused: capture.microphoneReused === true,
      profile: value.capture?.profile === "processed" ? "processed" : "raw",
      sourceSampleRate: boundedNumber(capture.sourceSampleRate, { maximum: 384_000 }),
      processingSampleRate: boundedNumber(capture.processingSampleRate, { maximum: 384_000 }),
      requestedConstraints: safeAudioMetadata(capture.requestedConstraints),
      effectiveTrackSettings: safeAudioMetadata(capture.effectiveTrackSettings),
      resampler: {
        method: typeof capture.resampler?.method === "string" ? capture.resampler.method.slice(0, 64) : null,
        inputSampleRate: boundedNumber(capture.resampler?.inputSampleRate, { maximum: 384_000 }),
        outputSampleRate: boundedNumber(capture.resampler?.outputSampleRate, { maximum: 384_000, fallback: 16_000 }),
      },
      preProcessing: sanitizeSignal(capture.preProcessing),
      postProcessing: sanitizeSignal(capture.postProcessing),
      workletGain: {
        current: boundedNumber(gain.current, { maximum: 100 }),
        minimum: boundedNumber(gain.minimum, { maximum: 100 }),
        maximum: boundedNumber(gain.maximum, { maximum: 100 }),
      },
    },
  };
}

function createServerDiagnostics() {
  return {
    startedAt: performance.now(),
    firstServerPcmAt: null,
    lastServerPcmAt: null,
    runtimeReadyAt: null,
    stopAt: null,
    firstPartialAt: null,
    firstSegmentFinalAt: null,
    firstUsableTextAt: null,
    sessionFinalAt: null,
    completionSentAt: null,
    archiveStartedAt: null,
    archiveCompletedAt: null,
    archiveMs: null,
    preprocessingMs: 0,
    inferenceQueuedAt: null,
    inferenceStartedAt: null,
    inferenceCompletedAt: null,
    vadQueuedAt: null,
    vadStartedAt: null,
    vadCompletedAt: null,
    client: null,
    transport: {
      packetCount: 0,
      pcmBytes: 0,
      clientAudioBytes: null,
    },
    signal: createSignalAccumulator(),
    runtime: {
      inferenceMode: "batch",
      mode: null,
      model: null,
      precision: null,
      backend: "unreported",
      computeBackend: null,
    },
    analysis: null,
    vadObservation: null,
    progressive: {
      enabled: false,
      committedSegments: 0,
      completedSegments: 0,
      failedSequences: [],
      heldTailRegions: 0,
      vadError: null,
      fallback: false,
      segments: [],
    },
  };
}

function recordAnalysis(diagnostics, analysis, durationMs) {
  diagnostics.preprocessingMs += durationMs;
  if (!diagnostics.analysis) diagnostics.analysis = analysis;
}

function gapsForSegments(segments, sampleCount) {
  const gaps = [];
  let cursor = 0;
  for (const [startSample, endSample] of segments) {
    if (startSample > cursor) gaps.push([cursor, startSample]);
    cursor = Math.max(cursor, endSample);
  }
  if (cursor < sampleCount) gaps.push([cursor, sampleCount]);
  return gaps;
}

function authoritativeAnalysis(selection, sampleCount) {
  const segments = Array.isArray(selection?.segments) ? selection.segments : [];
  const silentRuns = selection?.available ? gapsForSegments(segments, sampleCount) : [];
  return {
    source: "silero_authoritative",
    available: selection?.available === true,
    status: selection?.status || "unavailable",
    sampleCount,
    segments,
    regionIndices: Array.isArray(selection?.regionIndices) ? selection.regionIndices : [],
    speechSamples: Math.max(0, Number(selection?.speechSamples) || 0),
    silentSamples: silentRuns.reduce((total, [startSample, endSample]) => total + endSample - startSample, 0),
    silenceRuns: silentRuns,
    windowSamples: Number(selection?.policy?.frameSamples) || 512,
    silenceRms: null,
    silenceMs: null,
    minSegmentMs: 0,
    maxSegments: selection?.segmentGuard?.maxSegments || 16,
    sourceRegionCount: selection?.sourceRegionCount || 0,
    normalizedRegionCount: selection?.normalizedRegionCount || 0,
    segmentGuard: selection?.segmentGuard || null,
    policy: selection?.policy || null,
  };
}

function externalAnalysis(pcmSampleCount) {
  return {
    source: "external_policy",
    available: true,
    status: "bypassed",
    sampleCount: pcmSampleCount,
    segments: [[0, pcmSampleCount]],
    regionIndices: [],
    speechSamples: pcmSampleCount,
    silentSamples: 0,
    silenceRuns: [],
    windowSamples: null,
    silenceRms: null,
    silenceMs: null,
    minSegmentMs: 0,
    maxSegments: null,
    sourceRegionCount: null,
    normalizedRegionCount: null,
    segmentGuard: null,
    policy: null,
  };
}

function markInferenceStart(diagnostics) {
  if (diagnostics.inferenceStartedAt !== null) return;
  diagnostics.inferenceQueuedAt ||= performance.now();
  diagnostics.inferenceStartedAt = performance.now();
}

function markInferenceQueued(diagnostics) {
  diagnostics.inferenceQueuedAt ||= performance.now();
}

function markInferenceComplete(diagnostics) {
  diagnostics.inferenceCompletedAt ||= performance.now();
}

function speechDecision(diagnostics) {
  if (diagnostics.analysis?.source === "silero_authoritative") {
    return {
      detector: "silero_vad",
      detected: diagnostics.analysis.segments.length > 0,
      available: diagnostics.analysis.available,
      status: diagnostics.analysis.status,
    };
  }
  if (diagnostics.analysis?.source === "external_policy") {
    return { detector: "external_policy", detected: true, available: true, status: "bypassed" };
  }
  if (!diagnostics.signal.sampleCount) return { detector: "unclassified", detected: false };
  if (diagnostics.signal.peak === 0) return { detector: "digital_zero", detected: false };
  return { detector: "unclassified", detected: true };
}

function serializeServerDiagnostics(diagnostics) {
  const analysis = diagnostics.analysis;
  const segments = analysis?.segments || [];
  const silenceRuns = analysis?.silenceRuns || [];
  const segmentBoundaries = segments.map(([startSample, endSample], index) => ({
    index,
    startSample,
    endSample,
    startMs: Math.round(startSample / 16),
    endMs: Math.round(endSample / 16),
    durationMs: Math.round((endSample - startSample) / 16),
    vadRegionIndices: analysis?.regionIndices?.[index] || null,
  }));
  const silentBoundaries = silenceRuns.map(([startSample, endSample], index) => ({
    index,
    startSample,
    endSample,
    startMs: Math.round(startSample / 16),
    endMs: Math.round(endSample / 16),
    durationMs: Math.round((endSample - startSample) / 16),
  }));
  const speechSamples = analysis?.source === "silero_authoritative"
    ? analysis.speechSamples
    : analysis ? Math.max(0, analysis.sampleCount - analysis.silentSamples) : 0;
  const submittedSegmentSamples = segments.reduce((total, [start, end]) => total + end - start, 0);
  return {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    clock: "performance.now",
    events: {
      sessionStartMs: 0,
      firstServerPcmMs: elapsed(diagnostics.startedAt, diagnostics.firstServerPcmAt),
      lastServerPcmMs: elapsed(diagnostics.startedAt, diagnostics.lastServerPcmAt),
      runtimeReadyMs: elapsed(diagnostics.startedAt, diagnostics.runtimeReadyAt),
      stopMs: elapsed(diagnostics.startedAt, diagnostics.stopAt),
      firstPartialMs: elapsed(diagnostics.startedAt, diagnostics.firstPartialAt),
      firstSegmentFinalMs: elapsed(diagnostics.startedAt, diagnostics.firstSegmentFinalAt),
      sessionFinalMs: elapsed(diagnostics.startedAt, diagnostics.sessionFinalAt),
      completionSentMs: elapsed(diagnostics.startedAt, diagnostics.completionSentAt),
      inferenceQueuedMs: elapsed(diagnostics.startedAt, diagnostics.inferenceQueuedAt),
      inferenceStartedMs: elapsed(diagnostics.startedAt, diagnostics.inferenceStartedAt),
      firstUsableTextMs: elapsed(diagnostics.startedAt, diagnostics.firstUsableTextAt),
      inferenceCompletedMs: elapsed(diagnostics.startedAt, diagnostics.inferenceCompletedAt),
      vadQueuedMs: elapsed(diagnostics.startedAt, diagnostics.vadQueuedAt),
      vadStartedMs: elapsed(diagnostics.startedAt, diagnostics.vadStartedAt),
      vadCompletedMs: elapsed(diagnostics.startedAt, diagnostics.vadCompletedAt),
      archiveStartMs: elapsed(diagnostics.startedAt, diagnostics.archiveStartedAt),
      archiveCompletedMs: elapsed(diagnostics.startedAt, diagnostics.archiveCompletedAt),
    },
    durations: {
      runtimePreparationMs: elapsed(diagnostics.startedAt, diagnostics.runtimeReadyAt),
      preprocessingMs: Math.max(0, Math.round(diagnostics.preprocessingMs)),
      runtimeWaitAfterStopMs: elapsed(diagnostics.stopAt, diagnostics.runtimeReadyAt),
      queueDelayMs: elapsed(diagnostics.inferenceQueuedAt, diagnostics.inferenceStartedAt),
      stopToInferenceStartMs: elapsed(diagnostics.stopAt, diagnostics.inferenceStartedAt),
      firstTextInferenceMs: elapsed(diagnostics.inferenceStartedAt, diagnostics.firstUsableTextAt),
      inferenceDelayMs: elapsed(diagnostics.inferenceStartedAt, diagnostics.firstUsableTextAt),
      inferenceTotalMs: elapsed(diagnostics.inferenceStartedAt, diagnostics.inferenceCompletedAt),
      userSettlementMs: elapsed(diagnostics.stopAt, diagnostics.completionSentAt),
      settlementDelayMs: elapsed(diagnostics.stopAt, diagnostics.completionSentAt),
      vadQueueMs: elapsed(diagnostics.vadQueuedAt, diagnostics.vadStartedAt),
      vadExecutionMs: elapsed(diagnostics.vadStartedAt, diagnostics.vadCompletedAt),
      archiveExecutionMs: elapsed(diagnostics.archiveStartedAt, diagnostics.archiveCompletedAt),
      archiveMs: diagnostics.archiveMs === null ? null : Math.max(0, Math.round(diagnostics.archiveMs)),
    },
    transport: {
      packetCount: diagnostics.transport.packetCount,
      pcmBytes: diagnostics.transport.pcmBytes,
      clientAudioBytes: diagnostics.transport.clientAudioBytes,
      audioDurationMs: Math.round(diagnostics.transport.pcmBytes / 32),
    },
    signal: {
      serverPcm: serializeSignal(diagnostics.signal),
    },
    inference: {
      inferenceMode: diagnostics.runtime.inferenceMode,
      mode: diagnostics.runtime.mode,
      model: diagnostics.runtime.model,
      precision: diagnostics.runtime.precision,
      backend: diagnostics.runtime.backend,
      computeBackend: diagnostics.runtime.computeBackend,
      segmentCount: segments.length,
      speechDurationMs: Math.round(speechSamples / 16),
      silenceDurationMs: analysis ? Math.round(analysis.silentSamples / 16) : 0,
      submittedSegmentDurationMs: Math.round(submittedSegmentSamples / 16),
      boundaries: segmentBoundaries,
      silenceRuns: silentBoundaries,
      sileroObservation: diagnostics.vadObservation,
      segmentGuard: analysis?.segmentGuard || null,
      progressiveBatch: diagnostics.progressive,
      vadPolicy: analysis?.source === "silero_authoritative"
        ? {
          type: "silero_authoritative",
          ...(analysis.policy || {}),
          maxSegments: analysis.maxSegments,
          sourceRegionCount: analysis.sourceRegionCount,
          normalizedRegionCount: analysis.normalizedRegionCount,
        }
        : analysis?.source === "external_policy"
          ? { type: "external_policy" }
          : {
            type: "rms_threshold",
            windowMs: analysis ? analysis.windowSamples / 16 : SEGMENT_WINDOW_SAMPLES / 16,
            silenceRms: analysis?.silenceRms ?? SEGMENT_SILENCE_RMS,
            silenceMs: analysis?.silenceMs ?? SEGMENT_SILENCE_MS,
            minSegmentMs: analysis?.minSegmentMs ?? SEGMENT_MIN_SEGMENT_MS,
            mergeActiveMs: SEGMENT_MERGE_ACTIVE_MS,
            maxSegments: analysis?.maxSegments ?? SEGMENT_MAX_SEGMENTS,
            speechPaddingMs: 0,
          },
    },
  };
}

function wavBlob(chunks, byteLength) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + byteLength, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(byteLength, 40);
  return new Blob([header, ...chunks], { type: "audio/wav" });
}

class PcmAccumulator {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
    this.buffer = null;
    this.byteLength = 0;
  }

  append(data) {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const nextLength = this.byteLength + chunk.length;
    if (nextLength > this.maxBytes) throw dictationError("dictation_too_long", "Voice dictation reached the server audio limit", 413);
    if (!this.buffer) this.buffer = Buffer.allocUnsafe(this.maxBytes);
    const start = this.byteLength;
    chunk.copy(this.buffer, start);
    this.byteLength = nextLength;
    return this.buffer.subarray(start, nextLength);
  }

  view() {
    return this.buffer ? this.buffer.subarray(0, this.byteLength) : Buffer.alloc(0);
  }
}

async function readSse(response, emit, limits) {
  if (!response.ok || !response.body) throw dictationError("asr_request_failed", `Voice endpoint returned ${response.status}`, 502);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const raw = await response.text();
    if (Buffer.byteLength(raw) > limits.maxEventBytes) throw dictationError("asr_event_too_large", "Voice endpoint response is too large", 502);
    const event = JSON.parse(raw);
    emit({ type: "final", text: transcriptText(event) });
    return;
  }
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let pending = "";
  let cumulative = "";
  const processFrame = (frame) => {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data);
    const type = String(event.type || "");
    if (type === "transcript.text.delta") {
      cumulative += String(event.delta || "");
      emit({ type: "partial", text: cumulative });
    } else if (type === "transcript.text.done") {
      cumulative = mergeTranscript(cumulative, transcriptText(event) || cumulative);
      emit({ type: "final", text: cumulative });
    } else if (type === "error" || event.error) {
      emit({ type: "error", code: String(event.code || "asr_error"), message: String(event.message || event.error?.message || "Transcription failed") });
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    if (Buffer.byteLength(pending) > limits.maxEventBytes) throw dictationError("asr_event_too_large", "Voice endpoint event is too large", 502);
    const frames = pending.split(/\r?\n\r?\n/);
    pending = frames.pop() || "";
    frames.forEach(processFrame);
  }
  pending += decoder.decode();
  if (pending.trim()) processFrame(pending);
}

function resolveInferenceAnalysis(pcm, byteLength, segmentation, limits, diagnostics) {
  if (segmentation?.mode === "silero_authoritative") {
    const analysis = segmentation.analysis || authoritativeAnalysis(
      {
        available: true,
        status: "speech",
        segments: segmentation.segments,
      },
      Math.floor(byteLength / 2),
    );
    if (diagnostics) diagnostics.analysis = analysis;
    return analysis;
  }
  if (segmentation?.mode === "external_policy") {
    const analysis = externalAnalysis(Math.floor(byteLength / 2));
    if (diagnostics) diagnostics.analysis = analysis;
    return analysis;
  }
  const preprocessingStartedAt = performance.now();
  const analysis = analyzeSilence(pcm, byteLength, limits);
  if (diagnostics) recordAnalysis(diagnostics, analysis, performance.now() - preprocessingStartedAt);
  return analysis;
}

export function createHttpAdapter(config, emit, limits, fetchImpl, diagnostics = null) {
  const chunks = [];
  let byteLength = 0;
  const controller = new AbortController();
  const snapshot = () => Buffer.concat(chunks, byteLength);
  const transcribeRange = async ({ startSample = 0, endSample = 0 } = {}) => {
    if (!byteLength || controller.signal.aborted) return "";
    const pcm = snapshot();
    const start = Math.max(0, Math.min(Math.floor(startSample), Math.floor(byteLength / 2)));
    const end = Math.max(start, Math.min(Math.floor(endSample), Math.floor(byteLength / 2)));
    if (end <= start) return "";
    const piece = pcm.subarray(start * 2, end * 2);
    const form = new FormData();
    form.append("file", wavBlob([piece], piece.length), `dictation-${start}-${end}.wav`);
    form.append("response_format", "json");
    if (config.model) form.append("model", config.model);
    if (config.provider !== "groq") form.append("stream", "true");
    let text = "";
    if (diagnostics) {
      markInferenceQueued(diagnostics);
      markInferenceStart(diagnostics);
    }
    try {
      const response = await fetchImpl(config.endpoint, { method: "POST", headers: config.headers, body: form, signal: controller.signal, redirect: "error" });
      await readSse(response, (event) => {
        if (event.type === "final") text = mergeTranscript(text, String(event.text || ""));
        else if (event.type === "partial" && !text) text = String(event.text || "");
      }, limits);
      return text.trim();
    } finally {
      if (diagnostics) markInferenceComplete(diagnostics);
    }
  };
  const transcribe = async ({ segmentation = null } = {}) => {
    if (!byteLength || controller.signal.aborted) return { final: false, text: "" };
    if (diagnostics) markInferenceQueued(diagnostics);
    const pcm = Buffer.concat(chunks, byteLength);
    const analysis = resolveInferenceAnalysis(pcm, byteLength, segmentation, limits, diagnostics);
    const segments = analysis.segments;
    let final = false;
    let text = "";
    for (let index = 0; index < segments.length; index += 1) {
      const [startSample, endSample] = segments[index];
      const segmentBytes = (endSample - startSample) * 2;
      const segmentChunks = [pcm.subarray(startSample * 2, endSample * 2)];
      const prefix = text;
      let segmentText = "";
      const form = new FormData();
      form.append("file", wavBlob(segmentChunks, segmentBytes), `dictation-${index + 1}.wav`);
      form.append("response_format", "json");
      if (config.model) form.append("model", config.model);
      if (config.provider !== "groq") form.append("stream", "true");
      if (diagnostics) markInferenceStart(diagnostics);
      const response = await fetchImpl(config.endpoint, { method: "POST", headers: config.headers, body: form, signal: controller.signal, redirect: "error" });
      await readSse(response, (event) => {
        if (event.type === "final") {
          final = true;
          // Finals within one response are cumulative snapshots of that
          // segment, so they merge extension-aware; the completed segments
          // ahead of this one are distinct utterances and append verbatim.
          segmentText = mergeTranscript(segmentText, String(event.text || ""));
          emit({ type: "final", text: appendText(prefix, segmentText) });
        } else if (event.type === "partial") {
          // Partials stay cumulative snapshots of the whole utterance: prefix
          // the joined text of the completed segments ahead of this one.
          emit({ type: "partial", text: appendText(prefix, String(event.text || "")) });
        } else emit(event);
      }, limits);
      text = appendText(text, segmentText);
    }
    if (diagnostics) markInferenceComplete(diagnostics);
    return { final, text };
  };
  queueMicrotask(() => emit({ type: "ready", sampleRate: 16_000, encoding: "pcm_s16le" }));
  return {
    opened: Promise.resolve(),
    write(data) {
      byteLength += data.length;
      if (byteLength > limits.maxAudioBytes) throw dictationError("dictation_too_long", "Voice dictation reached the server audio limit", 413);
      chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    },
    async stop(options = {}) {
      try {
        if (options.progressive) {
          emit({ type: "adapter_closed", final: Boolean(options.text), text: String(options.text || "") });
          return;
        }
        const result = await transcribe(options);
        emit({ type: "adapter_closed", ...result });
      } catch (error) {
        if (error.name !== "AbortError") emit({ type: "error", code: error.code || "asr_request_failed", message: error.message });
      }
    },
    transcribeRange,
    close() { controller.abort(); chunks.length = 0; },
  };
}

function createSnapshotAdapter(emit, limits, transcribe, diagnostics = null, { progressive = true, useSegmentation = true } = {}) {
  const chunks = [];
  let byteLength = 0;
  const snapshot = () => Buffer.concat(chunks, byteLength);
  const transcribeRange = async ({ startSample = 0, endSample = 0 } = {}) => {
    if (!byteLength) return "";
    const pcm = snapshot();
    const start = Math.max(0, Math.min(Math.floor(startSample), Math.floor(byteLength / 2)));
    const end = Math.max(start, Math.min(Math.floor(endSample), Math.floor(byteLength / 2)));
    if (end <= start) return "";
    if (diagnostics) {
      markInferenceQueued(diagnostics);
      markInferenceStart(diagnostics);
    }
    try {
      return String(await transcribe(pcm.subarray(start * 2, end * 2)) || "").trim();
    } finally {
      if (diagnostics) markInferenceComplete(diagnostics);
    }
  };
  const run = async ({ segmentation = null } = {}) => {
    if (!byteLength) return { final: false, text: "" };
    if (diagnostics) markInferenceQueued(diagnostics);
    const snapshot = Buffer.concat(chunks, byteLength);
    const analysis = useSegmentation
      ? resolveInferenceAnalysis(snapshot, byteLength, segmentation, limits, diagnostics)
      : { segments: [[0, Math.floor(byteLength / 2)]] };
    const segments = analysis.segments;
    let text = "";
    for (const [startSample, endSample] of segments) {
      const piece = snapshot.subarray(startSample * 2, endSample * 2);
      if (diagnostics) markInferenceStart(diagnostics);
      const pieceText = String(await transcribe(piece) || "").trim();
      if (pieceText) text = appendText(text, pieceText);
    }
    if (text) emit({ type: "final", text });
    if (diagnostics) markInferenceComplete(diagnostics);
    return { final: Boolean(text), text };
  };
  queueMicrotask(() => emit({ type: "ready", sampleRate: 16_000, encoding: "pcm_s16le" }));
  return {
    opened: Promise.resolve(),
    write(data) {
      byteLength += data.length;
      if (byteLength > limits.maxAudioBytes) throw dictationError("dictation_too_long", "Voice dictation reached the server audio limit", 413);
      chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    },
    async stop(options = {}) {
      try {
        if (options.progressive) {
          emit({ type: "adapter_closed", final: Boolean(options.text), text: String(options.text || "") });
          return;
        }
        const result = await run(options);
        emit({ type: "adapter_closed", ...result });
      } catch (error) { emit({ type: "error", code: error.code || "asr_request_failed", message: error.message }); }
    },
    ...(progressive ? { transcribeRange } : {}),
    close() { chunks.length = 0; },
  };
}

export function createDeepgramAdapter(config, emit, limits, fetchImpl, diagnostics = null) {
  return createSnapshotAdapter(emit, limits, async (pcm) => {
    const endpoint = new URL(config.endpoint);
    endpoint.searchParams.set("model", config.model || "nova-3");
    endpoint.searchParams.set("smart_format", "true");
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { ...config.headers, "Content-Type": "audio/wav" },
      body: wavBlob([pcm], pcm.length),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (!response.ok) throw dictationError("asr_request_failed", `Deepgram returned ${response.status}`, 502);
    const result = await response.json();
    return result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
  }, diagnostics);
}

export function createDictationStream({ wss, voiceRuntime, recordingStore = null, fetchImpl = fetch, limits: limitOverrides = {} }) {
  const limits = { ...DEFAULT_LIMITS, ...limitOverrides };
  let activeSessions = 0;
  const handleUpgrade = (request, socket, head) => wss.handleUpgrade(request, socket, head, (client) => {
    if (activeSessions >= limits.maxSessions) {
      client.send(JSON.stringify({ type: "error", code: "dictation_capacity", message: "The Conduit server is already handling the maximum number of dictation sessions" }));
      client.close(1013, "Dictation capacity reached");
      return;
    }
    activeSessions += 1;
    voiceRuntime.pin?.();
    let adapter = null;
    let adapterReady = false;
    let settleAdapter;
    const adapterAvailable = new Promise((resolve) => { settleAdapter = resolve; });
    let completed = false;
    let stopping = false;
    let stoppedAt = 0;
    let finalText = "";
    let hasFinal = false;
    let durationTimer;
    let finalTimer;
    let deadlineTimer;
    let deadlinePassed = false;
    let audioBytes = 0;
    let clientAudioBytes = null;
    const pcmAccumulator = new PcmAccumulator(limits.maxAudioBytes);
    let transcriptObserved = false;
    let stopReason = null;
    let savedRecord = null;
    let archivePromise = null;
    let vadObservationPromise = null;
    let settleRuntimeConfig;
    let runtimeConfigSettled = false;
    const runtimeConfigReady = new Promise((resolve) => { settleRuntimeConfig = resolve; });
    let finalPcm = null;
    let metadataUpdateTail = Promise.resolve();
    let progressiveVad = null;
    let progressiveEnabled = false;
    let progressiveVadTail = Promise.resolve();
    let progressiveInferenceTail = Promise.resolve();
    let progressiveVadError = null;
    const progressiveSeenRegions = new Set();
    const progressiveResults = new Map();
    const progressiveFailures = new Map();
    let progressiveNextSequence = 0;
    let progressiveHeadCount = 0;
    let progressiveTailRange = null;
    let progressiveNextPublish = 0;
    let progressiveText = "";
    let progressiveLastRangeEnd = 0;
    const SHORT_FAILURE_AUDIO_BYTES = 1;
    const diagnostics = createServerDiagnostics();
    let runtimeMetadata = {
      mode: null,
      adapter: null,
      provider: null,
      model: null,
      inferenceMode: "batch",
      precision: null,
      backend: "unreported",
      computeBackend: null,
      capabilities: null,
      native: null,
      progressiveBatch: false,
    };
    const send = (event) => {
      if (client.readyState === client.OPEN) client.send(JSON.stringify(event));
    };
    const cleanup = () => {
      clearTimeout(durationTimer);
      clearTimeout(finalTimer);
      clearTimeout(deadlineTimer);
      adapter?.close();
      adapter = null;
      adapterReady = false;
    };
    const diagnosticsPayload = () => ({
      client: diagnostics.client,
      server: serializeServerDiagnostics(diagnostics),
    });
    const setAuthoritativeVadAnalysis = (observation) => {
      const sampleCount = Math.floor(audioBytes / 2);
      const selection = selectSileroVadRanges(observation, sampleCount, { maxSegments: limits.maxSegments });
      diagnostics.analysis = authoritativeAnalysis(selection, sampleCount);
      return selection;
    };
    const publishProgressiveResults = () => {
      while (progressiveResults.has(progressiveNextPublish) || progressiveFailures.has(progressiveNextPublish)) {
        const sequence = progressiveNextPublish;
        const result = progressiveResults.get(sequence);
        if (result?.text) {
          progressiveText = appendProgressiveSegment(progressiveText, result.text, result.range.overlapSamples);
          emit({
            type: "final",
            text: progressiveText,
            segment: {
              sequence,
              startSample: result.range.startSample,
              endSample: result.range.endSample,
            },
          });
        }
        progressiveNextPublish += 1;
      }
    };
    const queueProgressiveRange = (range) => {
      if (!adapter?.transcribeRange) {
        progressiveFailures.set(range.sequence, { code: "progressive_adapter_unavailable", message: "The batch adapter cannot transcribe a progressive range" });
        publishProgressiveResults();
        return;
      }
      const diagnosticSegment = {
        sequence: range.sequence,
        regionIndex: range.regionIndex ?? null,
        regionIndices: range.regionIndices || [range.regionIndex],
        startSample: range.startSample,
        endSample: range.endSample,
        overlapSamples: range.overlapSamples,
        status: "queued",
      };
      diagnostics.progressive.segments.push(diagnosticSegment);
      diagnostics.progressive.committedSegments += 1;
      const task = progressiveInferenceTail.then(async () => {
        try {
          const text = String(await adapter.transcribeRange(range) || "").trim();
          progressiveResults.set(range.sequence, { text, range });
          diagnosticSegment.status = "completed";
          diagnosticSegment.textLength = text.length;
          diagnostics.progressive.completedSegments += 1;
        } catch (error) {
          const failure = {
            code: error?.code || "progressive_segment_failed",
            message: error?.message || "Progressive batch segment failed",
          };
          diagnosticSegment.status = "failed";
          diagnosticSegment.errorCode = failure.code;
          progressiveFailures.set(range.sequence, failure);
          diagnostics.progressive.failedSequences.push(range.sequence);
          send({ type: "segment_error", sequence: range.sequence, code: failure.code, message: failure.message });
        }
        publishProgressiveResults();
      });
      progressiveInferenceTail = task.then(() => undefined, () => undefined);
    };
    const progressiveRange = (region) => {
      const sampleCount = Math.floor(audioBytes / 2);
      const startSample = Math.max(0, Math.min(sampleCount, Math.floor(Number(region.submittedStartSample ?? region.startSample) || 0)));
      const endSample = Math.max(startSample, Math.min(sampleCount, Math.floor(Number(region.submittedEndSample ?? region.endSample) || 0)));
      const overlapSamples = Math.min(3_840, Math.max(0, progressiveLastRangeEnd - startSample));
      progressiveLastRangeEnd = Math.max(progressiveLastRangeEnd, endSample);
      return {
        sequence: progressiveNextSequence++,
        regionIndex: region.regionIndex,
        startSample,
        endSample,
        overlapSamples,
        closureReason: region.closureReason || "end_of_stream",
      };
    };
    const handleProgressiveRegions = (regions) => {
      if (!progressiveEnabled) return;
      for (const source of regions || []) {
        const regionIndex = Number(source.regionIndex);
        if (!Number.isInteger(regionIndex) || progressiveSeenRegions.has(regionIndex)) continue;
        progressiveSeenRegions.add(regionIndex);
        const range = progressiveRange(source);
        if (range.endSample <= range.startSample) continue;
        if (progressiveHeadCount < Math.max(0, limits.maxSegments - 1)) {
          progressiveHeadCount += 1;
          queueProgressiveRange(range);
          continue;
        }
        if (!progressiveTailRange) {
          progressiveTailRange = { ...range, sequences: [range.sequence], regionIndices: [regionIndex] };
        } else {
          progressiveTailRange.startSample = Math.min(progressiveTailRange.startSample, range.startSample);
          progressiveTailRange.endSample = Math.max(progressiveTailRange.endSample, range.endSample);
          progressiveTailRange.overlapSamples = Math.max(progressiveTailRange.overlapSamples, range.overlapSamples);
          progressiveTailRange.sequences.push(range.sequence);
          progressiveTailRange.regionIndices.push(regionIndex);
        }
      }
      diagnostics.progressive.heldTailRegions = progressiveTailRange?.regionIndices.length || 0;
    };
    const queueProgressivePcm = (chunk) => {
      if (!progressiveEnabled || !progressiveVad || !chunk?.length) return;
      const buffered = Buffer.from(chunk);
      const task = progressiveVadTail.then(() => {
        if (progressiveVadError) return [];
        return progressiveVad.push(buffered);
      });
      const handled = task.then((regions) => {
        handleProgressiveRegions(regions);
        return regions;
      });
      progressiveVadTail = handled.then(() => undefined, (error) => {
        progressiveVadError ||= error;
        return undefined;
      });
      void handled.catch((error) => {
        progressiveVadError ||= error;
        diagnostics.progressive.vadError = error?.message || "Progressive VAD failed";
      });
    };
    const finishProgressiveVad = async () => {
      if (!progressiveEnabled || !progressiveVad) return null;
      let observation = null;
      try {
        await progressiveVadTail;
        if (!progressiveVadError) {
          observation = await progressiveVad.finish();
          handleProgressiveRegions((observation?.regions || []).map((region, regionIndex) => ({ ...region, regionIndex })));
        }
      } catch (error) {
        progressiveVadError ||= error;
        diagnostics.progressive.vadError = error?.message || "Progressive VAD failed";
      }
      if ((progressiveVadError || observation?.available !== true) && typeof voiceRuntime.observeVoiceActivity === "function") {
        diagnostics.progressive.fallback = true;
        await progressiveInferenceTail;
        progressiveEnabled = false;
        runtimeMetadata.progressiveBatch = false;
        progressiveTailRange = null;
        diagnostics.progressive.heldTailRegions = 0;
        observation = await voiceRuntime.observeVoiceActivity(freezeAcceptedPcm());
        return observation;
      }
      if (progressiveTailRange) {
        const tail = progressiveTailRange;
        progressiveTailRange = null;
        diagnostics.progressive.heldTailRegions = 0;
        queueProgressiveRange(tail);
      }
      await progressiveInferenceTail;
      return observation;
    };
    const activateProgressiveBatch = (config, next) => {
      if (config?.mode !== "local" || config?.inferenceMode !== "batch" || typeof next?.transcribeRange !== "function") return;
      if (typeof voiceRuntime.beginVoiceActivity !== "function") return;
      let stream;
      try { stream = voiceRuntime.beginVoiceActivity(); }
      catch (error) {
        diagnostics.progressive.vadError = error?.message || "Progressive VAD could not start";
        return;
      }
      if (!stream) return;
      progressiveVad = stream;
      progressiveEnabled = true;
      runtimeMetadata.progressiveBatch = true;
      diagnostics.progressive.enabled = true;
      queueProgressivePcm(pcmAccumulator.view());
    };
    const freezeAcceptedPcm = () => {
      if (!finalPcm) finalPcm = Buffer.from(pcmAccumulator.view());
      return finalPcm;
    };
    const archiveRecording = (reason, error = null, transcript = "", updates = {}) => {
      if (!recordingStore || audioBytes <= 0) return Promise.resolve(null);
      if (savedRecord) return Promise.resolve(savedRecord);
      if (archivePromise) return archivePromise;
      const archiveStartedAt = performance.now();
      diagnostics.archiveStartedAt ||= archiveStartedAt;
      const text = String(transcript || "").trim();
      const options = {
        audioChunks: [freezeAcceptedPcm()],
        audioBytes,
        transcript: text,
        allowEmptyTranscript: true,
        allowShortAudio: Boolean(error && audioBytes >= SHORT_FAILURE_AUDIO_BYTES),
        metadata: {
          transcriptObserved,
          transcriptStatus: text ? "non_empty" : "empty",
          completionReason: reason,
          final: updates.final ?? false,
          finalWithinDeadline: updates.finalWithinDeadline ?? false,
          settlementMs: stoppedAt ? Date.now() - stoppedAt : null,
          clientAudioBytes,
          serverAudioBytes: audioBytes,
          serverAudioDurationMs: Math.round(audioBytes / 32),
          transcriptionStatus: error ? "failed" : "completed",
          ...(error ? { transcriptionError: error.message || "Voice transcription failed" } : {}),
          diagnostics: diagnosticsPayload(),
          ...runtimeMetadata,
          ...updates,
        },
      };
      const persist = typeof recordingStore.enqueue === "function"
        ? recordingStore.enqueue(options)
        : recordingStore.save(options);
      archivePromise = Promise.resolve(persist).then((record) => {
        savedRecord = record;
        return record;
      }).catch((archiveError) => {
        console.error(`Voice diagnostic recording failed: ${archiveError.message}`);
        return null;
      }).finally(() => {
        diagnostics.archiveCompletedAt = performance.now();
        diagnostics.archiveMs = Math.max(0, Math.round(performance.now() - archiveStartedAt));
      });
      return archivePromise;
    };
    const updateSavedRecording = (updates = {}) => {
      metadataUpdateTail = metadataUpdateTail.then(async () => {
        const record = await archivePromise;
        if (!record || typeof recordingStore?.updateMetadata !== "function") return;
        try {
          await recordingStore.updateMetadata(record, updates);
        } catch (error) {
          console.error(`Voice diagnostic metadata update failed: ${error.message}`);
        }
      });
      return metadataUpdateTail;
    };
    const startVadObservation = () => {
      if (vadObservationPromise) return vadObservationPromise;
      vadObservationPromise = runtimeConfigReady.then(async () => {
        if (audioBytes <= 0) return null;
        diagnostics.vadQueuedAt ||= performance.now();
        if (progressiveEnabled) {
          const startedAt = performance.now();
          const observation = await finishProgressiveVad();
          diagnostics.vadStartedAt = startedAt;
          diagnostics.vadCompletedAt = performance.now();
          diagnostics.vadObservation = observation || {
            type: "silero_vad_observation",
            available: false,
            status: progressiveVadError ? "error" : "not_configured",
            regions: [],
            frames: [],
          };
          setAuthoritativeVadAnalysis(diagnostics.vadObservation);
          return diagnostics.vadObservation;
        }
        if (typeof voiceRuntime.observeVoiceActivity !== "function") {
          diagnostics.vadObservation = {
            type: "silero_vad_observation",
            available: false,
            status: "not_configured",
            regions: [],
            frames: [],
          };
          setAuthoritativeVadAnalysis(diagnostics.vadObservation);
          return diagnostics.vadObservation;
        }
        const pcm = freezeAcceptedPcm();
        const observation = await voiceRuntime.observeVoiceActivity(pcm);
        const queue = observation?.queue;
        diagnostics.vadStartedAt = queue?.startedAt ?? performance.now();
        diagnostics.vadCompletedAt = queue?.completedAt ?? performance.now();
        diagnostics.vadObservation = observation || {
          type: "silero_vad_observation",
          available: false,
          status: "not_configured",
          regions: [],
          frames: [],
        };
        setAuthoritativeVadAnalysis(diagnostics.vadObservation);
        return diagnostics.vadObservation;
      }).catch((error) => {
        diagnostics.vadStartedAt ||= performance.now();
        diagnostics.vadCompletedAt = performance.now();
        diagnostics.vadObservation = {
          type: "silero_vad_observation",
          available: false,
          status: "error",
          errorCode: error.code || "voice_vad_unavailable",
          error: error.message || "Silero VAD observation failed",
          regions: [],
          frames: [],
        };
        setAuthoritativeVadAnalysis(diagnostics.vadObservation);
        return diagnostics.vadObservation;
      });
      return vadObservationPromise;
    };
    const complete = (reason, upstream = {}) => {
      if (completed) return;
      completed = true;
      const completedAt = Date.now();
      diagnostics.sessionFinalAt ||= performance.now();
      cleanup();
      const transcript = String(upstream.text || finalText || "").trim();
      const finalUpdates = {
        transcript,
        transcriptStatus: transcript ? "non_empty" : "empty",
        transcriptObserved,
        completionReason: reason,
        final: upstream.final ?? hasFinal,
        finalWithinDeadline: Boolean(hasFinal && stoppedAt && !deadlinePassed),
        settlementMs: stoppedAt ? completedAt - stoppedAt : null,
        clientAudioBytes,
        serverAudioBytes: audioBytes,
        serverAudioDurationMs: Math.round(audioBytes / 32),
        transcriptionStatus: "completed",
        ...runtimeMetadata,
      };
      startVadObservation();
      const archive = archiveRecording(reason, null, transcript, finalUpdates);
      diagnostics.completionSentAt = performance.now();
      const finalDiagnostics = diagnosticsPayload();
      send({
        type: "completed",
        text: upstream.text || finalText,
        final: upstream.final ?? hasFinal,
        reason,
        settlementMs: stoppedAt ? completedAt - stoppedAt : null,
        finalWithinDeadline: Boolean(hasFinal && stoppedAt && !deadlinePassed),
        audioBytes,
        audioDurationMs: Math.round(audioBytes / 32),
        speech: speechDecision(diagnostics),
        diagnostics: finalDiagnostics,
        ...runtimeMetadata,
      });
      void Promise.all([archive, vadObservationPromise]).then(() => updateSavedRecording({
        ...finalUpdates,
        diagnostics: diagnosticsPayload(),
      })).then(() => {
        console.info(JSON.stringify({ type: "conduit.voice-dictation-diagnostic", diagnostics: diagnosticsPayload() }));
      });
    };
    const updateClientDiagnostics = async (value) => {
      const clientDiagnostics = sanitizeClientDiagnostics(value);
      if (!clientDiagnostics) {
        send({ type: "client_diagnostics_ack", accepted: false });
        return;
      }
      diagnostics.client = clientDiagnostics;
      diagnostics.transport.clientAudioBytes = clientAudioBytes ?? clientDiagnostics.transport.pcmBytes ?? null;
      if (completed && archivePromise) {
        await archivePromise;
        await updateSavedRecording({ diagnostics: diagnosticsPayload() });
      }
      console.info(JSON.stringify({ type: "conduit.voice-dictation-diagnostic", diagnostics: diagnosticsPayload() }));
      send({ type: "client_diagnostics_ack", accepted: true });
    };
    const fail = (error) => {
      if (completed) return;
      completed = true;
      diagnostics.sessionFinalAt ||= performance.now();
      cleanup();
      const failure = error instanceof Error ? error : new Error(String(error || "Voice dictation failed"));
      startVadObservation();
      const archive = archiveRecording("failed", failure);
      diagnostics.completionSentAt = performance.now();
      send({ type: "error", code: failure.code || "dictation_failed", message: failure.message });
      void Promise.all([archive, vadObservationPromise]).then(() => updateSavedRecording({
        transcriptionStatus: "failed",
        transcriptionError: failure.message,
        completionReason: "failed",
        diagnostics: diagnosticsPayload(),
        ...runtimeMetadata,
      }));
    };
    const acceptAudio = (data) => {
      if (data.length > limits.maxFrameBytes) throw dictationError("dictation_frame_too_large", "Audio frame is too large", 413);
      const chunk = pcmAccumulator.append(data);
      audioBytes = pcmAccumulator.byteLength;
      const receivedAt = performance.now();
      if (diagnostics.firstServerPcmAt === null) diagnostics.firstServerPcmAt = receivedAt;
      diagnostics.lastServerPcmAt = receivedAt;
      diagnostics.transport.packetCount += 1;
      diagnostics.transport.pcmBytes = audioBytes;
      addPcmSignal(diagnostics.signal, chunk);
      if (adapterReady && adapter) adapter.write(chunk);
      queueProgressivePcm(chunk);
    };
    const stop = (reason) => {
      if (stopping || completed) return;
      stopping = true;
      stopReason = reason;
      stoppedAt = Date.now();
      diagnostics.stopAt = performance.now();
      const vadPromise = startVadObservation();
      void (async () => {
        try {
          if (!adapter) send({ type: "waiting_for_transcription" });
          const current = adapter || await adapterAvailable;
          if (!current || completed) return;
          const finalizationTimeoutMs = calculateFinalizationTimeoutMs({
            audioBytes,
            adapter: runtimeMetadata.adapter,
            model: runtimeMetadata.model,
            limits,
          });
          send({
            type: "finalizing",
            timeoutMs: finalizationTimeoutMs,
            audioDurationMs: Math.round(audioBytes / 32),
            ...runtimeMetadata,
          });
          finalTimer = setTimeout(() => fail(dictationError("dictation_final_timeout", "Voice dictation did not finalize in time", 504)), finalizationTimeoutMs);
          finalTimer.unref?.();
          deadlineTimer = setTimeout(() => { deadlinePassed = true; send({ type: "settlement_deadline", deadlineMs: limits.finalDeadlineMs }); }, limits.finalDeadlineMs);
          deadlineTimer.unref?.();
          await vadPromise;
          if (completed) return;
          const segmentation = {
            mode: "silero_authoritative",
            segments: diagnostics.analysis?.segments || [],
            analysis: diagnostics.analysis,
          };
          await current.stop({
            segmentation,
            progressive: progressiveEnabled,
            text: progressiveText,
          });
        } catch (error) { fail(error); }
      })();
    };
    const emit = (event) => {
      if (completed) return;
      // Session already advertised readiness so the browser can stream PCM while
      // the local model cold-starts; ignore the adapter's own ready event.
      if (event.type === "ready") return;
      if (event.type === "partial") {
        const text = String(event.text || "");
        if (text.trim()) {
          transcriptObserved = true;
          diagnostics.firstPartialAt ||= performance.now();
          diagnostics.firstUsableTextAt ||= performance.now();
        }
        send({ type: "partial", text });
      }
      else if (event.type === "final") {
        finalText = String(event.text || "");
        if (finalText.trim()) {
          transcriptObserved = true;
          diagnostics.firstSegmentFinalAt ||= performance.now();
          diagnostics.firstUsableTextAt ||= performance.now();
        }
        hasFinal = true;
        send({ type: "final", text: finalText, ...(event.segment ? { segment: event.segment } : {}) });
        // Completion waits for adapter_closed: segmented transcriptions emit
        // one final per utterance, so completing on the first final would drop
        // every later segment.
      } else if (event.type === "adapter_closed") complete(stopping ? stopReason || "stopped" : "upstream_closed", event);
      else if (event.type === "error") fail(dictationError(event.code || "asr_error", event.message || "Voice dictation failed", 502));
      else send(event);
    };
    // Accept PCM immediately. Cold model load continues in the background; the
    // server retains frames until the adapter is attached, then drains them.
    send({ type: "ready", sampleRate: 16_000, encoding: "pcm_s16le" });
    durationTimer = setTimeout(() => stop("duration_limit"), limits.maxDurationMs);
    durationTimer.unref?.();
    (async () => {
      const config = await voiceRuntime.resolve();
      if (completed) {
        settleAdapter(null);
        if (!runtimeConfigSettled) {
          runtimeConfigSettled = true;
          settleRuntimeConfig(config);
        }
        return;
      }
      const resolvedModel = typeof config.model === "string" && config.model
        ? config.model
        : typeof config.localModelId === "string"
          ? config.localModelId
          : null;
      runtimeMetadata = {
        mode: config.mode === "local" || config.mode === "remote" ? config.mode : null,
        adapter: typeof config.adapter === "string" ? config.adapter : null,
        provider: typeof config.provider === "string" ? config.provider : null,
        model: resolvedModel,
        inferenceMode: typeof config.inferenceMode === "string" ? config.inferenceMode : "batch",
        precision: typeof config.precision === "string" ? config.precision : precisionFor(resolvedModel),
        backend: typeof config.backend === "string" ? config.backend : "unreported",
        computeBackend: typeof config.computeBackend === "string" ? config.computeBackend : null,
        capabilities: config.capabilities && typeof config.capabilities === "object" ? config.capabilities : null,
        native: config.native && typeof config.native === "object" ? config.native : null,
        progressiveBatch: false,
      };
      diagnostics.runtime = {
        mode: runtimeMetadata.mode,
        inferenceMode: runtimeMetadata.inferenceMode,
        model: runtimeMetadata.model,
        precision: runtimeMetadata.precision,
        backend: runtimeMetadata.backend,
        computeBackend: runtimeMetadata.computeBackend,
        capabilities: runtimeMetadata.capabilities,
        native: runtimeMetadata.native,
      };
      const next = config.adapter === "deepgram_audio_v1"
        ? createDeepgramAdapter(config, emit, limits, fetchImpl, diagnostics)
        : config.adapter === "transcribe_cpp_batch_v1"
          ? createSnapshotAdapter(emit, limits, config.transcribe, diagnostics, { progressive: false, useSegmentation: false })
        : config.adapter === "managed_transformers_v1"
          ? createSnapshotAdapter(emit, limits, config.transcribe, diagnostics)
          : createHttpAdapter(config, emit, limits, fetchImpl, diagnostics);
      await next.opened;
      if (completed) {
        next.close();
        settleAdapter(null);
        return;
      }
      adapter = next;
      if (pcmAccumulator.byteLength > 0) adapter.write(pcmAccumulator.view());
      adapterReady = true;
      activateProgressiveBatch(config, next);
      diagnostics.runtimeReadyAt = performance.now();
      send({ type: "runtime_ready", ...runtimeMetadata });
      settleAdapter(adapter);
      if (!runtimeConfigSettled) {
        runtimeConfigSettled = true;
        settleRuntimeConfig(config);
      }
    })().catch((error) => {
      settleAdapter(null);
      if (!runtimeConfigSettled) {
        runtimeConfigSettled = true;
        settleRuntimeConfig(null);
      }
      fail(error);
    });

    client.on("message", (data, isBinary) => {
      try {
        if (isBinary) {
          if (completed || stopping) return;
          acceptAudio(data);
          return;
        }
        const command = JSON.parse(String(data));
        if (command.type === "client_diagnostics") {
          if (completed) void updateClientDiagnostics(command.clientDiagnostics ?? command.diagnostics).catch((error) => {
            console.error(`Voice diagnostic completion metadata update failed: ${error.message}`);
            send({ type: "client_diagnostics_ack", accepted: false });
          });
          return;
        }
        if (completed || stopping) return;
        if (command.type !== "stop") throw dictationError("dictation_control_invalid", "Unknown dictation control frame");
        const reportedAudioBytes = Number(command.audioBytesSent);
        clientAudioBytes = Number.isFinite(reportedAudioBytes) && reportedAudioBytes >= 0
          ? Math.trunc(reportedAudioBytes)
          : null;
        diagnostics.client = sanitizeClientDiagnostics(command.clientDiagnostics ?? command.diagnostics);
        diagnostics.transport.clientAudioBytes = clientAudioBytes ?? diagnostics.client?.transport.pcmBytes ?? null;
        stop("stopped");
      } catch (error) { fail(error); }
    });
    client.once("close", () => {
      if (!completed) {
        completed = true;
        diagnostics.sessionFinalAt ||= performance.now();
        cleanup();
        startVadObservation();
        const archive = archiveRecording("client_disconnected");
        void Promise.all([archive, vadObservationPromise]).then(() => updateSavedRecording({
          completionReason: "client_disconnected",
          diagnostics: diagnosticsPayload(),
          ...runtimeMetadata,
        }));
      }
      settleAdapter(null);
      activeSessions = Math.max(0, activeSessions - 1);
      voiceRuntime.unpin?.();
    });
  });
  return { handleUpgrade, activeSessions: () => activeSessions };
}
