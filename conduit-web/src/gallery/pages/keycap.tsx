import { createSignal } from "solid-js";
import { Show } from "solid-js";
import { Button, Icons, SettingLine } from "@/components/ui";
import { Item, Keycap, Leader, Menu, Section } from "@/components/ui";
import { row, token, type Page } from "../model";

function ShortcutExample() {
  const [key, setKey] = createSignal("Ctrl Shift K");
  return <SettingLine plain label="Command palette"><Show when={key()} fallback={<Button variant="ghost" size="sm" onClick={() => setKey("Ctrl Shift K")}>Restore shortcut</Button>}><Keycap label="Command palette" onClick={() => setKey((value) => value === "Ctrl Shift K" ? "Alt K" : "Ctrl Shift K")} onRemove={() => setKey("")}>{key()}</Keycap></Show></SettingLine>;
}
export const keycapPage: Page = {
  title: "Keycap",
  summary: "Keycap reads the surface's --tint and --well values.",
  preview: () => <div class="g-row"><Keycap>Ctrl</Keycap><Keycap>K</Keycap></div>,
  usage: `import { Keycap } from "@/components/ui";

<Keycap label="Command palette" onClick={() => recordShortcut()}
  onRemove={() => clearShortcut()}>Ctrl K</Keycap>`,
  anatomy: { scene: () => <Keycap label="Ctrl K" onClick={() => {}} onRemove={() => {}}>Ctrl K</Keycap>, parts: [
    { selector: ".ui-keycap > button:first-child", name: "Chord", does: "starts recording another shortcut", from: "Keycap onClick" },
    { selector: ".ui-keycap-remove", name: "Remove", does: "clears the shortcut", from: "Keycap onRemove" },
  ] },
  examples: [
    row("key", "a key or a chord beside a row, muted --control-2xs tall · corner --radius-inset · fill --tint · --text-label --font-label --weight-lift · --muted-foreground", () => <div class="g-row"><Keycap>Ctrl</Keycap><Keycap>K</Keycap></div>, { code: "<Keycap>K</Keycap>" }),
    row("on the cursor", "on the row the cursor is on, white .ui-row[data-highlighted] .ui-keycap · --foreground", () => <Menu><Section><Item keys={["Ctrl", "K"]} active>Command palette</Item></Section></Menu>, { code: "<Item keys={[…]} active>", surfaces: ["ground"] }),
    row("leading", "the leader's key, at the row's start: white in the leader .ui-leader .ui-keys[data-first] · --foreground", () => <Leader label="Leader"><Section><Item keysFirst keys={["A"]}>Attach files</Item></Section></Leader>, { code: "<Item keysFirst keys={[…]}> in <Leader>", surfaces: ["ground"] }),
    row("editable", "Settings · Shortcuts: pressed to record another, × clears it 1.5625 units tall · --text-caption · --foreground · × --muted-foreground behind a --tint line · each part --tint washed", () => <Keycap label="Ctrl K" onClick={() => {}} onRemove={() => {}}>Ctrl K</Keycap>, { code: "<Keycap onClick onRemove>" }),
    row("pressable", "pressed to record another, not cleared here as editable, without the ×", () => <Keycap label="Ctrl Shift K" onClick={() => {}}>Ctrl Shift K</Keycap>, { code: "<Keycap onClick>" }),
    row("change and clear", "Click changes the chord; remove clears it", () => <ShortcutExample />, { code: "SettingLine > Keycap label onClick onRemove" }),
    row("long chord", "Multiple named keys", () => <Keycap>Ctrl Shift Alt ArrowRight</Keycap>, { code: "<Keycap>" }),
    row("icon key", "Arrow glyph as key content", () => <Keycap><Icons.ArrowUp /></Keycap>, { code: "Keycap children={icon}" }),
  ],
  tokens: [{ title: "Keycap", tokens: [
    token("--control-2xs", "Small control size"),
    token("--radius-inset", "Key corner"),
    token("--tint", "Surface tint"),
    token("--text-label", "Key text size"),
    token("--font-label", "Key font"),
  ] }],
  api: ["Keycap", "Menu", "Section", "Item"],
};
