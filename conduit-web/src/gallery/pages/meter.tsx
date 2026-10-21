// Props: parts (value, colour), mark (at, label, quiet).
import { Reading, ReadingTotal } from "@/components/ui";
import { Meter } from "@/components/ui";
import { row, token, type Page } from "../model";

export const meterPage: Page = {
  title: "Meter",
  summary: "A bar shows parts of a whole and an optional threshold.",
  preview: () => <Meter parts={[{ value: 42, colour: "var(--foreground)" }, { value: 58, colour: "transparent" }]} />,
  usage: `import { Meter } from "@/components/ui";

<Meter parts={[{ value: 42, colour: "var(--foreground)" },
  { value: 58, colour: "transparent" }]}
  mark={{ at: 85, label: "compacts at 85%", quiet: true }} />`,
  anatomy: { scene: () => <Meter parts={[{ value: 42, colour: "var(--foreground)" }, { value: 58, colour: "transparent" }]} mark={{ at: 85, label: "compacts at 85%" }} />, parts: [
    { selector: ".ui-meter-bar", name: "Bar", does: "shows the parts of the whole", from: "Meter parts" },
    { selector: ".ui-meter-mark", name: "Threshold", does: "marks where the named action occurs", from: "Meter mark.at" },
    { selector: ".ui-meter-label", name: "Label", does: "names the threshold", from: "Meter mark.label" },
  ] },
  examples: [
    row("context reading", "Token counts form a whole; long threshold title stays quiet.", () => <Reading><ReadingTotal label="Context window · conduit-web workspace review" value="64,000 / 200,000 tokens" /><Meter parts={[{ value: 48000, colour: "var(--category-1)" }, { value: 16000, colour: "var(--category-2)" }, { value: 136000, colour: "transparent" }]} mark={{ at: 85, label: "Conversation compacts at 170,000 of 200,000 tokens in this context window", quiet: true }} /></Reading>, { code: "<Reading><Meter parts={tokenCounts} mark={{ at: 85, label, quiet: true }} /></Reading>" }),
    row("long threshold", "Visible threshold text at the centre of the bar.", () => <Meter parts={[{ value: 1, colour: "var(--category-1)" }, { value: 1, colour: "transparent" }]} mark={{ at: 50, label: "Compact the workspace review conversation at half of the available context window", quiet: false }} />, { code: "<Meter parts mark={{ at: 50, label, quiet: false }} />" }),
    row("Parts", "Messages use 42%; the remaining 58% is free.", () => <Meter parts={[{ value: 42, colour: "var(--foreground)" }, { value: 58, colour: "transparent" }]} />),
    row("Named threshold", "Context compacts at the named 85% threshold.", () => <Meter parts={[{ value: 42, colour: "var(--foreground)" }, { value: 58, colour: "transparent" }]} mark={{ at: 85, label: "compacts at 85%" }} />),
    row("Quiet threshold", "The threshold rule has a title and no label below it.", () => <Meter parts={[{ value: 42, colour: "var(--foreground)" }, { value: 58, colour: "transparent" }]} mark={{ at: 85, label: "compacts at 85%", quiet: true }} />),
  ],
  tokens: [{ title: "Meter", tokens: [
    token("--track-size", "Track height"),
    token("--hairline", "Fine line width"),
    token("--tint", "Surface tint"),
    token("--text-caption", "Label or value size"),
    token("--muted-foreground", "Quiet text or stroke colour"),
  ] }],
  api: ["Meter"],
};
