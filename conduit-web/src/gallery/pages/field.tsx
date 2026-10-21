import { Field, Input, Switch } from "@/components/ui";
import { FormTable, form } from "../specs";
import { lib, type Family } from "../model";
import { SegmentedText } from "../demos";

export const fieldFamily: Family = {
  title: "Field", stage: true,
  note: "A label above a control, or beside an inline control.",
  usage: `import { Field, Input } from "@/components/ui/controls";

<Field label="Short name">
  <Input placeholder="Project name" />
</Field>`,
  api: ["Field","Input","Switch","Segmented"],
  groups: [{ title: "Examples", staged: "density", atoms: [
      lib("field-label", "Label above input", "both", "control", "Field", () => <FormTable rows={[
        form("Label above input", "Short name labels the input below it.", () => <Field label="Short name"><Input placeholder="Project name" /></Field>),
      ]} on={["ground", "frost"]} />, "row"),
      lib("field-inline", "Inline switch", "both", "control", "Field", () => <FormTable rows={[
        form("Inline switch", "The label and switch share one row.", () => <Field label="Notifications" plain inline><Switch label="Notifications" checked /></Field>),
      ]} on={["ground", "frost"]} />, "row"),
      lib("field-group", "Plain group", "both", "control", "Field", () => <FormTable rows={[
        form("Plain group", "A group label does not select a radio option.", () => <Field label="Source" plain><SegmentedText /></Field>),
      ]} on={["ground", "frost"]} />, "row"),
  ] }],
};
