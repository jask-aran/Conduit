import { createSignal } from "solid-js";
import { Field, SettingLine } from "@/components/ui";
import { Input } from "@/components/ui";
import { row, token, type Page } from "../model";

function FolderInput() {
  const [name, setName] = createSignal("conduit-web");
  return <Field label="Workspace name"><Input value={name()} onInput={(event) => setName(event.currentTarget.value)} /></Field>;
}
export const inputPage: Page = {
  title: "Input",
  summary: "Input reads the surface's --tint and --well values.",
  preview: () => <FolderInput />,
  usage: `import { Input } from "@/components/ui";

<Input placeholder="Add a note (optional)" aria-label="Note"
  value={note()} onInput={(event) => setNote(event.currentTarget.value)} />`,
  examples: [
    row("Input", "Input", () => <div class="g-field"><Input placeholder="Replace" /><Input value="Lorem ipsum file" /></div>),
    row("rename workspace", "Editable name inside Field", () => <FolderInput />, { code: "Field > Input value onInput" }),
    row("disabled", "Server address while connecting", () => <Input aria-label="Server address" value="laptop.ts.net" disabled />, { code: "<Input disabled>" }),
    row("read only", "Workspace path cannot be edited", () => <Input aria-label="Workspace path" value="/work/conduit/conduit-web" readOnly />, { code: "<Input readOnly>" }),
    row("long path", "Single-line content scrolls", () => <Input aria-label="Folder path" value="/work/conduit/conduit-web/src/gallery/pages/component-examples" />, { code: "<Input value>" }),
    row("password", "Masked stored API key", () => <Input aria-label="API key" type="password" value="conduit-demo-key" readOnly />, { code: '<Input type="password" readOnly>' }),
    row("number setting", "Bounded chat count in settings", () => <SettingLine label="Sidebar chats"><Input aria-label="Sidebar chats" type="number" min={1} max={100} step={1} value={20} /></SettingLine>, { code: 'SettingLine > Input type="number"' }),
  ],
  tokens: [{ title: "Input", tokens: [
    token("--control", "Control height"),
    token("--text-row", "Control text size"),
    token("--tint", "Surface tint"),
    token("--well", "Surface fill"),
  ] }],
  api: ["Input"],
};
