// One page for the three ways the library shows how much of something there is.
import { createSignal, Show } from "solid-js";
import { Button, Gauge, Meter, Progress, Reading, ReadingTotal, Series, SettingGroup, SettingLine, SettingValue, SettingWide } from "@/components/ui";
import { row, token, type Page } from "../model";

/** A month of a hub's spend, as Settings › Usage draws it: quiet days, a busy week, today current. */
const SPEND = [0, 0, 0.42, 1.8, 0, 0.12, 0, 0, 2.6, 3.1, 0.9, 0, 0, 0, 0.3, 0, 5.4, 4.8, 2.2, 0, 0, 0.6, 0, 0, 1.1, 0, 0, 0.8, 2.05, 1.2]
  .map((value, index) => ({ label: `Oct ${index + 4}`, value, title: `Oct ${index + 4}: $${value.toFixed(2)}`, current: index === 29 }));

function GaugeExample() {
  const [open, setOpen] = createSignal(false);
  return <><Button variant="ghost" size="sm" aria-label="Context usage: 100%" aria-expanded={open()} onClick={() => setOpen(!open())}><Gauge value={100} />100%</Button><Show when={open()}><Reading><ReadingTotal label="Context usage for conduit-web development and workspace review" value="200,000 / 200,000 tokens" /></Reading></Show></>;
}

export const meterPage: Page = {
  title: "Meter",
  summary: "How much of something there is. Meter is the full form: a bar of coloured parts, with a rule where something happens. Gauge is the same reading as a ring, for a slot the size of an icon (the composer's context); Progress is a single bar for work under way, a native progress element that assistive tech reads out. Series is how much over time: a column per period on the same --tint ground, the current one at full strength, each column's title its reading. All share the track's ground.",
  preview: () => <div class="g-row" style={{ gap: "var(--space-2xl)", width: "min(100%, 420px)" }}>
    <Gauge value={42} />
    <div style={{ flex: "1" }}><Meter parts={[{ value: 30, colour: "var(--category-1)" }, { value: 12, colour: "var(--category-2)" }, { value: 58, colour: "transparent" }]} mark={{ at: 85, label: "compacts at 85%" }} /></div>
  </div>,
  usage: `import { Meter, Gauge, Progress } from "@/components/ui";

<Meter parts={[{ value: 42, colour: "var(--category-1)" }, { value: 58, colour: "transparent" }]}
  mark={{ at: 85, label: "compacts at 85%", quiet: true }} />
<Gauge value={85} tone="warning" />
<Progress label="Model files" value={48} max={100} />
<Series label="Spend, last 30 days: $28.65" points={days.map((day) => ({ label: day.date, value: day.cost, title, current }))} />`,
  anatomy: [
    { title: "Meter", scene: () => <Meter parts={[{ value: 42, colour: "var(--foreground)" }, { value: 58, colour: "transparent" }]} mark={{ at: 85, label: "compacts at 85%" }} />, parts: [
    { selector: ".ui-meter-bar", name: "Bar", does: "shows the parts of the whole", from: "Meter parts" },
    { selector: ".ui-meter-mark", name: "Threshold", does: "marks where the named action occurs", from: "Meter mark.at" },
    { selector: ".ui-meter-label", name: "Label", does: "names the threshold", from: "Meter mark.label" },
    ] },
    { title: "Series", scene: () => <div style={{ width: "calc(20 * var(--u-space))" }}><Series label="Spend over 30 days" points={SPEND} ends={["Oct 4", "Today"]} /></div>, parts: [
    { selector: ".ui-series-bars", name: "Ground", does: "the room each column grows in, a hairline at its foot", from: "--series-height" },
    { selector: ".ui-series-bars > span[data-current]", name: "Current", does: "the period you are in, at full strength", from: "Series points[].current" },
    { selector: ".ui-series-ends", name: "Ends", does: "names the first and last periods", from: "Series ends, or the points' labels" },
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
    row("Series · in a setting group", "Settings › Usage: a month of spend under its total; each column's title is the day's reading.", () => <div style={{ width: "calc(36 * var(--u-space))" }}><SettingGroup title="Spend"><SettingLine plain label="Last 30 days" state="API-equivalent"><SettingValue>$28.65</SettingValue></SettingLine><SettingWide><Series label="Spend, last 30 days" points={SPEND} ends={["Oct 4", "Today"]} /></SettingWide></SettingGroup></div>, { code: '<SettingWide><Series label points={days} ends={["Oct 4", "Today"]} /></SettingWide>' }),
    row("Series · a week", "Seven periods, wide columns; the last is current.", () => <div style={{ width: "calc(20 * var(--u-space))" }}><Series label="Spend, last 7 days" points={SPEND.slice(-7)} /></div>),
    row("Series · nothing yet", "Every period empty: the ground alone.", () => <div style={{ width: "calc(20 * var(--u-space))" }}><Series label="No spend in 30 days" points={SPEND.map((point) => ({ ...point, value: 0 }))} ends={["Oct 4", "Today"]} /></div>),
    row("Series · 90 days", "Narrow columns keep a stroke apart.", () => <div style={{ width: "calc(36 * var(--u-space))" }}><Series label="Spend, last 90 days" points={[...SPEND, ...SPEND, ...SPEND].map((point, index) => ({ ...point, current: index === 89 }))} ends={["Aug 5", "Today"]} /></div>),
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
    { title: "Series", tokens: [
    token("--series-height", "Room the columns grow in"),
    token("--stroke", "Gap between columns, and their corner"),
    token("--opacity-muted", "A resting column"),
    token("--tint", "Ground's foot"),
    token("--font-data", "Ends"),
    ] },
    { title: "Progress", tokens: [
    token("--track-size", "Track height"),
    token("--radius-round", "Round corner"),
    token("--tint", "Surface tint"),
    token("--foreground", "Text or filled track colour"),
    ] },
  ],
  api: ["Meter", "Gauge", "Progress", "Series"],
};
