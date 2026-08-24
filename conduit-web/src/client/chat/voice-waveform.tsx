import { createSignal, For, onCleanup, onMount, Show, type Accessor } from "solid-js";
import type { AudioSignalLevel } from "./voice-audio";
import {
  compactWaveformBarCount,
  emptyWaveformHistory,
  MAX_RESPONSIVE_BAR_COUNT,
  normalizeVoiceLevel,
  normalizeVoicePeak,
  selectWaveformBars,
  VOICE_WAVEFORM_SAMPLE_COUNT,
  waveformBarHeightPercent,
} from "./voice-waveform-model";

export {
  compactWaveformBarCount,
  MAX_RESPONSIVE_BAR_COUNT,
  normalizeVoiceLevel,
  normalizeVoicePeak,
  selectWaveformBars,
  VOICE_WAVEFORM_SAMPLE_COUNT,
  waveformBarHeightPercent,
};
export const VOICE_WAVEFORM_SAMPLE_INTERVAL_MS = 70;
const PEAK_HOLD_MS = 650;
const PEAK_DECAY = 0.86;

export type VoiceWaveformState = "connecting" | "listening" | "stopped" | "error";

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

export interface VoiceWaveformProps {
  history: Accessor<number[]>;
  level: Accessor<number>;
  peak: Accessor<number>;
  state: VoiceWaveformState;
  barCount?: number;
  /** Pixels allocated to each bar when the plot width is known. */
  barDensity?: number;
  variant?: "monitor" | "compact";
  ariaLabel?: string;
  class?: string;
}

const stateLabel = (state: VoiceWaveformState) => ({
  connecting: "Connecting",
  listening: "Listening",
  stopped: "Stopped",
  error: "Microphone error",
}[state]);

const percent = (value: number) => `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;

export function VoiceWaveform(props: VoiceWaveformProps) {
  let plot!: HTMLDivElement;
  const [plotWidth, setPlotWidth] = createSignal(0);
  let resizeObserver: ResizeObserver | undefined;

  onMount(() => {
    if (!props.barDensity || typeof ResizeObserver === "undefined") return;
    const measure = () => setPlotWidth(plot.getBoundingClientRect().width);
    measure();
    resizeObserver = new ResizeObserver(([entry]) => {
      if (entry) setPlotWidth(entry.contentRect.width);
    });
    resizeObserver.observe(plot);
  });

  onCleanup(() => resizeObserver?.disconnect());

  const compact = () => props.variant === "compact";
  const bars = () => {
    const history = props.history();
    const responsiveCount = compactWaveformBarCount(plotWidth(), props.barDensity || 0);
    const count = Math.max(1, Math.floor(responsiveCount || props.barCount || history.length || VOICE_WAVEFORM_SAMPLE_COUNT));
    return selectWaveformBars(history, count, { pad: true });
  };
  const title = () => stateLabel(props.state);
  const peakHeight = () => `${waveformBarHeightPercent(props.peak())}%`;
  return <div class={`voice-waveform${props.class ? ` ${props.class}` : ""}`} data-state={props.state} data-variant={compact() ? "compact" : "monitor"} role="img" aria-label={props.ariaLabel || `${title()} microphone input`}>
    <Show when={!compact()}>
      <div class="voice-waveform-header">
        <span class="voice-waveform-state"><span class="voice-waveform-dot" aria-hidden="true" />{title()}</span>
        <span class="voice-waveform-readout"><span>Level {percent(props.level())}</span><span>Peak {percent(props.peak())}</span></span>
      </div>
    </Show>
    <div ref={plot} class="voice-waveform-plot" aria-hidden="true">
      <Show when={!compact()}>
        <span class="voice-waveform-gridline voice-waveform-gridline-high" />
        <span class="voice-waveform-gridline voice-waveform-gridline-low" />
      </Show>
      <For each={bars()}>{(value) => <span class="voice-waveform-bar" style={{ height: `${waveformBarHeightPercent(value, compact())}%` }} />}</For>
      <Show when={!compact()}><span class="voice-waveform-peak" data-visible={props.peak() >= 0.02} style={{ bottom: peakHeight() }} /></Show>
    </div>
    <Show when={!compact()}><div class="voice-waveform-scale" aria-hidden="true"><span>quiet</span><span>now</span></div></Show>
  </div>;
}
