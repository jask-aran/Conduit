import type { VoiceCaptureProfile } from "./voice-audio";

interface PcmDiagnosticsMessage {
  sampleCount?: number;
  rms?: number;
  peak?: number;
  rawRms?: number;
  rawPeak?: number;
  rawSampleCount?: number;
  rawClipped?: boolean;
  rawClippedSamples?: number;
  clipped?: boolean;
  clippedSamples?: number;
  gain?: number;
  resampler?: { method?: string; inputSampleRate?: number; outputSampleRate?: number };
}

interface SignalAccumulator {
  sumSquares: number;
  sampleCount: number;
  peak: number;
  clippedSamples: number;
}

interface SignalSummary {
  rms: number;
  peak: number;
  clipping: boolean;
  clippedSamples: number;
  bands: null;
}

export interface VoiceDictationClientDiagnostics {
  schemaVersion: 5;
  clock: "performance.now";
  events: {
    shortcutAcceptedMs: number;
    digitalSilenceCount: number;
    microphoneRequestStartMs: number | null;
    microphoneRequestResolvedMs: number | null;
    workletConnectedMs: number | null;
    firstWorkletPcmMs: number | null;
    firstWebSocketSendMs: number | null;
    stopRequestedMs: number | null;
    finalEventMs: number | null;
  };
  durations: {
    captureStartupMs: number | null;
    microphoneRequestMs: number | null;
    workletSetupMs: number | null;
    transportStartupMs: number | null;
    captureDurationMs: number | null;
    stopToFinalMs: number | null;
  };
  transport: {
    packetCount: number;
    pcmBytes: number;
    maxWebSocketBufferedBytes: number;
  };
  capture: {
    microphoneReused: boolean;
    profile: VoiceCaptureProfile;
    sourceSampleRate: number | null;
    processingSampleRate: number | null;
    requestedConstraints: Record<string, unknown>;
    effectiveTrackSettings: Record<string, unknown>;
    resampler: {
      method: string | null;
      inputSampleRate: number | null;
      outputSampleRate: number;
    };
    preProcessing: SignalSummary;
    postProcessing: SignalSummary;
    workletGain: {
      current: number | null;
      minimum: number | null;
      maximum: number | null;
    };
  };
}

