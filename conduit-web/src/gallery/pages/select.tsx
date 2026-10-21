import { createSignal, Show } from "solid-js";
import { Field, Item, Menu, Section, SettingLine } from "@/components/ui";
import { FormTable, form } from "../specs";
import { SelectTrigger } from "@/components/ui";
import { Select } from "@/components/menus";
import { lib, type Family } from "../model";

function ProviderSelect() {
  const [value, setValue] = createSignal("OpenAI");
  const [open, setOpen] = createSignal(false);
  return <Field plain label="Provider"><SelectTrigger value={value()} aria-label="Provider" aria-expanded={open()} onClick={() => setOpen((value) => !value)} />
    <Show when={open()}><Menu><Section>{["OpenAI", "Anthropic", "Local"].map((provider) => <Item tabIndex={0} checked={value() === provider} onClick={() => { setValue(provider); setOpen(false); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setValue(provider); setOpen(false); } }}>{provider}</Item>)}</Section></Menu></Show>
  </Field>;
}
/** The app's Select: native options, the library's trigger and menu. */
function AdapterSelect() {
  const [width, setWidth] = createSignal("compact");
  return <div class="g-field"><Select aria-label="Transcript width" value={width()} onChange={(event) => setWidth(event.currentTarget.value)}>
    <option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="wide">Wide</option>
  </Select><Select bare aria-label="Code blocks" value="fold"><option value="fold">Fold long blocks</option><option value="never">Never fold</option></Select></div>;
}
export const selectFamily: Family = {
  title: "Select", stage: true,
  note: "one choice from a list: the adapter Select (components/menus.tsx) keeps a native select as the value's owner and draws the library's SelectTrigger opening a Menu of its options. It reads the surface's --tint and --well values, at the surface and density picked above.",
  usage: `import { Select } from "@/components/menus";

<Select aria-label="Transcript width" value={width()}
  onChange={(event) => setWidth(event.currentTarget.value)}>
  <option value="compact">Compact</option>
  <option value="wide">Wide</option>
</Select>`,
  api: ["Select", "SelectTrigger"],
  groups: [
    { title: "Examples", staged: true, atoms: [
      lib("select", "Select", "both", "control", "SelectTrigger bare", () => <div class="g-field"><SelectTrigger value="System default" /><div class="g-row"><span>Provider</span><SelectTrigger bare value="OpenAI" /></div></div>),
      lib("select-adapter", "Select · the adapter", "both", "control", "components/menus.tsx Select", () => <AdapterSelect />),
      lib("select-examples", "Select · additional examples", "both", "control", "SelectTrigger", () => <FormTable rows={[
        form("choose provider", "Open choices and change the value", () => <ProviderSelect />, "Field > SelectTrigger + Menu"),
        form("disabled", "Provider unavailable while connecting", () => <SelectTrigger aria-label="Provider" value="OpenAI" disabled />, "<SelectTrigger disabled>"),
        form("disabled bare", "Locked setting without a field border", () => <SettingLine label="Provider"><SelectTrigger bare disabled aria-label="Provider" value="OpenAI" /></SettingLine>, "SettingLine > SelectTrigger bare disabled"),
        form("long value", "Model name exceeds a short label", () => <SelectTrigger aria-label="Model" value="OpenAI / GPT-5.2 Codex / workspace review with extended context" />, "<SelectTrigger value>"),
      ]} on={["ground", "frost"]} />, "row"),
    ] },
  ],
};
