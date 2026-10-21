// Props: value, tone (idle, normal, warning, critical; omitted defaults to normal).
import { createSignal, Show } from "solid-js";
import { Button, Reading, ReadingTotal } from "@/components/ui";
import { Gauge } from "@/components/ui";
import { FormTable, form } from "../specs";
import { lib, type Family } from "../model";

function GaugeExample() {
  const [open, setOpen] = createSignal(false);
  return <><Button variant="ghost" size="sm" aria-label="Context usage: 100%" aria-expanded={open()} onClick={() => setOpen(!open())}><Gauge value={100} />100%</Button><Show when={open()}><Reading><ReadingTotal label="Context usage for conduit-web development and workspace review" value="200,000 / 200,000 tokens" /></Reading></Show></>;
}

export const gaugeFamily: Family = {
  title: "Gauge", stage: true,
  note: "A ring shows context usage; its tone shows the usage state.",
  usage: `import { Gauge } from "@/components/ui";

<Gauge value={85} tone="warning" />`,
  api: ["Gauge"],
  groups: [{ title: "Examples", staged: "density", atoms: [
      lib("gauge-examples", "gauge · more examples", "both", "control", "gauge", () => <FormTable rows={[
        form("composer control", "Full context ring; click to open its usage reading.", () => <GaugeExample />, '<Button variant="ghost" size="sm"><Gauge value={100} />100%</Button>'),
      ]} on={["ground", "frost"]} />, "row"),

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
