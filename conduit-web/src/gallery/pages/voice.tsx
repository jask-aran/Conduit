import { createSignal } from "solid-js";
import { Button, SettingGroup, SettingLine, SettingWide, VoiceWaveform } from "@/components/ui";
import { FormTable, form } from "../specs";

import { VoiceFoundation } from "../voice";
import { type Family, lib } from "../model";

export const voiceFamily: Family = { title: "Voice", note: "the voice while it is heard: the waveform monitor (Settings · Voice, and compact where the mic is tested), in each state it has", usage: `import { VoiceWaveform } from "@/components/ui/voice";

<VoiceWaveform history={audioInputWaveform.history}
  level={audioInputWaveform.level} peak={audioInputWaveform.peak}
  state="listening" variant="compact" barDensity={3}
  ariaLabel="Microphone input level" />`,
  api: ["VoiceWaveform"],
  groups: [{ title: "States", layout: "desktop", atoms: [
    lib("voice-waveform", "VoiceWaveform", "both", "voice", "components/ui/voice.tsx", () => <VoiceFoundation />, "row"),
  ] }] };

voiceFamily.groups.push({ title: "Examples", layout: "desktop", atoms: [
    lib("voice-examples", "VoiceWaveform · examples", "both", "voice", "VoiceWaveform history level peak barCount barDensity gain ariaLabel", () => <FormTable on={["desktop", "phone"]} stacked rows={[
      form("Microphone test", "Responsive bars in Voice settings; stop and resume", () => {
        const [listening, setListening] = createSignal(true);
        const samples = Array.from({ length: 96 }, (_, i) => (Math.sin(i / 4) + 1) * .3);
        return <SettingGroup title="Voice"><SettingLine plain label="Microphone input · MacBook Pro built-in microphone with voice isolation" state={listening() ? "Listening" : "Stopped"}><Button size="sm" variant="ghost" outline onClick={() => setListening(!listening())}>{listening() ? "Stop test" : "Test microphone"}</Button></SettingLine><SettingWide><VoiceWaveform history={() => samples} level={() => .32} peak={() => .6} state={listening() ? "listening" : "stopped"} variant="compact" barDensity={3} ariaLabel="MacBook Pro microphone input level" /></SettingWide></SettingGroup>;
      }, '<SettingWide><VoiceWaveform variant="compact" barDensity={3} /></SettingWide>'),
      form("Quiet input", "24 bars; doubled gain; zero peak", () => <VoiceWaveform history={() => Array.from({ length: 24 }, (_, i) => i % 3 * .025)} level={() => .025} peak={() => 0} state="listening" barCount={24} gain={2} ariaLabel="Quiet microphone input with doubled gain" />, "<VoiceWaveform barCount={24} gain={2} />"),
      form("Full input", "Bars and readouts at their upper limit", () => <VoiceWaveform history={() => [1, .9, 1, .8, 1]} level={() => 1} peak={() => 1} state="listening" barCount={32} gain={1} />, "<VoiceWaveform barCount={32} gain={1} />"),
    ]} />, "row"),
  ] });
