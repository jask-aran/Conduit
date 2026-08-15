import { audioInputConstraints, formatMicrophoneError, hasAudioSignal, isUnavailableAudioInputError, normalizeVoiceCaptureProfile, type AudioSignalLevel, type VoiceCaptureProfile } from "./voice-audio";
import type { VoiceDictationClientDiagnostics, VoiceDictationDiagnostics } from "./voice-dictation-diagnostics";

export type VoiceDictationState = "idle" | "starting" | "listening" | "finishing" | "waiting" | "transcribing" | "completed" | "failed";

export interface VoiceInputWarning {
  kind: "digital_silence";
}

interface WorkletPcmMessage {
  type: string;
  buffer?: ArrayBuffer;
  rms?: number;
  peak?: number;
  sampleCount?: number;
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

export interface VoiceDictationCompletion {
  text: string;
  final: boolean;
  finalWithinDeadline: boolean;
  settlementMs: number | null;
  inputSignalDetected: boolean;
  speechDetector: "digital_zero" | "silero" | "unclassified" | null;
  speechDetected: boolean | null;
  maxInputPeak: number;
  captureDurationMs: number;
  audioBytesSent: number;
  serverAudioBytes: number | null;
  serverAudioDurationMs: number | null;
  completionReason: string | null;
  adapter: string | null;
  provider: string | null;
  model: string | null;
  inferenceMode: string | null;
  precision: string | null;
  backend: string | null;
  diagnostics: {
    client: VoiceDictationClientDiagnostics | null;
    server: Record<string, unknown> | null;
  };
}

interface VoiceDictationCallbacks {
  onState: (state: VoiceDictationState) => void;
  onRuntimeReady?: () => void;
  onTranscriptionWaiting?: () => void;
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onCompleted: (completion: VoiceDictationCompletion) => void;
  onInputLevel?: (level: AudioSignalLevel) => void;
  onInputWarning?: (warning: VoiceInputWarning | null) => void;
  onError: (error: Error) => void;
}

interface VoiceDictationOptions {
  getInputDeviceId?: () => string;
  getCaptureProfile?: () => VoiceCaptureProfile;
  getWarmMicrophone?: () => boolean;
}

const MAX_SOCKET_BUFFER_BYTES = 1024 * 1024;
// Keep the complete five-minute server capture limit until the WebSocket is
// available. This prevents a slow handshake from becoming an audio-loss path.
const MAX_PENDING_AUDIO_BYTES = 16_000 * 2 * 300;
const INITIAL_FINALIZATION_TIMEOUT_MS = 60_000;
const FINALIZATION_NETWORK_GRACE_MS = 5_000;
const VOICE_CAPTURE_WORKLET_PATH = "/voice-capture-worklet.js";
const WARM_MICROPHONE_STOP_EVENT = "conduit:stop-warm-microphone";
const WARM_MICROPHONE_STATE_EVENT = "conduit:warm-microphone-state";
let cachedWorkletModuleUrl: string | null = null;
let workletPreload: Promise<string> | null = null;
let warmMicrophoneActive = false;

const workletContexts = new WeakSet<AudioContext>();

export function preloadVoiceCaptureWorklet() {
  if (cachedWorkletModuleUrl) return Promise.resolve(cachedWorkletModuleUrl);
  if (!workletPreload) {
    workletPreload = fetch(VOICE_CAPTURE_WORKLET_PATH, { credentials: "same-origin", cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`Could not preload ${VOICE_CAPTURE_WORKLET_PATH}`);
        return response.blob();
      })
      .then((source) => {
        if (typeof URL.createObjectURL !== "function") throw new Error("This browser cannot cache the voice capture worklet");
        cachedWorkletModuleUrl = URL.createObjectURL(source);
        return cachedWorkletModuleUrl;
      })
      .catch((error) => {
        workletPreload = null;
        throw error;
      });
  }
  return workletPreload;
}

export function isWarmMicrophoneActive() {
  return warmMicrophoneActive;
}

