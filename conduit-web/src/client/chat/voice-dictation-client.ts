import { audioInputConstraints, formatMicrophoneError, hasAudioSignal, isUnavailableAudioInputError, type AudioSignalLevel } from "./voice-audio";

export type VoiceDictationState = "idle" | "connecting" | "active" | "stopping" | "completed" | "failed";

export interface VoiceInputWarning {
  kind: "mic_silent";
}

export interface VoiceDictationCompletion {
  text: string;
  final: boolean;
  finalWithinDeadline: boolean;
  settlementMs: number | null;
  inputSignalDetected: boolean;
  maxInputPeak: number;
  captureDurationMs: number;
  audioBytesSent: number;
  serverAudioBytes: number | null;
  serverAudioDurationMs: number | null;
  completionReason: string | null;
  adapter: string | null;
  provider: string | null;
  model: string | null;
}

interface VoiceDictationCallbacks {
  onState: (state: VoiceDictationState) => void;
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onCompleted: (completion: VoiceDictationCompletion) => void;
  onInputLevel?: (level: AudioSignalLevel) => void;
  onInputWarning?: (warning: VoiceInputWarning | null) => void;
  onError: (error: Error) => void;
}

interface VoiceDictationOptions {
  getInputDeviceId?: () => string;
}

const MAX_SOCKET_BUFFER_BYTES = 1024 * 1024;
// Safety net only: the server now emits ready on accept and retains PCM while
// the model cold-starts. Keep enough headroom for a slow first WebSocket frame.
const MAX_PENDING_AUDIO_BYTES = 2 * 1024 * 1024;
const INITIAL_FINALIZATION_TIMEOUT_MS = 60_000;
const FINALIZATION_NETWORK_GRACE_MS = 5_000;

