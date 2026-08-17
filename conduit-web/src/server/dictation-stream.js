import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { OPENAI_LIVE_ADAPTER, OPENAI_LIVE_MODEL } from "../voice-settings.js";
import { createSegmentationProvider, segmentationObservationMetadata } from "./voice-segmentation.js";
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

// The binding exposes the Parakeet buffered decoder's 160 ms chunk setting,
// but it does not define a required JavaScript feed size. Keep the transport
// packet size independent and coalesce eight 20 ms packets before native feed.
// The queue limit is deliberately fixed for this package; tests can use the
// createDictationStream limits seam to force the overflow path.
export const TRANSCRIBE_CPP_FEED_QUANTUM_MS = 160;
export const TRANSCRIBE_CPP_LIVE_QUEUE_LIMIT_MS = 5_000;
const VOICE_SAMPLE_RATE = 16_000;

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

function transcriptError(code, message) {
  return Object.assign(new Error(message), { code, status: 502 });
}

function samplePosition(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function sameTranscriptText(left, right) {
  return String(left || "").trim().replace(/\s+/g, " ") === String(right || "").trim().replace(/\s+/g, " ");
}

/**
 * Owns the transcript truth for one accepted PCM timeline. Runtime output is
 * treated as a proposal: tentative revisions can be replaced, stable
 * segments cannot, and the session final is derived from the accepted stable
 * segments rather than copied over them.
 */
export function createTranscriptTruth(sessionId, { onEvent = null } = {}) {
  const id = String(sessionId || "");
  const tentative = new Map();
  const stable = new Map();
  let stableText = "";
  let lastSequence = -1;
  let committedThroughSample = 0;
  let submittedThroughSample = 0;
  let processedThroughSample = null;
  const emitNormalized = (event) => onEvent?.(event);

  const orderedTentative = () => [...tentative.values()]
    .sort((left, right) => left.fromSample - right.fromSample || left.regionId.localeCompare(right.regionId));
  const displayText = () => orderedTentative().reduce((text, region) => appendText(text, region.text), stableText);
  const clearCoveredTentative = (fromSample, throughSample) => {
    for (const [regionId, region] of tentative) {
      if (region.throughSample <= throughSample || region.fromSample < throughSample && region.throughSample > fromSample) tentative.delete(regionId);
    }
  };
  const acceptTentative = ({ regionId, revision, text, fromSample = 0, throughSample = 0 } = {}) => {
    const safeRegionId = String(regionId || "");
    const safeRevision = samplePosition(revision, -1);
    if (!safeRegionId || safeRevision < 0) throw transcriptError("voice_tentative_invalid", "Tentative transcript output requires a region ID and revision");
    const existing = tentative.get(safeRegionId);
    if (existing && safeRevision <= existing.revision) return { accepted: false, revision: existing.revision };
    const region = {
      regionId: safeRegionId,
      revision: safeRevision,
      text: String(text || "").trim(),
      fromSample: samplePosition(fromSample),
      throughSample: Math.max(samplePosition(throughSample), samplePosition(fromSample)),
    };
    tentative.set(safeRegionId, region);
    emitNormalized({
      type: "tentative_region",
      sessionId: id,
      ...region,
    });
    return { accepted: true, revision: safeRevision };
  };
  const acceptStableSegment = ({ segmentId, sequence, text, fromSample = 0, throughSample = 0 } = {}) => {
    const safeSegmentId = String(segmentId || "");
    const safeSequence = samplePosition(sequence, -1);
    const safeText = String(text || "").trim();
    const safeFrom = samplePosition(fromSample);
    const safeThrough = Math.max(samplePosition(throughSample), safeFrom);
    if (!safeSegmentId || safeSequence < 0 || !safeText) return { accepted: false, sequence: safeSequence };
    const existing = stable.get(safeSegmentId);
    if (existing) {
      if (!sameTranscriptText(existing.text, safeText)
        || existing.sequence !== safeSequence
        || existing.fromSample !== safeFrom
        || existing.throughSample !== safeThrough) {
        throw transcriptError("voice_stable_segment_conflict", `Stable segment ${safeSegmentId} was reused with different content`);
      }
      return { accepted: false, sequence: safeSequence };
    }
    if (safeSequence <= lastSequence) throw transcriptError("voice_stable_sequence_invalid", "Stable transcript sequence did not increase");
    if (safeFrom < committedThroughSample || safeThrough <= committedThroughSample || safeThrough < safeFrom) throw transcriptError("voice_stable_coverage_invalid", "Stable transcript sample coverage did not increase");
    const segment = {
      segmentId: safeSegmentId,
      sequence: safeSequence,
      text: safeText,
      fromSample: safeFrom,
      throughSample: safeThrough,
    };
    stable.set(safeSegmentId, segment);
    stableText = appendText(stableText, safeText);
    lastSequence = safeSequence;
    committedThroughSample = Math.max(committedThroughSample, safeThrough);
    clearCoveredTentative(safeFrom, committedThroughSample);
    emitNormalized({
      type: "stable_segment",
      sessionId: id,
      ...segment,
    });
    return { accepted: true, sequence: safeSequence };
  };
  const acceptRuntimeSnapshot = ({ regionId = `${id}:live`, revision = 0, stableText: nextStable = "", tentativeText = "", fromSample = committedThroughSample, throughSample = committedThroughSample } = {}) => {
    const candidateStable = String(nextStable || "").trim();
    if (candidateStable && !sameTranscriptText(candidateStable, stableText)) {
      const current = stableText.trim();
      if (current && !candidateStable.startsWith(current)) throw transcriptError("voice_stable_text_conflict", "Runtime final text does not extend the stable transcript");
      const suffix = current ? candidateStable.slice(current.length).trim() : candidateStable;
      if (suffix) {
        acceptStableSegment({
          segmentId: `${id}:segment:${lastSequence + 1}`,
          sequence: lastSequence + 1,
          text: suffix,
          fromSample: committedThroughSample,
          throughSample: Math.max(samplePosition(throughSample), committedThroughSample),
        });
      }
    }
    acceptTentative({ regionId, revision, text: tentativeText, fromSample, throughSample });
    if (!String(tentativeText || "").trim()) tentative.delete(String(regionId || ""));
    return snapshot();
  };
  const acceptSessionFinal = ({ text = "", committedThroughSample: finalThroughSample = committedThroughSample } = {}) => {
    const candidate = String(text || "").trim();
    if (candidate && !sameTranscriptText(candidate, stableText)) {
      const current = stableText.trim();
      if (current && !candidate.startsWith(current)) throw transcriptError("voice_session_final_conflict", "Runtime final text cannot replace the stable transcript");
      const suffix = current ? candidate.slice(current.length).trim() : candidate;
      if (suffix) {
        acceptStableSegment({
          segmentId: `${id}:segment:${lastSequence + 1}`,
          sequence: lastSequence + 1,
          text: suffix,
          fromSample: committedThroughSample,
          throughSample: Math.max(samplePosition(finalThroughSample), committedThroughSample),
        });
      }
    }
    tentative.clear();
    const finalText = stableText.trim();
    if (finalText) committedThroughSample = Math.max(committedThroughSample, samplePosition(finalThroughSample));
    const event = {
      type: "session_final",
      sessionId: id,
      text: finalText,
      committedThroughSample,
    };
    emitNormalized(event);
    return event;
  };
  const discardTentative = () => {
    const discardedRevisions = [...tentative.values()].map((region) => region.revision);
    tentative.clear();
    return { discardedRevisions: discardedRevisions.length, revisions: discardedRevisions };
  };
  const noteSubmitted = (throughSample) => {
    submittedThroughSample = Math.max(submittedThroughSample, samplePosition(throughSample));
    return submittedThroughSample;
  };
  const noteProcessed = (throughSample) => {
    processedThroughSample = Math.max(processedThroughSample || 0, samplePosition(throughSample));
    return processedThroughSample;
  };
  const snapshot = () => ({
    text: displayText(),
    stableText: stableText.trim(),
    tentativeText: orderedTentative().map((region) => region.text).filter(Boolean).join(" "),
    committedThroughSample,
    tentativeRegions: orderedTentative(),
    stableSegments: [...stable.values()],
  });
  return {
    acceptTentative,
    acceptStableSegment,
    acceptRuntimeSnapshot,
    acceptSessionFinal,
    discardTentative,
    noteSubmitted,
    noteProcessed,
    displayText,
    stableText: () => stableText.trim(),
    tentativeRegions: orderedTentative,
    snapshot,
    watermarks: () => ({ submittedThroughSample, processedThroughSample, committedThroughSample }),
  };
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
    segmentation: {
      provider: null,
      calibrationVersion: null,
      state: "not_started",
    },
    watermarks: {
      acceptedThroughSample: 0,
      submittedThroughSample: 0,
      processedThroughSample: null,
      committedThroughSample: 0,
      archiveOwnedThroughSample: 0,
    },
    streaming: {
      enabled: false,
      family: null,
      profile: null,
      feedCount: 0,
      feedCallCount: 0,
      feedSamples: 0,
      meanAudioPerCallMs: 0,
      feedQuantumMs: null,
      feedQuantumSamples: null,
      queueLimitMs: TRANSCRIBE_CPP_LIVE_QUEUE_LIMIT_MS,
      acceptedThroughSample: 0,
      submittedThroughSample: 0,
      processedThroughSample: null,
      committedThroughSample: 0,
      serverQueuedAudioMs: 0,
      runtimeBufferedAudioMs: null,
      totalInferenceLagMs: null,
      maxServerQueueMs: 0,
      maxNativeBufferMs: 0,
      stopDrainMs: null,
      overflow: null,
      revisionCount: 0,
      firstCommittedAt: null,
      firstTentativeAt: null,
      lastRevision: null,
      maxBufferedMs: 0,
      fallback: null,
    },
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

function authoritativeAnalysis(selection, sampleCount, source = "silero_authoritative") {
  const segments = Array.isArray(selection?.segments) ? selection.segments : [];
  const silentRuns = selection?.available ? gapsForSegments(segments, sampleCount) : [];
  return {
    source,
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
  if (["silero_authoritative", "heuristic"].includes(diagnostics.analysis?.source)) {
    return {
      detector: diagnostics.analysis.source === "heuristic" ? "heuristic" : "silero_vad",
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
  const streaming = {
    ...(diagnostics.streaming || {}),
    firstCommittedMs: elapsed(diagnostics.startedAt, diagnostics.streaming?.firstCommittedAt),
    firstTentativeMs: elapsed(diagnostics.startedAt, diagnostics.streaming?.firstTentativeAt),
  };
  delete streaming.firstCommittedAt;
  delete streaming.firstTentativeAt;
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
  const speechSamples = ["silero_authoritative", "heuristic"].includes(analysis?.source)
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
        : analysis?.source === "heuristic"
          ? {
            type: "heuristic",
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
      streaming,
      watermarks: { ...diagnostics.watermarks },
      segmentation: { ...diagnostics.segmentation },
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

function pcmFloat32(buffer) {
  const samples = new Float32Array(Math.floor(buffer.length / 2));
  for (let index = 0; index < samples.length; index += 1) samples[index] = buffer.readInt16LE(index * 2) / 32768;
  return samples;
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
  if (segmentation?.mode === "heuristic") {
    const analysis = segmentation.analysis || authoritativeAnalysis(
      {
        available: true,
        status: "speech",
        segments: segmentation.segments,
        policy: segmentation.policy,
      },
      Math.floor(byteLength / 2),
      "heuristic",
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

function remoteSpeechRanges(pcm, byteLength, segmentation, limits, diagnostics) {
  const analysis = resolveInferenceAnalysis(pcm, byteLength, segmentation, limits, diagnostics);
  if (!analysis.segments?.length) return { analysis, pcm: Buffer.alloc(0), byteLength: 0, startSample: 0, endSample: 0 };
  let start = analysis.segments[0][0];
  let end = analysis.segments[0][1];
  for (const [rangeStart, rangeEnd] of analysis.segments) {
    start = Math.min(start, rangeStart);
    end = Math.max(end, rangeEnd);
  }
  return { analysis, pcm: pcm.subarray(start * 2, end * 2), byteLength: (end - start) * 2, startSample: start, endSample: end };
}

export function createHttpAdapter(config, emit, limits, fetchImpl, diagnostics = null, { signal: sessionSignal = null, watermarks = null } = {}) {
  const chunks = [];
  let byteLength = 0;
  const controller = sessionSignal ? null : new AbortController();
  const signal = sessionSignal || controller.signal;
  const upload = async (pcm, range = {}) => {
    if (!pcm.length || signal.aborted) return { final: false, text: "" };
    const form = new FormData();
    form.append("file", wavBlob([pcm], pcm.length), "dictation.wav");
    form.append("response_format", "json");
    if (config.model) form.append("model", config.model);
    if (config.provider !== "groq") form.append("stream", "true");
    watermarks?.onSubmitted?.({ startSample: range.startSample || 0, endSample: range.endSample || Math.floor(pcm.length / 2) });
    if (diagnostics) markInferenceStart(diagnostics);
    const response = await fetchImpl(config.endpoint, { method: "POST", headers: { "User-Agent": "ConduitVoice/1.0", ...config.headers }, body: form, signal, redirect: "error" });
    let text = "";
    await readSse(response, (event) => {
      if (event.type === "final") {
        text = mergeTranscript(text, String(event.text || ""));
        emit({ type: "final", text });
      } else if (event.type === "partial") {
        emit({ type: "partial", text: String(event.text || "") });
      } else emit(event);
    }, limits);
    watermarks?.onProcessed?.({ startSample: range.startSample || 0, endSample: range.endSample || Math.floor(pcm.length / 2) });
    return { final: Boolean(text), text };
  };
  const transcribe = async ({ segmentation = null } = {}) => {
    if (!byteLength || signal.aborted) return { final: false, text: "" };
    if (diagnostics) markInferenceQueued(diagnostics);
    const selected = remoteSpeechRanges(Buffer.concat(chunks, byteLength), byteLength, segmentation, limits, diagnostics);
    try {
      return await upload(selected.pcm, selected);
    } finally {
      if (diagnostics) markInferenceComplete(diagnostics);
    }
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
    close() { controller?.abort(); chunks.length = 0; },
  };
}

function createSnapshotAdapter(emit, limits, transcribe, diagnostics = null, {
  progressive = true,
  useSegmentation = true,
  signal = null,
  sessionId = null,
  nextOperationId = null,
  watermarks = null,
  sampleOffset = 0,
} = {}) {
  const chunks = [];
  let byteLength = 0;
  let closed = false;
  const snapshot = () => Buffer.concat(chunks, byteLength);
  const invoke = async (pcm, options = {}) => {
    if (closed || signal?.aborted) return "";
    const operationId = options.operationId || nextOperationId?.("batch") || `voice-batch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const result = await transcribe(pcm, { ...options, operationId, sessionId, signal });
    return signal?.aborted || closed ? "" : String(result || "").trim();
  };
  const transcribeRange = async ({ startSample = 0, endSample = 0, sequence = 0 } = {}) => {
    if (!byteLength || closed || signal?.aborted) return "";
    const pcm = snapshot();
    const start = Math.max(0, Math.min(Math.floor(startSample), Math.floor(byteLength / 2)));
    const end = Math.max(start, Math.min(Math.floor(endSample), Math.floor(byteLength / 2)));
    if (end <= start) return "";
    if (diagnostics) {
      markInferenceQueued(diagnostics);
      markInferenceStart(diagnostics);
    }
    watermarks?.onSubmitted?.({ sequence, startSample: start + sampleOffset, endSample: end + sampleOffset });
    try {
      const result = await invoke(pcm.subarray(start * 2, end * 2), {
        sequence,
        startSample: start + sampleOffset,
        endSample: end + sampleOffset,
      });
      watermarks?.onProcessed?.({ sequence, startSample: start + sampleOffset, endSample: end + sampleOffset });
      return result;
    } finally {
      if (diagnostics) markInferenceComplete(diagnostics);
    }
  };
  const run = async ({ segmentation = null } = {}) => {
    if (!byteLength || closed || signal?.aborted) return { final: false, text: "" };
    if (diagnostics) markInferenceQueued(diagnostics);
    const snapshot = Buffer.concat(chunks, byteLength);
    const analysis = useSegmentation
      ? resolveInferenceAnalysis(snapshot, byteLength, segmentation, limits, diagnostics)
      : { segments: [[0, Math.floor(byteLength / 2)]] };
    const segments = analysis.segments;
    let text = "";
    for (const [sequence, [startSample, endSample]] of segments.entries()) {
      const piece = snapshot.subarray(startSample * 2, endSample * 2);
      if (diagnostics) markInferenceStart(diagnostics);
      const absoluteStartSample = startSample + sampleOffset;
      const absoluteEndSample = endSample + sampleOffset;
      watermarks?.onSubmitted?.({ sequence, startSample: absoluteStartSample, endSample: absoluteEndSample });
      const pieceText = await invoke(piece, { sequence, startSample: absoluteStartSample, endSample: absoluteEndSample });
      watermarks?.onProcessed?.({ sequence, startSample: absoluteStartSample, endSample: absoluteEndSample });
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
    close() { closed = true; byteLength = 0; chunks.length = 0; },
  };
}

function streamOptions(streaming = {}) {
  const family = String(streaming.family || "parakeet_buffered");
  const familyOptions = { kind: family };
  for (const [key, value] of [["leftMs", streaming.leftMs], ["chunkMs", streaming.chunkMs], ["rightMs", streaming.rightMs]]) {
    if (Number.isFinite(Number(value))) familyOptions[key] = Number(value);
  }
  return {
    family: familyOptions,
    commitPolicy: streaming.commitPolicy || "stable_prefix",
    ...(Number.isFinite(Number(streaming.stablePrefixAgreementN))
      ? { stablePrefixAgreementN: Number(streaming.stablePrefixAgreementN) }
      : {}),
  };
}

export function upsamplePcm16kTo24k(pcm16) {
  const source = Buffer.isBuffer(pcm16) ? pcm16 : Buffer.from(pcm16);
  const inputSamples = Math.floor(source.length / 2);
  if (!inputSamples) return Buffer.alloc(0);
  const outputSamples = Math.round(inputSamples * 1.5);
  const output = Buffer.allocUnsafe(outputSamples * 2);
  for (let index = 0; index < outputSamples; index += 1) {
    const sourceIndex = index / 1.5;
    const left = Math.min(inputSamples - 1, Math.floor(sourceIndex));
    const right = Math.min(inputSamples - 1, left + 1);
    const fraction = sourceIndex - left;
    const mixed = source.readInt16LE(left * 2) * (1 - fraction) + source.readInt16LE(right * 2) * fraction;
    output.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(mixed))), index * 2);
  }
  return output;
}

export function createOpenaiRealtimeStreamAdapter(emit, _limits, openStream, diagnostics = null, { watermarks = null } = {}) {
  let session = null;
  let closed = false;
  let feedError = null;
  let errorReported = false;
  let feedTail = Promise.resolve();
  let committed = "";
  let tentative = "";
  let revision = 0;
  let acceptedThroughSample = 0;
  let submittedThroughSample = 0;
  let committedThroughSample = 0;

  const opened = Promise.resolve().then(async () => {
    if (typeof openStream !== "function") throw dictationError("voice_stream_unsupported", "The selected voice model does not expose stateful streaming", 409);
    session = await openStream();
    if (!session || typeof session.append !== "function" || typeof session.commit !== "function") {
      throw dictationError("voice_stream_invalid", "The selected voice model returned an invalid streaming session", 502);
    }
    if (diagnostics) {
      diagnostics.streaming.enabled = true;
      diagnostics.streaming.family = "openai_realtime";
      diagnostics.streaming.profile = { model: OPENAI_LIVE_MODEL, inputRate: 24_000, delay: "low" };
    }
    return session;
  });

  const reportError = (error) => {
    if (errorReported) return;
    errorReported = true;
    emit({ type: "error", code: error?.code || "voice_stream_failed", message: error?.message || "Stateful voice transcription failed" });
  };

  const publish = (terminal = false) => {
    const full = `${committed}${committed && tentative ? " " : ""}${tentative}`.replace(/\s+/g, " ").trim();
    revision += 1;
    if (diagnostics) {
      diagnostics.streaming.lastRevision = revision;
      diagnostics.streaming.revisionCount = revision;
      if (committed.trim() && diagnostics.streaming.firstCommittedAt === null) diagnostics.streaming.firstCommittedAt = performance.now();
      if (tentative.trim() && diagnostics.streaming.firstTentativeAt === null) diagnostics.streaming.firstTentativeAt = performance.now();
      diagnostics.streaming.acceptedThroughSample = Math.max(diagnostics.streaming.acceptedThroughSample, acceptedThroughSample);
      diagnostics.streaming.submittedThroughSample = Math.max(diagnostics.streaming.submittedThroughSample, submittedThroughSample);
      diagnostics.streaming.committedThroughSample = Math.max(diagnostics.streaming.committedThroughSample, committedThroughSample);
    }
    const stableThroughSample = Math.min(acceptedThroughSample, Math.max(committedThroughSample, submittedThroughSample));
    emit({
      type: terminal ? "final" : "partial",
      text: full,
      stableText: committed.trim(),
      tentativeText: tentative.trim(),
      revision,
      fromSample: committedThroughSample,
      throughSample: stableThroughSample,
    });
    return full;
  };

  const attach = (live) => {
    live.onDelta?.((delta) => {
      tentative = `${tentative}${delta}`;
      publish();
    });
    live.onCompleted?.((transcript) => {
      const next = String(transcript || tentative).trim();
      committed = committed ? `${committed} ${next}`.trim() : next;
      tentative = "";
      committedThroughSample = submittedThroughSample;
      publish();
    });
  };

  return {
    opened: opened.then((live) => {
      attach(live);
      return live;
    }),
    write(data) {
      const copy = Buffer.from(data);
      const sampleCount = Math.floor(copy.length / 2);
      const startSample = acceptedThroughSample;
      acceptedThroughSample += sampleCount;
      if (diagnostics) diagnostics.streaming.acceptedThroughSample = Math.max(diagnostics.streaming.acceptedThroughSample, acceptedThroughSample);
      const task = feedTail.then(async () => {
        const live = await opened;
        if (closed || feedError) return;
        if (diagnostics) {
          markInferenceQueued(diagnostics);
          markInferenceStart(diagnostics);
          diagnostics.streaming.feedCount += 1;
          diagnostics.streaming.feedSamples += sampleCount;
          diagnostics.streaming.feedCallCount += 1;
          diagnostics.streaming.meanAudioPerCallMs = diagnostics.streaming.feedSamples
            / diagnostics.streaming.feedCallCount
            / (VOICE_SAMPLE_RATE / 1_000);
        }
        await live.append(upsamplePcm16kTo24k(copy));
        submittedThroughSample = Math.max(submittedThroughSample, startSample + sampleCount);
        if (diagnostics) diagnostics.streaming.submittedThroughSample = Math.max(diagnostics.streaming.submittedThroughSample, submittedThroughSample);
        watermarks?.onSubmitted?.({ startSample, endSample: submittedThroughSample });
      });
      feedTail = task.catch((error) => {
        feedError ||= error;
        reportError(error);
      });
    },
    async stop() {
      await opened;
      await feedTail;
      if (feedError) throw feedError;
      if (closed || !session) return;
      if (diagnostics) {
        markInferenceQueued(diagnostics);
        markInferenceStart(diagnostics);
      }
      const transcript = await session.commit();
      committedThroughSample = submittedThroughSample;
      watermarks?.onProcessed?.({ startSample: 0, endSample: submittedThroughSample });
      if (!committed && transcript) committed = String(transcript).trim();
      tentative = "";
      if (diagnostics) markInferenceComplete(diagnostics);
      const text = publish(true);
      emit({ type: "adapter_closed", final: Boolean(text), text, stableText: committed.trim(), tentativeText: "" });
    },
    close() {
      closed = true;
      try { session?.close?.(); }
      catch (error) { reportError(error); }
      session = null;
    },
  };
}

export function openOpenaiRealtimeStream({ url, headers, model = OPENAI_LIVE_MODEL, WebSocketImpl = WebSocket, openTimeoutMs = 8_000, commitTimeoutMs = 20_000 } = {}) {
  if (!url) throw dictationError("voice_stream_unsupported", "OpenAI live transcription requires a realtime endpoint", 409);
  const socket = new WebSocketImpl(url, { headers: { "User-Agent": "ConduitVoice/1.0", ...headers } });
  let deltaHandler = null;
  let completedHandler = null;
  let ready = false;
  let closed = false;
  let lastCompleted = "";
  let settleReady;
  let failReady;
  const readyPromise = new Promise((resolve, reject) => {
    settleReady = resolve;
    failReady = reject;
  });
  const pendingCompletions = [];

  const handleMessage = (raw) => {
    let event;
    try { event = JSON.parse(String(raw)); }
    catch { return; }
    const type = String(event?.type || "");
    if (type === "error") {
      const error = dictationError("voice_stream_failed", event.error?.message || "OpenAI live transcription failed", 502);
      if (!ready) failReady(error);
      else pendingCompletions.splice(0).forEach((item) => item.reject(error));
      return;
    }
    if ((type === "session.updated" || type === "session.created" || type === "transcription_session.updated" || type === "transcription_session.created") && !ready) {
      ready = true;
      settleReady();
      return;
    }
    if (type === "conversation.item.input_audio_transcription.delta") {
      deltaHandler?.(String(event.delta || ""));
      return;
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      lastCompleted = String(event.transcript || "");
      completedHandler?.(lastCompleted);
      const waiter = pendingCompletions.shift();
      if (waiter) waiter.resolve(lastCompleted);
    }
  };

  socket.on("message", handleMessage);
  socket.once("error", (error) => {
    const failed = dictationError("voice_stream_failed", error?.message || "OpenAI live transcription failed", 502);
    if (!ready) failReady(failed);
  });
  socket.once("close", () => {
    closed = true;
    if (!ready) failReady(dictationError("voice_stream_failed", "OpenAI live transcription closed before it was ready", 502));
  });
  socket.once("open", () => {
    socket.send(JSON.stringify({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24_000 },
            transcription: { model, languages: ["en"], delay: "low" },
            turn_detection: null,
          },
        },
      },
    }));
  });

  const waitReady = Promise.race([
    readyPromise,
    new Promise((_, reject) => setTimeout(() => reject(dictationError("voice_stream_failed", "OpenAI live transcription did not become ready", 504)), openTimeoutMs)),
  ]);

  return waitReady.then(() => ({
    onDelta(handler) { deltaHandler = handler; },
    onCompleted(handler) { completedHandler = handler; },
    async append(pcm24) {
      if (closed || socket.readyState !== socket.OPEN) throw dictationError("voice_stream_failed", "OpenAI live transcription is not connected", 502);
      socket.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: Buffer.from(pcm24).toString("base64"),
      }));
    },
    async commit() {
      if (closed || socket.readyState !== socket.OPEN) return lastCompleted;
      const completed = new Promise((resolve, reject) => {
        pendingCompletions.push({ resolve, reject });
      });
      socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      return Promise.race([
        completed,
        new Promise((resolve) => setTimeout(() => resolve(lastCompleted), commitTimeoutMs)),
      ]);
    },
    close() {
      closed = true;
      try { socket.close(); } catch {}
    },
  }));
}

export function createTranscribeCppStreamAdapter(emit, limits = {}, openStream, diagnostics = null, streaming = {}) {
  let nativeStream = null;
  let closed = false;
  let inputClosed = false;
  let finalized = false;
  let feedError = null;
  let errorReported = false;
  let workerPromise = null;
  let lastText = "";
  let stableTextAvailable = false;
  let acceptedThroughSample = 0;
  let submittedThroughSample = 0;
  let processedThroughSample = null;
  let committedThroughSample = 0;
  let currentBufferedMs = null;
  let stopDrainStartedAt = null;
  const queue = [];
  let queuedSamples = 0;
  const options = streamOptions(streaming);
  const feedQuantumMs = TRANSCRIBE_CPP_FEED_QUANTUM_MS;
  const feedQuantumSamples = Math.round(feedQuantumMs * VOICE_SAMPLE_RATE / 1_000);
  const queueLimitMs = Number.isFinite(Number(limits.liveQueueLimitMs)) && Number(limits.liveQueueLimitMs) > 0
    ? Number(limits.liveQueueLimitMs)
    : TRANSCRIBE_CPP_LIVE_QUEUE_LIMIT_MS;
  const queueLimitSamples = Math.round(queueLimitMs * VOICE_SAMPLE_RATE / 1_000);
  const configuration = {
    family: options.family.kind,
    leftMs: options.family.leftMs ?? null,
    chunkMs: options.family.chunkMs ?? null,
    rightMs: options.family.rightMs ?? null,
    latencyMs: Number.isFinite(Number(streaming.latencyMs)) ? Number(streaming.latencyMs) : null,
    commitPolicy: options.commitPolicy,
    stablePrefixAgreementN: options.stablePrefixAgreementN ?? null,
    feedQuantumMs,
    feedQuantumSamples,
    queueLimitMs,
    queueLimitSamples,
  };

  const syncDiagnostics = () => {
    if (!diagnostics?.streaming) return;
    const target = diagnostics.streaming;
    const serverQueuedSamples = Math.max(0, acceptedThroughSample - submittedThroughSample);
    target.acceptedThroughSample = Math.max(target.acceptedThroughSample || 0, acceptedThroughSample);
    target.submittedThroughSample = Math.max(target.submittedThroughSample || 0, submittedThroughSample);
    if (processedThroughSample !== null) {
      target.processedThroughSample = Math.max(
        target.processedThroughSample || 0,
        Math.min(acceptedThroughSample, processedThroughSample),
      );
    }
    target.committedThroughSample = Math.max(target.committedThroughSample || 0, committedThroughSample);
    target.serverQueuedAudioMs = serverQueuedSamples / (VOICE_SAMPLE_RATE / 1_000);
    target.maxServerQueueMs = Math.max(target.maxServerQueueMs || 0, target.serverQueuedAudioMs);
    target.runtimeBufferedAudioMs = currentBufferedMs;
    target.totalInferenceLagMs = currentBufferedMs === null ? null : target.serverQueuedAudioMs + currentBufferedMs;
    target.maxNativeBufferMs = Math.max(target.maxNativeBufferMs || 0, currentBufferedMs || 0);
    target.maxBufferedMs = Math.max(target.maxBufferedMs || 0, currentBufferedMs || 0);
    target.meanAudioPerCallMs = target.feedCallCount
      ? target.feedSamples / target.feedCallCount / (VOICE_SAMPLE_RATE / 1_000)
      : 0;
    if (diagnostics.watermarks) {
      diagnostics.watermarks.acceptedThroughSample = Math.max(diagnostics.watermarks.acceptedThroughSample, acceptedThroughSample);
      diagnostics.watermarks.submittedThroughSample = Math.max(diagnostics.watermarks.submittedThroughSample, submittedThroughSample);
      if (processedThroughSample !== null) {
        diagnostics.watermarks.processedThroughSample = Math.max(
          diagnostics.watermarks.processedThroughSample || 0,
          Math.min(acceptedThroughSample, processedThroughSample),
        );
      }
      diagnostics.watermarks.committedThroughSample = Math.max(diagnostics.watermarks.committedThroughSample, committedThroughSample);
    }
  };

  const opened = Promise.resolve().then(async () => {
    if (typeof openStream !== "function") throw dictationError("voice_stream_unsupported", "The selected voice model does not expose stateful streaming", 409);
    nativeStream = await openStream(options);
    if (!nativeStream || typeof nativeStream.feed !== "function" || typeof nativeStream.finalize !== "function") {
      throw dictationError("voice_stream_invalid", "The selected voice model returned an invalid streaming session", 502);
    }
    if (diagnostics) {
      diagnostics.streaming.enabled = true;
      diagnostics.streaming.family = configuration.family;
      diagnostics.streaming.profile = { ...configuration };
      diagnostics.streaming.feedQuantumMs = feedQuantumMs;
      diagnostics.streaming.feedQuantumSamples = feedQuantumSamples;
      diagnostics.streaming.queueLimitMs = queueLimitMs;
    }
    syncDiagnostics();
    return nativeStream;
  });

  const reportError = (error, details = {}) => {
    if (errorReported) return;
    errorReported = true;
    emit({
      type: "error",
      code: error?.code || "voice_stream_failed",
      message: error?.message || "Stateful voice transcription failed",
      fallbackEligible: !stableTextAvailable,
      ...details,
    });
  };

  const updateCursors = (update, endSample) => {
    submittedThroughSample = Math.max(submittedThroughSample, endSample);
    const committedMs = Number(update?.audioCommittedMs);
    if (Number.isFinite(committedMs)) {
      committedThroughSample = Math.max(
        committedThroughSample,
        Math.min(acceptedThroughSample, Math.max(0, Math.round(committedMs * VOICE_SAMPLE_RATE / 1_000))),
      );
    }
    if (Number.isSafeInteger(update?.processedThroughSample) && update.processedThroughSample >= 0) {
      processedThroughSample = Math.max(processedThroughSample || 0, update.processedThroughSample);
    }
    currentBufferedMs = Number.isFinite(Number(update?.bufferedMs)) ? Number(update.bufferedMs) : null;
    syncDiagnostics();
  };

  const publish = (update, terminal = false) => {
    if (!nativeStream || closed) return "";
    const snapshot = nativeStream.text || {};
    const committed = String(snapshot.committed || "");
    const tentative = String(snapshot.tentative || "");
    const full = String(snapshot.full || `${committed}${tentative}`).trim();
    const revision = Number.isFinite(Number(update?.revision)) ? Number(update.revision) : null;
    stableTextAvailable ||= Boolean(committed.trim());
    if (diagnostics) {
      diagnostics.streaming.lastRevision = revision;
      diagnostics.streaming.revisionCount = Math.max(diagnostics.streaming.revisionCount, revision ?? 0);
      if (committed.trim() && diagnostics.streaming.firstCommittedAt === null) diagnostics.streaming.firstCommittedAt = performance.now();
      if (tentative.trim() && diagnostics.streaming.firstTentativeAt === null) diagnostics.streaming.firstTentativeAt = performance.now();
    }
    if (full !== lastText || terminal) {
      emit({
        type: terminal ? "final" : "partial",
        text: full,
        stableText: committed.trim(),
        tentativeText: tentative.trim(),
        revision,
        audioCommittedMs: Number.isFinite(Number(update?.audioCommittedMs)) ? Number(update.audioCommittedMs) : null,
        bufferedMs: Number.isFinite(Number(update?.bufferedMs)) ? Number(update.bufferedMs) : null,
      });
      lastText = full;
    }
    return full;
  };

  const takeFeedQuantum = (flush) => {
    if (!queuedSamples || (!flush && queuedSamples < feedQuantumSamples)) return null;
    const targetSamples = queuedSamples >= feedQuantumSamples ? feedQuantumSamples : queuedSamples;
    const parts = [];
    let remaining = targetSamples;
    let startSample = null;
    while (remaining > 0 && queue.length) {
      const entry = queue[0];
      const availableSamples = Math.floor(entry.buffer.length / 2) - entry.offsetSamples;
      const takeSamples = Math.min(remaining, availableSamples);
      if (startSample === null) startSample = entry.startSample + entry.offsetSamples;
      parts.push(entry.buffer.subarray(entry.offsetSamples * 2, (entry.offsetSamples + takeSamples) * 2));
      entry.offsetSamples += takeSamples;
      remaining -= takeSamples;
      queuedSamples -= takeSamples;
      if (entry.offsetSamples >= Math.floor(entry.buffer.length / 2)) queue.shift();
    }
    if (remaining > 0 || startSample === null) return null;
    return {
      pcm: parts.length === 1 ? parts[0] : Buffer.concat(parts, targetSamples * 2),
      startSample,
      endSample: startSample + targetSamples,
    };
  };

  const overflow = () => {
    const queuedMs = Math.max(0, acceptedThroughSample - submittedThroughSample) / (VOICE_SAMPLE_RATE / 1_000);
    const error = dictationError("live_queue_overflow", "Live voice transcription fell behind capture", 503);
    inputClosed = true;
    closed = true;
    feedError = error;
    queue.length = 0;
    queuedSamples = 0;
    if (diagnostics) {
      diagnostics.streaming.overflow = {
        code: "live_queue_overflow",
        queuedMs,
        acceptedThroughSample,
        submittedThroughSample,
        stableText: stableTextAvailable,
      };
    }
    try { nativeStream?.reset?.(); }
    catch (resetError) { reportError(resetError); }
    reportError(error, { queueMs: queuedMs });
  };

  const enqueue = (data) => {
    if (closed || inputClosed || feedError) return;
    const copy = Buffer.from(data);
    const sampleCount = Math.floor(copy.length / 2);
    if (!sampleCount) return;
    const startSample = acceptedThroughSample;
    acceptedThroughSample += sampleCount;
    const queuedMs = Math.max(0, acceptedThroughSample - submittedThroughSample) / (VOICE_SAMPLE_RATE / 1_000);
    if (queuedMs > queueLimitMs) {
      syncDiagnostics();
      overflow();
      return;
    }
    queue.push({ buffer: copy, offsetSamples: 0, startSample });
    queuedSamples += sampleCount;
    syncDiagnostics();
    scheduleWorker();
  };

  const runWorker = async () => {
    await opened;
    while (!closed && !feedError) {
      const item = takeFeedQuantum(inputClosed);
      if (!item) break;
      const stream = nativeStream;
      if (!stream) break;
      if (diagnostics) {
        markInferenceQueued(diagnostics);
        markInferenceStart(diagnostics);
      }
      const update = await stream.feed(pcmFloat32(item.pcm));
      if (closed || feedError || stream !== nativeStream) break;
      submittedThroughSample = Math.max(submittedThroughSample, item.endSample);
      if (diagnostics) {
        diagnostics.streaming.feedCount += 1;
        diagnostics.streaming.feedCallCount += 1;
        diagnostics.streaming.feedSamples += item.endSample - item.startSample;
      }
      updateCursors(update, item.endSample);
      publish(update);
    }
    syncDiagnostics();
  };

  function scheduleWorker() {
    if (workerPromise || closed || feedError) return workerPromise;
    workerPromise = runWorker().catch((error) => {
      feedError ||= error;
      inputClosed = true;
      reportError(error);
    }).finally(() => {
      workerPromise = null;
      if (!closed && !feedError && (inputClosed ? queuedSamples > 0 : queuedSamples >= feedQuantumSamples)) scheduleWorker();
    });
    return workerPromise;
  }

  return {
    opened,
    write(data) { enqueue(data); },
    async stop() {
      await opened;
      if (closed || finalized) return;
      inputClosed = true;
      stopDrainStartedAt = performance.now();
      while (!closed && !feedError) {
        scheduleWorker();
        const activeWorker = workerPromise;
        if (activeWorker) await activeWorker;
        if (!workerPromise && queuedSamples === 0) break;
      }
      if (feedError) throw feedError;
      if (closed || !nativeStream) return;
      if (diagnostics) {
        diagnostics.streaming.stopDrainMs = Math.max(0, performance.now() - stopDrainStartedAt);
        markInferenceQueued(diagnostics);
        markInferenceStart(diagnostics);
      }
      const stream = nativeStream;
      const update = await stream.finalize();
      if (stream !== nativeStream || closed) return;
      finalized = true;
      updateCursors(update, acceptedThroughSample);
      if (diagnostics) markInferenceComplete(diagnostics);
      const text = publish(update, true);
      emit({ type: "adapter_closed", final: Boolean(text), text, stableText: String(stream.text?.committed || "").trim(), tentativeText: "" });
    },
    close() {
      if (closed && !nativeStream) return;
      closed = true;
      inputClosed = true;
      queue.length = 0;
      queuedSamples = 0;
      try { nativeStream?.reset?.(); }
      catch (error) { reportError(error); }
      nativeStream = null;
      syncDiagnostics();
    },
  };
}

export function createDeepgramAdapter(config, emit, limits, fetchImpl, diagnostics = null, options = {}) {
  return createSnapshotAdapter(emit, limits, async (pcm) => {
    const endpoint = new URL(config.endpoint);
    endpoint.searchParams.set("model", config.model || "nova-3");
    endpoint.searchParams.set("smart_format", "true");
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "User-Agent": "ConduitVoice/1.0", ...config.headers, "Content-Type": "audio/wav" },
      body: wavBlob([pcm], pcm.length),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (!response.ok) throw dictationError("asr_request_failed", `Deepgram returned ${response.status}`, 502);
    const result = await response.json();
    return result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
  }, diagnostics, { progressive: false, useSegmentation: false, ...options });
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
    const lease = typeof voiceRuntime.acquireLease === "function"
      ? voiceRuntime.acquireLease()
      : (voiceRuntime.pin?.(), null);
    const releaseRuntimeLease = typeof lease === "function"
      ? lease
      : typeof lease?.release === "function"
        ? () => lease.release()
        : () => voiceRuntime.unpin?.();
    const sessionId = randomUUID();
    const transcriptTruth = createTranscriptTruth(sessionId);
    const sessionController = new AbortController();
    let operationSequence = 0;
    const nextOperationId = (kind) => `${sessionId}:${kind}:${++operationSequence}`;
    let adapter = null;
    let adapterReady = false;
    let pendingStreamChunks = [];
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
    let fallbackLiveToBatch = null;
    let liveFallbackPromise = null;
    let segmentationProvider = null;
    const SHORT_FAILURE_AUDIO_BYTES = 1;
    const diagnostics = createServerDiagnostics();
    const noteWatermark = (name, value) => {
      const sampleCount = Math.floor(audioBytes / 2);
      const safeValue = Math.max(0, Math.min(sampleCount, samplePosition(value)));
      diagnostics.watermarks[name] = Math.max(diagnostics.watermarks[name] || 0, safeValue);
      if (name === "submittedThroughSample") transcriptTruth.noteSubmitted(safeValue);
      if (name === "processedThroughSample") transcriptTruth.noteProcessed(safeValue);
    };
    const watermarkHooks = {
      onSubmitted: ({ endSample }) => noteWatermark("submittedThroughSample", endSample),
      onProcessed: ({ endSample }) => noteWatermark("processedThroughSample", endSample),
    };
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
      modelId: null,
      artifactId: null,
      runtimeId: null,
      backendPathId: null,
      resolvedProfileId: null,
      execution: null,
      segmentation: null,
      fallback: null,
      requestedComputeBackend: null,
      actualComputeBackend: null,
      loadedRuntimeVersion: null,
      progressiveBatch: false,
      streamFallback: null,
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
      if (!sessionController.signal.aborted) sessionController.abort();
      releaseRuntimeLease();
    };
    const diagnosticsPayload = () => ({
      client: diagnostics.client,
      server: serializeServerDiagnostics(diagnostics),
    });
    const setAuthoritativeVadAnalysis = (observation) => {
      const sampleCount = Math.floor(audioBytes / 2);
      const selection = selectSileroVadRanges(observation, sampleCount, { maxSegments: limits.maxSegments });
      const source = observation?.type === "heuristic_segmentation_observation" ? "heuristic" : "silero_authoritative";
      const metadata = segmentationObservationMetadata(observation);
      diagnostics.analysis = authoritativeAnalysis(selection, sampleCount, source);
      diagnostics.segmentation = {
        provider: source === "heuristic" ? "heuristic" : "silero",
        calibrationVersion: observation?.policy?.calibrationVersion || null,
        state: observation?.available === true ? "ready" : observation?.status || "unavailable",
        status: metadata.status,
        frameCount: metadata.frameCount,
        regionCount: metadata.regionCount,
      };
      return selection;
    };
    const publishProgressiveResults = () => {
      while (progressiveResults.has(progressiveNextPublish) || progressiveFailures.has(progressiveNextPublish)) {
        const sequence = progressiveNextPublish;
        const result = progressiveResults.get(sequence);
        if (result?.text) {
          const mergedText = appendProgressiveSegment(progressiveText, result.text, result.range.overlapSamples);
          const previousText = progressiveText.trim();
          const segmentText = previousText && mergedText.startsWith(previousText)
            ? mergedText.slice(previousText.length).trim()
            : result.text;
          const fromSample = Math.max(transcriptTruth.snapshot().committedThroughSample, result.range.startSample);
          transcriptTruth.acceptStableSegment({
            segmentId: `${sessionId}:segment:${sequence}`,
            sequence,
            text: segmentText,
            fromSample,
            throughSample: result.range.endSample,
          });
          progressiveText = transcriptTruth.stableText();
          diagnostics.watermarks.committedThroughSample = Math.max(diagnostics.watermarks.committedThroughSample, result.range.endSample);
          emit({
            type: "final",
            text: progressiveText,
            segment: {
              segmentId: `${sessionId}:segment:${sequence}`,
              sequence,
              startSample: result.range.startSample,
              endSample: result.range.endSample,
            },
            stableSegment: true,
            _truthApplied: true,
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
      if ((progressiveVadError || observation?.available !== true) && segmentationProvider?.observe) {
        diagnostics.progressive.fallback = true;
        await progressiveInferenceTail;
        progressiveEnabled = false;
        runtimeMetadata.progressiveBatch = false;
        progressiveTailRange = null;
        diagnostics.progressive.heldTailRegions = 0;
        observation = await segmentationProvider.observe(freezeAcceptedPcm());
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
      if (config?.mode !== "local" || config?.execution === "stop" || config?.inferenceMode !== "batch" || typeof next?.transcribeRange !== "function") return;
      let provider = segmentationProvider;
      if ((!provider || provider.mode === "none") && typeof voiceRuntime.beginVoiceActivity === "function") {
        provider = createSegmentationProvider({
          mode: "silero",
          silero: {
            observe: (pcm) => voiceRuntime.observeVoiceActivity(pcm),
            createStream: () => voiceRuntime.beginVoiceActivity(),
          },
        });
        segmentationProvider = provider;
      }
      if (!provider?.createStream) return;
      let stream;
      try { stream = provider.createStream(); }
      catch (error) {
        diagnostics.progressive.vadError = error?.message || "Progressive VAD could not start";
        return;
      }
      if (!stream) return;
      progressiveVad = stream;
      progressiveEnabled = true;
      diagnostics.segmentation.provider = provider.mode;
      diagnostics.segmentation.calibrationVersion = provider.policy?.calibrationVersion || null;
      diagnostics.segmentation.state = "ready";
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
      diagnostics.watermarks.archiveOwnedThroughSample = Math.max(diagnostics.watermarks.archiveOwnedThroughSample, Math.floor(audioBytes / 2));
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
        if (!segmentationProvider || segmentationProvider.mode === "none") {
          diagnostics.segmentation = { provider: "none", calibrationVersion: null, state: "not_configured" };
          diagnostics.vadObservation = null;
          return null;
        }
        if (typeof segmentationProvider.observe !== "function") {
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
        const observation = await segmentationProvider.observe(pcm);
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
      let sessionFinal;
      try {
        sessionFinal = transcriptTruth.acceptSessionFinal({
          text: upstream.text || finalText,
          committedThroughSample: Math.floor(audioBytes / 2),
        });
      } catch (error) {
        fail(error);
        return;
      }
      completed = true;
      const completedAt = Date.now();
      diagnostics.sessionFinalAt ||= performance.now();
      cleanup();
      const transcript = sessionFinal.text;
      finalText = transcript;
      noteWatermark("committedThroughSample", sessionFinal.committedThroughSample);
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
      send(sessionFinal);
      send({
        type: "completed",
        text: transcript,
        final: upstream.final ?? (hasFinal || Boolean(transcript)),
        reason,
        settlementMs: stoppedAt ? completedAt - stoppedAt : null,
        finalWithinDeadline: Boolean((hasFinal || transcript) && stoppedAt && !deadlinePassed),
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
      diagnostics.streaming.acceptedThroughSample = Math.max(diagnostics.streaming.acceptedThroughSample, Math.floor(audioBytes / 2));
      diagnostics.watermarks.acceptedThroughSample = Math.floor(audioBytes / 2);
      const receivedAt = performance.now();
      if (diagnostics.firstServerPcmAt === null) diagnostics.firstServerPcmAt = receivedAt;
      diagnostics.lastServerPcmAt = receivedAt;
      diagnostics.transport.packetCount += 1;
      diagnostics.transport.pcmBytes = audioBytes;
      addPcmSignal(diagnostics.signal, chunk);
      if (adapterReady && adapter) adapter.write(chunk);
      else pendingStreamChunks.push(chunk);
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
          if (liveFallbackPromise) await liveFallbackPromise;
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
            mode: diagnostics.analysis?.source === "heuristic"
              ? "heuristic"
              : diagnostics.analysis?.source === "silero_authoritative"
                ? "silero_authoritative"
                : "external_policy",
            segments: diagnostics.analysis?.segments || [],
            analysis: diagnostics.analysis,
            policy: diagnostics.analysis?.policy || null,
          };
          try {
            await current.stop({
              segmentation,
              progressive: progressiveEnabled,
              text: progressiveText,
            });
          } catch (error) {
            if (!liveFallbackPromise) throw error;
            await liveFallbackPromise;
            if (!completed && adapter && adapter !== current) {
              await adapter.stop({
                segmentation,
                progressive: progressiveEnabled,
                text: progressiveText,
              });
            }
          }
        } catch (error) { fail(error); }
      })();
    };
    const emit = (event) => {
      if (completed) return;
      // Session already advertised readiness so the browser can stream PCM while
      // the local model cold-starts; ignore the adapter's own ready event.
      if (event.type === "ready") return;
      try {
        const hasRuntimeRevision = Number.isFinite(Number(event.revision));
        const hasRuntimeSnapshot = typeof event.stableText === "string" || typeof event.tentativeText === "string";
        const applyRuntimeSnapshot = () => {
          if (!hasRuntimeSnapshot) return transcriptTruth.snapshot();
          const throughSample = Number.isFinite(Number(event.throughSample))
            ? Number(event.throughSample)
            : Number.isFinite(Number(event.audioCommittedMs))
              ? Math.round(Number(event.audioCommittedMs) * VOICE_SAMPLE_RATE / 1_000)
              : transcriptTruth.snapshot().committedThroughSample;
          const snapshot = transcriptTruth.acceptRuntimeSnapshot({
            regionId: event.regionId || `${sessionId}:tentative:0`,
            revision: hasRuntimeRevision ? Number(event.revision) : diagnostics.streaming.revisionCount + 1,
            stableText: event.stableText || "",
            tentativeText: event.tentativeText || "",
            fromSample: event.fromSample ?? transcriptTruth.snapshot().committedThroughSample,
            throughSample,
          });
          if (Number.isFinite(Number(event.audioCommittedMs))) {
            noteWatermark("committedThroughSample", throughSample);
          }
          return snapshot;
        };
        if (event.type === "partial") {
          const snapshot = applyRuntimeSnapshot();
          const text = hasRuntimeSnapshot ? snapshot.text : String(event.text || "");
          if (text.trim()) {
            transcriptObserved = true;
            diagnostics.firstPartialAt ||= performance.now();
            diagnostics.firstUsableTextAt ||= performance.now();
          }
          send({
            type: "partial",
            text,
            ...(hasRuntimeSnapshot ? { stableText: snapshot.stableText, tentativeText: snapshot.tentativeText, regionId: event.regionId || `${sessionId}:tentative:0` } : {}),
            ...(Number.isFinite(Number(event.revision)) ? { revision: Number(event.revision) } : {}),
            ...(Number.isFinite(event.audioCommittedMs) ? { audioCommittedMs: Number(event.audioCommittedMs) } : {}),
            ...(Number.isFinite(event.bufferedMs) ? { bufferedMs: Number(event.bufferedMs) } : {}),
          });
        } else if (event.type === "final") {
          let snapshot;
          if (event._truthApplied) snapshot = transcriptTruth.snapshot();
          else if (hasRuntimeSnapshot) snapshot = applyRuntimeSnapshot();
          else {
            const candidate = String(event.text || "").trim();
            const final = transcriptTruth.acceptSessionFinal({ text: candidate, committedThroughSample: Math.floor(audioBytes / 2) });
            snapshot = transcriptTruth.snapshot();
            noteWatermark("committedThroughSample", final.committedThroughSample);
          }
          finalText = snapshot.text;
          if (finalText.trim()) {
            transcriptObserved = true;
            diagnostics.firstSegmentFinalAt ||= performance.now();
            diagnostics.firstUsableTextAt ||= performance.now();
          }
          hasFinal = true;
          send({
            type: "final",
            text: finalText,
            ...(event.segment ? { segment: event.segment } : {}),
            stableText: snapshot.stableText,
            tentativeText: snapshot.tentativeText,
            ...(Number.isFinite(Number(event.revision)) ? { revision: Number(event.revision) } : {}),
            ...(Number.isFinite(event.audioCommittedMs) ? { audioCommittedMs: Number(event.audioCommittedMs) } : {}),
            ...(Number.isFinite(event.bufferedMs) ? { bufferedMs: Number(event.bufferedMs) } : {}),
          });
          // Completion waits for adapter_closed: segmented transcriptions emit
          // one final per utterance, so completing on the first final would drop
          // every later segment.
        } else if (event.type === "adapter_closed") complete(stopping ? stopReason || "stopped" : "upstream_closed", event);
        else if (event.type === "error") {
          const truth = transcriptTruth.snapshot();
          const exactStableCheckpoint = truth.stableSegments.some((segment) => segment.throughSample === truth.committedThroughSample && segment.throughSample > 0);
          if (fallbackLiveToBatch && (event.fallbackEligible || exactStableCheckpoint)) void fallbackLiveToBatch(event).catch(() => {});
          else fail(dictationError(event.code || "asr_error", event.message || "Voice dictation failed", 502));
        } else send(event);
      } catch (error) {
        fail(error);
      }
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
        modelId: typeof config.modelId === "string" ? config.modelId : null,
        artifactId: typeof config.artifactId === "string" ? config.artifactId : null,
        runtimeId: typeof config.runtimeId === "string" ? config.runtimeId : null,
        backendPathId: typeof config.backendPathId === "string" ? config.backendPathId : null,
        resolvedProfileId: typeof config.resolvedProfileId === "string" ? config.resolvedProfileId : null,
        execution: typeof config.execution === "string" ? config.execution : null,
        segmentation: typeof config.segmentation === "string" ? config.segmentation : null,
        fallback: config.fallback && typeof config.fallback === "object" ? config.fallback : null,
        requestedComputeBackend: typeof config.requestedComputeBackend === "string" ? config.requestedComputeBackend : null,
        actualComputeBackend: typeof config.actualComputeBackend === "string" ? config.actualComputeBackend : config.computeBackend || null,
        loadedRuntimeVersion: typeof config.loadedRuntimeVersion === "string" ? config.loadedRuntimeVersion : null,
        progressiveBatch: false,
        streamFallback: null,
      };
      const segmentationMode = config.segmentation === "heuristic"
        ? "heuristic"
        : config.segmentation === "none"
          ? "none"
          : "silero";
      segmentationProvider = createSegmentationProvider({
        mode: segmentationMode,
        silero: {
          ...(typeof voiceRuntime.observeVoiceActivity === "function" ? { observe: (pcm) => voiceRuntime.observeVoiceActivity(pcm) } : {}),
          ...(typeof voiceRuntime.beginVoiceActivity === "function" ? { createStream: () => voiceRuntime.beginVoiceActivity() } : {}),
        },
        heuristicPolicy: config.heuristicPolicy || config.segmentationPolicy || {},
      });
      diagnostics.segmentation = {
        provider: segmentationProvider.mode,
        calibrationVersion: segmentationProvider.policy?.calibrationVersion || null,
        state: segmentationProvider.mode === "none" ? "not_configured" : "ready",
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
        modelId: runtimeMetadata.modelId,
        artifactId: runtimeMetadata.artifactId,
        runtimeId: runtimeMetadata.runtimeId,
        backendPathId: runtimeMetadata.backendPathId,
        resolvedProfileId: runtimeMetadata.resolvedProfileId,
        execution: runtimeMetadata.execution,
        segmentation: runtimeMetadata.segmentation,
        fallback: runtimeMetadata.fallback,
        requestedComputeBackend: runtimeMetadata.requestedComputeBackend,
        actualComputeBackend: runtimeMetadata.actualComputeBackend,
        loadedRuntimeVersion: runtimeMetadata.loadedRuntimeVersion,
        streamFallback: runtimeMetadata.streamFallback,
      };
      const updateRuntimeDiagnostics = () => {
        diagnostics.runtime = {
          mode: runtimeMetadata.mode,
          inferenceMode: runtimeMetadata.inferenceMode,
          model: runtimeMetadata.model,
          precision: runtimeMetadata.precision,
          backend: runtimeMetadata.backend,
          computeBackend: runtimeMetadata.computeBackend,
          capabilities: runtimeMetadata.capabilities,
          native: runtimeMetadata.native,
          modelId: runtimeMetadata.modelId,
          artifactId: runtimeMetadata.artifactId,
          runtimeId: runtimeMetadata.runtimeId,
          backendPathId: runtimeMetadata.backendPathId,
          resolvedProfileId: runtimeMetadata.resolvedProfileId,
          execution: runtimeMetadata.execution,
          segmentation: runtimeMetadata.segmentation,
          fallback: runtimeMetadata.fallback,
          requestedComputeBackend: runtimeMetadata.requestedComputeBackend,
          actualComputeBackend: runtimeMetadata.actualComputeBackend,
          loadedRuntimeVersion: runtimeMetadata.loadedRuntimeVersion,
          streamFallback: runtimeMetadata.streamFallback,
        };
      };
      let next;
      if (config.adapter === "transcribe_cpp_stream_v1") {
        next = createTranscribeCppStreamAdapter(emit, limits, config.stream, diagnostics, config.streaming || config.capabilities?.streaming || {});
        try {
          await next.opened;
        } catch (error) {
          next.close();
          const sourceProfile = {
            profileId: runtimeMetadata.resolvedProfileId,
            adapter: runtimeMetadata.adapter,
            model: runtimeMetadata.model,
            runtimeId: runtimeMetadata.runtimeId,
            backendPathId: runtimeMetadata.backendPathId,
          };
          const fallbackProfileId = runtimeMetadata.fallback?.profileId || null;
          if (typeof config.transcribe !== "function") throw error;
          runtimeMetadata = {
            ...runtimeMetadata,
            adapter: "transcribe_cpp_batch_fallback_v1",
            inferenceMode: "batch",
            capabilities: {
              ...(runtimeMetadata.capabilities || {}),
              inferenceMode: "batch",
              partials: false,
              streaming: null,
              fallback: "wp5_progressive_batch",
            },
            streamFallback: {
              from: "transcribe_cpp_stream_v1",
              reason: error?.code || "voice_stream_open_failed",
              replay: "from_zero",
              replaySample: 0,
              discardedTentativeRevisions: [],
              stableCheckpoint: 0,
              overlapSamples: 0,
              duplicateBoundaryHandling: "none",
              sourceProfile,
              fallbackProfile: fallbackProfileId,
              completingProfile: fallbackProfileId,
            },
          };
          diagnostics.streaming.fallback = runtimeMetadata.streamFallback;
          updateRuntimeDiagnostics();
          next = createSnapshotAdapter(emit, limits, config.transcribe, diagnostics, { signal: sessionController.signal, sessionId, nextOperationId, watermarks: watermarkHooks });
        }
      } else if (config.adapter === OPENAI_LIVE_ADAPTER) {
        next = createOpenaiRealtimeStreamAdapter(emit, limits, config.stream, diagnostics, { watermarks: watermarkHooks });
        await next.opened;
      } else if (config.adapter === "deepgram_audio_v1") {
        next = createDeepgramAdapter(config, emit, limits, fetchImpl, diagnostics, { signal: sessionController.signal, sessionId, nextOperationId, watermarks: watermarkHooks });
      } else if (config.adapter === "transcribe_cpp_batch_v1") {
        next = createSnapshotAdapter(emit, limits, config.transcribe, diagnostics, { progressive: false, useSegmentation: false, signal: sessionController.signal, sessionId, nextOperationId, watermarks: watermarkHooks });
      } else if (config.adapter === "managed_transformers_v1") {
        next = createSnapshotAdapter(emit, limits, config.transcribe, diagnostics, {
          progressive: config.execution !== "stop",
          useSegmentation: config.execution !== "stop",
          signal: sessionController.signal,
          sessionId,
          nextOperationId,
          watermarks: watermarkHooks,
        });
      } else if (config.adapter === "managed_parakeet_loopback_v1") {
        next = createSnapshotAdapter(emit, limits, config.transcribe, diagnostics, { progressive: false, useSegmentation: false, signal: sessionController.signal, sessionId, nextOperationId, watermarks: watermarkHooks });
      } else if (config.adapter === "transcribe_rs_batch_v1") {
        const progressive = config.execution !== "stop";
        next = createSnapshotAdapter(emit, limits, config.transcribe, diagnostics, {
          progressive,
          useSegmentation: progressive,
          signal: sessionController.signal,
          sessionId,
          nextOperationId,
          watermarks: watermarkHooks,
        });
      } else {
        next = createHttpAdapter(config, emit, limits, fetchImpl, diagnostics, { signal: sessionController.signal, watermarks: watermarkHooks });
      }
      if (config.adapter === "transcribe_cpp_stream_v1" && typeof config.transcribe === "function" && runtimeMetadata.adapter === "transcribe_cpp_stream_v1") {
        const startLiveFallback = async (event) => {
          if (completed || runtimeMetadata.adapter !== "transcribe_cpp_stream_v1") return;
          const truthBeforeFallback = transcriptTruth.snapshot();
          const stableCheckpoint = truthBeforeFallback.committedThroughSample;
          const stableSegment = truthBeforeFallback.stableSegments.at(-1) || null;
          const hasStableCheckpoint = Boolean(stableSegment && stableCheckpoint > 0 && stableSegment.throughSample === stableCheckpoint);
          const overlapSamples = hasStableCheckpoint ? Math.min(1_600, stableCheckpoint) : 0;
          const replaySample = hasStableCheckpoint ? stableCheckpoint - overlapSamples : 0;
          const sourceProfile = {
            profileId: runtimeMetadata.resolvedProfileId,
            adapter: runtimeMetadata.adapter,
            model: runtimeMetadata.model,
            runtimeId: runtimeMetadata.runtimeId,
            backendPathId: runtimeMetadata.backendPathId,
          };
          const fallbackProfileId = runtimeMetadata.fallback?.profileId || null;
          const fallbackEmit = (fallbackEvent) => {
            if (!hasStableCheckpoint || !["final", "adapter_closed"].includes(fallbackEvent.type)) {
              emit(fallbackEvent);
              return;
            }
            const suffix = String(fallbackEvent.text || "").trim();
            const text = suffix
              ? appendProgressiveSegment(truthBeforeFallback.stableText, suffix, overlapSamples)
              : truthBeforeFallback.stableText;
            emit({
              ...fallbackEvent,
              text,
              stableText: truthBeforeFallback.stableText,
              tentativeText: "",
            });
          };
          const previous = adapter;
          const discardedTentative = transcriptTruth.discardTentative();
          previous?.close();
          adapter = null;
          adapterReady = false;
          pendingStreamChunks = [];
          runtimeMetadata = {
            ...runtimeMetadata,
            adapter: "transcribe_cpp_batch_fallback_v1",
            inferenceMode: "batch",
            capabilities: {
              ...(runtimeMetadata.capabilities || {}),
              inferenceMode: "batch",
              partials: false,
              streaming: null,
              fallback: hasStableCheckpoint ? "wp9_checkpoint_batch" : "wp5_progressive_batch",
            },
            streamFallback: {
              from: "transcribe_cpp_stream_v1",
              reason: event.code || "voice_stream_failed",
              replay: hasStableCheckpoint ? "from_committed_sample" : "from_zero",
              replaySample,
              discardedTentativeRevisions: discardedTentative.revisions,
              stableCheckpoint,
              overlapSamples,
              duplicateBoundaryHandling: hasStableCheckpoint ? "stable_prefix_preserved" : "none",
              sourceProfile,
              fallbackProfile: fallbackProfileId,
              completingProfile: fallbackProfileId,
            },
          };
          diagnostics.streaming.fallback = runtimeMetadata.streamFallback;
          updateRuntimeDiagnostics();
          const fallbackAdapter = createSnapshotAdapter(
            fallbackEmit,
            limits,
            config.transcribe,
            diagnostics,
            {
              progressive: !hasStableCheckpoint,
              useSegmentation: !hasStableCheckpoint,
              signal: sessionController.signal,
              sessionId,
              nextOperationId,
              watermarks: watermarkHooks,
              sampleOffset: replaySample,
            },
          );
          await fallbackAdapter.opened;
          if (completed) {
            fallbackAdapter.close();
            return;
          }
          adapter = fallbackAdapter;
          if (pcmAccumulator.byteLength > replaySample * 2) {
            adapter.write(pcmAccumulator.view().subarray(replaySample * 2));
          }
          adapterReady = true;
          activateProgressiveBatch({ ...config, inferenceMode: "batch", execution: hasStableCheckpoint ? "stop" : config.execution }, fallbackAdapter);
          send({
            type: "stream_fallback",
            from: "transcribe_cpp_stream_v1",
            to: "transcribe_cpp_batch_fallback_v1",
            reason: event.code || "voice_stream_failed",
            replay: hasStableCheckpoint ? "from_committed_sample" : "from_zero",
            replaySample,
            discardedTentativeRevisions: discardedTentative.revisions,
            stableCheckpoint,
            overlapSamples,
            duplicateBoundaryHandling: hasStableCheckpoint ? "stable_prefix_preserved" : "none",
            sourceProfile,
            fallbackProfile: fallbackProfileId,
            completingProfile: fallbackProfileId,
            ...runtimeMetadata,
          });
        };
        fallbackLiveToBatch = (event) => {
          if (!liveFallbackPromise) {
            liveFallbackPromise = startLiveFallback(event).catch((error) => {
              if (!completed) fail(error);
              throw error;
            });
          }
          return liveFallbackPromise;
        };
      }
      await next.opened;
      if (completed) {
        next.close();
        settleAdapter(null);
        return;
      }
      adapter = next;
      if (runtimeMetadata.adapter === "transcribe_cpp_stream_v1" || runtimeMetadata.adapter === OPENAI_LIVE_ADAPTER) {
        for (const chunk of pendingStreamChunks) adapter.write(chunk);
      } else if (pcmAccumulator.byteLength > 0) {
        adapter.write(pcmAccumulator.view());
      }
      pendingStreamChunks = [];
      adapterReady = true;
      activateProgressiveBatch(
        runtimeMetadata.adapter === "transcribe_cpp_batch_fallback_v1"
          ? { ...config, inferenceMode: "batch" }
          : config,
        next,
      );
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
    });
  });
  return { handleUpgrade, activeSessions: () => activeSessions };
}
