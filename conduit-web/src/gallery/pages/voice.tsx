import type { VoiceWaveformState } from "@/components/ui/voice";
import { createSignal, onCleanup } from "solid-js";
import { Button, SettingGroup, SettingLine, SettingWide, VoiceWaveform } from "@/components/ui";

import { emptyWaveformHistory, VOICE_WAVEFORM_SAMPLE_COUNT } from "@/components/ui/voice-waveform-model";
import { row, token, type Page } from "../model";

function WaveformExample(props: { state: VoiceWaveformState; variant: "monitor" | "compact" }) {
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
  const stoppedHistory = Array.from({ length: VOICE_WAVEFORM_SAMPLE_COUNT }, (_, i) => (Math.sin(i / 3) * .5 + .5) * .65);

  return <VoiceWaveform state={props.state} variant={props.variant}
    history={props.state === "listening" ? history : () => props.state === "stopped" ? stoppedHistory : empty}
    level={props.state === "listening" ? level : props.state === "stopped" ? () => .35 : silent}
    peak={props.state === "listening" ? peak : props.state === "stopped" ? () => .65 : silent} />;
}

export const voicePage: Page = {
  title: "Voice",
  summary: "The voice while it is heard: the waveform monitor (Settings · Voice, and compact where the mic is tested), in each state it has.",
  preview: () => <WaveformExample state="listening" variant="monitor" />,
  anatomy: { scene: () => <WaveformExample state="listening" variant="monitor" />, parts: [
    { selector: ".ui-voice-waveform-state", name: "State", does: "names the microphone state and shows its status dot" },
    { selector: ".ui-voice-waveform-readout", name: "Readout", does: "shows the current level and peak" },
    { selector: ".ui-voice-waveform-plot", name: "Plot", does: "shows recent input as bars and marks the peak" },
    { selector: ".ui-voice-waveform-scale", name: "Scale", does: "labels the history from quiet to now" },
  ] },
  usage: `import { VoiceWaveform } from "@/components/ui/voice";

<VoiceWaveform history={audioInputWaveform.history}
  level={audioInputWaveform.level} peak={audioInputWaveform.peak}
  state="listening" variant="compact" barDensity={3}
  ariaLabel="Microphone input level" />`,
  examples: [
    row("connecting · monitor", "Connecting label and pulsing dot; bars stay quiet until input arrives.", () => <WaveformExample state="connecting" variant="monitor" />, { surfaces: ["ground"], phone: true, code: 'VoiceWaveform state="connecting" variant="monitor"' }),
    row("connecting · compact", "Quiet bars; the compact form hides the connecting label and dot.", () => <WaveformExample state="connecting" variant="compact" />, { surfaces: ["ground"], phone: true, code: 'VoiceWaveform state="connecting" variant="compact"' }),
    row("listening · monitor", "Listening label and live dot; moving bars, level and peak show synthetic input.", () => <WaveformExample state="listening" variant="monitor" />, { surfaces: ["ground"], phone: true, code: 'VoiceWaveform state="listening" variant="monitor"' }),
    row("listening · compact", "Moving bars show synthetic input; the compact form hides labels and readouts.", () => <WaveformExample state="listening" variant="compact" />, { surfaces: ["ground"], phone: true, code: 'VoiceWaveform state="listening" variant="compact"' }),
    row("stopped · monitor", "Stopped label and neutral dot; the last bars, level and peak stay visible.", () => <WaveformExample state="stopped" variant="monitor" />, { surfaces: ["ground"], phone: true, code: 'VoiceWaveform state="stopped" variant="monitor"' }),
    row("stopped · compact", "The last bars stay visible; the compact form hides the stopped label.", () => <WaveformExample state="stopped" variant="compact" />, { surfaces: ["ground"], phone: true, code: 'VoiceWaveform state="stopped" variant="compact"' }),
    row("error · monitor", "Microphone error label and destructive dot and border; bars show no input.", () => <WaveformExample state="error" variant="monitor" />, { surfaces: ["ground"], phone: true, code: 'VoiceWaveform state="error" variant="monitor"' }),
    row("error · compact", "Quiet bars and destructive border; the compact form hides the error label and dot.", () => <WaveformExample state="error" variant="compact" />, { surfaces: ["ground"], phone: true, code: 'VoiceWaveform state="error" variant="compact"' }),
    row("Microphone test", "Responsive bars in Voice settings; stop and resume", () => {
        const [listening, setListening] = createSignal(true);
        const samples = Array.from({ length: 96 }, (_, i) => (Math.sin(i / 4) + 1) * .3);
        return <SettingGroup title="Voice"><SettingLine plain label="Microphone input · MacBook Pro built-in microphone with voice isolation" state={listening() ? "Listening" : "Stopped"}><Button size="sm" variant="ghost" outline onClick={() => setListening(!listening())}>{listening() ? "Stop test" : "Test microphone"}</Button></SettingLine><SettingWide><VoiceWaveform history={() => samples} level={() => .32} peak={() => .6} state={listening() ? "listening" : "stopped"} variant="compact" barDensity={3} ariaLabel="MacBook Pro microphone input level" /></SettingWide></SettingGroup>;
      }, { surfaces: ["ground"], phone: true, code: '<SettingWide><VoiceWaveform variant="compact" barDensity={3} /></SettingWide>' }),
    row("Quiet input", "24 bars; doubled gain; zero peak", () => <VoiceWaveform history={() => Array.from({ length: 24 }, (_, i) => i % 3 * .025)} level={() => .025} peak={() => 0} state="listening" barCount={24} gain={2} ariaLabel="Quiet microphone input with doubled gain" />, { surfaces: ["ground"], phone: true, code: "<VoiceWaveform barCount={24} gain={2} />" }),
    row("Full input", "Bars and readouts at their upper limit", () => <VoiceWaveform history={() => [1, .9, 1, .8, 1]} level={() => 1} peak={() => 1} state="listening" barCount={32} gain={1} />, { surfaces: ["ground"], phone: true, code: "<VoiceWaveform barCount={32} gain={1} />" })
  ],
  tokens: [{ title: "What it reads", tokens: [
    token("--control-lg", "plot height"),
    token("--duration-follow", "bar response time"),
    token("--live", "listening dot"),
    token("--destructive", "error border and dot")
  ] }],
  api: ["VoiceWaveform"]
};
