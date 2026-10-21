import { createSignal, For, onCleanup, onMount, Show, type Accessor } from "solid-js";
import { compactWaveformBarCount, selectWaveformBars, VOICE_WAVEFORM_SAMPLE_COUNT, waveformBarHeightPercent } from "./voice-waveform-model";

export type VoiceWaveformState = "connecting" | "listening" | "stopped" | "error";

export interface VoiceWaveformProps {
  history: Accessor<number[]>;
  level: Accessor<number>;
  peak: Accessor<number>;
  state: VoiceWaveformState;
  barCount?: number;
  /** Pixels allocated to each bar when the plot width is known. */
  barDensity?: number;
  variant?: "monitor" | "compact";
  /** Multiplies each bar's level before it is drawn (clamped to full height). */
  gain?: number;
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
  return <div class={`ui-voice-waveform${props.class ? ` ${props.class}` : ""}`} data-state={props.state} data-variant={compact() ? "compact" : "monitor"} role="img" aria-label={props.ariaLabel || `${title()} microphone input`}>
    <Show when={!compact()}>
      <div class="ui-voice-waveform-header">
        <span class="ui-voice-waveform-state"><span class="ui-voice-waveform-dot" aria-hidden="true" />{title()}</span>
        <span class="ui-voice-waveform-readout"><span>Level {percent(props.level())}</span><span>Peak {percent(props.peak())}</span></span>
      </div>
    </Show>
    <div ref={plot} class="ui-voice-waveform-plot" aria-hidden="true">
      <Show when={!compact()}>
        <span class="ui-voice-waveform-gridline ui-voice-waveform-gridline-high" />
        <span class="ui-voice-waveform-gridline ui-voice-waveform-gridline-low" />
      </Show>
      <For each={bars()}>{(value) => <span class="ui-voice-waveform-bar" style={{ height: `${waveformBarHeightPercent(Math.min(1, value * (props.gain ?? 1)), compact())}%` }} />}</For>
      <Show when={!compact()}><span class="ui-voice-waveform-peak" data-visible={props.peak() >= 0.02} style={{ bottom: peakHeight() }} /></Show>
    </div>
    <Show when={!compact()}><div class="ui-voice-waveform-scale" aria-hidden="true"><span>quiet</span><span>now</span></div></Show>
  </div>;
}
