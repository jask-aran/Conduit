export interface AudioInputDevice {
  deviceId: string;
  label: string;
  groupId: string;
}

export interface AudioSignalLevel {
  rms: number;
  peak: number;
}

export interface AudioInputTestResult extends AudioSignalLevel {
  deviceId: string;
  label: string;
  sampleRate: number;
  channelCount: number | null;
  signalDetected: boolean;
  durationMs: number;
}

export interface AudioInputTestOptions {
  onLevel?: (level: AudioSignalLevel) => void;
  maxDurationMs?: number;
}

export interface AudioInputTestSession {
  result: Promise<AudioInputTestResult>;
  stop: () => void;
}

export const MIN_AUDIO_SIGNAL_RMS = 0.003;
export const MIN_AUDIO_SIGNAL_PEAK = 0.01;
export const MAX_AUDIO_INPUT_TEST_DURATION_MS = 60_000;

export function hasAudioSignal(level: AudioSignalLevel) {
  return level.rms >= MIN_AUDIO_SIGNAL_RMS || level.peak >= MIN_AUDIO_SIGNAL_PEAK;
}

export function audioInputConstraints(deviceId = ""): MediaStreamConstraints {
  const audio: MediaTrackConstraints = {
    channelCount: { ideal: 1 },
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return { audio, video: false };
}

function mediaDevices() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access is not available in this browser");
  return navigator.mediaDevices;
}

export async function listAudioInputDevices(): Promise<AudioInputDevice[]> {
  const devices = await mediaDevices().enumerateDevices();
  return devices
    .filter((device) => device.kind === "audioinput")
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Microphone ${index + 1}`,
      groupId: device.groupId,
    }));
}

export function formatMicrophoneError(reason: unknown) {
  const error = reason as DOMException & { message?: string };
  switch (error?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Microphone access was denied. Allow Conduit in Chrome site settings, then try again.";
    case "NotFoundError":
      return "Chrome could not find a microphone. Connect one or choose a different input device.";
    case "OverconstrainedError":
      return "The selected microphone is no longer available. Refresh the device list and choose another input.";
    case "NotReadableError":
      return "Chrome could not read the selected microphone. Close other apps using it, then try again.";
    case "SecurityError":
      return "Microphone access is blocked in this browser context. Use Conduit over HTTPS or localhost.";
    default:
      return error?.message || "Could not access the selected microphone";
  }
}

function audioContextConstructor() {
  return window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

export function startAudioInputTest(deviceId = "", options: AudioInputTestOptions = {}): AudioInputTestSession {
  const maxDurationMs = Math.max(100, Math.min(MAX_AUDIO_INPUT_TEST_DURATION_MS, Math.round(options.maxDurationMs || MAX_AUDIO_INPUT_TEST_DURATION_MS)));
  let stopRequested = false;
  let resolveSampling: (() => void) | null = null;
  let resolveResult!: (result: AudioInputTestResult) => void;
  let rejectResult!: (reason: unknown) => void;
  const result = new Promise<AudioInputTestResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const stop = () => {
    stopRequested = true;
    resolveSampling?.();
  };

  void (async () => {
    let stream: MediaStream | null = null;
    let track: MediaStreamTrack | null = null;
    let context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let silentGain: GainNode | null = null;
    let timer: number | null = null;
    let maxDurationTimer: number | null = null;
    let started = performance.now();
    let maxRms = 0;
    let maxPeak = 0;
    try {
      stream = await mediaDevices().getUserMedia(audioInputConstraints(deviceId));
      track = stream.getAudioTracks()[0] || null;
      const Constructor = audioContextConstructor();
      if (!Constructor) throw new Error("Audio input testing is not supported by this browser");
      context = new Constructor();
      await context.resume();
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 2_048;
      silentGain = context.createGain();
      silentGain.gain.value = 0;
      source.connect(analyser);
      analyser.connect(silentGain);
      silentGain.connect(context.destination);
      const samples = new Float32Array(analyser.fftSize);
      started = performance.now();
      maxDurationTimer = window.setTimeout(stop, maxDurationMs);
      await new Promise<void>((resolve) => {
        resolveSampling = resolve;
        const sample = () => {
          if (stopRequested || !analyser) return resolve();
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          let peak = 0;
          for (const value of samples) {
            sum += value * value;
            peak = Math.max(peak, Math.abs(value));
          }
          const level = { rms: Math.sqrt(sum / samples.length), peak };
          options.onLevel?.(level);
          maxRms = Math.max(maxRms, level.rms);
          maxPeak = Math.max(maxPeak, level.peak);
          if (stopRequested || performance.now() - started >= maxDurationMs) return resolve();
          timer = window.setTimeout(sample, 50);
        };
        sample();
      });
      const refreshed = await listAudioInputDevices();
      const settings = track?.getSettings();
      const actualDeviceId = deviceId || settings?.deviceId || "";
      const selected = refreshed.find((device) => device.deviceId === actualDeviceId);
      resolveResult({
        deviceId: actualDeviceId,
        label: selected?.label || track?.label || "Default microphone",
        sampleRate: settings?.sampleRate || context.sampleRate,
        channelCount: settings?.channelCount || null,
        rms: maxRms,
        peak: maxPeak,
        signalDetected: hasAudioSignal({ rms: maxRms, peak: maxPeak }),
        durationMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      rejectResult(error);
    } finally {
      resolveSampling = null;
      if (timer !== null) window.clearTimeout(timer);
      if (maxDurationTimer !== null) window.clearTimeout(maxDurationTimer);
      source?.disconnect();
      analyser?.disconnect();
      silentGain?.disconnect();
      stream?.getTracks().forEach((item) => item.stop());
      if (context) await context.close().catch(() => {});
    }
  })();

  return { result, stop };
}

export async function testAudioInput(deviceId = "", durationMs = 1_500, options: AudioInputTestOptions = {}): Promise<AudioInputTestResult> {
  const session = startAudioInputTest(deviceId, { ...options, maxDurationMs: durationMs });
  const timer = window.setTimeout(session.stop, Math.max(1, Math.round(durationMs)));
  try {
    return await session.result;
  } finally {
    window.clearTimeout(timer);
  }
}
