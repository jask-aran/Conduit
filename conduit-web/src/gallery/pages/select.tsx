import { createSignal, Show } from "solid-js";
import { Field, Item, Menu, Section, SettingLine } from "@/components/ui";
import { SelectTrigger } from "@/components/ui";
import { Select } from "@/components/menus";
import { row, token, type Page } from "../model";

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
export const selectPage: Page = {
  title: "Select",
  summary: "one choice from a list: the adapter Select (components/menus.tsx) keeps a native select as the value's owner and draws the library's SelectTrigger opening a Menu of its options. It reads the surface's --tint and --well values.",
  preview: () => <AdapterSelect />,
  usage: `import { Select } from "@/components/menus";

<Select aria-label="Transcript width" value={width()}
  onChange={(event) => setWidth(event.currentTarget.value)}>
  <option value="compact">Compact</option>
  <option value="wide">Wide</option>
</Select>`,
  anatomy: { scene: () => <div class="g-field"><SelectTrigger value="System default" /><div class="g-row"><span>Provider</span><SelectTrigger bare value="OpenAI" /></div></div>, parts: [
    { selector: ".ui-input > span", name: "Value", does: "shows the current choice", from: "SelectTrigger value" },
    { selector: ".ui-input > svg", name: "Chevron", does: "shows that choices can open", from: "SelectTrigger" },
  ] },
  examples: [
    row("Select", "SelectTrigger bare", () => <div class="g-field"><SelectTrigger value="System default" /><div class="g-row"><span>Provider</span><SelectTrigger bare value="OpenAI" /></div></div>),
    row("Select · the adapter", "components/menus.tsx Select", () => <AdapterSelect />),
    row("choose provider", "Open choices and change the value", () => <ProviderSelect />, { code: "Field > SelectTrigger + Menu" }),
    row("disabled", "Provider unavailable while connecting", () => <SelectTrigger aria-label="Provider" value="OpenAI" disabled />, { code: "<SelectTrigger disabled>" }),
    row("disabled bare", "Locked setting without a field border", () => <SettingLine label="Provider"><SelectTrigger bare disabled aria-label="Provider" value="OpenAI" /></SettingLine>, { code: "SettingLine > SelectTrigger bare disabled" }),
    row("long value", "Model name exceeds a short label", () => <SelectTrigger aria-label="Model" value="OpenAI / GPT-5.2 Codex / workspace review with extended context" />, { code: "<SelectTrigger value>" }),
  ],
  tokens: [{ title: "Select", tokens: [
    token("--control", "Control height"),
    token("--text-row", "Control text size"),
    token("--icon", "Icon or thumb size"),
    token("--muted-foreground", "Quiet text or stroke colour"),
  ] }],
  api: ["Select", "SelectTrigger"],
};