export function stopWarmMicrophone() {
  window.dispatchEvent(new Event(WARM_MICROPHONE_STOP_EVENT));
}

function publishWarmMicrophoneState(active: boolean) {
  if (warmMicrophoneActive === active) return;
  warmMicrophoneActive = active;
  window.dispatchEvent(new CustomEvent(WARM_MICROPHONE_STATE_EVENT, { detail: { active } }));
}

async function ensureVoiceWorklet(context: AudioContext) {
  if (workletContexts.has(context)) return;
  let moduleUrl = VOICE_CAPTURE_WORKLET_PATH;
  try { moduleUrl = await preloadVoiceCaptureWorklet(); }
  catch { /* startCapture retries the authenticated application asset below. */ }
  try {
    await context.audioWorklet.addModule(moduleUrl);
  } catch (error) {
    if (moduleUrl === VOICE_CAPTURE_WORKLET_PATH) throw error;
    await context.audioWorklet.addModule(VOICE_CAPTURE_WORKLET_PATH);
  }
  workletContexts.add(context);
}

let diagnosticsFactory: ((acceptedAt: number) => VoiceDictationDiagnostics) | null = null;
void import("./voice-dictation-diagnostics").then(({ createVoiceDictationDiagnostics }) => {
  diagnosticsFactory = createVoiceDictationDiagnostics;
}).catch((error) => {
  console.warn("Voice dictation diagnostics are unavailable; capture will continue without telemetry", error);
});

