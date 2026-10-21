import { createSignal } from "solid-js";
import { Field, SettingLine } from "@/components/ui";
import { FormTable, form } from "../specs";
import { Input } from "@/components/ui";
import { lib, type Family } from "../model";

function FolderInput() {
  const [name, setName] = createSignal("conduit-web");
  return <Field label="Workspace name"><Input value={name()} onInput={(event) => setName(event.currentTarget.value)} /></Field>;
}
export const inputFamily: Family = {
  title: "Input", stage: true,
  note: "Input reads the surface's --tint and --well values, at the surface and density picked above.",
  usage: `import { Input } from "@/components/ui";

<Input placeholder="Add a note (optional)" aria-label="Note"
  value={note()} onInput={(event) => setNote(event.currentTarget.value)} />`,
  api: ["Input"],
  groups: [
    { title: "Examples", staged: true, atoms: [
      lib("input", "Input", "both", "control", "Input", () => <div class="g-field"><Input placeholder="Replace" /><Input value="Lorem ipsum file" /></div>),
      lib("input-examples", "Input · additional examples", "both", "control", "Input", () => <FormTable rows={[
        form("rename workspace", "Editable name inside Field", () => <FolderInput />, "Field > Input value onInput"),
        form("disabled", "Server address while connecting", () => <Input aria-label="Server address" value="laptop.ts.net" disabled />, "<Input disabled>"),
        form("read only", "Workspace path cannot be edited", () => <Input aria-label="Workspace path" value="/work/conduit/conduit-web" readOnly />, "<Input readOnly>"),
        form("long path", "Single-line content scrolls", () => <Input aria-label="Folder path" value="/work/conduit/conduit-web/src/gallery/pages/component-examples" />, "<Input value>"),
        form("password", "Masked stored API key", () => <Input aria-label="API key" type="password" value="conduit-demo-key" readOnly />, '<Input type="password" readOnly>'),
        form("number setting", "Bounded chat count in settings", () => <SettingLine label="Sidebar chats"><Input aria-label="Sidebar chats" type="number" min={1} max={100} step={1} value={20} /></SettingLine>, 'SettingLine > Input type="number"'),
      ]} on={["ground", "frost"]} />, "row"),
    ] },
  ],
};
