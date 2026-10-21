import { Gauge } from "@/components/ui";
import { FormTable, form } from "../specs";
import { lib, type Family } from "../model";

export const gaugeFamily: Family = {
  title: "Gauge", stage: true,
  note: "A ring shows context usage; its tone shows the usage state.",
  usage: `import { Gauge } from "@/components/ui";

<Gauge value={85} tone="warning" />`,
  api: ["Gauge"],
  groups: [{ title: "Examples", staged: "density", atoms: [
      lib("gauge-idle", "idle", "both", "control", "Gauge", () => <FormTable rows={[
        form("idle", "Context usage is 0%; tone is idle.", () => <Gauge value={0} tone="idle" />),
      ]} on={["ground", "frost"]} />, "row"),
      lib("gauge-normal", "normal", "both", "control", "Gauge", () => <FormTable rows={[
        form("normal", "Context usage is 42%; tone is normal.", () => <Gauge value={42} tone="normal" />),
      ]} on={["ground", "frost"]} />, "row"),
      lib("gauge-warning", "warning", "both", "control", "Gauge", () => <FormTable rows={[
        form("warning", "Context usage is 85%; tone is warning.", () => <Gauge value={85} tone="warning" />),
      ]} on={["ground", "frost"]} />, "row"),
      lib("gauge-critical", "critical", "both", "control", "Gauge", () => <FormTable rows={[
        form("critical", "Context usage is 98%; tone is critical.", () => <Gauge value={98} tone="critical" />),
      ]} on={["ground", "frost"]} />, "row"),
  ] }],
};
