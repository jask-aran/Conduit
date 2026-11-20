/*
 * Smart chips on the page (sheet-chips.js): each cell's chip indexed from the look as it changes, what the grid draws for one (cell-draw.ts), and the
 * card a chip opens (Enter or Alt+Down on it, or a click): what the app knows of it and what can be done with it, walked with the arrows.
 */
import { createEffect, createSignal, For, onCleanup, type Accessor } from "solid-js";
import type * as Y from "yjs";
import { Item, Readout, Section } from "@/components/ui";
import { Popover, PopoverContent } from "@/components/ui/menus";
import { key, type SheetView } from "@/sheet-format.js";
import { CHIP, hostOf, readChip, writeChip, type SheetArtifactType, type SheetChip } from "@/sheet-chips.js";
import type { SheetOption } from "@/sheet-types.js";
import type { SheetChipLook } from "./cell-draw";
import type { FunctionOffer } from "./functions";
import type { SheetBox, SheetGrid, SheetHost, SheetKey } from "./host";

/** Someone the app knows, as `@` offers them: the signed-in person or an agent. */
export type SheetPerson = { id: string; name: string; role: string; agent?: boolean };
/** One of the project's artifacts, as `@` offers them. */
export type SheetArtifactRef = { id: string; name: string; type: SheetArtifactType };
/** One thing the card does: Enter or a click runs it. */
export type SheetChipAction = { label: string; keys?: string[]; run(): void };

export const ARTIFACT_NAMES: Readonly<Record<SheetArtifactType, string>> = { paper: "Paper", sheet: "Sheet", site: "Site", markdown: "Markdown" };

export function createSheetChips(look: Y.Map<number | string>, model: Accessor<SheetView | undefined>, artifacts: () => readonly SheetArtifactRef[]) {
  const chips = new Map<string, SheetChip>(), [changed, setChanged] = createSignal(0);
  const index = (name: string) => { if (!name.startsWith(CHIP)) return false; const chip = readChip(look.get(name)); if (chip) chips.set(name.slice(CHIP.length), chip); else chips.delete(name.slice(CHIP.length)); return true; };
  for (const name of look.keys()) index(name);
  const observe = (event: Y.YMapEvent<number | string>) => { let any = false; for (const name of event.keysChanged) any = index(name) || any; if (any) setChanged((n) => n + 1); };
  look.observe(observe);
  onCleanup(() => look.unobserve(observe));
  const at = (row: number, col: number) => { const sheet = chips.size ? model() : undefined; return sheet && chips.get(key(sheet.rowAt(row) ?? "", sheet.colAt(col) ?? "")); };
  const artifactOf = (id: string) => artifacts().find((one) => one.id === id);
  return {
    /** A cell's chip; undefined for most. Not tracked. */
    at,
    /** Counts each change of any chip. */
    changed,
    /** Whether any chip is an artifact's, whose name follows a rename. */
    artifacts: () => [...chips.values()].some((one) => one.kind === "artifact"),
    /** What the grid draws for a cell's chip: its icon and text (an artifact's name as the list has it now; a link's title, else its host). */
    drawn: (row: number, col: number, shown: string, link?: string): SheetChipLook | undefined => {
      const chip = at(row, col);
      if (!chip) return undefined;
      if (chip.kind === "link") return { icon: "link", text: chip.title || (link && !link.startsWith("#") ? hostOf(link.replace(/^mailto:/, "")) : shown) };
      if (chip.kind === "person") return { icon: chip.role === "Agent" ? "agent" : "person", text: chip.name };
      if (chip.kind === "artifact") return { icon: chip.type === "sheet" ? "sheet" : "paper", text: artifactOf(chip.id)?.name ?? chip.name };
      return { icon: "date", text: shown };
    },
    /** The cell shown as `chip` (null: plain), in the caller's step. */
    set: (row: number, col: number, chip: SheetChip | null, cells: Y.Map<string>) => { const sheet = model(); if (sheet) writeChip(look as unknown as Y.Map<unknown>, cells, sheet, row, col, chip); },
    artifactOf,
  };
}
export type SheetChips = ReturnType<typeof createSheetChips>;

