import { createSignal, onCleanup, type Accessor } from "solid-js";
import type { AudioSignalLevel } from "./voice-audio";
import { emptyWaveformHistory, normalizeVoiceLevel, normalizeVoicePeak, VOICE_WAVEFORM_SAMPLE_COUNT } from "@/components/ui/voice-waveform-model";

export const VOICE_WAVEFORM_SAMPLE_INTERVAL_MS = 70;
const PEAK_HOLD_MS = 650;
const PEAK_DECAY = 0.86;

export interface VoiceWaveformController {
  history: Accessor<number[]>;
  level: Accessor<number>;
  peak: Accessor<number>;
  push: (level: AudioSignalLevel) => void;
  reset: () => void;
}

export function createVoiceWaveformController(sampleCount = VOICE_WAVEFORM_SAMPLE_COUNT): VoiceWaveformController {
  const [history, setHistory] = createSignal(emptyWaveformHistory(sampleCount));
  const [level, setLevel] = createSignal(0);
  const [peak, setPeak] = createSignal(0);
  let latestLevel = 0;
  let latestPeak = 0;
  let peakValue = 0;
  let peakLastRaisedAt = 0;
  let lastSampleAt = 0;
  let sampleFrame: number | null = null;

  const sample = () => {
    sampleFrame = null;
    const now = performance.now();
    if (now - lastSampleAt < VOICE_WAVEFORM_SAMPLE_INTERVAL_MS) return;
    lastSampleAt = now;
    if (latestPeak >= peakValue) {
      peakValue = latestPeak;
      peakLastRaisedAt = now;
    } else if (now - peakLastRaisedAt >= PEAK_HOLD_MS) {
      peakValue *= PEAK_DECAY;
    }
    setLevel(latestLevel);
    setPeak(peakValue);
    setHistory((current) => [...current.slice(-(sampleCount - 1)), latestLevel]);
  };

  const push = (next: AudioSignalLevel) => {
    latestLevel = normalizeVoiceLevel(next);
    latestPeak = normalizeVoicePeak(next);
    if (sampleFrame === null) sampleFrame = window.requestAnimationFrame(sample);
  };

  const reset = () => {
    if (sampleFrame !== null) window.cancelAnimationFrame(sampleFrame);
    sampleFrame = null;
    latestLevel = 0;
    latestPeak = 0;
    peakValue = 0;
    peakLastRaisedAt = 0;
    lastSampleAt = 0;
    setLevel(0);
    setPeak(0);
    setHistory(emptyWaveformHistory(sampleCount));
  };

  onCleanup(() => {
    if (sampleFrame !== null) window.cancelAnimationFrame(sampleFrame);
  });

  return { history, level, peak, push, reset };
}