function socketUrl() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/v0/dictation/stream`;
}

export class Pcm16Resampler {
  private pending = new Float32Array(0);
  private position = 0;
  private readonly ratio: number;

  constructor(inputRate: number, outputRate = 16_000) {
    if (outputRate > inputRate) throw new Error("The microphone sample rate is below 16 kHz");
    this.ratio = inputRate / outputRate;
  }

  push(input: Float32Array) {
    const combined = new Float32Array(this.pending.length + input.length);
    combined.set(this.pending);
    combined.set(input, this.pending.length);
    const values: number[] = [];
    while (this.position + this.ratio <= combined.length) {
      const start = Math.floor(this.position);
      const end = Math.max(start + 1, Math.min(combined.length, Math.floor(this.position + this.ratio)));
      let sum = 0;
      for (let index = start; index < end; index += 1) sum += combined[index] || 0;
      const sample = Math.max(-1, Math.min(1, sum / (end - start)));
      values.push(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
      this.position += this.ratio;
    }
    const consumed = Math.floor(this.position);
    this.pending = combined.slice(consumed);
    this.position -= consumed;
    return Int16Array.from(values);
  }
}

export function downsampleToPcm16(input: Float32Array, inputRate: number, outputRate = 16_000) {
  return new Pcm16Resampler(inputRate, outputRate).push(input);
}

export function createVoiceDictationClient(callbacks: VoiceDictationCallbacks, options: VoiceDictationOptions = {}) {
  let state: VoiceDictationState = "idle";
  let socket: WebSocket | null = null;
  let stream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: AudioWorkletNode | null = null;
  let silentGain: GainNode | null = null;
  let permission: Promise<MediaStream> | null = null;
  let explicitlyClosed = false;
  let fallbackTimer: number | null = null;
  let stopRequested = false;
  let serverReady = false;
  let capturePromise: Promise<void> | null = null;
  let pendingAudio: ArrayBuffer[] = [];
  let pendingAudioBytes = 0;
  let inputSignalDetected = false;
  let maxInputPeak = 0;
  let captureStartedAt: number | null = null;
  let captureStoppedAt: number | null = null;
  let audioBytesSent = 0;
  let micSilentActive = false;
  let captureDrainResolver: (() => void) | null = null;
  let captureDrainTimer: number | null = null;
  let drainingCapture = false;
  let stopFrameSent = false;
  const stoppedStreams = new WeakSet<MediaStream>();

  const setState = (next: VoiceDictationState) => {
    state = next;
    callbacks.onState(next);
  };

  const resumeContext = () => {
    if (audioContext?.state === "suspended") void audioContext.resume().catch(() => {});
  };

  const removeResumeListeners = () => {
    document.removeEventListener("visibilitychange", resumeContext);
    window.removeEventListener("pointerdown", resumeContext, true);
    window.removeEventListener("touchend", resumeContext, true);
  };

  const stopStream = (target: MediaStream | null) => {
    if (!target || stoppedStreams.has(target)) return;
    stoppedStreams.add(target);
    target.getTracks().forEach((track) => track.stop());
  };

  const resolveCaptureDrain = () => {
    if (captureDrainTimer !== null) window.clearTimeout(captureDrainTimer);
    captureDrainTimer = null;
    const resolve = captureDrainResolver;
    captureDrainResolver = null;
    resolve?.();
  };

  const stopCapture = () => {
    if (captureStartedAt !== null && captureStoppedAt === null) captureStoppedAt = performance.now();
    resolveCaptureDrain();
    drainingCapture = false;
    permission = null;
    removeResumeListeners();
    if (processor) processor.port.onmessage = null;
    source?.disconnect();
    processor?.disconnect();
    silentGain?.disconnect();
    stopStream(stream);
    void audioContext?.close().catch(() => {});
    source = null;
    processor = null;
    silentGain = null;
    stream = null;
    audioContext = null;
  };

  const closeSocket = () => {
    explicitlyClosed = true;
    serverReady = false;
    pendingAudio = [];
    pendingAudioBytes = 0;
    if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
    fallbackTimer = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Dictation complete");
    socket = null;
  };

  const fail = (reason: unknown) => {
    if (state === "failed") return;
    stopCapture();
    closeSocket();
    const error = reason instanceof Error ? reason : new Error(String(reason || "Voice dictation failed"));
    setState("failed");
    callbacks.onError(error);
  };

  const transmitAudio = (buffer: ArrayBuffer) => {
    const currentSocket = socket;
    if (!serverReady || !currentSocket || currentSocket.readyState !== WebSocket.OPEN) return;
    if (currentSocket.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) {
      fail(new Error("The server is not accepting microphone audio quickly enough"));
      return;
    }
    currentSocket.send(buffer);
    audioBytesSent += buffer.byteLength;
  };

  const drainPendingAudio = () => {
    if (!serverReady || !socket || socket.readyState !== WebSocket.OPEN) return;
    const queued = pendingAudio;
    pendingAudio = [];
    pendingAudioBytes = 0;
    queued.forEach(transmitAudio);
  };

  const flushPendingAudio = () => {
    if (state !== "active") return;
    drainPendingAudio();
  };

  const sendStopFrame = () => {
    if (stopFrameSent || !stopRequested || !serverReady || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "stop", audioBytesSent }));
    stopFrameSent = true;
  };

  const armFinalizationTimer = (timeoutMs: number) => {
    if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
    fallbackTimer = window.setTimeout(() => fail(new Error("Dictation finalisation timed out")), Math.max(1_000, timeoutMs + FINALIZATION_NETWORK_GRACE_MS));
  };

  const sendAudio = (buffer: ArrayBuffer) => {
    if (state !== "active" && !(state === "stopping" && drainingCapture)) return;
    if (serverReady && socket?.readyState === WebSocket.OPEN) {
      transmitAudio(buffer);
      return;
    }
    if (pendingAudioBytes + buffer.byteLength > MAX_PENDING_AUDIO_BYTES) {
      fail(new Error("Voice dictation server did not become ready in time"));
      return;
    }
    pendingAudio.push(buffer);
    pendingAudioBytes += buffer.byteLength;
  };

  const startCapture = async () => {
    const requested = permission;
    if (!requested || stopRequested || state !== "connecting") return;
    const acquired = await requested;
    const context = audioContext;
    const current = () => permission === requested && !stopRequested && state === "connecting"
      && audioContext === context;
    if (!context || !current()) return stopStream(acquired);
    stream = acquired;
    try {
      if (!context.audioWorklet || typeof AudioWorkletNode === "undefined") {
        throw new Error("This browser does not support AudioWorklet voice capture");
      }
      await context.audioWorklet.addModule("/voice-capture-worklet.js");
      if (!current()) return stopCapture();
      await context.resume();
      if (!current()) return stopCapture();
      source = context.createMediaStreamSource(acquired);
      processor = new AudioWorkletNode(context, "conduit-voice-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      silentGain = context.createGain();
      silentGain.gain.value = 0;
      processor.port.onmessage = (event: MessageEvent<ArrayBuffer | { type: string; buffer?: ArrayBuffer; rms?: number; peak?: number }>) => {
        if (event.data && typeof event.data === "object" && "type" in event.data) {
          if (event.data.type === "flush_complete") {
            resolveCaptureDrain();
            return;
          }
          if (event.data.type === "mic_silent") {
            micSilentActive = true;
            callbacks.onInputWarning?.({ kind: "mic_silent" });
            return;
          }
          if (event.data.type !== "pcm" || !event.data.buffer) return;
          const level = { rms: Number(event.data.rms) || 0, peak: Number(event.data.peak) || 0 };
          if (micSilentActive && level.peak > 0) {
            micSilentActive = false;
            callbacks.onInputWarning?.(null);
          }
          inputSignalDetected ||= hasAudioSignal(level);
          maxInputPeak = Math.max(maxInputPeak, level.peak);
          callbacks.onInputLevel?.(level);
          sendAudio(event.data.buffer);
          return;
        }
        if (event.data instanceof ArrayBuffer) sendAudio(event.data);
      };
      processor.onprocessorerror = () => fail(new Error("Microphone audio processing failed"));
      context.onstatechange = resumeContext;
      document.addEventListener("visibilitychange", resumeContext);
      window.addEventListener("pointerdown", resumeContext, true);
      window.addEventListener("touchend", resumeContext, true);
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);
      setState("active");
      captureStartedAt = performance.now();
      captureStoppedAt = null;
      flushPendingAudio();
    } catch (error) {
      if (current()) throw error;
      stopCapture();
    }
  };

  const stop = () => {
    if (!["connecting", "active"].includes(state)) return;
    stopRequested = true;
    setState("stopping");
    const drain = processor
      ? (() => {
        drainingCapture = true;
        return new Promise<void>((resolve) => {
          captureDrainResolver = resolve;
          captureDrainTimer = window.setTimeout(resolveCaptureDrain, 250);
          try { processor?.port.postMessage({ type: "flush" }); }
          catch { resolveCaptureDrain(); }
        }).finally(() => {
          drainingCapture = false;
          stopCapture();
        });
      })()
      : Promise.resolve().then(stopCapture);
    void drain.then(sendStopFrame);
    armFinalizationTimer(INITIAL_FINALIZATION_TIMEOUT_MS);
  };

  const start = () => {
    if (["connecting", "active", "stopping"].includes(state)) return;
    explicitlyClosed = false;
    stopRequested = false;
    const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!navigator.mediaDevices?.getUserMedia || !AudioContextConstructor) {
      fail(new Error("Voice capture is not supported by this browser"));
      return;
    }
    try {
      audioContext = new AudioContextConstructor();
      serverReady = false;
      stopFrameSent = false;
      pendingAudio = [];
      pendingAudioBytes = 0;
      inputSignalDetected = false;
      maxInputPeak = 0;
      captureStartedAt = null;
      captureStoppedAt = null;
      audioBytesSent = 0;
      micSilentActive = false;
      const requested = navigator.mediaDevices.getUserMedia(audioInputConstraints(options.getInputDeviceId?.() || ""));
      permission = requested;
      requested.then(
        (acquired) => { if (permission !== requested || stopRequested || state !== "connecting") stopStream(acquired); },
        (error) => {
          if (permission !== requested || stopRequested) return;
          const formatted = new Error(formatMicrophoneError(error));
          const code = error && typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name || "") : "";
          if (code) Object.assign(formatted, { code, unavailableDevice: isUnavailableAudioInputError(error) });
          fail(formatted);
        },
      );
      socket = new WebSocket(socketUrl());
      socket.binaryType = "arraybuffer";
      setState("connecting");
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === "ready") {
            serverReady = true;
            drainPendingAudio();
            if (stopRequested && !drainingCapture) sendStopFrame();
            else flushPendingAudio();
          } else if (message.type === "finalizing") {
            const timeoutMs = Number(message.timeoutMs);
            if (Number.isFinite(timeoutMs) && timeoutMs >= 1_000) armFinalizationTimer(timeoutMs);
          } else if (message.type === "partial") {
            if (inputSignalDetected) callbacks.onPartial(String(message.text || ""));
          } else if (message.type === "final") {
            if (inputSignalDetected) callbacks.onFinal(String(message.text || ""));
          }
          else if (message.type === "completed") {
            stopCapture();
            if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
            setState("completed");
            const serverAudioBytes = Number(message.audioBytes);
            const serverAudioDurationMs = Number(message.audioDurationMs);
            callbacks.onCompleted({
              text: String(message.text || ""),
              final: message.final === true,
              finalWithinDeadline: message.finalWithinDeadline === true,
              settlementMs: Number.isFinite(message.settlementMs) ? Number(message.settlementMs) : null,
              inputSignalDetected,
              maxInputPeak,
              captureDurationMs: captureStartedAt === null ? 0 : Math.max(0, Math.round((captureStoppedAt ?? performance.now()) - captureStartedAt)),
              audioBytesSent,
              serverAudioBytes: Number.isFinite(serverAudioBytes) ? serverAudioBytes : null,
              serverAudioDurationMs: Number.isFinite(serverAudioDurationMs) ? serverAudioDurationMs : null,
              completionReason: typeof message.reason === "string" ? message.reason : null,
              adapter: typeof message.adapter === "string" ? message.adapter : null,
              provider: typeof message.provider === "string" ? message.provider : null,
              model: typeof message.model === "string" ? message.model : null,
            });
            closeSocket();
          } else if (message.type === "error") fail(new Error(String(message.message || "Voice dictation failed")));
        } catch (error) { fail(error); }
      };
      socket.onerror = () => fail(new Error("Could not connect to voice dictation"));
      socket.onclose = () => {
        if (!explicitlyClosed && !["completed", "failed"].includes(state)) fail(new Error("Voice dictation disconnected"));
      };
      capturePromise = startCapture().finally(() => { capturePromise = null; });
      void capturePromise.catch(fail);
    } catch (error) { fail(error); }
  };

  const dispose = () => {
    stopCapture();
    closeSocket();
    state = "idle";
  };

  return { start, stop, dispose, state: () => state };
}