/** A chip's card over its cell: its kind, what it says, and its actions, the first under the cursor. Esc gives the keyboard back to the cell (`onClose`). */
export function ChipCard(props: { at: { box: SheetBox; kind: string; title: string; meta?: string; actions: readonly SheetChipAction[] } | null; frame: () => HTMLElement | undefined; onClose(): void }) {
  const [active, setActive] = createSignal(0);
  let list: HTMLDivElement | undefined;
  createEffect(() => { if (props.at) setActive(0); });
  const run = (action?: SheetChipAction) => { if (!action) return; props.onClose(); action.run(); };
  const keys = (event: KeyboardEvent) => {
    const count = props.at?.actions.length ?? 0;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive((at) => Math.min(count - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)))); }
    else if (event.key === "Home" || event.key === "End") { event.preventDefault(); setActive(event.key === "Home" ? 0 : count - 1); }
    else if (event.key === "Enter") { event.preventDefault(); run(props.at?.actions[active()]); }
    else { const by = props.at?.actions.find((one) => one.keys && event.ctrlKey && one.keys.at(-1) === event.key); if (by) { event.preventDefault(); run(by); } }
  };
  return <Popover open={props.at !== null} onOpenChange={(open) => { if (!open) props.onClose(); }} anchorRef={props.frame} placement="bottom-start"
    anchorRect={() => { const box = props.at?.box; return box ? new DOMRect(box.left, box.top, box.width, box.height) : undefined; }}>
    <PopoverContent aria-label={props.at?.kind ?? "Chip"} width="sm" onOpenAutoFocus={(event) => { event.preventDefault(); list?.focus(); }}>
      <Section title={props.at?.kind}><Readout label={props.at?.title ?? ""} value={props.at?.meta} /></Section>
      <Section role="listbox" tabIndex={-1} ref={list} onKeyDown={keys}>
        <For each={props.at?.actions ?? []}>{(action, at) =>
          <Item role="option" aria-selected={active() === at()} active={active() === at()} keys={action.keys} onCursor={() => setActive(at())} onClick={() => run(action)}>{action.label}</Item>}</For>
      </Section>
    </PopoverContent>
  </Popover>;
}

const PRESETS: Readonly<Record<string, { detail: string; options: SheetOption[] }>> = {
  Status: { detail: "Not started, In progress, Blocked, Done", options: [{ value: "Not started" }, { value: "In progress", ink: "amber" }, { value: "Blocked", ink: "red" }, { value: "Done", ink: "green" }] },
  Priority: { detail: "P0 to P3", options: [{ value: "P0", ink: "red" }, { value: "P1", ink: "amber" }, { value: "P2", ink: "blue" }, { value: "P3" }] },
  Rating: { detail: "One to five stars", options: [1, 2, 3, 4, 5].map((n) => ({ value: "★".repeat(n) + "☆".repeat(5 - n) })) },
  "Yes/No": { detail: "Yes or No", options: [{ value: "Yes", ink: "green" }, { value: "No", ink: "red" }] },
};
const WEB = /^https?:\/\/[^\s]+$/i, USED = "conduit:sheet-chips-used";
type Cell = { row: number; col: number };
type Card = { row: number; col: number; box: SheetBox; kind: string; title: string; meta?: string; actions: readonly SheetChipAction[] };

/**
 * Everything chips do on the page, given what of the sheet they need: the card, the keys on a chip, what `@` offers past CHIPS and what taking one does,
 * a URL pasted into an empty cell offered as a chip (Tab takes it), and the palette's Show as chip and Remove chip. Each change is one named step.
 */
