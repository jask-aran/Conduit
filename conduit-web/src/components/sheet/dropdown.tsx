/*
 * A dropdown cell's options (types.ts): the list opened on the cell, filtered as it is typed into, and the options' editor, from the Cell type menu
 * ("Dropdown…") and the list's Edit options.
 */
import { createEffect, createSignal, For, Index, on } from "solid-js";
import { Actions, MenuAction, Section } from "@/components/ui";
import { CardForm } from "@/components/ui/card";
import { Button, Input, Swatch } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { Popover, PopoverContent, SearchList, Select } from "@/components/ui/menus";
import { Row } from "@/components/ui/row";
import { SHEET_INKS, type SheetInk } from "@/sheet-styles.js";
import type { SheetOption } from "@/sheet-types.js";
import type { SheetBox } from "./host";
import { SHEET_INK_TOKENS } from "./theme";

const INK_NAMES: Readonly<Record<SheetInk, string>> = { red: "Red", amber: "Amber", green: "Green", blue: "Blue" };
/** An option being edited, with the value it had (`was`), so the cells holding it follow a rename. */
export type DropdownOption = SheetOption & { was?: string };
const swatch = (ink?: SheetInk) => <Swatch colour={ink ? `var(${SHEET_INK_TOKENS[ink]})` : undefined} hollow={!ink} />;

/** The options of the dropdown at `at`, the cell's own value current; picking one is `onPick`. */
export function DropdownList(props: { at: SheetBox | null; options: readonly SheetOption[]; value: string; frame: () => HTMLElement | undefined; onPick(value: string): void; onEdit(): void; onClose(): void }) {
  return <Popover open={props.at !== null} onOpenChange={(open) => { if (!open) props.onClose(); }} anchorRef={props.frame} placement="bottom-start"
    anchorRect={() => { const box = props.at; return box ? new DOMRect(box.left, box.top, box.width, box.height) : undefined; }}>
    <PopoverContent aria-label="Options" width="sm">
      <SearchList items={[...props.options]} placeholder="Search options" empty="No option matches." matches={(one, needle) => one.value.toLowerCase().includes(needle)}
        isCurrent={(one) => one.value === props.value} onChoose={(one) => props.onPick(one.value)} row={(one) => ({ icon: swatch(one.ink), label: one.value })} />
      <Section><MenuAction onClick={props.onEdit}>Edit options</MenuAction></Section>
    </PopoverContent>
  </Popover>;
}

/** The editor of a dropdown's options: each renamed, recoloured, moved up or deleted, and more added. `given`: the options it opens with (null: shut). */
export function DropdownPrompt(props: { given: readonly DropdownOption[] | null; onSave(options: DropdownOption[]): void; onClose(): void }) {
  const [options, setOptions] = createSignal<DropdownOption[]>([]);
  createEffect(on(() => props.given, (given) => { if (given) setOptions(given.length ? [...given] : [{ value: "" }]); }));
  const change = (at: number, next: Partial<DropdownOption>) => setOptions((all) => all.map((one, n) => n === at ? { ...one, ...next } : one));
  const raise = (at: number) => setOptions((all) => [...all.slice(0, at - 1), all[at]!, all[at - 1]!, ...all.slice(at + 1)]);
  const save = (event: SubmitEvent) => { event.preventDefault(); props.onSave(options().filter((one) => one.value.trim())); };
  return <Dialog open={props.given !== null} title="Dropdown options" onOpenChange={(open) => { if (!open) props.onClose(); }}>
    <CardForm onSubmit={save}>
      <Index each={options()}>{(one, at) => <Row lead={swatch(one().ink)}
        label={<Input aria-label={`Option ${at + 1}`} value={one().value} autofocus={at === options().length - 1 && !one().value} onInput={(event) => change(at, { value: event.currentTarget.value })} />}
        end={<>
          <Select aria-label="Colour" value={one().ink ?? ""} onChange={(event) => change(at, { ink: (event.currentTarget.value || undefined) as SheetInk | undefined })}>
            <option value="">No colour</option><For each={SHEET_INKS as SheetInk[]}>{(ink) => <option value={ink}>{INK_NAMES[ink]}</option>}</For>
          </Select>
          <Button type="button" variant="ghost" disabled={at === 0} onClick={() => raise(at)}>Up</Button>
          <Button type="button" variant="ghost" onClick={() => setOptions((all) => all.filter((_, n) => n !== at))}>Delete</Button>
        </>} />}</Index>
      <Actions>
        <Button type="button" variant="ghost" outline onClick={() => setOptions((all) => [...all, { value: "" }])}>Add option</Button>
        <Button type="button" variant="ghost" outline onClick={() => props.onClose()}>Cancel</Button><Button type="submit">Save</Button>
      </Actions>
    </CardForm>
  </Dialog>;
}
