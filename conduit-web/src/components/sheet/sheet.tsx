import * as Y from "yjs";
import { createEffect, createMemo, createResource, createSignal, lazy, on, onCleanup, Show, untrack, type JSX } from "solid-js";
import { Empty, Frost, Icons, Notice } from "@/components/ui";
import { sheetLineIcons as LineIcons, sheetMergeIcons as MergeIcons, sheetSortIcons as SortIcons } from "@/components/ui/sheet-icons";
import { DedupePrompt, focusSearch, menuAt, SheetMenu, ShiftPrompt, SplitPrompt, type SheetMenuEntry, type SheetShiftWay } from "./cell-menu";
import { sheetDataIcons as DataIcons } from "@/components/ui/sheet-icons";
import { toast } from "@/components/ui/notifications";
import { createDecisionScope } from "@/components/ui/decision-dialog";
import { createSheetMerges, type SheetMergeKind } from "./merges";
import { Input } from "@/components/ui/controls";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, MenuRow, MenuSection } from "@/components/ui/menus";
import { CELLS, COLS, LOOK, ROWS, TAB, TABS, a1, colIndex, colName, colsOf, fromCsv, key, parseRange, rangeA1, readEntry, rowsOf, runsOf, valueText, entryText, type SheetView } from "@/sheet-format.js";
import { shiftRefs } from "@/sheet-rules.js";
import { formatDates, writeFormat } from "@/sheet-formats.js";
import { daySerial, serialDay } from "@/sheet-types.js";
import { CalendarPopover, today } from "@/components/ui/calendar";
import { addTab, SheetFoot } from "./foot";
import { createFilled, type SheetFilled } from "./jump";
import { SheetShortcuts } from "./keys";
import { createSheetOutline } from "./outline";
import { createSheetTabs } from "./tabs";
import { ASK_KEY, type SheetAnchor, type SheetBox, type SheetGrid, type SheetGridEvents, type SheetHost, type SheetMarks, type SheetPlace, type SheetRange, type SheetState } from "./host";
import { createLiveSheet } from "./live";
import { readLook } from "./theme";
import { createArtWindow } from "@/components/ui/chat-art";
import { createFormulaEditor, FormulaField, FormulaHelp } from "./formula-editor";
import { createSequenceKeys, SequenceHint, SHEET_SEQUENCES, SizePrompt, type SheetSequence, type SizeQuestion } from "./sequences";
import { createSheetSizes, dragRowEdges } from "./sizes";
import { createSheetFilter, FilterMenu, regionAround } from "./filter";
import type { PlacedTable } from "./tables";
import { createSheetFormats } from "./formats";
import { createSheetBrush, createSheetStyles, measureShown } from "./styles";
import { createSheetRules, RulePrompt, RulesMenu } from "./rules";
import { createSheetTools } from "./tools";
import { createSheetFind } from "./find";
import { createSheetHistory } from "./history";
import { FormatMenu, FormatPrompt, FormattingMenu } from "./format-menu";
import { sheetChartIcons as ChartIcons } from "@/components/ui/sheet-icons";
import { createSheetTypes, type SheetTypeKind } from "./types";
import { DropdownList, DropdownPrompt, type DropdownOption } from "./dropdown";
import { LinkPrompt } from "./link";
import { createChipControl } from "./chips";
import { clearChips, copyChips } from "@/sheet-chips.js";
import { createSheetValidity } from "./validity";
import { ValidationPrompt } from "./validation";
import { brokenText } from "@/sheet-valid.js";
import type { SheetPill } from "./cell-draw";
import type { SheetChartKind } from "@/sheet-charts.js";

const SheetCharts = lazy(() => import("./charts"));

// Cells written into the text a comment quotes, and how much of each: enough to read.
const QUOTED_CELLS = 200, QUOTED_CHARS = 40;
// The grid keeps a spreadsheet's chords the application binds elsewhere: Ctrl+B is Bold (the sidebar elsewhere), Ctrl+- deletes rows, Ctrl+0 hides columns, Ctrl+Shift+1..5 are number formats.
const OWN_KEYS = ["primary+KeyB", "primary+Minus", "primary+Digit0", ...[0, 1, 2, 3, 4, 5, 6].map((n) => `primary+shift+Digit${n}`), "primary+Backslash", "alt+primary+KeyV", "primary+KeyK", "primary+Slash"].join(" ");
// A formula moved as a fill moves it; text stays as typed.
const shifted = (input: string, rows: number, cols: number) => input.startsWith("=") ? shiftRefs(input, rows, cols) : input;
const REFIT = "refit";
const between = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, n) => from + n);
// Whether `ok` comes true within a few seconds, checked each frame: a hub op's lines arriving.
const until = (ok: () => boolean) => new Promise<boolean>((done) => { const since = performance.now(), wait = () => ok() ? done(true) : performance.now() - since > 5000 ? done(false) : requestAnimationFrame(wait); wait(); });
type Menu = { rows?: SheetRange; cols?: SheetRange };

/** A sheet: the hub's live copy drawn in the grid, a formula bar over it, the comment margin beside it. */
/** `onChart`: a chart of a range asked for (of a kind, or of the one that fits it).
 *  `onComment`: a comment on the selection, as the quote tool starts one (the cell menu); `onAsk`: the one comments go to asked about it (the cell menu, or ASK_KEY as on a paper). */
