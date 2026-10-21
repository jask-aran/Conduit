// Props: parts (value, colour), mark (at, label, quiet).
import { Reading, ReadingTotal } from "@/components/ui";
import { Meter } from "@/components/ui";
import { FormTable, form } from "../specs";
import { lib, type Family } from "../model";

export const meterFamily: Family = {
  title: "Meter", stage: true,
  note: "A bar shows parts of a whole and an optional threshold.",
  usage: `import { Meter } from "@/components/ui";

<Meter parts={[{ value: 42, colour: "var(--foreground)" },
  { value: 58, colour: "transparent" }]}
  mark={{ at: 85, label: "compacts at 85%", quiet: true }} />`,
  api: ["Meter"],
  groups: [{ title: "Examples", staged: "density", atoms: [
      lib("meter-examples", "meter · more examples", "both", "control", "meter", () => <FormTable rows={[
        form("context reading", "Token counts form a whole; long threshold title stays quiet.", () => <Reading><ReadingTotal label="Context window · conduit-web workspace review" value="64,000 / 200,000 tokens" /><Meter parts={[{ value: 48000, colour: "var(--category-1)" }, { value: 16000, colour: "var(--category-2)" }, { value: 136000, colour: "transparent" }]} mark={{ at: 85, label: "Conversation compacts at 170,000 of 200,000 tokens in this context window", quiet: true }} /></Reading>, "<Reading><Meter parts={tokenCounts} mark={{ at: 85, label, quiet: true }} /></Reading>"),
        form("long threshold", "Visible threshold text at the centre of the bar.", () => <Meter parts={[{ value: 1, colour: "var(--category-1)" }, { value: 1, colour: "transparent" }]} mark={{ at: 50, label: "Compact the workspace review conversation at half of the available context window", quiet: false }} />, "<Meter parts mark={{ at: 50, label, quiet: false }} />"),
      ]} on={["ground", "frost"]} />, "row"),

      lib("meter-parts", "Parts", "both", "control", "Meter", () => <FormTable rows={[
        form("Parts", "Messages use 42%; the remaining 58% is free.", () => <Meter parts={[{ value: 42, colour: "var(--foreground)" }, { value: 58, colour: "transparent" }]} />),
      ]} on={["ground", "frost"]} />, "row"),
      lib("meter-marked", "Named threshold", "both", "control", "Meter", () => <FormTable rows={[
        form("Named threshold", "Context compacts at the named 85% threshold.", () => <Meter parts={[{ value: 42, colour: "var(--foreground)" }, { value: 58, colour: "transparent" }]} mark={{ at: 85, label: "compacts at 85%" }} />),
      ]} on={["ground", "frost"]} />, "row"),
      lib("meter-quiet", "Quiet threshold", "both", "control", "Meter", () => <FormTable rows={[
        form("Quiet threshold", "The threshold rule has a title and no label below it.", () => <Meter parts={[{ value: 42, colour: "var(--foreground)" }, { value: 58, colour: "transparent" }]} mark={{ at: 85, label: "compacts at 85%", quiet: true }} />),
      ]} on={["ground", "frost"]} />, "row"),
  ] }],
};
