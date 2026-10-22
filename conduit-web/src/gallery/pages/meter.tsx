// One page for the three ways the library shows how much of something there is.
import { createSignal, Show } from "solid-js";
import { Button, Gauge, Meter, Progress, Reading, ReadingTotal, SettingWide } from "@/components/ui";
import { row, token, type Page } from "../model";

function GaugeExample() {
  const [open, setOpen] = createSignal(false);
  return <><Button variant="ghost" size="sm" aria-label="Context usage: 100%" aria-expanded={open()} onClick={() => setOpen(!open())}><Gauge value={100} />100%</Button><Show when={open()}><Reading><ReadingTotal label="Context usage for conduit-web development and workspace review" value="200,000 / 200,000 tokens" /></Reading></Show></>;
}

export const meterPage: Page = {
  title: "Meter",
  summary: "How much of something there is. Meter is the full form: a bar of coloured parts, with a rule where something happens. Gauge is the same reading as a ring, for a slot the size of an icon (the composer's context); Progress is a single bar for work under way, a native progress element that assistive tech reads out. All three share the track: --track-size on a --tint ground.",
  preview: () => <div class="g-row" style={{ gap: "var(--space-2xl)", width: "min(100%, 420px)" }}>
    <Gauge value={42} />
    <div style={{ flex: "1" }}><Meter parts={[{ value: 30, colour: "var(--category-1)" }, { value: 12, colour: "var(--category-2)" }, { value: 58, colour: "transparent" }]} mark={{ at: 85, label: "compacts at 85%" }} /></div>
  </div>,
  usage: `import { Meter, Gauge, Progress } from "@/components/ui";

<Meter parts={[{ value: 42, colour: "var(--category-1)" }, { value: 58, colour: "transparent" }]}
  mark={{ at: 85, label: "compacts at 85%", quiet: true }} />
<Gauge value={85} tone="warning" />
<Progress label="Model files" value={48} max={100} />`,
  anatomy: [
    { title: "Meter", scene: () => <Meter parts={[{ value: 42, colour: "var(--foreground)" }, { value: 58, colour: "transparent" }]} mark={{ at: 85, label: "compacts at 85%" }} />, parts: [
    { selector: ".ui-meter-bar", name: "Bar", does: "shows the parts of the whole", from: "Meter parts" },
    { selector: ".ui-meter-mark", name: "Threshold", does: "marks where the named action occurs", from: "Meter mark.at" },
    { selector: ".ui-meter-label", name: "Label", does: "names the threshold", from: "Meter mark.label" },
    ] },
    { title: "Gauge", scene: () => <Gauge value={42} tone="normal" />, parts: [
    { selector: ".ui-gauge > circle:first-child", name: "Track", does: "shows the full context window", from: "Gauge" },
    { selector: ".ui-gauge > circle:last-child", name: "Usage", does: "shows the used proportion", from: "Gauge value" },
  ] },
  ],
  examples: [
    row("Meter · context reading", "Token counts form a whole; long threshold title stays quiet.", () => <Reading><ReadingTotal label="Context window · conduit-web workspace review" value="64,000 / 200,000 tokens" /><Meter parts={[{ value: 48000, colour: "var(--category-1)" }, { value: 16000, colour: "var(--category-2)" }, { value: 136000, colour: "transparent" }]} mark={{ at: 85, label: "Conversation compacts at 170,000 of 200,000 tokens in this context window", quiet: true }} /></Reading>, { code: "<Reading><Meter parts={tokenCounts} mark={{ at: 85, label, quiet: true }} /></Reading>" }),
    row("Meter · long threshold", "Visible threshold text at the centre of the bar.", () => <Meter parts={[{ value: 1, colour: "var(--category-1)" }, { value: 1, colour: "transparent" }]} mark={{ at: 50, label: "Compact the workspace review conversation at half of the available context window", quiet: false }} />, { code: "<Meter parts mark={{ at: 50, label, quiet: false }} />" }),
    row("Meter · parts", "Messages use 42%; the remaining 58% is free.", () => <Meter parts={[{ value: 42, colour: "var(--foreground)" }, { value: 58, colour: "transparent" }]} />),
    row("Meter · named threshold", "Context compacts at the named 85% threshold.", () => <Meter parts={[{ value: 42, colour: "var(--foreground)" }, { value: 58, colour: "transparent" }]} mark={{ at: 85, label: "compacts at 85%" }} />),
    row("Meter · quiet threshold", "The threshold rule has a title and no label below it.", () => <Meter parts={[{ value: 42, colour: "var(--foreground)" }, { value: 58, colour: "transparent" }]} mark={{ at: 85, label: "compacts at 85%", quiet: true }} />),
    row("Gauge · composer control", "Full context ring; click to open its usage reading.", () => <GaugeExample />, { code: '<Button variant="ghost" size="sm"><Gauge value={100} />100%</Button>' }),
    row("Gauge · idle", "Context usage is 0%; tone is idle.", () => <Gauge value={0} tone="idle" />),
    row("Gauge · normal", "Context usage is 42%; tone is normal.", () => <Gauge value={42} tone="normal" />),
    row("Gauge · warning", "Context usage is 85%; tone is warning.", () => <Gauge value={85} tone="warning" />),
    row("Gauge · critical", "Context usage is 98%; tone is critical.", () => <Gauge value={98} tone="critical" />),
    row("Progress · model download", "Byte maximum in the settings download container.", () => <SettingWide><Reading><ReadingTotal label="whisper-large-v3-turbo · downloading model files" value="384 MB / 768 MB" /><Progress label="whisper-large-v3-turbo model files in /work/models/transcription" value={384000000} max={768000000} /></Reading></SettingWide>, { code: "<SettingWide><Progress label value={384000000} max={768000000} /></SettingWide>" }),
    row("Progress · waiting", "No model files have downloaded.", () => <Progress label="Model files: waiting" value={0} max={100} />),
    row("Progress · downloading", "48 of 100 model file units have downloaded.", () => <Progress label="Model files: downloading" value={48} max={100} />),
    row("Progress · complete", "All model files have downloaded.", () => <Progress label="Model files: complete" value={100} max={100} />),
  ],
  tokens: [
    { title: "Meter", tokens: [
    token("--track-size", "Track height"),
    token("--hairline", "Fine line width"),
    token("--tint", "Surface tint"),
    token("--text-caption", "Label or value size"),
    token("--muted-foreground", "Quiet text or stroke colour"),
    ] },
    { title: "Gauge", tokens: [
    token("--icon-sm", "Ring size"),
    token("--tone-line", "Empty ring opacity"),
    token("--warn", "Warning colour"),
    token("--destructive", "Critical colour"),
    token("--duration-gentle", "Value change duration"),
    ] },
    { title: "Progress", tokens: [
    token("--track-size", "Track height"),
    token("--radius-round", "Round corner"),
    token("--tint", "Surface tint"),
    token("--foreground", "Text or filled track colour"),
    ] },
  ],
  api: ["Meter", "Gauge", "Progress"],
};
