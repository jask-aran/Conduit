// Props: value, tone (idle, normal, warning, critical; omitted defaults to normal).
import { createSignal, Show } from "solid-js";
import { Button, Reading, ReadingTotal } from "@/components/ui";
import { Gauge } from "@/components/ui";
import { row, token, type Page } from "../model";

function GaugeExample() {
  const [open, setOpen] = createSignal(false);
  return <><Button variant="ghost" size="sm" aria-label="Context usage: 100%" aria-expanded={open()} onClick={() => setOpen(!open())}><Gauge value={100} />100%</Button><Show when={open()}><Reading><ReadingTotal label="Context usage for conduit-web development and workspace review" value="200,000 / 200,000 tokens" /></Reading></Show></>;
}

export const gaugePage: Page = {
  title: "Gauge",
  summary: "A ring shows context usage; its tone shows the usage state.",
  preview: () => <Gauge value={42} tone="normal" />,
  usage: `import { Gauge } from "@/components/ui";

<Gauge value={85} tone="warning" />`,
  anatomy: { scene: () => <Gauge value={42} tone="normal" />, parts: [
    { selector: ".ui-gauge > circle:first-child", name: "Track", does: "shows the full context window", from: "Gauge" },
    { selector: ".ui-gauge > circle:last-child", name: "Usage", does: "shows the used proportion", from: "Gauge value" },
  ] },
  examples: [
    row("composer control", "Full context ring; click to open its usage reading.", () => <GaugeExample />, { code: '<Button variant="ghost" size="sm"><Gauge value={100} />100%</Button>' }),
    row("idle", "Context usage is 0%; tone is idle.", () => <Gauge value={0} tone="idle" />),
    row("normal", "Context usage is 42%; tone is normal.", () => <Gauge value={42} tone="normal" />),
    row("warning", "Context usage is 85%; tone is warning.", () => <Gauge value={85} tone="warning" />),
    row("critical", "Context usage is 98%; tone is critical.", () => <Gauge value={98} tone="critical" />),
  ],
  tokens: [{ title: "Gauge", tokens: [
    token("--icon-sm", "Ring size"),
    token("--tone-line", "Empty ring opacity"),
    token("--warn", "Warning colour"),
    token("--destructive", "Critical colour"),
    token("--duration-gentle", "Value change duration"),
  ] }],
  api: ["Gauge"],
};
