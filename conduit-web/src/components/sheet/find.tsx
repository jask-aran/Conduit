import { createEffect, createMemo, createSignal, onCleanup, Show, type Accessor } from "solid-js";
import { CaseSensitiveIcon, ReplaceAllIcon, ReplaceIcon, WholeWordIcon } from "lucide-solid";
import { FindBar, IconButton, LeadInput, Segmented } from "@/components/ui";
import type { SheetView } from "@/sheet-format.js";
import { unfilled, type SheetDrawn } from "./formats";
import type { SheetGrid, SheetRange } from "./host";

// Matches washed at once, around the current one: the grid redraws every mark it is given on each change.
const WASHED = 400;
type Cell = { row: number; col: number };
type LookIn = "values" | "formulas";
const before = (one: Cell, two: Cell) => one.row < two.row || (one.row === two.row && one.col < two.col);
const same = (one: Cell | null, two: Cell) => Boolean(one && one.row === two.row && one.col === two.col);
const cellRange = ({ row, col }: Cell): SheetRange => ({ top: row, bottom: row, left: col, right: col });
const primary = (event: KeyboardEvent) => (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;

/**
 * Find and replace over the shown tab's cells: by what a cell shows (its value as its number format draws it) or by what was typed in it (a formula's
 * text). Matches are found row by row as a spreadsheet's are, from the selected cell on. A match in a hidden row is found but not selected, as the grid
 * cannot show it. Replacing always edits what was typed, and a formula's text only while looking in formulas; hidden rows are left, as the sheet's
 * other bulk writes leave them.
 */
export function createSheetFind(options: {
  model: Accessor<SheetView | undefined>; grid: Accessor<SheetGrid | undefined>; at: Accessor<SheetRange | null>; hidden(): ReadonlySet<number>;
  draw(row: number, col: number, value: number | string): SheetDrawn | null; write(list: { row: number; col: number; input: string }[]): void;
}) {
  const [open, setOpen] = createSignal(false), [replacing, setReplacing] = createSignal(false);
  const [query, setQueryText] = createSignal(""), [replacement, setReplacement] = createSignal(""), [lookIn, setLookIn] = createSignal<LookIn>("values");
  const [matchCase, setMatchCase] = createSignal(false), [whole, setWhole] = createSignal(false);
  const [current, setCurrent] = createSignal<Cell | null>(null), [note, setNote] = createSignal<string>(), [version, setVersion] = createSignal(0);
  let field: HTMLInputElement | undefined, replaceField: HTMLInputElement | undefined;

  // The sheet changing (typed, computed, another tab shown) finds again, once a frame however many cells came.
  createEffect(() => {
    const sheet = options.model();
    if (!open() || !sheet) return;
    let frame = 0;
    const off = sheet.onChange(() => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; setVersion((n) => n + 1); }); });
    onCleanup(() => { off(); cancelAnimationFrame(frame); });
  });
  const fold = (text: string) => matchCase() ? text : text.toLocaleLowerCase();
  // What a cell shows, as the grid draws it: an error by its code, a number by its format, else short as a sheet shows it.
  const shown = (sheet: SheetView, row: number, col: number) => {
    const value = sheet.value(row, col);
    if (value === null) return "";
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    const drawn = typeof value === "string" && value.startsWith("#") && sheet.error(row, col) !== null ? null : options.draw(row, col, value);
    return drawn ? unfilled(drawn.text) : typeof value === "number" ? String(Number(value.toPrecision(12))) : value;
  };
  const matches = createMemo<Cell[]>(() => {
    version();
    const sheet = options.model(), wanted = fold(query());
    if (!open() || !sheet || !wanted) return [];
    const formulas = lookIn() === "formulas", exact = whole(), out: Cell[] = [];
    sheet.inputs().forEach((line, row) => line.forEach((input, col) => {
      if (!input) return;
      const text = fold(formulas ? input : shown(sheet, row, col));
      if (exact ? text === wanted : text.includes(wanted)) out.push({ row, col });
    }));
    return out;
  });
  const index = () => { const at = current(); return at ? matches().findIndex((one) => same(at, one)) : -1; };

  const go = (cell: Cell | undefined) => {
    setNote(undefined);
    if (!cell) return setCurrent(null);
    setCurrent(cell);
    if (!options.hidden().has(cell.row)) options.grid()?.select(cellRange(cell));
  };
  const from = (): Cell => { const area = options.at(); return current() ?? (area ? { row: area.top, col: area.left } : { row: 0, col: 0 }); };
  /** The next match after `at` (or the one at it, `inclusive`), or the one before it; past the last it goes round. */
  const step = (by: 1 | -1, at = from(), inclusive = false) => {
    const list = matches();
    if (!list.length) return go(undefined);
    go(by > 0 ? list.find((one) => before(at, one) || (inclusive && same(at, one))) ?? list[0] : list.findLast((one) => before(one, at)) ?? list.at(-1));
  };
  // A change to what is looked for lands on the first match from where it stood, as typing into a find does.
  const ask = (change: () => void) => { const at = from(); change(); step(1, at, true); };

  const pattern = () => new RegExp(query().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), matchCase() ? "g" : "gi");
  /** What a cell's typed text becomes, or null where it is left: a formula while looking in values, or text that holds no match (a value its format drew). */
  const replaced = (input: string) => {
    if (lookIn() === "values" && input.startsWith("=")) return null;
    if (whole()) return fold(input) === fold(query()) ? replacement() : null;
    const next = input.replace(pattern(), () => replacement());
    return next === input ? null : next;
  };
  const replaceOne = () => {
    const at = current(), sheet = options.model();
    if (!at || index() < 0 || !sheet) return step(1);
    const next = options.hidden().has(at.row) ? null : replaced(sheet.input(at.row, at.col));
    if (next !== null) options.write([{ ...at, input: next }]);
    step(1, at);
    if (next === null) setNote(options.hidden().has(at.row) ? "Left: in a hidden row" : lookIn() === "values" && sheet.input(at.row, at.col).startsWith("=") ? "Left: a formula (look in formulas)" : "Left: no match in what was typed");
  };
  // One write, so one undo step.
  const replaceAll = () => {
    const sheet = options.model(), hidden = options.hidden(), list: { row: number; col: number; input: string }[] = [];
    if (!sheet) return;
    let inHidden = 0, left = 0;
    for (const at of matches()) {
      if (hidden.has(at.row)) { inHidden++; continue; }
      const next = replaced(sheet.input(at.row, at.col));
      if (next === null) left++; else list.push({ ...at, input: next });
    }
    options.write(list);
    setNote([`Replaced ${list.length}`, inHidden && `${inHidden} in hidden rows left`, left && `${left} left`].filter(Boolean).join(", "));
  };

  // Washed while the bar is open (shut, nothing is found): a window of matches round the current one.
  createEffect(() => {
    const grid = options.grid();
    if (!grid) return;
    const list = matches(), at = index(), start = Math.max(0, Math.min(at - WASHED / 2, list.length - WASHED)), now = current();
    grid.found(list.slice(start, start + WASHED).map((one) => ({ range: cellRange(one), current: same(now, one) })));
  });

  const show = (replace: boolean) => {
    if (replace) setReplacing(true);
    // Counted again from the selected cell: Enter goes to the first match after it.
    setCurrent(null); setNote(undefined); setOpen(true);
    queueMicrotask(() => { const into = replace ? replaceField : field; into?.focus(); into?.select(); });
  };
  const close = () => { setOpen(false); setNote(undefined); options.grid()?.focus(); };
  const count = () => {
    if (note()) return note();
    if (!query()) return undefined;
    const total = matches().length, at = index();
    if (!total) return "No matches";
    if (at < 0) return total === 1 ? "1 match" : `${total} matches`;
    return `${at + 1} of ${total}${options.hidden().has(current()!.row) ? ", in a hidden row" : ""}`;
  };
  // Ctrl+F finds, Ctrl+H finds with the replace field shown; pressed in the bar, Ctrl+F goes back to the find field.
  const keys = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (!primary(event) || (key !== "f" && key !== "h")) return false;
    event.preventDefault();
    show(key === "h");
    return true;
  };
  // The toggles leave the caret where it was, so Enter keeps stepping after a click.
  const keep = (event: MouseEvent) => event.preventDefault();

  const view = (props: { beside: boolean }) => <Show when={open()}>
    <div class="ui-spreadsheet-find" data-beside={props.beside ? "" : undefined} onKeyDown={(event) => { if (event.key !== "Escape") return keys(event); event.preventDefault(); event.stopPropagation(); close(); }}>
      <FindBar label="Find" query={query()} count={count()} inputRef={(element) => { field = element; }} onQuery={(text) => ask(() => setQueryText(text))}
        onNext={() => step(1)} onPrevious={() => step(-1)} onEscape={close} onClose={close}>
        <div class="ui-spreadsheet-find-rows">
          <div class="ui-spreadsheet-find-row">
            <Segmented size="sm" label="Look in" value={lookIn()} options={[{ value: "values", label: "Values" }, { value: "formulas", label: "Formulas" }]} onChange={(value) => ask(() => setLookIn(value))} />
            <IconButton kind="tool" label="Match case" aria-pressed={matchCase()} onMouseDown={keep} onClick={() => ask(() => setMatchCase((on) => !on))}><CaseSensitiveIcon /></IconButton>
            <IconButton kind="tool" label="Whole cell" aria-pressed={whole()} onMouseDown={keep} onClick={() => ask(() => setWhole((on) => !on))}><WholeWordIcon /></IconButton>
            <IconButton kind="tool" label="Show replace (Ctrl+H)" aria-pressed={replacing()} onClick={() => { const on = !replacing(); setReplacing(on); queueMicrotask(() => (on ? replaceField : field)?.focus()); }}><ReplaceIcon /></IconButton>
          </div>
          <Show when={replacing()}>
            <div class="ui-spreadsheet-find-row">
              <LeadInput kind="tool" lead={<ReplaceIcon />} ref={(element) => { replaceField = element; }} aria-label="Replace with" placeholder="Replace with" value={replacement()}
                onInput={(event) => setReplacement(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.isComposing) return;
                  if (event.key === "Enter") { event.preventDefault(); replaceOne(); }
                  else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
                }} />
              <IconButton kind="tool" label="Replace (Enter)" disabled={!query()} onMouseDown={keep} onClick={replaceOne}><ReplaceIcon /></IconButton>
              <IconButton kind="tool" label="Replace all" disabled={!query()} onMouseDown={keep} onClick={replaceAll}><ReplaceAllIcon /></IconButton>
            </div>
          </Show>
        </div>
      </FindBar>
    </div>
  </Show>;
  return { show, keys, view };
}