export interface VoiceDictationDiagnostics {
  requestStarted(constraints: unknown, profile: VoiceCaptureProfile): void;
  microphoneReused(): void;
  requestResolved(): void;
  captureSettings(settings: unknown, contextSampleRate: number): void;
  workletConnected(): void;
  pcm(message: PcmDiagnosticsMessage, bufferBytes: number): void;
  digitalSilence(): void;
  audioSent(bufferedBytes: number, pcmBytes: number): void;
  captureStopped(): void;
  stopRequested(): void;
  stopFrame(): VoiceDictationClientDiagnostics;
  completed(): VoiceDictationClientDiagnostics;
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function redactedSettings(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  try {
    const encoded = JSON.stringify(value, (key, child) => key === "deviceId" || key === "groupId" ? "[redacted]" : child);
    const result = encoded && encoded.length <= 4096 ? JSON.parse(encoded) : null;
    return result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function addSignal(accumulator: SignalAccumulator, rms: unknown, peak: unknown, sampleCount: unknown, clipped: unknown, clippedSamples: unknown) {
  const count = Math.max(0, Math.round(numberOrNull(sampleCount) ?? 0));
  const level = Math.max(0, numberOrNull(rms) ?? 0);
  const maximum = Math.max(0, numberOrNull(peak) ?? 0);
  accumulator.sumSquares += level * level * count;
  accumulator.sampleCount += count;
  accumulator.peak = Math.max(accumulator.peak, maximum);
  accumulator.clippedSamples += Math.max(0, Math.round(numberOrNull(clippedSamples) ?? (clipped === true || maximum >= 1 ? 1 : 0)));
}

function elapsed(start: number | null, end: number | null) {
  if (start === null || end === null) return null;
  return Math.max(0, Math.round(end - start));
}

function relativeTo(origin: number, value: number | null) {
  if (value === null) return null;
  return Math.max(0, Math.round(value - origin));
}

function signalSummary(accumulator: SignalAccumulator): SignalSummary {
  return {
    rms: accumulator.sampleCount ? Math.sqrt(accumulator.sumSquares / accumulator.sampleCount) : 0,
    peak: accumulator.peak,
    clipping: accumulator.clippedSamples > 0,
    clippedSamples: accumulator.clippedSamples,
    bands: null,
  };
}

export function createVoiceDictationDiagnostics(shortcutAcceptedAt: number): VoiceDictationDiagnostics {
  let requestStart: number | null = null;
  let requestEnd: number | null = null;
  let workletConnected: number | null = null;
  let firstPcm: number | null = null;
  let firstSend: number | null = null;
  let stopRequestedAt: number | null = null;
  let finalEvent: number | null = null;
  let captureStoppedAt: number | null = null;
  let packetCount = 0;
  let pcmBytes = 0;
  let maxBuffered = 0;
  let captureMicrophoneReused = false;
  let profile: VoiceCaptureProfile = "raw";
  let sourceSampleRate: number | null = null;
  let processingSampleRate: number | null = null;
  let requestedConstraints: Record<string, unknown> = {};
  let effectiveTrackSettings: Record<string, unknown> = {};
  let resampler = { method: null as string | null, inputSampleRate: null as number | null, outputSampleRate: 16_000 };
  let preProcessing: SignalAccumulator = { sumSquares: 0, sampleCount: 0, peak: 0, clippedSamples: 0 };
  let postProcessing: SignalAccumulator = { sumSquares: 0, sampleCount: 0, peak: 0, clippedSamples: 0 };
  let currentGain: number | null = null;
  let minimumGain: number | null = null;
  let maximumGain: number | null = null;
  let digitalSilenceCount = 0;

  const build = (): VoiceDictationClientDiagnostics => ({
    schemaVersion: 5,
    clock: "performance.now",
    events: {
      shortcutAcceptedMs: 0,
      digitalSilenceCount,
      microphoneRequestStartMs: relativeTo(shortcutAcceptedAt, requestStart),
      microphoneRequestResolvedMs: relativeTo(shortcutAcceptedAt, requestEnd),
      workletConnectedMs: relativeTo(shortcutAcceptedAt, workletConnected),
      firstWorkletPcmMs: relativeTo(shortcutAcceptedAt, firstPcm),
      firstWebSocketSendMs: relativeTo(shortcutAcceptedAt, firstSend),
      stopRequestedMs: relativeTo(shortcutAcceptedAt, stopRequestedAt),
      finalEventMs: relativeTo(shortcutAcceptedAt, finalEvent),
    },
    durations: {
      captureStartupMs: elapsed(shortcutAcceptedAt, firstPcm),
      microphoneRequestMs: elapsed(requestStart, requestEnd),
      workletSetupMs: elapsed(shortcutAcceptedAt, workletConnected),
      transportStartupMs: elapsed(firstPcm, firstSend),
      captureDurationMs: elapsed(firstPcm, captureStoppedAt ?? finalEvent),
      stopToFinalMs: elapsed(stopRequestedAt, finalEvent),
    },
    transport: { packetCount, pcmBytes, maxWebSocketBufferedBytes: maxBuffered },
    capture: {
      microphoneReused: captureMicrophoneReused,
      profile,
      sourceSampleRate,
      processingSampleRate,
      requestedConstraints,
      effectiveTrackSettings,
      resampler,
      preProcessing: signalSummary(preProcessing),
      postProcessing: signalSummary(postProcessing),
      workletGain: { current: currentGain, minimum: minimumGain, maximum: maximumGain },
    },
  });

  return {
    requestStarted: (constraints, captureProfile) => {
      requestStart = performance.now();
      profile = captureProfile;
      requestedConstraints = redactedSettings(constraints);
    },
    microphoneReused: () => { captureMicrophoneReused = true; },
    requestResolved: () => { requestEnd = performance.now(); },
    captureSettings: (settings, contextSampleRate) => {
      effectiveTrackSettings = redactedSettings(settings);
      sourceSampleRate = numberOrNull((settings as { sampleRate?: unknown })?.sampleRate) ?? contextSampleRate;
      processingSampleRate = contextSampleRate;
    },
    workletConnected: () => { workletConnected = performance.now(); },
    pcm: (message, bufferBytes) => {
      const now = performance.now();
      if (firstPcm === null) firstPcm = now;
      const sampleCount = message.sampleCount ?? bufferBytes / 2;
      addSignal(postProcessing, message.rms, message.peak, sampleCount, message.clipped, message.clippedSamples);
      addSignal(preProcessing, message.rawRms ?? message.rms, message.rawPeak ?? message.peak, message.rawSampleCount ?? sampleCount, message.rawClipped ?? message.clipped, message.rawClippedSamples ?? message.clippedSamples);
      const gain = numberOrNull(message.gain);
      if (gain !== null) {
        currentGain = gain;
        minimumGain = minimumGain === null ? gain : Math.min(minimumGain, gain);
        maximumGain = maximumGain === null ? gain : Math.max(maximumGain, gain);
      }
      if (message.resampler) {
        resampler = {
          method: typeof message.resampler.method === "string" ? message.resampler.method : null,
          inputSampleRate: numberOrNull(message.resampler.inputSampleRate),
          outputSampleRate: numberOrNull(message.resampler.outputSampleRate) ?? 16_000,
        };
      }
    },
    digitalSilence: () => { digitalSilenceCount += 1; },
    audioSent: (bufferedBytes, bytes) => {
      maxBuffered = Math.max(maxBuffered, bufferedBytes);
      if (firstSend === null) firstSend = performance.now();
      packetCount += 1;
      pcmBytes += bytes;
    },
    captureStopped: () => { if (captureStoppedAt === null) captureStoppedAt = performance.now(); },
    stopRequested: () => { stopRequestedAt = performance.now(); },
    stopFrame: build,
    completed: () => {
      finalEvent = performance.now();
      return build();
    },
  };
}
