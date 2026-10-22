import { createSignal } from "solid-js";
import { Card, Icons } from "@/components/ui";
import { Field, Input, Switch } from "@/components/ui";
import { row, token, type Page } from "../model";
import { SegmentedText } from "../demos";

function RunOnStartField() {
  const [enabled, setEnabled] = createSignal(false);
  return <Field inline label="Also run when /terminal starts or recovers a shell"><Switch label="Run on start" checked={enabled()} onChange={setEnabled} /></Field>;
}
export const fieldPage: Page = {
  title: "Field",
  summary: "A label above a control, or beside an inline control.",
  preview: () => <Field label="Short name"><Input placeholder="Project name" /></Field>,
  usage: `import { Field, Input } from "@/components/ui/controls";

<Field label="Short name">
  <Input placeholder="Project name" />
</Field>`,
  anatomy: { scene: () => <Field label="Short name"><Input placeholder="Project name" /></Field>, parts: [
    { selector: ".ui-field-label", name: "Label", does: "names the control", from: "Field label" },
    { selector: ".ui-input", name: "Control", does: "accepts the field value", from: "Input" },
  ] },
  examples: [
    row("Label above input", "Short name labels the input below it.", () => <Field label="Short name"><Input placeholder="Project name" /></Field>),
    row("Inline switch", "The label and switch share one row.", () => <Field label="Notifications" plain inline><Switch label="Notifications" checked /></Field>),
    row("Plain group", "A group label does not select a radio option.", () => <Field label="Source" plain><SegmentedText /></Field>),
    row("inline label", "Long label beside a clickable switch", () => <RunOnStartField />, { code: "Field inline > Switch checked onChange" }),
    row("icon label", "Label accepts an icon and text", () => <Field label={<><Icons.Folder />Workspace folder</>}><Input value="/work/conduit" /></Field>, { code: "Field label={JSX} > Input" }),
    row("disabled control", "Label stays visible for a locked field", () => <Field label="Server address"><Input value="laptop.ts.net" disabled /></Field>, { code: "Field > Input disabled" }),
    row("inside card", "Long folder name in a dialog field", () => <Card title="Rename workspace"><Field label="Workspace name"><Input value="conduit-web component gallery and client settings" /></Field></Card>, { code: "Card > Field > Input", surfaces: ["ground"] }),
  ],
  tokens: [{ title: "Field", tokens: [
    token("--card-pair", "Label and control gap"),
    token("--space-lg", "Inline gap"),
    token("--text-caption", "Label or value size"),
    token("--weight-lift", "Label weight"),
  ] }],
  api: ["Field","Input","Switch","Segmented"],
};
