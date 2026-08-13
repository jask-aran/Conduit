export interface AudioInputDevice {
  deviceId: string;
  label: string;
  groupId: string;
}

export interface AudioSignalLevel {
  rms: number;
  peak: number;
}

export interface AudioInputTestRecording {
  url: string;
  mimeType: string;
}

export interface AudioInputTestResult extends AudioSignalLevel {
  deviceId: string;
  label: string;
  sampleRate: number;
  channelCount: number | null;
  signalDetected: boolean;
  durationMs: number;
  recording: AudioInputTestRecording | null;
  recordingError: string | null;
}

export interface AudioInputTestOptions {
  onLevel?: (level: AudioSignalLevel) => void;
  maxDurationMs?: number;
}

export interface AudioInputTestSession {
  result: Promise<AudioInputTestResult>;
  stop: () => void;
  dispose: () => void;
}

export const MIN_AUDIO_SIGNAL_RMS = 0.003;
export const MIN_AUDIO_SIGNAL_PEAK = 0.01;
export const MAX_AUDIO_INPUT_TEST_DURATION_MS = 60_000;
export const AUDIO_INPUT_TEST_STOP_GRACE_MS = 150;
export const AUDIO_INPUT_PLAYBACK_UNSUPPORTED_MESSAGE = "Playback is unavailable in this browser. Live microphone testing still works.";

export function hasAudioSignal(level: AudioSignalLevel) {
  return level.rms >= MIN_AUDIO_SIGNAL_RMS || level.peak >= MIN_AUDIO_SIGNAL_PEAK;
}

export function isUnavailableAudioInputError(reason: unknown) {
  const name = reason && typeof reason === "object" && "name" in reason ? String((reason as { name?: unknown }).name || "") : "";
  return name === "NotFoundError" || name === "OverconstrainedError";
}

export function revokeAudioInputRecording(recording: AudioInputTestRecording | null | undefined) {
  if (!recording?.url || typeof URL.revokeObjectURL !== "function") return;
  URL.revokeObjectURL(recording.url);
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

const playableRecordingTypes = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function startMediaRecorder(stream: MediaStream): { recorder: MediaRecorder; mimeType: string } | { error: string } {
  const Constructor = window.MediaRecorder;
  if (typeof Constructor !== "function" || typeof URL.createObjectURL !== "function") {
    return { error: AUDIO_INPUT_PLAYBACK_UNSUPPORTED_MESSAGE };
  }
  const supportedTypes = typeof Constructor.isTypeSupported === "function"
    ? playableRecordingTypes.filter((type) => {
      try { return Constructor.isTypeSupported(type); }
      catch { return false; }
    })
    : playableRecordingTypes;
  const types = [...supportedTypes, ""];
  let lastError: unknown = null;
  for (const mimeType of types) {
    try {
      const recorder = mimeType ? new Constructor(stream, { mimeType }) : new Constructor(stream);
      recorder.start();
      return { recorder, mimeType: recorder.mimeType || mimeType || "audio/webm" };
    } catch (error) {
      lastError = error;
    }
  }
  const detail = lastError instanceof Error && lastError.message ? ` ${lastError.message}` : "";
  return { error: `Playback is unavailable in this browser. The microphone recorder could not start.${detail}` };
}

export function startAudioInputTest(deviceId = "", options: AudioInputTestOptions = {}): AudioInputTestSession {
  const maxDurationMs = Math.max(100, Math.min(MAX_AUDIO_INPUT_TEST_DURATION_MS, Math.round(options.maxDurationMs || MAX_AUDIO_INPUT_TEST_DURATION_MS)));
  let stopRequested = false;
  let disposed = false;
  let activeRecording: AudioInputTestRecording | null = null;
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
  const dispose = () => {
    disposed = true;
    stop();
    revokeAudioInputRecording(activeRecording);
    activeRecording = null;
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
    let recorder: MediaRecorder | null = null;
    let recorderMimeType = "";
    let recorderChunks: Blob[] = [];
    let recorderStopPromise: Promise<AudioInputTestRecording | null> | null = null;
    let recordingError: string | null = null;
    let resultResolved = false;
    const finishRecording = async () => {
      if (!recorder) return null;
      if (!recorderStopPromise) {
        recorderStopPromise = new Promise<AudioInputTestRecording | null>((resolve) => {
          const finish = () => {
            const blob = recorderChunks.length > 0 ? new Blob(recorderChunks, { type: recorderMimeType }) : null;
            recorderChunks = [];
            if (recordingError || !blob || blob.size === 0 || typeof URL.createObjectURL !== "function") {
              resolve(null);
              return;
            }
            const recording = { url: URL.createObjectURL(blob), mimeType: blob.type || recorderMimeType };
            if (disposed) {
              revokeAudioInputRecording(recording);
              resolve(null);
              return;
            }
            activeRecording = recording;
            resolve(recording);
          };
          recorder!.onstop = finish;
          if (recorder!.state === "inactive") {
            finish();
            return;
          }
          try { recorder!.stop(); }
          catch (error) {
            recordingError = error instanceof Error ? error.message : "The microphone recorder stopped unexpectedly.";
            finish();
          }
        });
      }
      return recorderStopPromise;
    };
    try {
      stream = await mediaDevices().getUserMedia(audioInputConstraints(deviceId));
      track = stream.getAudioTracks()[0] || null;
      const recorderSetup = startMediaRecorder(stream);
      if ("error" in recorderSetup) {
        recordingError = recorderSetup.error;
      } else {
        recorder = recorderSetup.recorder;
        recorderMimeType = recorderSetup.mimeType;
        recorder.ondataavailable = (event) => {
          if (event.data?.size) recorderChunks.push(event.data);
        };
        recorder.onerror = () => {
          recordingError = "The microphone recorder stopped unexpectedly. Live microphone testing is still available.";
        };
      }
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
      if (stopRequested && recorder) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, AUDIO_INPUT_TEST_STOP_GRACE_MS));
      }
      const recording = await finishRecording();
      const refreshed = await listAudioInputDevices();
      const settings = track?.getSettings();
      const actualDeviceId = deviceId || settings?.deviceId || "";
      const selected = refreshed.find((device) => device.deviceId === actualDeviceId);
      resultResolved = true;
      resolveResult({
        deviceId: actualDeviceId,
        label: selected?.label || track?.label || "Default microphone",
        sampleRate: settings?.sampleRate || context.sampleRate,
        channelCount: settings?.channelCount || null,
        rms: maxRms,
        peak: maxPeak,
        signalDetected: hasAudioSignal({ rms: maxRms, peak: maxPeak }),
        durationMs: Math.round(performance.now() - started),
        recording,
        recordingError,
      });
    } catch (error) {
      revokeAudioInputRecording(activeRecording);
      activeRecording = null;
      rejectResult(error);
    } finally {
      if (recorder) {
        const recording = await finishRecording();
        if (!resultResolved) revokeAudioInputRecording(recording);
      }
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

  return { result, stop, dispose };
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