export function SheetEditor(props: { host: SheetHost; id: string; name: string; margin?: JSX.Element; marginEmpty?: boolean; marks?(marks: SheetMarks): void; onState?(state: SheetState): void; onDrawn?(): void; onAsk?(): void; onComment?(): void;
  onChart?(place: SheetPlace, kind?: SheetChartKind): void }) {
  const live = createLiveSheet(props.host, props.id), cells = live.doc.getMap<string>(CELLS), look = live.doc.getMap<number | string>(LOOK);
  const [model, setModel] = createSignal<SheetView>(), [grid, setGrid] = createSignal<SheetGrid>(), [failed, setFailed] = createSignal<string>();
  const [at, setAt] = createSignal<SheetRange | null>(null), [changed, setChanged] = createSignal(0), [address, setAddress] = createSignal<string | null>(null), [scrolled, setScrolled] = createSignal(0);
  const [menu, setMenu] = createSignal<Menu>({});
  const outline = createSheetOutline(look, model);
  const formats = createSheetFormats(look, model, props.host.failed), styles = createSheetStyles(look, model, props.host.failed), types = createSheetTypes(look, model, props.host.failed);
  // Data validation (validity.ts): writes judged, broken cells marked, the dialog open on a range.
  const validity = createSheetValidity(look, model), [validating, setValidating] = createSignal<SheetRange | null>(null);
  // A dropdown's list open on its cell, and the options being edited for a range (`type`: the list's, else a new one).
  const [listing, setListing] = createSignal<{ row: number; col: number; box: SheetBox } | null>(null), [editingList, setEditingList] = createSignal<{ range: SheetRange; type?: string; options: readonly DropdownOption[] } | null>(null);
  const [dating, setDating] = createSignal<{ row: number; col: number; box: SheetBox } | null>(null);
  const [linking, setLinking] = createSignal<{ row: number; col: number; box: SheetBox; text: string; address: string; own: boolean } | null>(null);
  const pills = new Map<string, SheetPill>();
  const pillOf = (_row: number, _col: number, type: string | undefined, shown: string): SheetPill | undefined => {
    if (!type?.startsWith("list:")) return undefined;
    const options = types.options(type), option = shown ? options?.find((one) => one.value === shown) : undefined, known = !shown || !options || Boolean(option), name = `${option?.ink}|${known}`;
    return pills.get(name) ?? pills.set(name, { ink: option?.ink, known }).get(name)!;
  };
  // The grid's element is a signal: the menu trigger that makes it may make it again, and the grid then mounts in the one that stands.
  const [island, setIsland] = createSignal<HTMLDivElement>(), [slot, setSlot] = createSignal<HTMLDivElement>();
  let root: HTMLElement | undefined, anchors: SheetAnchor[] = [], picking: string | undefined, addressField: HTMLInputElement | undefined, filled: SheetFilled | undefined;
  const [showingKeys, setShowingKeys] = createSignal(false);
  // The grid's code is fetched with the editor, not once the hub's copy has come.
  const gridCode = import("./grid");
  // Tabs this page added or deleted: they come and go with its steps, so their going does not end the history.
  const ownTabs = new Set<string>();
  const tabs = createSheetTabs({ doc: live.doc, host: props.host, id: props.id, name: props.name, grid, at, send: (op) => {
    if ("tab" in op) ownTabs.add(op.tab);
    return history.hub(op).then((done) => { const made = (done as { tab?: unknown } | null)?.tab; if ((op.op === "add-tab" || op.op === "duplicate-tab") && typeof made === "string") ownTabs.add(made); return done; });
  } });
  // Every tab's rows and columns are in it, so a row put in or taken out is undone with the formulas the hub moved for it; and the tabs' order and names,
  // so adding, deleting, moving, renaming and hiding a tab are steps too.
  // An Undo or Redo that would bring back a tab name another tab has taken since is not run: formulas naming it could no longer say which tab they mean.
  const clash = (item: Y.UndoManager["undoStack"][number], back: boolean) => {
    const meta = live.doc.getMap(TAB), order = live.doc.getArray(TABS), named = new Map<string, string>(), going = new Set<string>();
    live.doc.transact((tr) => {
      Y.iterateDeletedStructs(tr, item.deletions, (one) => { if (one instanceof Y.Item && one.deleted && one.parent === meta && one.parentSub?.startsWith("name:")) named.set(one.parentSub.slice(5), String(one.content.getContent()[0])); });
      Y.iterateDeletedStructs(tr, item.insertions, (one) => { if (one instanceof Y.Item && !one.deleted && one.parent === order) for (const id of one.content.getContent()) going.add(String(id)); });
    }, clash);
    const after = tabs.tabs().filter((tab) => !going.has(tab.id)).map((tab) => ({ id: tab.id, name: (named.get(tab.id) ?? tab.name).toLowerCase() }));
    for (const [id, name] of named) {
      if (!after.some((tab) => tab.id !== id && tab.name === name.toLowerCase())) continue;
      toast(`${back ? "Can't undo" : "Can't redo"}: another tab is now called ${name}`);
      return true;
    }
    return false;
  };
  const history = createSheetHistory(live.doc, [cells, look, live.doc.getArray(ROWS), live.doc.getArray(COLS), live.doc.getArray(TABS), live.doc.getMap(TAB)], (op) => tabs.cells(op), clash), [stepped, setStepped] = createSignal(0);
  // F4 outside the editor repeats the last step on the selection, as Excel's: what it ran of styles, borders, number formats, inserts, deletes and
  // fills (each remembered as it runs, a step's together) runs again, one step of the same name.
  // By what each is (a run of deletes made one by one is one delete again).
  // `of`: the step they made; any step since (typing, a sort) is the last one and is not repeated, so F4 does nothing rather than an older step.
  let again = new Map<string, (range: SheetRange) => void>(), fresh = true, repeating = false, of = 0;
  const remember = (what: string, run: (range: SheetRange) => void) => { if (repeating) return; if (fresh) { again = new Map(); fresh = false; queueMicrotask(() => { fresh = true; of = history.last(); }); } again.set(what, run); };
  const repeat = (range: SheetRange) => { const runs = [...again.values()]; if (!runs.length || history.last() !== of) return; repeating = true; try { history.act(history.steps().undo[0] ?? "Repeat", () => runs.forEach((run) => run(range))); } finally { repeating = false; } of = history.last(); };
  for (const [made, name, what] of [[styles, "set", "style"], [styles, "borders", "borders"], [styles, "clear", "clear"], [formats, "set", "format"]] as const) {
    const held = made as unknown as Record<string, (range: SheetRange, ...rest: unknown[]) => void>, own = held[name]!;
    held[name] = (range: SheetRange, ...rest: unknown[]) => { remember(what, (to) => own(to, ...rest)); own(range, ...rest); };
  }
  // The style and number format chords (Ctrl+B, Ctrl+Shift+%) are repeated too, as Excel's.
  for (const made of [styles, formats]) { const own = made.key; made.key = (event, range) => { const done = own(event, range); if (done) remember(`key ${event.code}`, (to) => own(event, to)); return done; }; }
  // Ctrl+` shows each formula as written in its cell; F8 extends the selection with the arrows, shown in the foot, until F8 or Esc again.
  const [formulasShown, setFormulasShown] = createSignal(false), [extending, setExtending] = createSignal(false);
  createEffect(on(() => tabs.shown(), () => setExtending(false), { defer: true }));
  live.own(history.origin);
  history.onChange(() => setStepped((n) => n + 1));
  createEffect(() => history.scope(tabs.tabs().flatMap((tab) => [live.doc.getArray(rowsOf(tab.id)), live.doc.getArray(colsOf(tab.id))])));
  // A tab deleted by another person or agent ends the history: a step on it could not be undone. One this page added or deleted comes and goes with its steps.
  let tabIds: Set<string> | undefined;
  createEffect(() => { const ids = new Set(tabs.tabs().map((tab) => tab.id)); if (tabIds && [...tabIds].some((id) => !ids.has(id) && !ownTabs.has(id))) history.clear(); tabIds = ids; });
  const watchers = new Set<(pressed?: string) => void>(), moved = (pressed?: string) => watchers.forEach((listener) => listener(pressed));
  createEffect(() => props.onState?.(live.state()));
  onCleanup(() => history.destroy());

  // Smart chips (chips.tsx): drawn, carded, offered by `@` and pasted.
  const chip = createChipControl({ look, cells, model, grid, act: (label, run) => history.act(label, run), host: props.host, link: types.link, type: types.at,
    editLink: (row, col) => openLink(row, col), openDate: (row, col) => openDate(row, col),
    dropdown: (range, options) => { history.act("Dropdown", () => types.set(range, "list", options)); openList(range.top, range.left); } });
  // What a cell is edited as, in the editor and the formula bar: a date, time or percentage as typed, not its serial (entryText).
  const shownInput = (row: number, col: number) => entryText(types.shown(row, col, model()?.input(row, col) ?? ""), formats.at(row, col));
  // `pasted`: a paste, let through as Excel lets one through, what breaks a rule marked and counted.
  const write = (given: readonly { row: number; col: number; input: string }[], pasted = false) => {
    const sheet = model();
    if (!sheet) return;
    // Read as Excel reads an entry (a date, a time, an amount is its number), a General cell taking the format that shows it as typed, before its
    // validation judges it. The hub is sent what was typed: it reads it itself, format and all.
    const read = given.map((cell) => ({ ...cell, ...readEntry(cell.input, formats.at(cell.row, cell.col)) })), typed = (row: number, col: number, input: string) => given.find((one) => one.row === row && one.col === col)?.input ?? input;
    // A Stop rule broken refuses the whole write; what only the engine can judge is the hub's `set`, refused there with the rule's message.
    const { local: list, hub: judged, refused, told, broken } = validity.sort(read.map(({ row, col, input }) => ({ row, col, input })), pasted);
    if (refused) return props.host.failed(refused);
    if (told) toast(told);
    if (broken) toast(brokenText(broken.count, a1(broken.first.row, broken.first.col), "pasted"));
    for (const { row, col, input } of judged) hub({ op: "set", at: a1(row, col), value: typed(row, col, input) });
    // A cell past the sheet's edge has no row or column of its own yet: the hub makes them as it sets it.
    const past: { row: number; col: number; input: string }[] = [];
    // A merge shows only its upper-left cell: a value written under the rest would be kept unseen (emptying them, as Merge does, is let through).
    const hiddenIn = (row: number, col: number) => { const one = merges.at(row, col); return one !== undefined && (row !== one.top || col !== one.left); };
    live.doc.transact(() => { for (const { row, col, input } of list) { if (input && hiddenIn(row, col)) continue; const rowId = sheet.rowAt(row), colId = sheet.colAt(col); if (!rowId || !colId) { if (input) past.push({ row, col, input }); continue; } if (input) cells.set(key(rowId, colId), input); else cells.delete(key(rowId, colId)); clearChips(look as unknown as Y.Map<unknown>, [[key(rowId, colId), input]]); } formatDates(look, sheet, list, tabs.dates(), tabs.named);
      for (const { row, col, format } of read) if (format && !formats.at(row, col) && sheet.rowAt(row) && sheet.colAt(col) && list.some((one) => one.row === row && one.col === col)) writeFormat(look, sheet, { top: row, bottom: row, left: col, right: col }, format, false); });
    for (const { row, col, input } of past) hub({ op: "set", at: a1(row, col), value: typed(row, col, input) });
  };
  const hub = (op: Parameters<SheetHost["cells"]>[0]) => void history.hub(op).catch((error: Error) => props.host.failed(error.message));
  // A fill is let through as Excel's is: the hub says what of it breaks a rule.
  const fill = (op: Parameters<SheetHost["cells"]>[0]) => void history.hub(op).then((said) => { const broken = (said as { broken?: unknown } | null)?.broken; if (typeof broken === "string") toast(broken); }, (error: Error) => props.host.failed(error.message));
  const labelOf = (list: readonly { row: number; col: number; input: string }[]) => list.every(({ input }) => !input) ? "Clear contents" : list.length === 1 ? `Typing in ${a1(list[0]!.row, list[0]!.col)}` : "Paste";
  const writes = (label: string) => (list: readonly { row: number; col: number; input: string }[]) => history.act(label || labelOf(list), () => write(list));
  const editor = createFormulaEditor({
    grid, input: (row, col) => shownInput(row, col), functions: tabs.functions, merged: (row, col) => merges.at(row, col),
    write: (row, col, input) => writes("")([{ row, col, input: types.typed(row, col, input) }]),
    refuse: (row, col, input) => { const { refused } = validity.sort([{ row, col, input: readEntry(types.typed(row, col, input), formats.at(row, col)).input }]); if (refused) props.host.failed(refused); return Boolean(refused); },
    // As a spreadsheet's Ctrl+Enter: each shown cell selected takes it, a formula moved from the cell typed in to its own.
    fill: (from, input) => { const area = at(); if (!area || (area.top === area.bottom && area.left === area.right)) return false; writes("Fill selection")(within(grid()?.lines() ? inTab(area) : area).flat().map(({ row, col }) => ({ row, col, input: shifted(input, row - from.row, col - from.col) }))); return true; },
    selected: () => { changed(); const area = at(); return area && { row: area.top, col: area.left }; }, error: (row, col) => model()?.error(row, col) ?? null,
    chips: chip.offers,
    chip: ({ row, col }, name, offer) => {
      if (chip.take({ row, col }, offer)) return;
      const range = { top: row, bottom: row, left: col, right: col };
      if (name === "Dropdown") return editList(range);
      if (name === "Date") { setType(range, "date"); return openDate(row, col); }
      history.act("Today", () => { write([{ row, col, input: String(daySerial(today())) }]); if (!formats.dated(row, col)) formats.set(range, "d/m/yyyy"); });
      grid()?.focus();
    },
  });
  // A cell its import froze keeps the file's formula under `excel:<rowId>:<colId>` (server/sheet-xlsx.js), so the mark follows it as rows, columns
  // and tabs change; it is marked while it holds what the import left, as an export writes the formula back. Why it froze is the import report's, found by its formula.
  const [report] = createResource(() => props.host.frozen?.() ?? null);
  const whyOf = createMemo(() => new Map(Object.values(report() ?? {}).flatMap((tab) => Object.values(tab).map((cell) => [cell.formula, cell.why] as const))));
  let anyFrozen = [...look.keys()].some((name) => name.startsWith("excel:"));
  const countFrozen = (event: { keysChanged: Set<string> }) => { if ([...event.keysChanged].some((name) => name.startsWith("excel:"))) anyFrozen = [...look.keys()].some((name) => name.startsWith("excel:")); };
  look.observe(countFrozen);
  onCleanup(() => look.unobserve(countFrozen));
  const frozenAt = (row: number, col: number) => {
    const sheet = anyFrozen ? model() : undefined, held = sheet && look.get(`excel:${sheet.rowAt(row)}:${sheet.colAt(col)}`) as unknown as { formula?: string; value?: unknown } | undefined;
    return held?.formula && held.value === sheet!.input(row, col) ? { formula: held.formula, why: whyOf().get(held.formula) } : undefined;
  };
  const frozenHere = () => { changed(); const area = at(); return area ? frozenAt(area.top, area.left) : undefined; };
  const filters = createSheetFilter(look, model, at, hub, (row, col) => Boolean(styles.at(row, col)?.bold), { act: history.act, select: (range) => grid()?.select(range), setType: (range, kind) => setType(range, kind), room: (on) => roomBelow(on) }), [filtering, setFiltering] = createSignal<{ col: number; box: SheetBox } | null>(null);
  const sizes = createSheetSizes(look, model, styles.lines, filters.hidden, measureShown(styles, formats, model)), [question, setQuestion] = createSignal<SizeQuestion | null>(null);
  const merges = createSheetMerges(look, model), rules = createSheetRules(look, model), [ruling, setRuling] = createSignal<SheetRange | null>(null), decisions = createDecisionScope(() => props.id);
  // A style, number format, type, validation or conditional rule set on cells past the tab's last row or column first grows the tab to hold them, as
  // typing there does, and is set once the hub's new lines have come, in the same step; whole columns or rows selected grow only across.
  const reach = (range: SheetRange, run: (range: SheetRange) => void) => {
    const size = model()?.size(), lines = grid()?.lines();
    if (!size) return;
    const to = { ...range, bottom: lines === "cols" || range.bottom >= 1_048_575 ? Math.min(range.bottom, size.rows - 1) : range.bottom, right: lines === "rows" || range.right >= 16_383 ? Math.min(range.right, size.cols - 1) : range.right };
    if (to.bottom < size.rows && to.right < size.cols) return run(to);
    const later = history.later();
    void Promise.all([to.bottom >= size.rows && history.hub({ op: "insert-rows", at: size.rows, count: to.bottom + 1 - size.rows }), to.right >= size.cols && history.hub({ op: "insert-cols", at: size.cols, count: to.right + 1 - size.cols })])
      .then(() => until(() => { const now = model()?.size(); return Boolean(now && now.rows > to.bottom && now.cols > to.right); }))
      .then((grown) => { if (grown) later(() => run(to)); }, (error: Error) => props.host.failed(error.message));
  };
  // Tab in a table's last cell with filled cells or the tab's edge under it: as Excel's, the cells under its columns are pushed down (the tab grown at
  // its edge) and the row added, one step; not where that would split a table below that spans other columns.
  const roomBelow = (on: PlacedTable) => {
    const size = model()?.size(), { range } = on, row = range.bottom + 1;
    if (!size) return;
    const split = filters.tables.all().find((one) => one.range.top > range.bottom && one.range.left <= range.right && one.range.right >= range.left && (one.range.left < range.left || one.range.right > range.right));
    if (split) return void toast(`Can't add a row to ${on.table.name}: it would split ${split.table.name} below it`);
    history.act("Add table row", () => {
      const later = history.later(), free = () => { const sheet = model(); return Boolean(sheet && sheet.size().rows > row && between(range.left, range.right).every((col) => !sheet.input(row, col))); };
      void history.hub(row >= size.rows ? { op: "insert-rows", at: size.rows, count: 1 } : { op: "shift-cells", range: rangeA1({ ...range, top: row, bottom: row }), way: "down" })
        .then(() => until(free)).then((made) => { if (made) later(() => { const added = filters.tables.addRow(on); if (added !== null) grid()?.select({ top: added, bottom: added, left: range.left, right: range.left }); }); }, (error: Error) => props.host.failed(error.message));
    });
  };
  for (const [made, name] of [[styles, "set"], [styles, "borders"], [formats, "set"], [types, "set"], [validity, "set"], [rules, "add"]] as const) {
    const held = made as unknown as Record<string, (range: SheetRange, ...rest: unknown[]) => void>, own = held[name]!.bind(made);
    held[name] = (range: SheetRange, ...rest: unknown[]) => reach(range, (to) => own(to, ...rest));
  }
  // As a spreadsheet's: Merge & Center on a merge unmerges it, and a merge emptying cells that hold values asks first.
  const merge = (kind: SheetMergeKind | null, asked = at()) => {
    if (!asked) return;
    let area = asked;
    if (kind === null || (kind === "center" && merges.is(area))) return void history.act("Unmerge cells", () => merges.unmerge(area));
    // Held by its corners' ids, the merge and the cells it empties are found again as it runs: rows may have moved while the question was open.
    const sheet = model(), ids = sheet && [sheet.rowAt(area.top), sheet.colAt(area.left), sheet.rowAt(area.bottom), sheet.colAt(area.right)];
    const run = () => history.act(kind === "center" ? "Merge & Center" : kind === "across" ? "Merge across" : "Merge cells", () => {
      const now = model(), found = ids && now && ids.every(Boolean) ? { top: now.indexOfRow(ids[0]!), left: now.indexOfCol(ids[1]!), bottom: now.indexOfRow(ids[2]!), right: now.indexOfCol(ids[3]!) } : area;
      if (Object.values(found).some((n) => n < 0)) return;
      area = found;
      const losing = merges.losing(area, kind);
      if (!merges.merge(area, kind)) return;
      write(losing.map((cell) => ({ ...cell, input: "" })));
      if (kind === "center") styles.set(area, { align: "center" });
    });
    if (!merges.losing(area, kind).length) return run();
    void decisions.confirm("Merging keeps only the upper-left value", { confirmLabel: "Merge" }).then((yes) => { if (yes) run(); grid()?.focus(); });
  };
  const sequences = createSequenceKeys((sequence) => "tool" in sequence ? tools.find((one) => one.name === sequence.tool)?.run() : sequence.run({ selection: at, sizes, look: () => readLook(root!), ask: setQuestion, filters: filters.keys, merge, rules: () => setRuling(at()) }),
    (name) => tools.find((one) => one.name === name)?.label ?? name);
  // One edge dragged sizes every whole row or column selected with it, as a spreadsheet does.
  const wholeOf = (area: SheetRange, kind: "rows" | "cols") => { const size = model()?.size(); return Boolean(size && (kind === "cols" ? area.top === 0 && area.bottom >= size.rows - 1 : area.left === 0 && area.right >= size.cols - 1)); };
  // Whole columns and rows by their letters and numbers (C:G, 3:9), as the field takes them.
  const addressOf = (area: SheetRange) => wholeOf(area, "cols") && !wholeOf(area, "rows") ? `${colName(area.left)}:${colName(area.right)}` : wholeOf(area, "rows") && !wholeOf(area, "cols") ? `${area.top + 1}:${area.bottom + 1}` : rangeA1(area);
  const span = (kind: "rows" | "cols", one: number) => {
    const area = at(), [from, to] = !area ? [one, one] : kind === "cols" ? [area.left, area.right] : [area.top, area.bottom];
    const whole = area && wholeOf(area, kind) && one >= from && one <= to && to > from;
    return whole ? Array.from({ length: to - from + 1 }, (_, n) => from + n) : [one];
  };
  // The grid draws at this place's zoom; the sizes the sheet keeps, and every look that measures them, are at 100%.
  const zoom = () => props.host.display?.().zoom ?? 1;
  const drawnLook = () => readLook(root!, props.host.display?.());
  const events: SheetGridEvents = {
    selected: setAt,
    write: (list, label, pairs) => {
      const was = (row: number, col: number) => model()?.input(row, col) ?? "";
      if (label === "Paste") chip.pasted(list, was);
      history.act(label || labelOf(list), () => { write(list.map((cell) => ({ ...cell, input: types.typed(cell.row, cell.col, cell.input) })), Boolean(label?.startsWith("Paste"))); const sheet = model(); if (pairs && sheet) copyChips(look as unknown as Y.Map<unknown>, sheet, pairs); });
    },
    fill: (range, values, from) => fill({ op: "fill", range: rangeA1(range), values, ...(from ? { from: rangeA1(from) } : {}) }),
    resized: (col, width) => history.act("Column width", () => sizes.setWidths(span("cols", col), width / zoom())),
    autofit: (kind, line) => history.act(kind === "cols" ? "Fit column width" : "Fit row height", () => kind === "cols" ? sizes.fitColumns(span("cols", line), readLook(root!)) : sizes.fitRows(span("rows", line), readLook(root!))),
    menu: setMenu,
    moved: () => { setScrolled((n) => n + 1); moved(); },
    drawn: () => props.onDrawn?.(),
    // A press on a chip already selected opens its card, as a second click does in a spreadsheet's.
    pressed: (row, col) => { const was = at(); if (was && was.top === row && was.bottom === row && was.left === col && was.right === col && chip.chips.at(row, col)) requestAnimationFrame(() => chip.open(row, col)); setExtending(false); const hit = anchors.find((anchor) => { const range = rangeOf(anchor); return range && row >= range.top && row <= range.bottom && col >= range.left && col <= range.right; }); if (hit) moved(hit.key); },
    key: (event, row, col) => {
      const bare = !event.ctrlKey && !event.altKey && !event.metaKey;
      // Shift+F10 and the Menu key open the cell menu at the active cell, its search focused.
      if ((event.key === "F10" && event.shiftKey && bare) || (event.key === "ContextMenu" && bare)) { event.preventDefault(); openMenu(); return true; }
      // F5 goes to a cell or range typed in the name box (Excel's Go To; Ctrl+G stays the application's leader). Shift+F11 adds a tab.
      if (event.key === "F4" && bare && !event.shiftKey) { event.preventDefault(); const area = at(); if (area) repeat(area); return true; }
      if (event.key === "F8" && bare && !event.shiftKey) { event.preventDefault(); setExtending((was) => !was); return true; }
      if (event.key === "Escape" && extending()) setExtending(false);
      if (event.key === "`" && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) { event.preventDefault(); setFormulasShown((was) => !was); grid()?.update(null); return true; }
      if (event.key === "F5" && bare && !event.shiftKey) { event.preventDefault(); addressField?.focus(); return true; }
      if (event.key === "F11" && event.shiftKey && bare) { event.preventDefault(); addTab(tabs); return true; }
      // Shift+F2 comments on the selection, Alt+F1 asks for a chart of it.
      if (event.key === "F2" && event.shiftKey && bare) { event.preventDefault(); props.onComment?.(); return true; }
      if (event.key === "F1" && event.altKey && !event.ctrlKey && !event.metaKey) { event.preventDefault(); askChart(); return true; }
      // Alt+Q searches every action by name, as Excel's Search box: the command palette, which lists the sheet's (`actions`).
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === "q") { event.preventDefault(); window.dispatchEvent(new Event("conduit:open-palette")); return true; }
      // Alt+Down on a filter's header cell opens its list.
      if (event.altKey && !event.ctrlKey && event.key === "ArrowDown" && filters.mark(row, col)) { event.preventDefault(); const box = grid()?.bounds({ top: row, bottom: row, left: col, right: col }); if (box) { filters.reapply(); setFiltering({ col, box }); } return true; }
      // Ctrl+' and Ctrl+Shift+" type the formula, or the value, of the cell above; Ctrl+Shift+; the time (by key: Glide gives no code).
      if (event.ctrlKey && !event.altKey && (event.key === "'" || event.key === '"' || event.key === ":")) {
        event.preventDefault();
        const text = event.key === ":" ? new Date().toTimeString().slice(0, 5) : row > 0 ? event.key === '"' ? valueText(model()?.value(row - 1, col) ?? null) : model()?.input(row - 1, col) ?? "" : "";
        editor.begin({ row, col }, "enter", "cell"); editor.typed(text, text.length);
        return true;
      }
      if (filters.gridKey(event)) return true;
      if (event.key === " " && event.ctrlKey !== event.shiftKey && !event.altKey && !event.metaKey) { event.preventDefault(); grid()?.whole(event.ctrlKey ? "cols" : "rows"); return true; }
      const plain = !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey, type = types.at(row, col);
      // Space ticks (or clears) every checkbox of the selection as the active one goes, as one step.
      if (plain && event.key === " " && type === "boolean") { event.preventDefault(); toggle(row, col); return true; }
      if (chip.key(event, row, col)) return true;
      // Enter and Alt+Down open a dropdown's options.
      if (type?.startsWith("list:") && ((plain && event.key === "Enter") || (event.altKey && !event.ctrlKey && event.key === "ArrowDown"))) { event.preventDefault(); openList(row, col); return true; }
      if (type === "date" && event.altKey && !event.ctrlKey && event.key === "ArrowDown") { event.preventDefault(); openDate(row, col); return true; }
      if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && (event.key === "ArrowRight" || event.key === "ArrowLeft")) { event.preventDefault(); const area = at(); if (area) group(area, event.key === "ArrowRight" ? 1 : -1); return true; }
      // As a spreadsheet's: Alt+= opens a SUM of the numbers just above (else just left), Ctrl+; today's date, each to be finished in the cell.
      const sum = event.altKey && !event.ctrlKey && !event.metaKey && event.key === "=", today = event.ctrlKey && !event.altKey && !event.shiftKey && event.key === ";";
      if (sum || today) {
        event.preventDefault();
        const number = (r: number, c: number) => typeof model()?.value(r, c) === "number";
        let text = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
        if (sum) {
          let top = row, left = col;
          while (top > 0 && number(top - 1, col)) top--;
          if (top === row) while (left > 0 && number(row, left - 1)) left--;
          text = top < row ? `=SUM(${a1(top, col)}:${a1(row - 1, col)})` : left < col ? `=SUM(${a1(row, left)}:${a1(row, col - 1)})` : "=SUM()";
        }
        editor.begin({ row, col }, "enter", "cell"); editor.typed(text, text.endsWith("()") ? text.length - 1 : text.length);
        return true;
      }
      // Ctrl+Alt+V lays what was copied here on the selection's cells as their formatting alone.
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "v") { event.preventDefault(); const from = grid()?.source(), area = at(); if (from && area) brush.lay(from, area); return true; }
      // The ask key (ASK_KEY) is the sheet's, not a letter typed.
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "m") return false;
      // AltGr is Ctrl and Alt together: what it types is typed.
      if ((event.ctrlKey || event.metaKey) && !(event.ctrlKey && event.altKey)) return false;
      // Enter moves on, as a spreadsheet's (grid.ts); F2 edits.
      if (event.key === "F2") { event.preventDefault(); editor.begin({ row, col }, "edit", "cell"); return true; }
      // Not held back: the editor has focus before the browser types the key, so it lands there, and every key after it.
      if (event.key.length !== 1 && event.key !== "Process") return false;
      editor.begin({ row, col }, "enter", "cell");
      return true;
    },
    activated: (row, col) => types.at(row, col)?.startsWith("list:") ? openList(row, col) : editor.begin({ row, col }, "edit", "cell"),
    dropdown: (row, col, box) => setListing({ row, col, box }),
    // After the press has given the grid the keyboard, which would shut the calendar as it takes its focus.
    dated: (row, col, box) => requestAnimationFrame(() => setDating({ row, col, box })),
    // A place in the workbook (`#Tab!A1`) is gone to; anything else opens beside.
    follow: (address) => {
      // Only web and mail addresses leave the page: a workbook's links are anyone's.
      if (!address.startsWith("#")) return void (/^(https?|mailto):/i.test(address) && window.open(address, "_blank", "noopener,noreferrer"));
      const range = parseRange(tabs.reveal(address.slice(1)).replace(/\$/g, ""));
      if (range) { grid()?.select(range); requestAnimationFrame(() => grid()?.focus()); }
    },
    hovered: (address) => { const into = island(); if (into && into.title !== (address ?? "")) into.title = address ?? ""; },
    filter: (_, col, box) => { filters.reapply(); setFiltering({ col, box }); },
    outline: (kind, line) => history.act(outline.line(kind, line).control === "shut" ? "Expand group" : "Collapse group", () => outline.toggle(kind, line)),
  };
  // The group the active cell's row or column is in (or whose control it is on) collapsed or expanded, as its chevron does.
  const folding = (kind: "rows" | "cols", n: number) => {
    const at = outline.around(kind, n), what = kind === "cols" ? "column" : "row";
    return at ? [{ label: `${at.shut ? "Expand" : "Collapse"} ${what} group`, icon: at.shut ? Icons.Preview : Icons.Hide, run: () => events.outline?.(kind, at.line) }] : [];
  };
  // As a spreadsheet's Alt+Shift+Right and Left: the selection's rows, or its whole columns, a group deeper or shallower.
  const group = (range: SheetRange, by: 1 | -1, kind = wholeOf(range, "cols") && !wholeOf(range, "rows") ? "cols" as const : "rows" as const) =>
    history.act(`${by > 0 ? "Group" : "Ungroup"} ${kind === "cols" ? "columns" : "rows"}`, () => kind === "cols" ? outline.group("cols", range.left, range.right, by) : outline.group("rows", range.top, range.bottom, by));

  // The model is made once the hub's copy is held, so it is built once from it and not cell by cell as it arrives.
  createEffect(() => {
    if (!live.synced() || untrack(model)) return;
    const sheet = tabs.open();
    setModel(sheet);
    onCleanup(() => sheet.destroy());
  });
  createEffect(() => {
    const sheet = model(), into = island();
    if (!sheet || !into) return;
    let made: SheetGrid | undefined, over = false;
    const index = filled = createFilled(cells, sheet);
    onCleanup(() => { index.off(); if (filled === index) filled = undefined; });
    void gridCode.then(({ mountGrid }) => {
      if (over) return;
      made = mountGrid(into, { model: sheet, events, look: untrack(drawnLook), filled: index, columns: {
        width: (col) => { const width = sizes.width(col); return width === undefined ? undefined : Math.round(width * zoom()); }, freeze: sizes.freeze, hidden: sizes.hidden, hiddenCols: sizes.hiddenCols,
        heights: () => { const by = zoom(), kept = sizes.heights(); return by === 1 ? kept : new Map([...kept].map(([row, height]) => [row, Math.round(height * by)])); },
        type: types.at, pill: pillOf, link: types.link, chip: (row, col, shown) => chip.chips.drawn(row, col, shown, types.link(row, col, shown)), draw: (row, col, value) => formats.draw(row, col, value, rules.fmt(row, col)), dated: formats.dated, style: (row, col) => rules.style(filters.style(styles.at(row, col), row, col), row, col), frozen: (row, col) => Boolean(frozenAt(row, col)), invalid: validity.invalid, mark: filters.mark, banded: filters.banded, merges: merges.list, outline: outline.line, formulas: () => untrack(formulasShown), extending: () => untrack(extending),
      } });
      setGrid(made);
      fitWrapped();
    }, (error: Error) => { setFailed(error.message); props.onDrawn?.(); });
    // An imported tab's wrapped cells fit their rows as it is shown, as Excel fits rows with no height of their own on opening.
    const fitWrapped = () => { const rows = styles.wrapped(); if (rows.length && root) live.doc.transact(() => sizes.refit(rows, readLook(root!)), REFIT); };
    const off = sheet.onChange((change) => {
      const cells = change.structure ? null : change.cells;
      // A wrapped cell's row fits its text again, whoever changed it, unless a person set its height; not a step of the history.
      const wrapped = cells && [...new Set(cells.flatMap(({ row, col }) => styles.at(row, col)?.wrap ? [row] : []))];
      if (wrapped?.length && root) live.doc.transact(() => sizes.refit(wrapped, readLook(root!)), REFIT);
      rules.changed();
      made?.update(rules.wide() ? null : cells);
      // The formula bar reads the selected cell again only when it may have changed.
      const area = at();
      if (!cells || (area && cells.some(({ row, col }) => row === area.top && col === area.left))) setChanged((n) => n + 1);
      // A tab shown, or lines put in or taken out: the comments' highlights are found again on what the grid now draws.
      if (!cells) { moved(); marks.anchors(anchors); fitWrapped(); }
      if (change.structure) setFiltering(null);
    });
    const restyled = () => { made?.update(null); moved(); };
    look.observe(restyled);
    onCleanup(() => { over = true; off(); look.unobserve(restyled); made?.destroy(); setGrid(undefined); });
  });
  const art = createArtWindow(true);
  // The app's tokens change with the Interface size and the theme, each set on the root element; so does much else (a dialog's scroll lock, a route's
  // motion), so the grid is drawn again only where the text's colour or the unit of size has changed.
  // Asked only once the root's attributes, its inline style's own properties aside, say something new: a dialog's scroll lock (overflow, padding) changes
  // no token, and reading the computed style as it opens would make the browser restyle the page there and then.
  let told = "", held = "";
  const relook = new MutationObserver(() => {
    const at = document.documentElement, said = [...at.attributes].map((one) => one.name === "style" ? [...at.style].filter((name) => name.startsWith("--")).map((name) => `${name}:${at.style.getPropertyValue(name)}`).join(";") : `${one.name}=${one.value}`).join(" ");
    if (said === held) return;
    held = said;
    const made = grid(), shown = root && getComputedStyle(root), now = shown ? `${shown.color} ${shown.getPropertyValue("--u-space")} ${shown.getPropertyValue("--muted-foreground")}` : "";
    if (made && root && now !== told) { told = now; made.theme(untrack(drawnLook)); }
  });
  relook.observe(document.documentElement, { attributes: true });
  onCleanup(() => relook.disconnect());
  // Drawn at another zoom, what stands where has moved.
  createEffect(on(() => props.host.display?.(), () => { const made = untrack(grid); if (made && root) { made.theme(drawnLook()); moved(); } }, { defer: true }));

  const input = () => { changed(); const area = at(); return area ? shownInput(area.top, area.left) : ""; };
  // The references of the formula being edited, outlined on the grid in their inks.
  createEffect(() => grid()?.references(editor.references()));
  // The cell editor stands over its cell, and may grow over the neighbours to its right as far as the grid's edge.
  let body: HTMLDivElement | undefined, formula: HTMLDivElement | undefined;
  // Key sequences and row edges are the grid's while it has the keyboard and the pointer (sequences.tsx, sizes.ts).
  createEffect(() => {
    const into = island();
    if (!into) return;
    const offKeys = sequences.attach(into), offBrush = brush.attach(into), offEdges = dragRowEdges(into, grid, (row, height) => history.act("Row height", () => sizes.setHeights(span("rows", row), height / zoom())));
    onCleanup(() => { offKeys(); offBrush(); offEdges(); });
  });
  // F6 and Shift+F6 go round the grid, the ribbon and the tabs, as Excel's go round its panes; in the ribbon Left and Right (Home, End) go along
  // its tools as they stand on screen and Esc goes back to the grid. Native listeners: the ribbon is portalled into the slot, so its keys reach
  // the section's own handler by way of the pane, not the slot.
  createEffect(() => {
    const ribbon = slot();
    if (!ribbon || !root) return;
    const section = root, parts = () => [island(), ribbon, section.querySelector<HTMLElement>(".ui-spreadsheet-tabs")];
    const enter = [() => grid()?.focus(), () => (ribbon.querySelector<HTMLElement>("[data-set=edit] button:not([disabled])") ?? ribbon.querySelector<HTMLElement>("button:not([disabled])"))?.focus(),
      () => section.querySelector<HTMLElement>(".ui-spreadsheet-tabs [aria-selected=true] .ui-tab-open")?.focus()];
    const round = (event: KeyboardEvent) => {
      if (event.key !== "F6" || event.ctrlKey || event.altKey || event.metaKey) return;
      const from = parts().findIndex((part) => part?.contains(event.target as Node));
      if (from < 0) return;
      event.preventDefault();
      enter[(from + (event.shiftKey ? 2 : 1)) % 3]!();
    };
    const keys = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || (event.target as HTMLElement).closest("input, textarea, [role=radiogroup], [role=menu], [role=dialog]")) return;
      if (event.key === "Escape") { event.preventDefault(); return grid()?.focus(); }
      const by = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[event.key];
      if (!by) return;
      const tools = [...ribbon.querySelectorAll<HTMLElement>("button:not([disabled])")].filter((one) => one.offsetParent).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      const at = tools.indexOf(event.target as HTMLElement), to = tools[Math.max(0, Math.min(tools.length - 1, Number.isFinite(by) ? at + by : by > 0 ? tools.length - 1 : 0))];
      if (to) { event.preventDefault(); to.focus(); }
    };
    section.addEventListener("keydown", round); ribbon.addEventListener("keydown", keys);
    onCleanup(() => { section.removeEventListener("keydown", round); ribbon.removeEventListener("keydown", keys); });
  });
  const cellBox = createMemo<JSX.CSSProperties>((was) => {
    scrolled();
    const now = editor.editing(), made = grid(), into = island();
    const cell = now && made?.bounds({ top: now.row, bottom: now.row, left: now.col, right: now.col });
    if (!cell || !body || !into) return was;
    const frame = body.getBoundingClientRect(), edge = into.getBoundingClientRect().right;
    return { left: `${cell.left - frame.left}px`, top: `${cell.top - frame.top}px`, "min-width": `${cell.width}px`, "min-height": `${cell.height}px`, "max-width": `${edge - cell.left}px` };
  }, {});
  // While a formula is edited, a press on a cell points it into the formula (a drag, a range); a press anywhere else in the grid ends the edit and
  // does what it would. A pointing press is the editor's alone: neither the grid nor the pane (which takes focus on a press) sees it, so the
  // selection stays and the keyboard stays in the formula.
  createEffect(() => {
    const into = island();
    if (!into) return;
    let taking = false;
    const drag = (event: PointerEvent) => { const cell = grid()?.cellAt(event.clientX, event.clientY); if (cell) editor.drag(cell); };
    const up = () => { removeEventListener("pointermove", drag, true); removeEventListener("pointerup", up, true); };
    const press = (event: PointerEvent) => {
      taking = false;
      if (event.button !== 0 || !editor.editing()) return;
      const cell = grid()?.cellAt(event.clientX, event.clientY);
      if (!cell || !editor.press(cell, event.shiftKey)) return editor.commit(undefined, false);
      taking = true; event.stopPropagation();
      addEventListener("pointermove", drag, true); addEventListener("pointerup", up, true);
    };
    const hold = (event: MouseEvent) => { if (taking) { event.preventDefault(); event.stopPropagation(); } };
    into.addEventListener("pointerdown", press, true);
    for (const kind of ["mousedown", "mouseup", "click"] as const) into.addEventListener(kind, hold, true);
    onCleanup(() => { up(); into.removeEventListener("pointerdown", press, true); for (const kind of ["mousedown", "mouseup", "click"] as const) into.removeEventListener(kind, hold, true); });
  });
  /** A defined name's reference (an imported workbook's, `names:<tabId>`), the shown tab's own before the workbook's. */
  const definedRef = (name: string) => {
    const here = tabs.tabs().find((tab) => tab.id === tabs.shown())?.name, found: { ref: string; tab?: string }[] = [];
    for (const [entry, value] of look) if (entry.startsWith("names:")) { try { const list: unknown = typeof value === "string" ? JSON.parse(value) : value; if (Array.isArray(list)) found.push(...list.filter((one) => typeof one?.ref === "string" && String(one.name).toLowerCase() === name.toLowerCase())); } catch { /* not a list */ } }
    return (found.find((one) => one.tab === here) ?? found.find((one) => one.tab === undefined))?.ref;
  };
  // `Data!B2` shows its tab; `B:D` and `3:9` are whole columns and rows; a defined name goes to its range. Past Excel's last row or column is no address.
  const go = () => {
    const said = (address() ?? "").trim(), typed = /^[A-Za-z_\\][\w.\\]*$/.test(said) && !parseRange(said) ? definedRef(said) ?? said : said;
    const local = typed ? tabs.reveal(typed).replace(/\$/g, "") : "", cols = /^([A-Za-z]{1,3}):([A-Za-z]{1,3})$/.exec(local), rows = /^(\d+):(\d+)$/.exec(local);
    const given = cols ? { top: 0, bottom: 0, left: Math.min(colIndex(cols[1]!), colIndex(cols[2]!)), right: Math.max(colIndex(cols[1]!), colIndex(cols[2]!)) }
      : rows ? { left: 0, right: 0, top: Math.max(0, Math.min(+rows[1]!, +rows[2]!) - 1), bottom: Math.max(+rows[1]!, +rows[2]!) - 1 } : parseRange(local);
    const range = given && given.bottom < 1_048_576 && given.right < 16_384 ? given : null;
    setAddress(null);
    if (range) { grid()?.select(range); if (cols || rows) grid()?.whole(cols ? "cols" : "rows"); }
    // After the grid has drawn the selection: focused with none, it selects its first cell.
    requestAnimationFrame(() => grid()?.focus());
  };
  const structure = (op: "insert-rows" | "insert-cols" | "delete-rows" | "delete-cols", at: number, count = 1) => {
    remember(op, (range) => op.endsWith("rows") ? structure(op, range.top, range.bottom - range.top + 1) : structure(op, range.left, range.right - range.left + 1));
    return hub({ op, at, count });
  };
  // Ctrl+- and Ctrl+Shift+= on a block of cells ask, as a spreadsheet's do, which way what is round it goes; whole rows or columns picked are not asked.
  const [shifting, setShifting] = createSignal<{ verb: "delete" | "insert"; range: SheetRange; box: SheetBox } | null>(null);
  const askShift = (verb: "delete" | "insert", range: SheetRange) => { const box = grid()?.bounds(range); if (box) setShifting({ verb, range, box }); };
  const shift = (verb: "delete" | "insert", range: SheetRange, way: SheetShiftWay) => {
    const rows = range.bottom - range.top + 1, cols = range.right - range.left + 1;
    if (way === "rows") return verb === "delete" ? deleteRows(range) : structure("insert-rows", range.top, rows);
    if (way === "cols") return structure(verb === "delete" ? "delete-cols" : "insert-cols", range.left, cols);
    history.act(verb === "delete" ? "Delete cells" : "Insert cells", () => hub({ op: "shift-cells", range: rangeA1(inTab(range)), way }));
  };

  const rangeOf = (anchor: Pick<SheetAnchor, "under">): SheetRange | null => {
    const sheet = model(), corners = String(anchor.under?.cells ?? "").split(" ").map((one) => one.split(":"));
    if (!sheet || corners.length !== 2) return null;
    const [[r1, c1], [r2, c2]] = corners as [[string, string], [string, string]];
    const rows = [sheet.indexOfRow(r1), sheet.indexOfRow(r2)], cols = [sheet.indexOfCol(c1), sheet.indexOfCol(c2)];
    if ([...rows, ...cols].some((index) => index < 0)) return null;
    return { top: Math.min(...rows), bottom: Math.max(...rows), left: Math.min(...cols), right: Math.max(...cols) };
  };
  /** A range by its corners' ids and by its A1 address; null where it runs past the sheet's own rows or columns, which have no ids yet. */
  const named = (range: SheetRange) => {
    const sheet = model(), ids = sheet && [sheet.rowAt(range.top), sheet.colAt(range.left), sheet.rowAt(range.bottom), sheet.colAt(range.right)];
    return ids?.every(Boolean) ? { cells: `${key(ids[0]!, ids[1]!)} ${key(ids[2]!, ids[3]!)}`, ...tabs.where(range) } : null;
  };
  /** A range as the place a comment is about: its values, row by row, as its quote; its box found again by its corners' ids, so it follows rows and columns put in or taken out. */
  const placeOf = (range: SheetRange): SheetPlace | null => {
    const sheet = model(), corners = named(range);
    if (!sheet || !corners) return null;
    const lines: string[] = [];
    for (let row = range.top, count = 0; row <= range.bottom && count < QUOTED_CELLS; row++) {
      const cells: string[] = [];
      for (let col = range.left; col <= range.right && count < QUOTED_CELLS; col++, count++) { const value = sheet.value(row, col); cells.push((value === null ? "" : String(value)).slice(0, QUOTED_CHARS)); }
      lines.push(cells.join("\t"));
    }
    // Empty cells are quoted by their address: Markup starts no comment on a place without text.
    const text = lines.join("\n");
    return { text: text.trim() ? text : corners.range, label: corners.range, under: corners, boxes: () => { const now = rangeOf({ under: corners }), box = now && grid()?.bounds(now); return box ? [box] : []; } };
  };
  // A chart asked of the agent, as a request on the range: Markup's ask box says it is being made, and stops it.
  const askChart = (kind?: SheetChartKind, range = at()) => { const place = range && placeOf(range); if (place) props.onChart?.(place, kind); };
  const find = createSheetFind({ model, grid, at, look, hidden: sizes.hidden, hiddenCols: sizes.hiddenCols, draw: formats.draw, write: (list) => writes(list.length === 1 ? "Replace" : "Replace all")(list) });
  const brush = createSheetBrush({ look, model, formats, at, act: history.act, failed: props.host.failed });
  const tools = createSheetTools({ tip: sequences.tip, at, styles, formats, offered: props.host.tools, done: () => grid()?.focus(), spread: (range, way) => spread(range, way), merge: (kind) => merge(kind), brush, act: history.act, chart: props.onChart && ((kind) => askChart(kind)),
    fit: (range) => sizes.fitRows(Array.from({ length: range.bottom - range.top + 1 }, (_, n) => range.top + n), readLook(root!)) });
  const marks: SheetMarks = {
    subject: () => ({ ...model()?.size() }),
    under: (box: SheetBox) => {
      const made = grid(), first = made?.cellAt(box.left + 1, box.top + 1), last = made?.cellAt(box.left + box.width - 1, box.top + box.height - 1) ?? first;
      return first && last ? named({ top: Math.min(first.row, last.row), bottom: Math.max(first.row, last.row), left: Math.min(first.col, last.col), right: Math.max(first.col, last.col) }) : null;
    },
    place: () => { const area = at(); return area ? placeOf(area) : null; },
    // Dragged across with the quote tool, the cells are selected as they are covered, so the grid shows what will be commented on.
    placeAt: (from, to) => {
      const made = grid(), first = made?.cellAt(from.x, from.y), last = to ? made?.cellAt(to.x, to.y) : first;
      if (!made || !first || !last) return null;
      const range = { top: Math.min(first.row, last.row), bottom: Math.max(first.row, last.row), left: Math.min(first.col, last.col), right: Math.max(first.col, last.col) };
      made.select(range);
      return placeOf(range);
    },
    slot,
    tools: () => tools,
    anchors: (list) => {
      anchors = list;
      tabs.follow(list);
      // A comment picked in the margin selects its cells.
      const open = list.find((anchor) => anchor.current && !anchor.resolved), range = open && open.key !== picking ? rangeOf(open) : null;
      picking = open?.key;
      if (range) grid()?.select(range);
      grid()?.highlight(list.filter((anchor) => !anchor.resolved).flatMap((anchor) => { const range = rangeOf(anchor); return range ? [{ range, current: anchor.current }] : []; }));
    },
    where: (name) => { const anchor = anchors.find((one) => one.key === name), range = anchor && rangeOf(anchor); return range ? grid()?.bounds(range) ?? null : null; },
    watch: (listener) => { watchers.add(listener); return () => watchers.delete(listener); },
    reveal: (address) => { const range = parseRange(tabs.reveal(address)); if (range) grid()?.select(range); },
    focus: () => grid()?.focus(),
    shortcuts: () => setShowingKeys(true),
    actions: () => actions(),
    history: { undo: history.undo, redo: history.redo, canUndo: () => (stepped(), history.canUndo()), canRedo: () => (stepped(), history.canRedo()), steps: () => (stepped(), history.steps()) },
  };
  // Highlights are drawn by the grid: told again once it is made.
  createEffect(() => { if (grid()) marks.anchors(anchors); });
  props.marks?.(marks);

  const rows = () => menu().rows, cols = () => menu().cols;
  // The menu's own doings, over what it was opened on: a sequence's (sizes), and the cells' cut, copy, paste and clearing.
  const picked = (): SheetRange | null => { const r = rows(), c = cols(); return r && c ? { top: r.top, bottom: r.bottom, left: c.left, right: c.right } : null; };
  const sized = (keys: string, selection: SheetRange) => SHEET_SEQUENCES.find((sequence): sequence is Extract<SheetSequence, { run: unknown }> => sequence.keys === keys && "run" in sequence)?.run({ selection: () => selection, sizes, look: () => readLook(root!), ask: setQuestion, filters: filters.keys, merge, rules: () => setRuling(at()) });
  // What a range's cuts, clears, pastes and deletes reach: its rows and columns shown, never one hidden, which is out of sight.
  const shownRows = (range: SheetRange) => { const hidden = sizes.hidden(); return Array.from({ length: range.bottom - range.top + 1 }, (_, r) => range.top + r).filter((row) => !hidden.has(row)); };
  const shownCols = (range: SheetRange) => { const hidden = sizes.hiddenCols(); return between(range.left, range.right).filter((col) => !hidden.has(col)); };
  const within = (range: SheetRange) => shownRows(range).map((row) => shownCols(range).map((col) => ({ row, col })));
  const copy = (range: SheetRange, cut = false) => navigator.clipboard.writeText(grid()?.copy(range, cut) ?? "").catch((error: Error) => props.host.failed(error.message));
  const clear = (range: SheetRange, label = "Clear contents") => writes(label)(within(range).flat().map((cell) => ({ ...cell, input: "" })));
  const paste = (range: SheetRange, values = false, transposed = false) => void navigator.clipboard.readText().then((text) => grid()?.paste({ row: range.top, col: range.left }, text, values, transposed), (error: Error) => props.host.failed(error.message));
  // The cell menu's Data rows: Remove duplicates (the hub's, as it moves cells as a sort does), Trim whitespace and Split text to columns.
  const [deduping, setDeduping] = createSignal<{ range: SheetRange; header: boolean } | null>(null), [splitting, setSplitting] = createSignal<SheetRange | null>(null);
  const dedupe = (range: SheetRange, header: boolean) => history.act("Remove duplicates", () => void history.hub({ op: "dedupe", range: rangeA1(range), header }).then((said) => {
    const { removed = 0, left = 0 } = (said ?? {}) as { removed?: number; left?: number };
    toast(removed ? `Removed ${removed} duplicate ${removed === 1 ? "row" : "rows"}, ${left} left` : "No duplicate rows");
  }, (error: Error) => props.host.failed(error.message)));
  const trim = (range: SheetRange) => {
    const list = within(inTab(range)).flat().flatMap(({ row, col }) => { const input = model()?.input(row, col) ?? "", next = input.startsWith("=") ? input : input.trim().replace(/ {2,}/g, " "); return next === input ? [] : [{ row, col, input: next }]; });
    if (list.length) writes("Trim whitespace")(list);
    toast(list.length ? `Trimmed ${list.length} ${list.length === 1 ? "cell" : "cells"}` : "Nothing to trim");
  };
  // A column's text cut at a separator into the cells right of it; filled cells there are written over only once asked.
  const split = async (range: SheetRange, separator: string) => {
    const sheet = model();
    if (!sheet) return;
    const col = range.left, list = shownRows(inTab(range)).flatMap((row) => {
      const input = sheet.input(row, col), parts = !input || input.startsWith("=") ? [] : separator.length === 1 ? fromCsv(input, separator).flat() : input.split(separator);
      return parts.length > 1 ? parts.map((text, n) => ({ row, col: col + n, input: text })) : [];
    });
    if (!list.length) return void toast("Nothing to split");
    if (list.some((one) => one.col > col && sheet.input(one.row, one.col) !== "") && !await decisions.confirm("Replace what is in the cells to the right?", { confirmLabel: "Replace" })) return grid()?.focus();
    writes("Split text to columns")(list);
    grid()?.focus();
  };
  // Each run of shown rows on its own, the last first, so the runs above keep their places.
  const deleteRows = (range: SheetRange) => history.act(`Delete ${range.bottom > range.top ? "rows" : "row"}`, () => { const rows = shownRows(range); for (let end = rows.length - 1; end >= 0;) { let start = end; while (start > 0 && rows[start - 1] === rows[start]! - 1) start--; structure("delete-rows", rows[start]!, end - start + 1); end = start - 1; } });
  // Fill down and Fill right: the selection's first shown row (or column) into the rest of it, from the shown row above (or column left) where it is
  // one deep, as a spreadsheet's; the hub moves the formulas. Each run of shown rows and columns is a fill of its own, its formulas first moved to where
  // the run starts.
  const spread = (picked: SheetRange, way: "down" | "right"): void => history.act(`Fill ${way}`, () => {
    remember("spread", (range) => spread(range, way));
    const sheet = model();
    if (!sheet) return;
    // Whole columns or rows reach the grid's spare room past the data; filling it would grow the tab on every press.
    const size = sheet.size(), range = { ...picked, bottom: Math.min(picked.bottom, Math.max(picked.top, size.rows - 1)), right: Math.min(picked.right, Math.max(picked.left, size.cols - 1)) };
    const rows = shownRows(range), cols = shownCols(range), down = way === "down", hidden = down ? sizes.hidden() : sizes.hiddenCols();
    if (!rows.length || !cols.length) return;
    let source = down ? (range.top === range.bottom ? range.top - 1 : rows[0]!) : range.left === range.right ? range.left - 1 : cols[0]!;
    while (source >= 0 && hidden.has(source)) source--;
    if (source < 0) return;
    for (const run of runsOf([...new Set([source, ...(down ? rows : cols)])])) if (run.length > 1 || run[0] !== source) for (const side of runsOf(down ? cols : rows)) {
      const by = run[0]! - source, [lines, across] = down ? [run, side] : [side, run];
      // From the source line, so the hub copies its look (number format, style, type, chip) with its values.
      fill({ op: "fill", range: rangeA1({ top: lines[0]!, bottom: lines.at(-1)!, left: across[0]!, right: across.at(-1)! }),
        from: rangeA1(down ? { top: source, bottom: source, left: side[0]!, right: side.at(-1)! } : { top: side[0]!, bottom: side.at(-1)!, left: source, right: source }),
        values: down ? [side.map((col) => shifted(sheet.input(source, col), by, 0))] : side.map((row) => [shifted(sheet.input(row, source), 0, by)]) });
    }
  });
  const hiddenIn = (range: SheetRange) => shownRows(range).length < range.bottom - range.top + 1;
  // A column's menu unhides the hidden columns it spans, or those just beside it, as column A hidden can be spanned by none.
  const hiddenColsBy = (range: SheetRange) => { const hidden = sizes.hiddenCols(), out = between(range.left, range.right).filter((col) => hidden.has(col));
    for (const dir of [-1, 1]) for (let col = (dir < 0 ? range.left : range.right) + dir; hidden.has(col); col += dir) out.push(col);
    return out; };
  // A header's menu is its whole columns, a row number's its whole rows (formats.ts clips both to the tab).
  const formatted = () => { const { rows, cols } = menu(), most = Number.MAX_SAFE_INTEGER; return rows || cols ? { top: rows?.top ?? 0, bottom: rows?.bottom ?? most, left: cols?.left ?? 0, right: cols?.right ?? most } : null; };
  const count = (from: number, to: number) => to - from + 1;
  const inTab = (area: SheetRange) => { const size = model()?.size(); return size ? { ...area, bottom: Math.min(area.bottom, size.rows - 1), right: Math.min(area.right, size.cols - 1) } : area; };
  const filteredBy = (col: number) => { const on = filters.filter(); return on && col >= on.range.left && col <= on.range.right ? on.range : null; };
  const inTable = () => { const on = filters.table(), area = at(); return Boolean(on && area && area.top >= on.range.top && area.top <= on.range.bottom && area.left >= on.range.left && area.left <= on.range.right); };
  // Opened once the menu has shut and given focus back (its onCloseAutoFocus), which would shut a popover opened sooner. The filter's header cell is
  // selected, which scrolls it into view, and the filter opens over it once drawn there.
  let opening: (() => void) | undefined;
  const openFilter = (range: SheetRange, col: number) => {
    const cell = { top: range.top, bottom: range.top, left: col, right: col };
    opening = () => { grid()?.select(cell); grid()?.focus(); requestAnimationFrame(() => { const box = grid()?.bounds(cell); if (box) { filters.reapply(); setFiltering({ col, box }); } }); };
  };
  createEffect(() => { if (!filters.filter()) setFiltering(null); });
  // The cell menu from the keyboard, over the selection as a right-click on it opens it, standing at its active cell.
  const openMenu = () => {
    const area = at(), made = grid(), into = island();
    if (!area || !made || !into) return;
    const box = made.bounds({ top: area.top, bottom: area.top, left: area.left, right: area.left }) ?? into.getBoundingClientRect();
    aimMenu(area);
    menuAt(into, box.left + Math.min(box.width / 2, 24), box.top + box.height);
  };
  const aimMenu = (area: SheetRange) => { const lines = grid()?.lines(); setMenu(lines === "rows" ? { rows: area } : lines === "cols" ? { cols: area } : { rows: { ...area, left: 0, right: 0 }, cols: { ...area, top: 0, bottom: 0 } }); };
  // What only a search of the cell menu, or the command palette, finds besides its rows: the ribbon's tools and the sheet's dialogs. Each runs as its
  // menu row or key does, the same named step.
  const moreActions = (): SheetMenuEntry[] => [
    ...tools.filter((tool) => !tool.pick).map((tool) => ({ label: tool.label, keys: tool.keys, meta: tool.menu, run: tool.run })),
    { label: "Conditional formatting…", keys: ["Alt", "H", "L"], run: () => { opening = () => setRuling(at()); } },
    { label: "Find", keys: ["Ctrl", "F"], run: () => { opening = () => find.show(false); } },
    { label: "Replace", keys: ["Ctrl", "H"], run: () => { opening = () => find.show(true); } },
    { label: "Go to…", keys: ["F5"], run: () => { opening = () => addressField?.focus(); } },
    { label: "Insert link…", keys: ["Ctrl", "K"], run: () => { const area = at(); if (area) opening = () => openLink(area.top, area.left); } },
    ...chip.actions((({ top, left } = at() ?? { top: -1, left: -1 }) => top < 0 ? null : { row: top, col: left })()),
    ...props.onChart ? [{ label: "Make chart", keys: ["Alt", "F1"], run: () => askChart() }] : [],
    { label: "New tab", keys: ["Shift", "F11"], run: () => addTab(tabs) },
    { label: "Duplicate tab", run: () => { const id = tabs.shown(); if (id) void tabs.op({ op: "duplicate-tab", tab: id }); } },
    ...filters.tableActions().map((one) => ({ ...one, run: () => { opening = one.run; } })),
    { label: "Sheet shortcuts", keys: ["Ctrl", "/"], run: () => { opening = () => setShowingKeys(true); } },
  ];
  // Every action of the cell menu at the selection, and the rest, in one list (the command palette's): run from there, what a row leaves to the menu's
  // shutting (a prompt it opens) runs a frame on, and the keyboard is the grid's again unless that took it.
  const actions = () => {
    const area = at();
    if (!area) return [];
    aimMenu(area);
    const flat = (list: SheetMenuEntry[], under?: string): SheetMenuEntry[] => list.flatMap((one) => one.sub ? flat(typeof one.sub === "function" ? one.sub() : one.sub, one.label) : [{ ...one, meta: one.meta ?? under }]);
    return flat([...menuGroups().flatMap((group) => group || []), ...moreActions()]).filter((one) => !one.disabled).map((one) => ({ label: one.label, keys: one.keys, meta: one.meta, run: () => {
      one.run?.(); const open = opening; opening = undefined;
      requestAnimationFrame(() => { if (open) open(); else if (!document.activeElement?.matches("input, textarea, [contenteditable], [role=dialog] *, [role=alertdialog] *")) grid()?.focus(); });
    } }));
  };
  // The current region round a cell (Ctrl+A, Ctrl+Shift+*), found on the index of filled cells.
  const regionOf = (row: number, col: number) => { const sheet = model(); return sheet && filled ? regionAround(sheet.size(), filled.has, row, col) : filters.around(row, col); };
  const TYPE_NAMES: Record<SheetTypeKind, string> = { boolean: "Checkbox", date: "Date", list: "Dropdown" };
  // A date cell draws its ISO text through a date format: one that has none takes the sheet's Date.
  // A date cell is a serial number in a date format: one with none takes the sheet's Date, and the dates its cells hold as text are read into serials.
  const setType = (range: SheetRange, kind: SheetTypeKind | null) => history.act("Cell type", () => {
    types.set(range, kind);
    if (kind !== "date") return;
    if (!formats.dated(range.top, range.left)) formats.set(range, "d/m/yyyy");
    const sheet = model();
    if (sheet) write(within(inTab(range)).flat().flatMap((cell) => { const input = sheet.input(cell.row, cell.col), typed = types.typed(cell.row, cell.col, input); return typed !== input ? [{ ...cell, input: typed }] : []; }));
  });
  /** The options editor on a range: its one dropdown's, else a new one's, started from the values its cells hold. */
  const editList = (range: SheetRange) => {
    const sheet = model(), type = types.uniform(range) === "list" ? types.at(range.top, range.left) : undefined;
    const options = type && types.options(type);
    if (type && options) return setEditingList({ range, type, options: options.map((one) => ({ ...one, was: one.value })) });
    const seen = new Set<string>();
    if (sheet) for (const row of shownRows(inTab(range)).slice(0, 1000)) for (const col of shownCols(inTab(range))) { const text = valueText(sheet.value(row, col)); if (text) seen.add(text); }
    setEditingList({ range, options: [...seen].slice(0, 50).map((value) => ({ value })) });
  };
  const openLink = (row: number, col: number) => {
    const box = grid()?.bounds({ top: row, bottom: row, left: col, right: col }), text = valueText(model()?.value(row, col) ?? null);
    if (box) setLinking({ row, col, box, text, address: types.link(row, col, text) ?? "", own: Boolean(types.link(row, col, "")) });
  };
  const openDate = (row: number, col: number) => { const box = grid()?.bounds({ top: row, bottom: row, left: col, right: col }); if (box) setDating({ row, col, box }); };
  const openList = (row: number, col: number) => { const box = grid()?.bounds({ top: row, bottom: row, left: col, right: col }); if (box) setListing({ row, col, box }); };
  const toggle = (row: number, col: number) => {
    const sheet = model(), area = at();
    if (!sheet || !area) return;
    const to = sheet.value(row, col) === true ? "FALSE" : "TRUE";
    writes("Toggle checkboxes")(within(inTab(area)).flat().filter((cell) => types.at(cell.row, cell.col) === "boolean").map((cell) => ({ ...cell, input: to })));
  };
  // The cell menu, as a spreadsheet's: what it does is said of the rows or columns it was opened on, counted ("Insert 5 rows above").
  const menuGroups = (): (SheetMenuEntry[] | false)[] => {
    const r = rows(), c = cols(), size = model()?.size();
    if (!size || (!r && !c)) return [];
    const kind = r && c ? "cells" : r ? "rows" : "cols", lastRow = Math.max(0, size.rows - 1), lastCol = Math.max(0, size.cols - 1);
    const range = kind === "cells" ? picked()! : kind === "rows" ? { top: r!.top, bottom: Math.min(r!.bottom, lastRow), left: 0, right: lastCol } : { top: 0, bottom: lastRow, left: c!.left, right: Math.min(c!.right, lastCol) };
    const nRows = count(range.top, range.bottom), nCols = count(range.left, range.right), many = (n: number, one: string, more: string) => n > 1 ? `${n} ${more}` : one;
    const rowsSaid = many(nRows, "row", "rows"), colsSaid = many(nCols, "column", "columns"), byCol = kind === "cols" ? range.left : at()?.left ?? range.left, whole = kind !== "cells";
    const moveBy = (isRows: boolean, by: -1 | 1) => history.act(`Move ${isRows ? rowsSaid : colsSaid}`, () => {
      const from = isRows ? range.top : range.left;
      hub({ op: isRows ? "move-rows" : "move-cols", at: from, count: isRows ? nRows : nCols, to: from + by });
      grid()?.select(isRows ? { ...range, top: range.top + by, bottom: range.bottom + by } : { ...range, left: range.left + by, right: range.right + by });
      grid()?.whole(isRows ? "rows" : "cols");
    });
    const clearFormats = () => { styles.clear(range); formats.set(range, "General"); };
    // A sheet's sort: every row under its header, by one column, the header naming it. The header is the frozen rows, else a first row of text alone
    // with a column of numbers (or dates) under one of its words, as a spreadsheet guesses one; else there is none and every row sorts.
    const valueAt = (row: number, col: number) => model()?.value(row, col) ?? null, filled = (value: unknown) => value !== null && value !== "";
    const under = (col: number) => { for (let row = 1; row <= lastRow; row++) { const value = valueAt(row, col); if (filled(value)) return value; } return null; };
    // Read as Sort sheet opens, not with the menu.
    const header = () => {
      const tops = between(0, lastCol).filter((col) => filled(valueAt(0, col))), worded = tops.length > 0 && tops.every((col) => typeof valueAt(0, col) === "string");
      const frozen = sizes.freeze().rows || (worded && tops.some((col) => typeof under(col) === "number") ? 1 : 0), text = frozen ? valueText(valueAt(frozen - 1, byCol)) : "";
      return { frozen, named: text ? `“${text}”` : `column ${colName(byCol)}` };
    };
    const sortSheet = (frozen: number, descending: boolean) => history.act(`Sort sheet ${descending ? "Z–A" : "A–Z"}`, () => { if (frozen < lastRow) hub({ op: "sort", range: rangeA1({ top: frozen, bottom: lastRow, left: 0, right: lastCol }), column: colName(byCol), descending }); });
    const hideRows = () => history.act("Hide rows", () => sizes.setHidden(between(range.top, range.bottom), true));
    return [
      [
        ...props.onAsk ? [{ label: "Ask the agent", icon: Icons.Agent, keys: ["Ctrl", "Alt", "M"], run: () => { grid()?.select(range); props.onAsk?.(); } }] : [],
        ...props.onComment ? [{ label: "Comment", icon: Icons.Chat, keys: ["Shift", "F2"], run: () => { grid()?.select(range); props.onComment?.(); } }] : [],
      ],
      [
        { label: "Cut", icon: Icons.Cut, keys: ["Ctrl", "X"], run: () => void copy(range, true).then(() => clear(range, "Cut")) },
        { label: "Copy", icon: Icons.Copy, keys: ["Ctrl", "C"], run: () => void copy(range) },
        { label: "Paste", icon: Icons.Paste, keys: ["Ctrl", "V"], run: () => paste(range) },
        ...grid()?.held() ? [{ label: "Paste values only", icon: Icons.Paste, keys: ["Ctrl", "Shift", "V"], run: () => paste(range, true) }] : [],
        { label: "Paste transposed", icon: DataIcons.transpose, run: () => paste(range, false, true) },
        ...grid()?.source() ? [{ label: "Paste formatting only", icon: Icons.Paste, keys: ["Ctrl", "Alt", "V"], run: () => { const from = grid()?.source(); if (from) brush.lay(from, range); } }] : [],
      ],
      [
        ...kind !== "cols" ? [{ label: range.bottom ? `Freeze rows 1 to ${range.bottom + 1}` : "Freeze row 1", icon: Icons.Pin, run: () => history.act("Freeze panes", () => sizes.setFreeze(range.bottom + 1, sizes.freeze().cols)) }] : [],
        ...kind !== "rows" ? [{ label: range.right ? `Freeze columns A to ${colName(range.right)}` : "Freeze column A", icon: Icons.Pin, run: () => history.act("Freeze panes", () => sizes.setFreeze(sizes.freeze().rows, range.right + 1)) }] : [],
        ...sizes.freeze().rows || sizes.freeze().cols ? [{ label: "Unfreeze", icon: Icons.PinOff, keys: ["Alt", "W", "F", "F"], run: () => history.act("Freeze panes", () => sizes.setFreeze(0, 0)) }] : [],
      ],
      [
        ...kind !== "cols" ? [
          { label: `Insert ${rowsSaid} above`, icon: Icons.Add, keys: whole ? ["Ctrl", "Shift", "="] : undefined, run: () => structure("insert-rows", range.top, nRows) },
          { label: `Insert ${rowsSaid} below`, icon: Icons.Add, run: () => structure("insert-rows", range.bottom + 1, nRows) },
        ] : [],
        ...props.onChart && (nRows > 1 || nCols > 1) ? [{ label: "Make chart", icon: ChartIcons.column, keys: ["Alt", "F1"], run: () => askChart(undefined, range) }] : [],
        ...kind !== "rows" ? [
          { label: `Insert ${colsSaid} left`, icon: Icons.Add, keys: whole ? ["Ctrl", "Shift", "="] : undefined, run: () => structure("insert-cols", range.left, nCols) },
          { label: `Insert ${colsSaid} right`, icon: Icons.Add, run: () => structure("insert-cols", range.right + 1, nCols) },
        ] : [],
      ],
      kind === "rows" && [
        { label: `Move ${rowsSaid} up`, icon: LineIcons.up, disabled: range.top === 0, run: () => moveBy(true, -1) },
        { label: `Move ${rowsSaid} down`, icon: LineIcons.down, disabled: range.bottom >= lastRow, run: () => moveBy(true, 1) },
      ],
      kind === "cols" && [
        { label: `Move ${colsSaid} left`, icon: LineIcons.left, disabled: range.left === 0, run: () => moveBy(false, -1) },
        { label: `Move ${colsSaid} right`, icon: LineIcons.right, disabled: range.right >= lastCol, run: () => moveBy(false, 1) },
      ],
      [
        { label: "Clear", icon: Icons.Erase, sub: () => [
          { label: "Clear contents", keys: ["Delete"], run: () => clear(range) },
          { label: "Clear formatting", keys: ["Alt", "H", "E", "F"], run: () => history.act("Clear formatting", clearFormats) },
          { label: "Clear all", run: () => history.act("Clear all", () => { clear(range); clearFormats(); }) },
        ] },
        ...kind !== "cols" ? [{ label: `Delete ${rowsSaid}`, icon: Icons.Delete, destructive: true, keys: whole ? ["Ctrl", "-"] : undefined, run: () => deleteRows(range) }] : [],
        ...kind !== "rows" ? [{ label: `Delete ${colsSaid}`, icon: Icons.Delete, destructive: true, keys: whole ? ["Ctrl", "-"] : undefined, run: () => structure("delete-cols", range.left, nCols) }] : [],
        ...!whole ? [
          { label: "Delete cells…", icon: Icons.Delete, destructive: true, keys: ["Ctrl", "-"], run: () => { opening = () => askShift("delete", range); } },
          { label: "Insert cells…", icon: Icons.Add, keys: ["Ctrl", "Shift", "="], run: () => { opening = () => askShift("insert", range); } },
        ] : [],
        ...kind !== "cols" ? [
          { label: `Hide ${rowsSaid}`, icon: Icons.Hide, keys: ["Ctrl", "9"], run: hideRows },
          ...hiddenIn(range) ? [{ label: "Unhide rows", icon: Icons.Preview, keys: ["Ctrl", "Shift", "9"], run: () => { const lines = between(range.top, range.bottom); history.act("Unhide rows", () => { sizes.setHidden(lines, false); filters.show(lines); }); } }] : [],
        ] : [],
        ...kind !== "cols" ? [
          { label: `Group ${rowsSaid}`, icon: DataIcons.group, keys: ["Alt", "Shift", "→"], run: () => group(range, 1, "rows") },
          ...between(range.top, range.bottom).some((row) => outline.line("rows", row).level) ? [{ label: `Ungroup ${rowsSaid}`, icon: DataIcons.ungroup, keys: ["Alt", "Shift", "←"], run: () => group(range, -1, "rows") }] : [],
          ...folding("rows", range.top),
        ] : [],
        ...kind !== "rows" ? [
          { label: `Group ${colsSaid}`, icon: DataIcons.group, keys: whole ? ["Alt", "Shift", "→"] : undefined, run: () => group(range, 1, "cols") },
          ...between(range.left, range.right).some((col) => outline.line("cols", col).level) ? [{ label: `Ungroup ${colsSaid}`, icon: DataIcons.ungroup, keys: whole ? ["Alt", "Shift", "←"] : undefined, run: () => group(range, -1, "cols") }] : [],
          ...folding("cols", range.left),
        ] : [],
        ...kind !== "rows" ? [
          { label: `Hide ${colsSaid}`, icon: Icons.Hide, keys: ["Ctrl", "0"], run: () => history.act("Hide columns", () => sizes.setHiddenCols(between(range.left, range.right), true)) },
          ...hiddenColsBy(range).length ? [{ label: "Unhide columns", icon: Icons.Preview, keys: ["Ctrl", "Shift", "0"], run: () => history.act("Unhide columns", () => sizes.setHiddenCols(hiddenColsBy(range), false)) }] : [],
        ] : [],
      ],
      kind !== "cols" && [
        { label: `Resize ${rowsSaid}…`, icon: Icons.Resize, keys: ["Alt", "H", "O", "H"], run: () => sized("HOH", range) },
        { label: "Fit row height", icon: Icons.Resize, keys: ["Alt", "H", "O", "A"], run: () => history.act("Row height", () => sized("HOA", range)) },
      ],
      kind !== "rows" && [
        { label: `Resize ${colsSaid}…`, icon: Icons.Resize, keys: ["Alt", "H", "O", "W"], run: () => sized("HOW", range) },
        { label: "Fit column width", icon: Icons.Resize, keys: ["Alt", "H", "O", "I"], run: () => history.act("Column width", () => sized("HOI", range)) },
        { label: "Default width…", icon: Icons.Resize, keys: ["Alt", "H", "O", "D"], run: () => sized("HOD", range) },
      ],
      [
        { label: "Sort range", icon: SortIcons.ascending, sub: () => [
          { label: `A to Z by column ${colName(byCol)}`, icon: SortIcons.ascending, keys: ["Alt", "H", "S", "S"], run: () => filters.keys.sort(false, byCol) },
          { label: `Z to A by column ${colName(byCol)}`, icon: SortIcons.descending, keys: ["Alt", "H", "S", "O"], run: () => filters.keys.sort(true, byCol) },
        ] },
        { label: "Sort sheet", icon: SortIcons.ascending, sub: () => { const { frozen, named } = header(); return [
          { label: `A to Z by ${named}`, icon: SortIcons.ascending, run: () => sortSheet(frozen, false) },
          { label: `Z to A by ${named}`, icon: SortIcons.descending, run: () => sortSheet(frozen, true) },
        ]; } },
        { label: filters.filter() ? "Remove filter" : "Create a filter", icon: SortIcons.filter, keys: ["Ctrl", "Shift", "L"], run: filters.keys.filter },
        ...filteredBy(byCol) ? [{ label: "Filter column…", icon: SortIcons.filter, keys: ["Alt", "↓"], run: () => openFilter(filteredBy(byCol)!, byCol) }] : [],
        ...filters.narrows(byCol) ? [{ label: `Clear filter from column ${colName(byCol)}`, icon: Icons.Erase, run: () => filters.keep(byCol, null) }] : [],
        { label: inTable() ? "Remove table" : "Format as table", icon: SortIcons.table, keys: ["Alt", "H", "T"], run: filters.keys.table },
        { label: "Data", icon: DataIcons.data, sub: () => [
          { label: "Remove duplicates…", icon: DataIcons.dedupe, run: () => { const on = nRows === 1 && nCols === 1 ? filters.region() : { range: inTab(range), header: false }; if (on) opening = () => setDeduping(on); } },
          { label: "Trim whitespace", icon: DataIcons.trim, run: () => trim(range) },
          { label: "Split text to columns…", icon: DataIcons.split, disabled: nCols > 1, run: () => { opening = () => setSplitting(range); } },
          { label: "Data validation…", icon: DataIcons.data, run: () => { opening = () => setValidating(range); } },
        ] },
      ],
      // Plain, checkboxes (TRUE and FALSE), dates or a dropdown's options (sheet-types.js): whole columns take a column's type, other ranges each cell its own.
      [{ label: "Cell type", icon: LineIcons.type, meta: ((kind) => kind === null ? undefined : kind ? TYPE_NAMES[kind] : "Plain")(types.uniform(range)), sub: () => [
        { label: "Plain", run: () => setType(range, null) },
        { label: "Checkbox", icon: LineIcons.checkbox, run: () => setType(range, "boolean") },
        { label: "Date", icon: LineIcons.date, run: () => setType(range, "date") },
        { label: "Dropdown…", icon: LineIcons.dropdown, run: () => editList(range) },
      ] }],
    ];
  };
  createEffect(on(tabs.shown, () => setFiltering(null), { defer: true }));
  return <section ref={(element) => { root = element; art(element); }} class="ui-spreadsheet" aria-label={props.name} data-margin={props.marginEmpty ? "none" : "beside"}
    onKeyDown={(event) => {
      if (!(event.ctrlKey || event.metaKey) || !island()?.contains(event.target as Node)) return;
      // Ctrl+/ lists the sheet's keys; Ctrl+1 asks for a number format of the person's own (in a browser tab, the browser keeps Ctrl+1 and Ctrl+9).
      if (!event.altKey && !event.shiftKey && event.code === "Slash") { event.preventDefault(); return setShowingKeys(true); }
      if (!event.altKey && !event.shiftKey && event.code === "Digit1") { event.preventDefault(); return formats.ask(at()); }
      // Ctrl+9 hides the selection's rows and Ctrl+Shift+9 shows those hidden in it, as the cell menu's Hide and Unhide rows.
      if (!event.altKey && event.code === "Digit9") {
        event.preventDefault();
        const area = at(), lines = area ? between(area.top, area.bottom) : [];
        if (lines.length) history.act(event.shiftKey ? "Unhide rows" : "Hide rows", () => { sizes.setHidden(lines, !event.shiftKey); if (event.shiftKey) filters.show(lines); });
        return;
      }
      // Ctrl+Shift+* selects the current region.
      if (!event.altKey && event.shiftKey && event.code === "Digit8") { event.preventDefault(); const area = at(), around = area && regionOf(area.top, area.left); if (around) grid()?.select(around); return; }
      // A style's chord is its tool's step: Ctrl+B is Bold.
      const tool = tools.find((one) => one.keys?.length === 2 && one.keys[1]!.toLowerCase() === event.key.toLowerCase())?.label ?? "";
      if (find.keys(event) || tabs.key(event) || history.act(tool, () => formats.key(event, at()) || styles.key(event, at())) || filters.key(event)) return;
      // Ctrl+K edits the active cell's link.
      if (!event.shiftKey && !event.altKey && event.code === "KeyK") { event.preventDefault(); const area = at(); if (area) openLink(area.top, area.left); return; }
      // Ctrl+A selects the block of data round the active cell, and pressed again (or where there is none) the whole tab, as a spreadsheet's.
      if (!event.shiftKey && !event.altKey && event.code === "KeyA") {
        event.preventDefault();
        const area = at(), size = model()?.size(), around = area && regionOf(area.top, area.left), same = (one: SheetRange, two: SheetRange) => one.top === two.top && one.left === two.left && one.bottom === two.bottom && one.right === two.right;
        if (!area || !size) return;
        const lone = around && (around.bottom > around.top || around.right > around.left || model()?.input(around.top, around.left));
        return grid()?.select(lone && !same(around, area) ? around : { top: 0, left: 0, bottom: Math.max(0, size.rows - 1), right: Math.max(0, size.cols - 1) });
      }
      // Ctrl+\ clears the selection's formatting.
      if (!event.shiftKey && !event.altKey && event.code === "Backslash") { event.preventDefault(); return tools.find((one) => one.name === "clear")?.run(); }
      // Ctrl+D and Ctrl+R are the grid's only while it has the keyboard: elsewhere the browser keeps them.
      if (!event.shiftKey && !event.altKey && (event.code === "KeyD" || event.code === "KeyR")) { event.preventDefault(); const area = at(); if (area) spread(area, event.code === "KeyD" ? "down" : "right"); return; }
      // Ctrl+0 hides the selection's columns and Ctrl+Shift+0 shows those hidden in it, as a spreadsheet's (by code: shifted, the key is ")").
      if (!event.altKey && event.code === "Digit0") {
        event.preventDefault();
        const area = at(), hide = !event.shiftKey, hidden = sizes.hiddenCols(), cols = area ? between(area.left, area.right).filter((col) => hide || hidden.has(col)) : [];
        if (cols.length) history.act(hide ? "Hide columns" : "Unhide columns", () => sizes.setHiddenCols(cols, hide));
        return;
      }
      // Ctrl+Shift+= and Ctrl+- insert and delete whole rows or columns picked, as a spreadsheet's. A block of cells is left alone (Excel asks which
      // way to shift it), and the key held back from the browser's zoom.
      if (!event.altKey && (event.key === "-" || (event.shiftKey && (event.key === "+" || event.code === "Equal")))) {
        event.preventDefault();
        const area = at(), lines = grid()?.lines(), adding = event.key !== "-";
        if (!area) return;
        if (!lines) return askShift(adding ? "insert" : "delete", area);
        if (lines === "rows") return void (adding ? structure("insert-rows", area.top, count(area.top, area.bottom)) : deleteRows(area));
        return void structure(adding ? "insert-cols" : "delete-cols", area.left, count(area.left, area.right));
      }
      // Ctrl+Shift+V pastes what the cells copied here showed, not their formulas; held back, it is not the browser's paste as plain text.
      if (event.shiftKey && !event.altKey && event.code === "KeyV") { event.preventDefault(); const area = at(); if (area) paste(area, true); return; }
      if (event.altKey && event.code === ASK_KEY) { event.preventDefault(); return props.onAsk?.(); }
      // The grid has no history of its own: what this page did is undone here, never what others did.
      // By code: with Shift or Caps Lock the key is "Z".
      const redo = event.code === "KeyY" || (event.code === "KeyZ" && event.shiftKey);
      if (event.code !== "KeyZ" && !redo) return;
      event.preventDefault();
      if (redo) history.redo(); else history.undo();
    }}>
    <div class="ui-spreadsheet-bar">
      <Input ref={addressField} class="ui-spreadsheet-address ui-frost ui-frost-raised" aria-label="Cell" spellcheck={false} value={address() ?? (at() ? addressOf(at()!) : "")} onFocus={(event) => event.currentTarget.select()} onInput={(event) => setAddress(event.currentTarget.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); go(); } else if (event.key === "Escape") { setAddress(null); grid()?.focus(); } }} onBlur={() => setAddress(null)} />
      {/* The formula bar edits the selected cell: focused, it opens the cell to edit as F2 does. */}
      <Frost lift="raised" ref={formula} class="ui-input ui-spreadsheet-formula" onFocusIn={() => { const area = at(); if (area && !editor.editing()) editor.begin({ row: area.top, col: area.left }, "edit", "bar"); }}>
        <FormulaField editor={editor} place="bar" label="Formula" class="ui-formula-text" idle={input} disabled={!at()} />
      </Frost>
      {/* The ribbon (Markup's bar with the sheet's tools) stands here, at the row's end, folding to the room the formula field leaves it. */}
      <div ref={setSlot} class="ui-spreadsheet-slot" />
      <Show when={(() => { changed(); const rule = validity.rule(at()); return rule?.showInputMessage === "1" && (rule.prompt || rule.promptTitle) ? rule : undefined; })()}>{(rule) =>
        <Notice kind="tool" title={String(rule().prompt ?? "")}>{rule().promptTitle ? `${String(rule().promptTitle)}: ` : ""}{String(rule().prompt ?? "")}</Notice>}</Show>
      <Show when={frozenHere()}>{(cell) => <Notice kind="tool" title={cell().why ? `${cell().formula}: ${cell().why}` : cell().formula}>Frozen on import: ={cell().formula.replace(/^=/, "")}</Notice>}</Show>
    </div>
    <div ref={body} class="ui-spreadsheet-body">
      <Show when={!failed()} fallback={<Empty role="alert">The sheet could not be drawn: {failed()}</Empty>}>
        {/* Before the grid, so Tab reaches a chart before the grid keeps it. */}
        <Show when={model()}>{(sheet) => <SheetCharts look={look} model={sheet()} grid={grid} scrolled={scrolled} zoom={zoom} hidden={sizes.hidden} hiddenCols={sizes.hiddenCols} act={history.act} undo={() => history.undo()} redo={() => history.redo()}
          text={(row, col) => { const value = sheet().value(row, col); return value === null ? "" : typeof value === "number" ? formats.draw(row, col, value)?.text ?? String(value) : String(value); }} />}</Show>
        {/* Escape in a submenu shuts the whole menu without its close focus: the keyboard fell to the page. */}
        <ContextMenu placement="bottom-start" onOpenChange={(open) => { if (!open) requestAnimationFrame(() => { if (!document.activeElement || document.activeElement === document.body) grid()?.focus(); }); }}>
          <ContextMenuTrigger as="div" ref={setIsland} class="ui-spreadsheet-grid" data-own-keys={OWN_KEYS} />
          {/* Shut, the menu gives the keyboard back to the grid (Kobalte's would go to the page), unless what it ran (a prompt, a comment) took it to type in. */}
          <ContextMenuContent onOpenAutoFocus={focusSearch} onCloseAutoFocus={(event) => {
            const open = opening;
            opening = undefined; event.preventDefault();
            if (open) open(); else requestAnimationFrame(() => { const now = document.activeElement; if (!now?.matches("input, textarea, [contenteditable], [role=dialog] *, [role=alertdialog] *")) grid()?.focus(); });
          }}>
            <SheetMenu groups={menuGroups()} more={moreActions} after={<>
              <Show when={picked()}>{(range) => <Show when={range().bottom > range().top || range().right > range().left}><MenuSection>
                <Show when={!merges.is(range())}>
                  <MenuRow icon={<MergeIcons.merge />} keys={["Alt", "H", "M", "C"]} onSelect={() => merge("center", range())}>Merge &amp; Center</MenuRow>
                  <Show when={range().right > range().left && range().bottom > range().top}><MenuRow icon={<MergeIcons.merge />} keys={["Alt", "H", "M", "A"]} onSelect={() => merge("across", range())}>Merge across</MenuRow></Show>
                  <MenuRow icon={<MergeIcons.merge />} keys={["Alt", "H", "M", "M"]} onSelect={() => merge("cells", range())}>Merge cells</MenuRow>
                </Show>
                <Show when={merges.list().some((one) => one.top <= range().bottom && one.bottom >= range().top && one.left <= range().right && one.right >= range().left)}>
                  <MenuRow icon={<MergeIcons.unmerge />} keys={["Alt", "H", "M", "U"]} onSelect={() => merge(null, range())}>Unmerge cells</MenuRow>
                </Show>
              </MenuSection></Show>}</Show>
              {/* Each selects what the menu was opened on (within the tab) before it acts, as the ribbon's tools act on the selection. */}
              <Show when={formatted()}>{(range) => <>
                <FormattingMenu tools={tools} range={range()} select={(area) => grid()?.select(inTab(area))} />
                <RulesMenu rules={rules} open={() => { grid()?.select(inTab(range())); setRuling(range()); }} />
                <FormatMenu formats={formats} range={range()} />
              </>}</Show>
              <Show when={props.host.openSettings}>{(open) => <MenuSection><MenuRow icon={<Icons.Settings />} onSelect={() => open()()}>View settings…</MenuRow></MenuSection>}</Show>
            </>} />
          </ContextMenuContent>
        </ContextMenu>
        <div class="ui-spreadsheet-editor" data-open={editor.editing() ? "" : undefined} style={{ ...cellBox(), "--sheet-zoom": zoom() }}><FormulaField editor={editor} place="cell" label="Cell" class="ui-formula-text" /></div>
        <FormulaHelp editor={editor} frame={() => body} />
        <SequenceHint typed={sequences.typed} next={sequences.next} anchor={slot} />
        <FormatPrompt formats={formats} act={history.act} onClose={() => grid()?.focus()} />
        <SizePrompt question={question()} onClose={() => { setQuestion(null); grid()?.focus(); }} />
        <RulePrompt area={ruling()} rules={rules} act={(label, run) => history.act(label, run)} onClose={() => { setRuling(null); grid()?.focus(); }} />
        <FilterMenu filter={filters} at={filtering()} frame={() => body} onClose={() => { setFiltering(null); grid()?.focus(); }} />
        <DropdownList at={listing()?.box ?? null} frame={() => body} options={(() => { const now = listing(); changed(); const type = now && types.at(now.row, now.col); return (type && types.options(type)) || []; })()}
          value={(() => { const now = listing(); return now ? valueText(model()?.value(now.row, now.col) ?? null) : ""; })()} onClose={() => { setListing(null); grid()?.focus(); }}
          onPick={(value) => { const now = listing(); setListing(null); if (now) writes(`Pick in ${a1(now.row, now.col)}`)([{ row: now.row, col: now.col, input: value }]); grid()?.focus(); }}
          onEdit={() => { const now = listing(); setListing(null); if (now) editList({ top: now.row, bottom: now.row, left: now.col, right: now.col }); }} />
        <CalendarPopover at={(() => { const box = dating()?.box; return box ? new DOMRect(box.left, box.top, box.width, box.height) : null; })()} frame={() => body} onClose={() => { setDating(null); grid()?.focus(); }}
          value={(() => { const now = dating(), value = now && model()?.value(now.row, now.col); return typeof value === "number" ? serialDay(value) : null; })()}
          onPick={(day) => { const now = dating(), serial = daySerial(day); setDating(null); if (now && serial !== null) writes(`Pick in ${a1(now.row, now.col)}`)([{ row: now.row, col: now.col, input: String(serial) }]); grid()?.focus(); }}
          onType={(typed) => { const now = dating(); setDating(null); if (now) { editor.begin(now, "enter", "cell"); editor.typed(typed, typed.length); } }} />
        <LinkPrompt at={linking()} frame={() => body} onClose={() => { setLinking(null); grid()?.focus(); }}
          onSave={(text, address) => { const now = linking(); setLinking(null); if (now) history.act(address ? "Link" : "Remove link", () => { if (text !== now.text) write([{ row: now.row, col: now.col, input: text }]); types.setLink(now.row, now.col, address || null); }); grid()?.focus(); }} />
        {chip.view(() => body)}
        <DropdownPrompt given={editingList()?.options ?? null} onClose={() => { setEditingList(null); grid()?.focus(); }}
          onSave={(options) => { const now = editingList(); setEditingList(null); if (now) history.act("Dropdown", () => {
            if (!now.type) return types.set(now.range, "list", options);
            // A renamed option renames the cells that hold it.
            const renamed = new Map(options.flatMap((one) => one.was && one.was !== one.value ? [[one.was, one.value] as const] : [])), sheet = model(), cells = types.cells(now.type);
            types.setOptions(now.type, options);
            if (renamed.size && sheet) write(cells.flatMap((cell) => { const to = renamed.get(valueText(sheet.value(cell.row, cell.col))); return to ? [{ ...cell, input: to }] : []; }));
          }); grid()?.focus(); }} />
        <ValidationPrompt range={validating()} rule={untrack(() => validity.rule(validating()))} onClose={() => { setValidating(null); grid()?.focus(); }}
          onSave={(rule) => { const range = untrack(validating); setValidating(null); if (range) history.act("Data validation", () => validity.set(range, rule)); grid()?.focus(); }} />
        <DedupePrompt asked={deduping() ? { range: rangeA1(deduping()!.range), header: deduping()!.header } : null} onRemove={(header) => { const asked = untrack(deduping); if (asked) dedupe(asked.range, header); }} onClose={() => { setDeduping(null); grid()?.focus(); }} />
        <SplitPrompt open={splitting() !== null} onSplit={(separator) => { const range = untrack(splitting); if (range) void split(range, separator); }} onClose={() => { setSplitting(null); grid()?.focus(); }} />
        <ShiftPrompt asked={shifting()} frame={() => body} onClose={() => { setShifting(null); grid()?.focus(); }} onChoose={(way) => { const asked = untrack(shifting); if (asked) shift(asked.verb, asked.range, way); }} />
        <find.view beside={Boolean(props.margin) && !props.marginEmpty} />
        <SheetShortcuts open={showingKeys()} onOpenChange={setShowingKeys} />
        <Show when={!model()}><Empty role="status" class="ui-spreadsheet-waiting">Opening the sheet…</Empty></Show>
      </Show>
      <Show when={props.margin}><aside class="ui-spreadsheet-margin" aria-label="Comments">{props.margin}</aside></Show>
    </div>
    <SheetFoot tabs={tabs} id={props.id} mode={() => extending() ? "Extend selection" : null} format={(range) => formats.figure(range)} filtered={filters.counted} act={history.act} />
  </section>;
}
