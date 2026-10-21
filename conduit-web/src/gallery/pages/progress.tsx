// Props: value, max, label.
import { SettingWide, Reading, ReadingTotal } from "@/components/ui";
import { Progress } from "@/components/ui";
import { FormTable, form } from "../specs";
import { lib, type Family } from "../model";

export const progressFamily: Family = {
  title: "Progress", stage: true,
  note: "Measured progress uses a value and a maximum.",
  usage: `import { Progress } from "@/components/ui/controls";

<Progress label="Model files" value={48} max={100} />`,
  api: ["Progress"],
  groups: [{ title: "Examples", staged: "density", atoms: [
      lib("progress-examples", "progress · more examples", "both", "control", "progress", () => <FormTable rows={[
        form("model download", "Byte maximum in the settings download container.", () => <SettingWide><Reading><ReadingTotal label="whisper-large-v3-turbo · downloading model files" value="384 MB / 768 MB" /><Progress label="whisper-large-v3-turbo model files in /work/models/transcription" value={384000000} max={768000000} /></Reading></SettingWide>, "<SettingWide><Progress label value={384000000} max={768000000} /></SettingWide>"),
      ]} on={["ground", "frost"]} />, "row"),

      lib("progress-empty", "Waiting", "both", "control", "Progress", () => <FormTable rows={[
        form("Waiting", "No model files have downloaded.", () => <Progress label="Model files: waiting" value={0} max={100} />),
      ]} on={["ground", "frost"]} />, "row"),
      lib("progress-partial", "Downloading", "both", "control", "Progress", () => <FormTable rows={[
        form("Downloading", "48 of 100 model file units have downloaded.", () => <Progress label="Model files: downloading" value={48} max={100} />),
      ]} on={["ground", "frost"]} />, "row"),
      lib("progress-complete", "Complete", "both", "control", "Progress", () => <FormTable rows={[
        form("Complete", "All model files have downloaded.", () => <Progress label="Model files: complete" value={100} max={100} />),
      ]} on={["ground", "frost"]} />, "row"),
  ] }],
};
