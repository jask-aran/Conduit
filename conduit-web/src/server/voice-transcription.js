import { OPENAI_LIVE_ADAPTER } from "../voice-settings.js";
import {
  analyzeSilence,
  createDeepgramAdapter,
  createHttpAdapter,
  createOpenaiRealtimeStreamAdapter,
} from "./dictation-stream.js";

const MAX_PCM_BYTES = 16_000 * 2 * 300;
const limits = { maxAudioBytes: MAX_PCM_BYTES, maxEventBytes: 64 * 1024, maxSegments: 16 };
const voiceError = (code, message, status = 400) => Object.assign(new Error(message), { code, status });

// This endpoint accepts the bubble's bounded, canonical PCM WAV, not arbitrary media containers.
function readWav(audio) {
  if (!Buffer.isBuffer(audio) || audio.length < 44
    || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE"
    || audio.readUInt32LE(4) !== audio.length - 8) {
    throw voiceError("invalid_audio", "Send a 16 kHz mono 16-bit PCM WAV recording.");
  }
  let format = false;
  let pcm = null;
  for (let offset = 12; offset + 8 <= audio.length;) {
    const kind = audio.toString("ascii", offset, offset + 4);
    const length = audio.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > audio.length) throw voiceError("invalid_audio", "The WAV recording is incomplete.");
    if (kind === "fmt ") {
      if (length < 16 || audio.readUInt16LE(start) !== 1 || audio.readUInt16LE(start + 2) !== 1
        || audio.readUInt32LE(start + 4) !== 16_000 || audio.readUInt32LE(start + 8) !== 32_000
        || audio.readUInt16LE(start + 12) !== 2 || audio.readUInt16LE(start + 14) !== 16) {
        throw voiceError("invalid_audio", "Send a 16 kHz mono 16-bit PCM WAV recording.");
      }
      format = true;
    } else if (kind === "data") {
      if (pcm || length % 2) throw voiceError("invalid_audio", "The WAV recording has invalid PCM data.");
      pcm = audio.subarray(start, start + length);
    }
    offset = start + length + length % 2;
  }
  if (!format || !pcm) throw voiceError("invalid_audio", "The WAV recording has no PCM data.");
  if (pcm.length > MAX_PCM_BYTES) throw voiceError("audio_too_long", "Record for no more than five minutes.", 413);
  return pcm;
}

export function createVoiceTranscriber(voiceRuntime) {
  let active = 0;
  return async (audio) => {
    if (!voiceRuntime) throw voiceError("voice_unavailable", "Voice transcription is unavailable.", 503);
    if (active >= 2) throw voiceError("voice_busy", "Voice transcription is busy. Try again.", 429);
    const pcm = readWav(audio);
    active++;
    const release = voiceRuntime.acquireLease();
    const controller = new AbortController();
    let adapter;
    // Includes cold model loading. The runtime receives the abort signal for local batch work.
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = voiceError("voice_timeout", "Voice transcription took too long. Try again.", 504);
        controller.abort(error);
        adapter?.close();
        reject(error);
      }, 600_000);
      timer.unref?.();
    });
    const transcribe = async () => {
      let config;
      try { config = await voiceRuntime.resolve(); }
      catch (error) {
        if (error.code === "dictation_not_configured") throw voiceError("voice_off", "Voice is off. Choose a voice source in Settings.", 409);
        throw error;
      }
      controller.signal.throwIfAborted();
      const ranges = analyzeSilence(pcm, pcm.length).segments;
      if (!ranges.length || !pcm.some((byte) => byte !== 0)) return "";
      if (typeof config.transcribe === "function") {
        const parts = [];
        for (const [sequence, [startSample, endSample]] of (config.wholeClips ? [[0, pcm.length / 2]] : ranges).entries()) {
          parts.push(await config.transcribe(pcm.subarray(startSample * 2, endSample * 2), {
            signal: controller.signal, sequence, startSample, endSample,
          }));
        }
        return parts.filter(Boolean).join(" ").trim();
      }
      let text = "";
      let failure;
      const emit = (event) => {
        if (event.type === "final" || event.type === "adapter_closed") text = String(event.text || text);
        if (event.type === "error") failure = voiceError(event.code || "asr_error", event.message || "Voice transcription failed.", 502);
      };
      const fetchImpl = voiceRuntime.fetchImpl;
      adapter = config.adapter === OPENAI_LIVE_ADAPTER
        ? createOpenaiRealtimeStreamAdapter(emit, limits, config.stream)
        : config.adapter === "deepgram_audio_v1"
          ? createDeepgramAdapter(config, emit, limits, fetchImpl, null, { signal: controller.signal })
          : createHttpAdapter(config, emit, limits, fetchImpl, null, { signal: controller.signal });
      await adapter.opened;
      controller.signal.throwIfAborted();
      // Realtime providers receive small PCM frames; HTTP adapters coalesce them into one upload.
      for (let offset = 0; offset < pcm.length; offset += 32_000) adapter.write(pcm.subarray(offset, offset + 32_000));
      await adapter.stop();
      if (failure) throw failure;
      return text.trim();
    };
    try { return await Promise.race([transcribe(), deadline]); }
    finally {
      clearTimeout(timer);
      controller.abort();
      adapter?.close();
      release();
      active--;
    }
  };
}
