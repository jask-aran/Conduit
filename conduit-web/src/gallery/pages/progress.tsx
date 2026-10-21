// Props: value, max, label.
import { SettingWide, Reading, ReadingTotal } from "@/components/ui";
import { Progress } from "@/components/ui";
import { row, token, type Page } from "../model";

export const progressPage: Page = {
  title: "Progress",
  summary: "Measured progress uses a value and a maximum.",
  preview: () => <Progress label="Model files: downloading" value={48} max={100} />,
  usage: `import { Progress } from "@/components/ui/controls";

<Progress label="Model files" value={48} max={100} />`,
  examples: [
    row("model download", "Byte maximum in the settings download container.", () => <SettingWide><Reading><ReadingTotal label="whisper-large-v3-turbo · downloading model files" value="384 MB / 768 MB" /><Progress label="whisper-large-v3-turbo model files in /work/models/transcription" value={384000000} max={768000000} /></Reading></SettingWide>, { code: "<SettingWide><Progress label value={384000000} max={768000000} /></SettingWide>" }),
    row("Waiting", "No model files have downloaded.", () => <Progress label="Model files: waiting" value={0} max={100} />),
    row("Downloading", "48 of 100 model file units have downloaded.", () => <Progress label="Model files: downloading" value={48} max={100} />),
    row("Complete", "All model files have downloaded.", () => <Progress label="Model files: complete" value={100} max={100} />),
  ],
  tokens: [{ title: "Progress", tokens: [
    token("--track-size", "Track height"),
    token("--radius-round", "Round corner"),
    token("--tint", "Surface tint"),
    token("--foreground", "Text or filled track colour"),
  ] }],
  api: ["Progress"],
};