function socketUrl() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/v0/dictation/stream`;
}

export function createVoiceDictationClient(callbacks: VoiceDictationCallbacks, options: VoiceDictationOptions = {}) {
  let state: VoiceDictationState = "idle";
  let socket: WebSocket | null = null;
  let stream: MediaStream | null = null;
  let streamDeviceId: string | null = null;
  let streamProfile: VoiceCaptureProfile | null = null;
  let requestedStreamDeviceId = "";
  let requestedStreamProfile: VoiceCaptureProfile = "raw";
  let streamTrack: MediaStreamTrack | null = null;
  let streamTrackEnded: (() => void) | null = null;
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
  let diagnostics: VoiceDictationDiagnostics | null = null;
  let captureAcceptingAudio = false;
  let releaseWarmAfterStop = false;
  const stoppedStreams = new WeakSet<MediaStream>();

  const setState = (next: VoiceDictationState) => {
    state = next;
    callbacks.onState(next);
  };

  let fail: (reason: unknown) => void = () => {};
  let resumeContext = () => {};

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

  const removeTrackEndedListener = () => {
    if (streamTrack && streamTrackEnded) streamTrack.removeEventListener?.("ended", streamTrackEnded);
    streamTrack = null;
    streamTrackEnded = null;
  };

  const releaseStream = () => {
    const target = stream;
    removeTrackEndedListener();
    stream = null;
    streamDeviceId = null;
    streamProfile = null;
    stopStream(target);
    publishWarmMicrophoneState(false);
  };

  const releaseAudioContext = () => {
    const target = audioContext;
    audioContext = null;
    if (!target) return;
    target.onstatechange = null;
    try { void Promise.resolve(target.close()).catch(() => {}); }
    catch { /* A failed close must not block the next capture. */ }
  };

  const ensureAudioContext = () => {
    const Constructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return null;
    if (audioContext?.state === "closed") releaseAudioContext();
    if (audioContext) return audioContext;
    try {
      audioContext = new Constructor({ sampleRate: 16_000 });
    } catch {
      audioContext = new Constructor();
    }
    return audioContext;
  };

  const trackIsLive = (track: MediaStreamTrack | null) => Boolean(track && track.readyState !== "ended");

  const attachTrackEndedListener = (track: MediaStreamTrack | null) => {
    removeTrackEndedListener();
    if (!track) return;
    const ended = () => {
      if (streamTrack !== track) return;
      if (["idle", "completed", "failed"].includes(state)) {
        releaseStream();
        return;
      }
      if (!captureAcceptingAudio && (stopRequested || ["finishing", "waiting", "transcribing"].includes(state))) {
        releaseStream();
        return;
      }
      fail(new Error("The microphone device stopped. Choose another microphone and try again."));
    };
    streamTrack = track;
    streamTrackEnded = ended;
    track.addEventListener?.("ended", ended);
  };

  const resolveCaptureDrain = () => {
    if (captureDrainTimer !== null) window.clearTimeout(captureDrainTimer);
    captureDrainTimer = null;
    const resolve = captureDrainResolver;
    captureDrainResolver = null;
    resolve?.();
  };

  const stopCapture = ({ retainWarm = false, closeContext = false } = {}) => {
    captureAcceptingAudio = false;
    if (captureStartedAt !== null && captureStoppedAt === null) captureStoppedAt = performance.now();
    diagnostics?.captureStopped();
    resolveCaptureDrain();
    drainingCapture = false;
    permission = null;
    removeResumeListeners();
    if (processor) processor.port.onmessage = null;
    source?.disconnect();
    processor?.disconnect();
    silentGain?.disconnect();
    source = null;
    processor = null;
    silentGain = null;
    const keepStream = retainWarm && trackIsLive(streamTrack);
    if (keepStream) {
      publishWarmMicrophoneState(true);
    } else {
      releaseStream();
    }
    if (closeContext || audioContext?.state === "closed") releaseAudioContext();
    else if (audioContext) audioContext.onstatechange = null;
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

  fail = (reason: unknown) => {
    if (state === "failed") return;
    stopCapture({ closeContext: true });
    closeSocket();
    const error = reason instanceof Error ? reason : new Error(String(reason || "Voice dictation failed"));
    setState("failed");
    callbacks.onError(error);
  };

  resumeContext = () => {
    const context = audioContext;
    if (!context) return;
    if (context.state === "closed") {
      fail(new Error("The microphone audio context closed. Start dictation again."));
      return;
    }
    if (context.state === "suspended") void context.resume().catch((error) => fail(error));
  };

  const onStopWarmMicrophone = () => {
    releaseWarmAfterStop = true;
    if (["starting", "listening"].includes(state)) {
      requestStop();
      return;
    }
    if (["finishing", "waiting", "transcribing"].includes(state)) return;
    stopCapture({ closeContext: true });
  };
  let requestStop: () => void = () => {};
  window.addEventListener(WARM_MICROPHONE_STOP_EVENT, onStopWarmMicrophone);

  const transmitAudio = (buffer: ArrayBuffer) => {
    const currentSocket = socket;
    if (!serverReady || !currentSocket || currentSocket.readyState !== WebSocket.OPEN) return;
    const bufferedAmount = currentSocket.bufferedAmount;
    if (bufferedAmount > MAX_SOCKET_BUFFER_BYTES) {
      fail(new Error("The server is not accepting microphone audio quickly enough"));
      return;
    }
    currentSocket.send(buffer);
    diagnostics?.audioSent(Math.max(bufferedAmount, currentSocket.bufferedAmount), buffer.byteLength);
    audioBytesSent += buffer.byteLength;
  };

  const returnWorkletBuffer = (owner: AudioWorkletNode | null, buffer: ArrayBuffer) => {
    if (!owner || !buffer.byteLength) return;
    try { owner.port.postMessage({ type: "return_buffer", buffer }, [buffer]); }
    catch { /* A stopped worklet can discard a buffer that no longer has an owner. */ }
  };

  const drainPendingAudio = () => {
    if (!serverReady || !socket || socket.readyState !== WebSocket.OPEN) return;
    const queued = pendingAudio;
    pendingAudio = [];
    pendingAudioBytes = 0;
    queued.forEach(transmitAudio);
  };

  const flushPendingAudio = () => {
    if (!["starting", "listening", "finishing"].includes(state)) return;
    drainPendingAudio();
  };

  const sendStopFrame = () => {
    if (stopFrameSent || !stopRequested || !serverReady || !socket || socket.readyState !== WebSocket.OPEN) return;
    const clientDiagnostics = diagnostics?.stopFrame();
    const frame: { type: "stop"; audioBytesSent: number; clientDiagnostics?: VoiceDictationClientDiagnostics } = { type: "stop", audioBytesSent };
    if (clientDiagnostics) frame.clientDiagnostics = clientDiagnostics;
    socket.send(JSON.stringify(frame));
    stopFrameSent = true;
  };

  const sendCompletedDiagnostics = (clientDiagnostics: VoiceDictationClientDiagnostics | null) => {
    if (!clientDiagnostics) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify({ type: "client_diagnostics", clientDiagnostics }));
    } catch {
      // The transcript is already complete. A closed socket must not turn a
      // successful dictation into a client error only because diagnostics
      // could not be handed back to the archive.
    }
  };

  const armFinalizationTimer = (timeoutMs: number) => {
    if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
    fallbackTimer = window.setTimeout(() => fail(new Error("Dictation finalisation timed out")), Math.max(1_000, timeoutMs + FINALIZATION_NETWORK_GRACE_MS));
  };

  const sendAudio = (buffer: ArrayBuffer) => {
    if (!["starting", "listening"].includes(state) && !(state === "finishing" && drainingCapture)) return;
    if (serverReady && socket?.readyState === WebSocket.OPEN) {
      transmitAudio(buffer);
      return;
    }
    if (pendingAudioBytes + buffer.byteLength > MAX_PENDING_AUDIO_BYTES) {
      fail(new Error("Voice dictation server did not become ready in time"));
      return;
    }
    pendingAudio.push(buffer.slice(0));
    pendingAudioBytes += buffer.byteLength;
  };

  const startCapture = async () => {
    const requested = permission;
    if (!requested || stopRequested || state !== "starting") return;
    const acquired = await requested;
    const context = audioContext;
    const current = () => permission === requested && !stopRequested && state === "starting"
      && audioContext === context;
    if (!context || !current()) return stopCapture({ retainWarm: options.getWarmMicrophone?.() === true && !releaseWarmAfterStop });
    stream = acquired;
    streamDeviceId = requestedStreamDeviceId;
    streamProfile = requestedStreamProfile;
    const track = acquired.getAudioTracks?.()[0] || null;
    attachTrackEndedListener(track);
    const settings = track?.getSettings?.() || {};
    diagnostics?.captureSettings(settings, context.sampleRate);
    try {
      if (!context.audioWorklet || typeof AudioWorkletNode === "undefined") {
        throw new Error("This browser does not support AudioWorklet voice capture");
      }
      await ensureVoiceWorklet(context);
      if (!current()) return stopCapture({ retainWarm: options.getWarmMicrophone?.() === true && !releaseWarmAfterStop });
      await context.resume();
      if (!current()) return stopCapture({ retainWarm: options.getWarmMicrophone?.() === true && !releaseWarmAfterStop });
      source = context.createMediaStreamSource(acquired);
      processor = new AudioWorkletNode(context, "conduit-voice-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      silentGain = context.createGain();
      silentGain.gain.value = 0;
      const markCaptureStarted = () => {
        if (state !== "starting") return;
        captureStartedAt = performance.now();
        captureStoppedAt = null;
        setState("listening");
      };
      processor.port.onmessage = (event: MessageEvent<ArrayBuffer | { type: string; buffer?: ArrayBuffer; rms?: number; peak?: number }>) => {
        if (event.data && typeof event.data === "object" && "type" in event.data) {
          const message = event.data as WorkletPcmMessage;
          if (message.type === "flush_complete") {
            resolveCaptureDrain();
            return;
          }
          if (message.type === "digital_silence") {
            micSilentActive = true;
            diagnostics?.digitalSilence();
            callbacks.onInputWarning?.({ kind: "digital_silence" });
            return;
          }
          if (message.type !== "pcm" || !message.buffer) return;
          const workletOwner = processor;
          diagnostics?.pcm(message, message.buffer.byteLength);
          markCaptureStarted();
          const level = { rms: Number(message.rms) || 0, peak: Number(message.peak) || 0 };
          if (micSilentActive && level.peak > 0) {
            micSilentActive = false;
            callbacks.onInputWarning?.(null);
          }
          inputSignalDetected ||= hasAudioSignal(level);
          maxInputPeak = Math.max(maxInputPeak, level.peak);
          callbacks.onInputLevel?.(level);
          sendAudio(message.buffer);
          returnWorkletBuffer(workletOwner, message.buffer);
          return;
        }
        if (event.data instanceof ArrayBuffer) {
          markCaptureStarted();
          sendAudio(event.data);
        }
      };
      processor.onprocessorerror = () => fail(new Error("Microphone audio processing failed"));
      context.onstatechange = resumeContext;
      document.addEventListener("visibilitychange", resumeContext);
      window.addEventListener("pointerdown", resumeContext, true);
      window.addEventListener("touchend", resumeContext, true);
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);
      captureAcceptingAudio = true;
      diagnostics?.workletConnected();
      flushPendingAudio();
    } catch (error) {
      if (current()) throw error;
      stopCapture({ retainWarm: options.getWarmMicrophone?.() === true && !releaseWarmAfterStop });
    }
  };

  const stop = () => {
    if (!["starting", "listening"].includes(state)) return;
    diagnostics?.stopRequested();
    stopRequested = true;
    // Stop has ended the capture window. The worklet may still flush its final
    // packet, but a track ending now is a warm-resource event, not audio loss.
    captureAcceptingAudio = false;
    setState("finishing");
    if (!socket && !permission && !capturePromise) {
      stopCapture({ closeContext: true });
      setState("idle");
      return;
    }
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
          stopCapture({ retainWarm: options.getWarmMicrophone?.() === true && !releaseWarmAfterStop });
        });
      })()
      : Promise.resolve().then(() => stopCapture({ retainWarm: options.getWarmMicrophone?.() === true && !releaseWarmAfterStop }));
    void drain.then(sendStopFrame).catch(fail);
    armFinalizationTimer(INITIAL_FINALIZATION_TIMEOUT_MS);
  };
  requestStop = stop;

  const beginStart = (acceptedAt: number) => {
    if (state !== "starting") return;
    explicitlyClosed = false;
    stopRequested = false;
    releaseWarmAfterStop = false;
    if (!navigator.mediaDevices?.getUserMedia || !ensureAudioContext()) {
      fail(new Error("Voice capture is not supported by this browser"));
      return;
    }
    diagnostics = diagnosticsFactory?.(acceptedAt) || null;
    try {
      const inputDeviceId = options.getInputDeviceId?.() || "";
      const captureProfile = normalizeVoiceCaptureProfile(options.getCaptureProfile?.());
      requestedStreamDeviceId = inputDeviceId;
      requestedStreamProfile = captureProfile;
      const reuseStream = Boolean(stream && trackIsLive(streamTrack)
        && streamDeviceId === inputDeviceId
        && streamProfile === captureProfile);
      if (stream && !reuseStream) {
        releaseStream();
        releaseAudioContext();
      }
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
      captureAcceptingAudio = false;
      const constraints = audioInputConstraints(inputDeviceId, captureProfile);
      diagnostics?.requestStarted(constraints, captureProfile);
      if (reuseStream) diagnostics?.microphoneReused();
      const requested = reuseStream
        ? Promise.resolve(stream!)
        : navigator.mediaDevices.getUserMedia(constraints);
      permission = requested;
      requested.then(
        (acquired) => {
          diagnostics?.requestResolved();
          if (permission !== requested || stopRequested || state !== "starting") {
            if (!reuseStream) stopStream(acquired);
          }
        },
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
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === "ready") {
            serverReady = true;
            drainPendingAudio();
            if (stopRequested && !drainingCapture) sendStopFrame();
            else flushPendingAudio();
          } else if (message.type === "runtime_ready") {
            callbacks.onRuntimeReady?.();
          } else if (message.type === "waiting_for_transcription") {
            callbacks.onTranscriptionWaiting?.();
            if (state === "finishing") setState("waiting");
          } else if (message.type === "finalizing") {
            if (["finishing", "waiting"].includes(state)) setState("transcribing");
            const timeoutMs = Number(message.timeoutMs);
            if (Number.isFinite(timeoutMs) && timeoutMs >= 1_000) armFinalizationTimer(timeoutMs);
          } else if (message.type === "partial") {
            callbacks.onPartial(String(message.text || ""));
          } else if (message.type === "final") {
            callbacks.onFinal(String(message.text || ""));
          }
          else if (message.type === "completed") {
            const clientDiagnostics = diagnostics?.completed() ?? null;
            const serverDiagnostics = message.diagnostics && typeof message.diagnostics === "object"
              && message.diagnostics.server && typeof message.diagnostics.server === "object"
              ? message.diagnostics.server as Record<string, unknown>
              : null;
            stopCapture({ retainWarm: options.getWarmMicrophone?.() === true && !releaseWarmAfterStop });
            if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
            setState("completed");
            const serverAudioBytes = Number(message.audioBytes);
            const serverAudioDurationMs = Number(message.audioDurationMs);
            const speechDetector = message.speech && typeof message.speech.detector === "string"
              ? message.speech.detector as "digital_zero" | "silero" | "unclassified"
              : null;
            const speechDetected = typeof message.speech?.detected === "boolean" ? message.speech.detected : null;
            callbacks.onCompleted({
              text: String(message.text || ""),
              final: message.final === true,
              finalWithinDeadline: message.finalWithinDeadline === true,
              settlementMs: Number.isFinite(message.settlementMs) ? Number(message.settlementMs) : null,
              inputSignalDetected,
              speechDetector,
              speechDetected,
              maxInputPeak,
              captureDurationMs: captureStartedAt === null ? 0 : Math.max(0, Math.round((captureStoppedAt ?? performance.now()) - captureStartedAt)),
              audioBytesSent,
              serverAudioBytes: Number.isFinite(serverAudioBytes) ? serverAudioBytes : null,
              serverAudioDurationMs: Number.isFinite(serverAudioDurationMs) ? serverAudioDurationMs : null,
              completionReason: typeof message.reason === "string" ? message.reason : null,
              adapter: typeof message.adapter === "string" ? message.adapter : null,
              provider: typeof message.provider === "string" ? message.provider : null,
              model: typeof message.model === "string" ? message.model : null,
              inferenceMode: typeof message.inferenceMode === "string" ? message.inferenceMode : null,
              precision: typeof message.precision === "string" ? message.precision : null,
              backend: typeof message.backend === "string" ? message.backend : null,
              diagnostics: { client: clientDiagnostics, server: serverDiagnostics },
            });
            sendCompletedDiagnostics(clientDiagnostics);
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

  const start = (acceptedAt = performance.now()) => {
    if (["starting", "listening", "finishing", "waiting", "transcribing"].includes(state)) return;
    setState("starting");
    try { ensureAudioContext(); }
    catch { /* beginStart reports unsupported or failed context creation. */ }
    // Telemetry is optional. Do not wait for its lazy chunk before opening the
    // microphone and transport path.
    if (state === "starting") beginStart(acceptedAt);
  };

  const dispose = () => {
    releaseWarmAfterStop = true;
    stopCapture({ closeContext: true });
    closeSocket();
    window.removeEventListener(WARM_MICROPHONE_STOP_EVENT, onStopWarmMicrophone);
    setState("idle");
  };

  return { start, stop, dispose, state: () => state };
}
