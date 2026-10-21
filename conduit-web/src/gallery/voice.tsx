import { createSignal, onCleanup } from "solid-js";
import { VoiceWaveform, type VoiceWaveformState } from "@/components/ui/voice";
import { emptyWaveformHistory, VOICE_WAVEFORM_SAMPLE_COUNT } from "@/components/ui/voice-waveform-model";
import { FormTable, form } from "./specs";

export function VoiceFoundation() {
  const [history, setHistory] = createSignal(emptyWaveformHistory(VOICE_WAVEFORM_SAMPLE_COUNT));
  const [level, setLevel] = createSignal(0);
  const [peak, setPeak] = createSignal(0);
  let t = 0;
  const timer = setInterval(() => {
    t += 1;
    const next = Math.max(0, Math.min(1, (Math.sin(t / 3) * .5 + .5) * (Math.sin(t / 11) * .4 + .6) * (.6 + Math.random() * .4)));
    setLevel(next);
    setPeak((current) => Math.max(next, current * .98));
    setHistory((current) => [...current.slice(1), next]);
  }, 70);
  onCleanup(() => clearInterval(timer));

  const silent = () => 0;
  const empty = emptyWaveformHistory(VOICE_WAVEFORM_SAMPLE_COUNT);
  const states: { state: VoiceWaveformState; monitor: string; compact: string }[] = [
    { state: "connecting", monitor: "Connecting label and pulsing dot; bars stay quiet until input arrives.", compact: "Quiet bars; the compact form hides the connecting label and dot." },
    { state: "listening", monitor: "Listening label and live dot; moving bars, level and peak show synthetic input.", compact: "Moving bars show synthetic input; the compact form hides labels and readouts." },
    { state: "stopped", monitor: "Stopped label and neutral dot; the last bars, level and peak stay visible.", compact: "The last bars stay visible; the compact form hides the stopped label." },
    { state: "error", monitor: "Microphone error label and destructive dot and border; bars show no input.", compact: "Quiet bars and destructive border; the compact form hides the error label and dot." },
  ];
  const stoppedHistory = Array.from({ length: VOICE_WAVEFORM_SAMPLE_COUNT }, (_, i) => (Math.sin(i / 3) * .5 + .5) * .65);
  return <FormTable on={["desktop", "phone"]} stacked rows={states.flatMap(({ state, monitor, compact }) =>
    (["monitor", "compact"] as const).map((variant) => form(`${state} · ${variant}`, variant === "monitor" ? monitor : compact,
      () => <VoiceWaveform state={state} variant={variant}
        history={state === "listening" ? history : () => state === "stopped" ? stoppedHistory : empty}
        level={state === "listening" ? level : state === "stopped" ? () => .35 : silent}
        peak={state === "listening" ? peak : state === "stopped" ? () => .65 : silent} />,
      `VoiceWaveform state="${state}" variant="${variant}"`)))} />;
}
