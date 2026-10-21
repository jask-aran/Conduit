import { createSignal } from "solid-js";
import { Card, Icons } from "@/components/ui";
import { Field, Input, Switch } from "@/components/ui";
import { FormTable, form } from "../specs";
import { lib, type Family } from "../model";
import { SegmentedText } from "../demos";

function RunOnStartField() {
  const [enabled, setEnabled] = createSignal(false);
  return <Field inline label="Also run when /terminal starts or recovers a shell"><Switch label="Run on start" checked={enabled()} onChange={setEnabled} /></Field>;
}
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
      lib("field-examples", "Field · additional examples", "both", "control", "Field", () => <FormTable rows={[
        form("inline label", "Long label beside a clickable switch", () => <RunOnStartField />, "Field inline > Switch checked onChange"),
        form("icon label", "Label accepts an icon and text", () => <Field label={<><Icons.Folder />Workspace folder</>}><Input value="/work/conduit" /></Field>, "Field label={JSX} > Input"),
        form("disabled control", "Label stays visible for a locked field", () => <Field label="Server address"><Input value="laptop.ts.net" disabled /></Field>, "Field > Input disabled"),
        form("inside card", "Long folder name in a dialog field", () => <Card title="Rename workspace"><Field label="Workspace name"><Input value="conduit-web component gallery and client settings" /></Field></Card>, "Card > Field > Input"),
      ]} on={["ground", "frost"]} />, "row"),
  ] }],
};
