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
