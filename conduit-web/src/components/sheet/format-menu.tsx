import { createSignal, For, Show } from "solid-js";
import { Actions, Icons } from "@/components/ui";
import { CardForm } from "@/components/ui/card";
import { Button, Input } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { PHONE_LAYOUT_QUERY } from "@/components/ui/layout";
import { MenuRow, MenuSection, MenuSub, MenuSubContent, MenuSubTrigger } from "@/components/ui/menus";
import { formatFault } from "@/sheet-formats.js";
import { SHEET_PRESETS, type SheetFormats } from "./formats";
import type { SheetRange, SheetTool } from "./host";

const KEY: Readonly<Record<string, string>> = { Backquote: "`" };
// On a phone a submenu opens in the menu's place, as every submenu there does, not off its edge.
const phone = () => matchMedia(PHONE_LAYOUT_QUERY).matches;

/** The context menu's Number format: the presets, the one the range has bold, a decimal place more or fewer, and a format of the person's own. */
export function FormatMenu(props: { formats: SheetFormats; range: SheetRange }) {
  const now = () => props.formats.uniform(props.range);
  const named = () => { const format = now(); return format === null ? undefined : SHEET_PRESETS.find((one) => one.format === (format ?? "General"))?.name ?? "Custom"; };
  return <MenuSection>
    <MenuSub phone={phone()}>
      <MenuSubTrigger icon={<Icons.Label />} meta={named()}>Number format</MenuSubTrigger>
      <MenuSubContent>
        <MenuSection>
          <For each={SHEET_PRESETS}>{(preset) => <MenuRow checked={now() !== null && (now() ?? "General") === preset.format} meta={preset.sample} keys={preset.code ? ["Ctrl", "Shift", KEY[preset.code] ?? preset.code.slice(-1)] : undefined}
            onSelect={() => props.formats.set(props.range, preset.format)}>{preset.name}</MenuRow>}</For>
          <MenuRow checked={named() === "Custom"} meta={named() === "Custom" ? now() ?? undefined : undefined} onSelect={() => props.formats.ask(props.range)}>Custom format…</MenuRow>
        </MenuSection>
        <MenuSection>
          <MenuRow icon={<Icons.Add />} onSelect={() => props.formats.decimals(props.range, 1)}>More decimals</MenuRow>
          <MenuRow icon={<Icons.Less />} onSelect={() => props.formats.decimals(props.range, -1)}>Fewer decimals</MenuRow>
        </MenuSection>
      </MenuSubContent>
    </MenuSub>
  </MenuSection>;
}

/** A number format typed in the codes a workbook's are written in (`#,##0.00;[Red]-#,##0.00`, `yyyy-mm-dd`), for the range `formats.ask` was given; a code that cannot be read says why. */
export function FormatPrompt(props: { formats: SheetFormats; act(label: string, run: () => void): void; onClose(): void }) {
  const [code, setCode] = createSignal("");
  const fault = () => code().trim() ? formatFault(code().trim()) : null;
  const shut = () => { props.formats.ask(null); props.onClose(); };
  const set = (event: SubmitEvent) => { event.preventDefault(); const range = props.formats.asking(); if (range && code().trim() && !fault()) props.act("Number format", () => props.formats.set(range, code().trim())); shut(); };
  return <Dialog open={props.formats.asking() !== null} title="Custom number format" onOpenChange={(open) => { if (!open) shut(); }}>
    <Show when={props.formats.asking()}>{(range) => { setCode(props.formats.at(range().top, range().left) ?? ""); return <CardForm onSubmit={set}>
      <Input aria-label="Format code" placeholder="#,##0.00;[Red]-#,##0.00" spellcheck={false} value={code()} onInput={(event) => setCode(event.currentTarget.value)} ref={(field) => queueMicrotask(() => field.select())} />
      <Show when={fault()}><p role="alert">{fault()}</p></Show>
      <Actions><Button type="button" variant="ghost" outline onClick={shut}>Cancel</Button><Button type="submit" disabled={!code().trim() || Boolean(fault())}>Set</Button></Actions>
    </CardForm>; }}</Show>
  </Dialog>;
}

/**
 * The cell menu's Formatting: the ribbon's tools (tools.tsx) as rows, those of one ribbon menu under one submenu, each showing what the selection
 * wears. A colour picked by hand stays on the ribbon, which has room for its picker.
 */
export function FormattingMenu(props: { tools: readonly SheetTool[] }) {
  const shown = () => props.tools.filter((tool) => !tool.pick);
  const groups = () => [...new Set(shown().flatMap((tool) => tool.menu ? [tool.menu] : []))];
  const row = (tool: SheetTool) => <MenuRow icon={tool.icon()} checked={(tool.pressed ?? tool.active) || undefined} disabled={tool.disabled} keys={tool.keys} onSelect={() => tool.run()}>{tool.label}</MenuRow>;
  return <MenuSection>
    <MenuSub phone={phone()}>
      <MenuSubTrigger icon={<Icons.Label />}>Formatting</MenuSubTrigger>
      <MenuSubContent>
        <MenuSection><For each={shown().filter((tool) => !tool.menu)}>{row}</For></MenuSection>
        <MenuSection><For each={groups()}>{(group) => <MenuSub phone={phone()}>
          <MenuSubTrigger meta={shown().find((tool) => tool.menu === group && tool.active)?.label}>{group}</MenuSubTrigger>
          <MenuSubContent><MenuSection><For each={shown().filter((tool) => tool.menu === group)}>{row}</For></MenuSection></MenuSubContent>
        </MenuSub>}</For></MenuSection>
      </MenuSubContent>
    </MenuSub>
  </MenuSection>;
}
