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
