import { Item, Keycap, Menu, Section } from "@/components/ui";
import { FormTable, form, type FormRow } from "../specs";
import { lib, type Family } from "../model";
const KEYCAPS: FormRow[] = [
  form("key", "a key or a chord beside a row, muted", () => <div class="g-row"><Keycap>Ctrl</Keycap><Keycap>K</Keycap></div>, "<Keycap>K</Keycap>", "--control-2xs tall · corner --radius-inset · fill --tint · --text-label --font-label --weight-lift · --muted-foreground"),
  form("on the cursor", "on the row the cursor is on, white", () => <Menu><Section><Item keys={["Ctrl", "K"]} active>Command palette</Item></Section></Menu>, "<Item keys={[…]} active>", ".ui-row[data-highlighted] .ui-keycap · --foreground"),
  form("leading", "the leader's key, at the row's start: white in the leader", () => <Menu class="ui-leader"><Section><Item keysFirst keys={["A"]}>Attach files</Item></Section></Menu>, "<Item keysFirst keys={[…]}> in <Leader>", ".ui-leader .ui-keys[data-first] · --foreground"),
  form("editable", "Settings · Shortcuts: pressed to record another, × clears it", () => <Keycap label="Ctrl K" onClick={() => {}} onRemove={() => {}}>Ctrl K</Keycap>, "<Keycap onClick onRemove>", "1.5625 units tall · --text-caption · --foreground · × --muted-foreground behind a --tint line · each part --tint washed"),
  form("pressable", "pressed to record another, not cleared here", () => <Keycap label="Ctrl Shift K" onClick={() => {}}>Ctrl Shift K</Keycap>, "<Keycap onClick>", "as editable, without the ×"),
];

export const keycapFamily: Family = {
  title: "Keycap", stage: true,
  note: "Keycap reads the surface's --tint and --well values, at the surface and density picked above.",
  usage: `import { Keycap } from "@/components/ui";

<Keycap label="Command palette" onClick={() => recordShortcut()}
  onRemove={() => clearShortcut()}>Ctrl K</Keycap>`,
  api: ["Keycap", "Menu", "Section", "Item"],
  groups: [
    { title: "Examples", note: "each form on each surface", staged: "density", atoms: [
      lib("keycap-forms", "Keycap · forms × surfaces", "desktop", "control", "Keycap · Item keys", () => <FormTable rows={KEYCAPS} on={["ground", "frost"]} />, "row"),
    ] },
  ],
};
