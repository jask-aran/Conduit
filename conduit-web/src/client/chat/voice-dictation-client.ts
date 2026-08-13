export type VoiceDictationState = "idle" | "connecting" | "active" | "stopping" | "completed" | "failed";

interface Completion {
  text: string;
  final: boolean;
  finalWithinDeadline: boolean;
  settlementMs: number | null;
}

interface VoiceDictationCallbacks {
  onState: (state: VoiceDictationState) => void;
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onCompleted: (completion: Completion) => void;
  onError: (error: Error) => void;
}

const MAX_SOCKET_BUFFER_BYTES = 1024 * 1024;

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

export function createVoiceDictationClient(callbacks: VoiceDictationCallbacks) {
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

  const stopCapture = () => {
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

  const sendAudio = (buffer: ArrayBuffer) => {
    if (state !== "active" || socket?.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) {
      fail(new Error("The server is not accepting microphone audio quickly enough"));
      return;
    }
    socket.send(buffer);
  };

  const startCapture = async () => {
    const requested = permission;
    if (!requested || stopRequested || state !== "connecting") return;
    const acquired = await requested;
    const context = audioContext;
    const current = () => permission === requested && !stopRequested && state === "connecting"
      && audioContext === context && socket?.readyState === WebSocket.OPEN;
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
      processor.port.onmessage = (event: MessageEvent<ArrayBuffer>) => sendAudio(event.data);
      processor.onprocessorerror = () => fail(new Error("Microphone audio processing failed"));
      context.onstatechange = resumeContext;
      document.addEventListener("visibilitychange", resumeContext);
      window.addEventListener("pointerdown", resumeContext, true);
      window.addEventListener("touchend", resumeContext, true);
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);
      setState("active");
    } catch (error) {
      if (current()) throw error;
      stopCapture();
    }
  };

  const stop = () => {
    if (!["connecting", "active"].includes(state)) return;
    stopRequested = true;
    stopCapture();
    setState("stopping");
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" }));
    fallbackTimer = window.setTimeout(() => fail(new Error("Dictation finalisation timed out")), 16_000);
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
      const requested = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      permission = requested;
      requested.then(
        (acquired) => { if (permission !== requested || stopRequested || state !== "connecting") stopStream(acquired); },
        (error) => { if (permission === requested && !stopRequested) fail(error); },
      );
      socket = new WebSocket(socketUrl());
      socket.binaryType = "arraybuffer";
      setState("connecting");
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === "ready") {
            if (stopRequested) socket?.send(JSON.stringify({ type: "stop" }));
            else void startCapture().catch(fail);
          } else if (message.type === "partial") callbacks.onPartial(String(message.text || ""));
          else if (message.type === "final") callbacks.onFinal(String(message.text || ""));
          else if (message.type === "end_of_speech") stop();
          else if (message.type === "completed") {
            stopCapture();
            if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
            setState("completed");
            callbacks.onCompleted({
              text: String(message.text || ""),
              final: message.final === true,
              finalWithinDeadline: message.finalWithinDeadline === true,
              settlementMs: Number.isFinite(message.settlementMs) ? Number(message.settlementMs) : null,
            });
            closeSocket();
          } else if (message.type === "error") fail(new Error(String(message.message || "Voice dictation failed")));
        } catch (error) { fail(error); }
      };
      socket.onerror = () => fail(new Error("Could not connect to voice dictation"));
      socket.onclose = () => {
        if (!explicitlyClosed && !["completed", "failed"].includes(state)) fail(new Error("Voice dictation disconnected"));
      };
    } catch (error) { fail(error); }
  };

  const dispose = () => {
    stopCapture();
    closeSocket();
    state = "idle";
  };

  return { start, stop, dispose, state: () => state };
}
