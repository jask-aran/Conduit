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
