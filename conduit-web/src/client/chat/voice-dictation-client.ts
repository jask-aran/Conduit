export type VoiceDictationState = "idle" | "connecting" | "active" | "stopping" | "completed" | "failed";

interface Completion {
  text: string;
  final: boolean;
  stoppedAt: number;
  completedAt: number;
}

interface VoiceDictationCallbacks {
  onState: (state: VoiceDictationState) => void;
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onCompleted: (completion: Completion) => void;
  onError: (error: Error) => void;
}

function socketUrl() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/v0/dictation/stream`;
}

export function downsampleToPcm16(input: Float32Array, inputRate: number, outputRate = 16_000) {
  if (outputRate > inputRate) throw new Error("The microphone sample rate is below 16 kHz");
  const ratio = inputRate / outputRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const output = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.max(start + 1, Math.min(input.length, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let cursor = start; cursor < end; cursor += 1) sum += input[cursor] || 0;
    const sample = Math.max(-1, Math.min(1, sum / (end - start)));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

export function createVoiceDictationClient(callbacks: VoiceDictationCallbacks) {
  let state: VoiceDictationState = "idle";
  let socket: WebSocket | null = null;
  let stream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let silentGain: GainNode | null = null;
  let permission: Promise<MediaStream> | null = null;
  let explicitlyClosed = false;
  let stoppedAt = 0;
  let fallbackTimer: number | null = null;
  let stopRequested = false;

  const setState = (next: VoiceDictationState) => {
    state = next;
    callbacks.onState(next);
  };

  const stopCapture = () => {
    if (processor) processor.onaudioprocess = null;
    source?.disconnect();
    processor?.disconnect();
    silentGain?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
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

  const startCapture = async () => {
    if (stopRequested || state !== "connecting") return;
    stream = await permission!;
    if (!audioContext || !socket || socket.readyState !== WebSocket.OPEN) return stopCapture();
    await audioContext.resume();
    source = audioContext.createMediaStreamSource(stream);
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    processor.onaudioprocess = (event) => {
      if (state !== "active" || socket?.readyState !== WebSocket.OPEN) return;
      const pcm = downsampleToPcm16(event.inputBuffer.getChannelData(0), audioContext!.sampleRate);
      socket.send(pcm.buffer);
    };
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
    setState("active");
  };

  const stop = () => {
    if (!["connecting", "active"].includes(state)) return;
    stopRequested = true;
    stoppedAt = performance.now();
    stopCapture();
    setState("stopping");
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" }));
    fallbackTimer = window.setTimeout(() => fail(new Error("Dictation finalisation timed out")), 1_150);
  };

  const start = () => {
    if (["connecting", "active", "stopping"].includes(state)) return;
    explicitlyClosed = false;
    stopRequested = false;
    stoppedAt = 0;
    const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!navigator.mediaDevices?.getUserMedia || !AudioContextConstructor) {
      fail(new Error("Voice capture is not supported by this browser"));
      return;
    }
    try {
      audioContext = new AudioContextConstructor();
      permission = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      permission.catch(fail);
      socket = new WebSocket(socketUrl());
      socket.binaryType = "arraybuffer";
      setState("connecting");
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === "ready") {
            if (stopRequested) socket?.send(JSON.stringify({ type: "stop" }));
            else void startCapture().catch(fail);
          }
          else if (message.type === "partial") callbacks.onPartial(String(message.text || ""));
          else if (message.type === "final") callbacks.onFinal(String(message.text || ""));
          else if (message.type === "end_of_speech") stop();
          else if (message.type === "completed") {
            stopCapture();
            if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
            const completedAt = performance.now();
            setState("completed");
            callbacks.onCompleted({ text: String(message.text || ""), final: message.final === true, stoppedAt: stoppedAt || completedAt, completedAt });
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