export function createChipControl(o: {
  look: Y.Map<number | string>; cells: Y.Map<string>; model: Accessor<SheetView | undefined>; grid(): SheetGrid | undefined; act(label: string, run: () => void): void; host: SheetHost;
  /** A cell's link (types.ts), a date cell's or dropdown's type, and the prompts the card hands on to. */
  link(row: number, col: number, text: string): string | undefined; type(row: number, col: number): string | undefined; editLink(row: number, col: number): void; openDate(row: number, col: number): void; dropdown(range: { top: number; bottom: number; left: number; right: number }, options: SheetOption[]): void;
}) {
  const chips = createSheetChips(o.look, o.model, () => o.host.artifacts?.() ?? []);
  const [card, setCard] = createSignal<Card | null>(null), [offer, setOffer] = createSignal<(Cell & { box: SheetBox; url: string }) | null>(null);
  // A chip's artifact renamed: the grid draws its new name.
  createEffect(() => { chips.changed(); if (chips.artifacts()) { o.host.artifacts?.().map((one) => one.name); o.grid()?.update(null); } });
  const box = (row: number, col: number) => o.grid()?.bounds({ top: row, bottom: row, left: col, right: col });
  const textAt = (row: number, col: number) => { const value = o.model()?.value(row, col); return value === null || value === undefined ? "" : String(value); };
  const set = (label: string, row: number, col: number, chip: SheetChip | null) => o.act(label, () => chips.set(row, col, chip, o.cells));
  const close = () => { setCard(null); o.grid()?.focus(); };
  const remove = (row: number, col: number): SheetChipAction => ({ label: "Remove chip", run: () => set("Remove chip", row, col, null) });
  const openLink = (address: string) => { if (/^(https?|mailto):/i.test(address)) window.open(address, "_blank", "noopener,noreferrer"); };
  const open = (row: number, col: number) => {
    const chip = chips.at(row, col), at = box(row, col);
    if (!chip || !at) return;
    const shown = textAt(row, col), look = chips.drawn(row, col, shown, o.link(row, col, shown))!;
    const made = (kind: string, meta: string | undefined, actions: SheetChipAction[]) => setCard({ row, col, box: at, kind, title: look.text, meta, actions: [...actions, remove(row, col)] });
    if (chip.kind === "link") {
      const address = o.link(row, col, shown) ?? "";
      return made("Link", address, [
        { label: "Open", keys: ["Ctrl", "Enter"], run: () => openLink(address) },
        { label: "Copy link", run: () => void navigator.clipboard.writeText(address).catch(() => o.host.failed("The link could not be copied")) },
        { label: "Edit", keys: ["Ctrl", "K"], run: () => o.editLink(row, col) },
      ]);
    }
    if (chip.kind === "person") return made(chip.role ?? "Person", undefined, chip.role === "Agent" && o.host.open ? [{ label: "Open thread", run: () => o.host.open!({ agent: chip.id }) }] : []);
    if (chip.kind === "artifact") {
      const known = chips.artifactOf(chip.id);
      return made(ARTIFACT_NAMES[known?.type ?? chip.type ?? "paper"], known ? undefined : "Not in this project's list", o.host.open ? [{ label: "Open beside", run: () => o.host.open!({ artifact: chip.id }) }] : []);
    }
    return made("Date", undefined, [{ label: "Pick a date", keys: ["Alt", "↓"], run: () => o.openDate(row, col) }]);
  };
  const people = () => o.host.people?.() ?? [], artifacts = () => o.host.artifacts?.() ?? [];
  // How often this viewer has taken each offer, so the most used stand first in their group (a per-viewer convenience: lost, the order is the list's own).
  const used = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(USED) ?? "{}") ?? {}; } catch { return {}; } };
  const use = (id: string) => { try { const all = used(); all[id] = (all[id] ?? 0) + 1; localStorage.setItem(USED, JSON.stringify(all)); } catch { /* not kept */ } };
  const offers = (query: string): FunctionOffer[] => {
    const needle = query.trim().toLowerCase(), hit = (name: string) => !needle || name.toLowerCase().includes(needle), counts = used();
    const ranked = (group: string, list: FunctionOffer[]) => list.map((one) => ({ ...one, group })).sort((a, b) => (counts[b.id!] ?? 0) - (counts[a.id!] ?? 0));
    return [
      ...ranked("People", people().filter((one) => hit(one.name)).map((one) => ({ name: one.name, chip: true as const, detail: one.role, id: `person:${one.id}` }))),
      ...ranked("Artifacts", artifacts().filter((one) => hit(one.name)).map((one) => ({ name: one.name, chip: true as const, detail: ARTIFACT_NAMES[one.type], id: `artifact:${one.id}` }))),
      ...ranked("Insert", Object.entries(PRESETS).filter(([name]) => hit(name)).map(([name, one]) => ({ name, chip: true as const, detail: `Dropdown: ${one.detail}`, id: `preset:${name}` }))),
    ];
  };
  /** An offer of `offers` taken in an empty cell; false where it is none of them. */
  const take = ({ row, col }: Cell, taken: FunctionOffer) => {
    const [what, ...rest] = (taken.id ?? "").split(":"), id = rest.join(":");
    if (taken.id) use(taken.id);
    if (what === "person") { const one = people().find((person) => person.id === id); if (one) set("Person chip", row, col, { kind: "person", id: one.id, name: one.name, role: one.role }); }
    else if (what === "artifact") { const one = artifacts().find((made) => made.id === id); if (one) set("File chip", row, col, { kind: "artifact", id: one.id, name: one.name, type: one.type }); }
    else if (what === "preset" && PRESETS[id]) return void o.dropdown({ top: row, bottom: row, left: col, right: col }, PRESETS[id]!.options), true;
    else return false;
    o.grid()?.focus();
    return true;
  };
  /** Whether the cell can be shown as a chip it is not: a link, or a date cell. */
  const chipFor = (row: number, col: number): SheetChip | null => { if (chips.at(row, col)) return null; const shown = textAt(row, col); return shown && o.link(row, col, shown) ? { kind: "link" } : o.type(row, col) === "date" ? { kind: "date" } : null; };
  return {
    chips, open, offers, take,
    /** A key on a cell: Enter opens its chip's card, Alt+Down too (a date chip's calendar), Ctrl+Enter follows a link chip; Tab takes the chip a paste offers. */
    key: (event: SheetKey, row: number, col: number) => {
      const shown = offer();
      if (shown) { setOffer(null); if (event.key === "Tab" && !event.shiftKey && shown.row === row && shown.col === col) { event.preventDefault(); set("Link chip", row, col, { kind: "link" }); return true; } }
      const chip = chips.at(row, col), plain = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
      if (!chip) return false;
      if (event.key === "Enter" && event.ctrlKey && chip.kind === "link") { event.preventDefault(); const text = textAt(row, col); openLink(o.link(row, col, text) ?? ""); return true; }
      const down = event.altKey && !event.ctrlKey && event.key === "ArrowDown";
      if (down && chip.kind === "date") { event.preventDefault(); o.openDate(row, col); return true; }
      if ((plain && event.key === "Enter") || down) { event.preventDefault(); open(row, col); return true; }
      return false;
    },
    /** Cells just written: a web address pasted alone into an empty cell offers to be a chip. */
    pasted: (list: readonly (Cell & { input: string })[], was: (row: number, col: number) => string) => {
      const one = list.length === 1 ? list[0]! : null;
      if (one && WEB.test(one.input) && !was(one.row, one.col)) requestAnimationFrame(() => { const at = box(one.row, one.col); if (at) setOffer({ row: one.row, col: one.col, box: at, url: one.input }); });
    },
    /** The palette's: the active cell shown as a chip it can be, or plain again. */
    actions: (cell: Cell | null): { label: string; run(): void }[] => {
      if (!cell) return [];
      const can = chipFor(cell.row, cell.col);
      return [...can ? [{ label: "Show as chip", run: () => set("Show as chip", cell.row, cell.col, can) }] : [], ...chips.at(cell.row, cell.col) ? [remove(cell.row, cell.col)] : []];
    },
    view: (frame: () => HTMLElement | undefined) => <>
      <ChipCard at={card()} frame={frame} onClose={close} />
      <Popover open={offer() !== null} onOpenChange={(open) => { if (!open) setOffer(null); }} anchorRef={frame} placement="bottom-start"
        anchorRect={() => { const at = offer()?.box; return at ? new DOMRect(at.left, at.top, at.width, at.height) : undefined; }}>
        <PopoverContent aria-label="Paste as" width="xs" onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}>
          <Section>
            <Item active onClick={() => setOffer(null)}>Plain text</Item>
            <Item keys={["Tab"]} onClick={() => { const at = offer(); setOffer(null); if (at) set("Link chip", at.row, at.col, { kind: "link" }); o.grid()?.focus(); }}>Chip</Item>
          </Section>
        </PopoverContent>
      </Popover>
    </>,
  };
}
export type ChipControl = ReturnType<typeof createChipControl>;
