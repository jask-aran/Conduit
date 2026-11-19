import { createEffect, createMemo, createResource, createSignal, on, onCleanup, Show, untrack, type JSX } from "solid-js";
import { Empty, Frost, Icons, Notice } from "@/components/ui";
import { sheetLineIcons as LineIcons, sheetMergeIcons as MergeIcons, sheetSortIcons as SortIcons } from "@/components/ui/sheet-icons";
import { SheetMenu, type SheetMenuEntry } from "./cell-menu";
import { createDecisionScope } from "@/components/ui/decision-dialog";
import { createSheetMerges, type SheetMergeKind } from "./merges";
import { Input } from "@/components/ui/controls";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, MenuRow, MenuSection } from "@/components/ui/menus";
import { CELLS, COLS, LOOK, ROWS, a1, colIndex, colName, colsOf, key, parseRange, rangeA1, rowsOf, runsOf, valueText, type SheetView } from "@/sheet-format.js";
import { shiftRefs } from "@/sheet-rules.js";
import { SheetFoot } from "./foot";
import { createSheetTabs } from "./tabs";
import { ASK_KEY, type SheetAnchor, type SheetBox, type SheetGrid, type SheetGridEvents, type SheetHost, type SheetMarks, type SheetPlace, type SheetRange, type SheetState } from "./host";
import { createLiveSheet } from "./live";
import { readLook } from "./theme";
import { createArtWindow } from "@/components/ui/chat-art";
import { createFormulaEditor, FormulaField, FormulaHelp } from "./formula-editor";
import { createSequenceKeys, SequenceHint, SHEET_SEQUENCES, SizePrompt, type SheetSequence, type SizeQuestion } from "./sequences";
import { createSheetSizes, dragRowEdges } from "./sizes";
import { createSheetFilter, FilterMenu } from "./filter";
import { createSheetFormats } from "./formats";
import { createSheetStyles } from "./styles";
import { createSheetRules, RulePrompt } from "./rules";
import { createSheetTools } from "./tools";
import { createSheetFind } from "./find";
import { createSheetHistory } from "./history";
import { FormatMenu } from "./format-menu";

// Cells written into the text a comment quotes, and how much of each: enough to read.
const QUOTED_CELLS = 200, QUOTED_CHARS = 40;
// The grid keeps a spreadsheet's chords the application binds elsewhere: Ctrl+- deletes rows, Ctrl+0 hides columns, Ctrl+Shift+1..5 are number formats.
const OWN_KEYS = ["primary+Minus", "primary+Digit0", ...[0, 1, 2, 3, 4, 5].map((n) => `primary+shift+Digit${n}`)].join(" ");
// A formula moved as a fill moves it; text stays as typed.
const shifted = (input: string, rows: number, cols: number) => input.startsWith("=") ? shiftRefs(input, rows, cols) : input;
const between = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, n) => from + n);
type Menu = { rows?: SheetRange; cols?: SheetRange };

/** A sheet: the hub's live copy drawn in the grid, a formula bar over it, the comment margin beside it. */
/** `onAsk`: the ask key (ASK_KEY) was pressed in the grid. */
export function SheetEditor(props: { host: SheetHost; id: string; name: string; margin?: JSX.Element; marginEmpty?: boolean; marks?(marks: SheetMarks): void; onState?(state: SheetState): void; onDrawn?(): void; onAsk?(): void }) {
  const live = createLiveSheet(props.host, props.id), cells = live.doc.getMap<string>(CELLS), look = live.doc.getMap<number | string>(LOOK);
  const [model, setModel] = createSignal<SheetView>(), [grid, setGrid] = createSignal<SheetGrid>(), [failed, setFailed] = createSignal<string>();
  const [at, setAt] = createSignal<SheetRange | null>(null), [changed, setChanged] = createSignal(0), [address, setAddress] = createSignal<string | null>(null), [scrolled, setScrolled] = createSignal(0);
  const [menu, setMenu] = createSignal<Menu>({});
  const formats = createSheetFormats(look, model, props.host.failed), styles = createSheetStyles(look, model, props.host.failed);
  // The grid's element is a signal: the menu trigger that makes it may make it again, and the grid then mounts in the one that stands.
  const [island, setIsland] = createSignal<HTMLDivElement>(), [slot, setSlot] = createSignal<HTMLDivElement>();
  let root: HTMLElement | undefined, anchors: SheetAnchor[] = [];
  const tabs = createSheetTabs({ doc: live.doc, host: props.host, id: props.id, name: props.name, grid, at });
  // Every tab's rows and columns are in it, so a row put in or taken out is undone with the formulas the hub moved for it.
  const history = createSheetHistory(live.doc, [cells, look, live.doc.getArray(ROWS), live.doc.getArray(COLS)], (op) => tabs.cells(op)), [stepped, setStepped] = createSignal(0);
  live.own(history.origin);
  history.onChange(() => setStepped((n) => n + 1));
  createEffect(() => history.scope(tabs.tabs().flatMap((tab) => [live.doc.getArray(rowsOf(tab.id)), live.doc.getArray(colsOf(tab.id))])));
  // A tab deleted, by anyone, ends the history, as Excel's does: a step on it could not be undone.
  let tabIds: Set<string> | undefined;
  createEffect(() => { const ids = new Set(tabs.tabs().map((tab) => tab.id)); if (tabIds && [...tabIds].some((id) => !ids.has(id))) history.clear(); tabIds = ids; });
  const watchers = new Set<(pressed?: string) => void>(), moved = (pressed?: string) => watchers.forEach((listener) => listener(pressed));
  createEffect(() => props.onState?.(live.state()));
  onCleanup(() => history.destroy());

  const write = (list: readonly { row: number; col: number; input: string }[]) => {
    const sheet = model();
    if (!sheet) return;
    // A cell past the sheet's edge has no row or column of its own yet: the hub makes them as it sets it.
    const past: { row: number; col: number; input: string }[] = [];
    // A merge shows only its upper-left cell: a value written under the rest would be kept unseen (emptying them, as Merge does, is let through).
    const hiddenIn = (row: number, col: number) => { const one = merges.at(row, col); return one !== undefined && (row !== one.top || col !== one.left); };
    live.doc.transact(() => { for (const { row, col, input } of list) { if (input && hiddenIn(row, col)) continue; const rowId = sheet.rowAt(row), colId = sheet.colAt(col); if (!rowId || !colId) { if (input) past.push({ row, col, input }); continue; } if (input) cells.set(key(rowId, colId), input); else cells.delete(key(rowId, colId)); } });
    for (const { row, col, input } of past) hub({ op: "set", at: a1(row, col), value: input });
  };
  const hub = (op: Parameters<SheetHost["cells"]>[0]) => void history.hub(op).catch((error: Error) => props.host.failed(error.message));
  const labelOf = (list: readonly { row: number; col: number; input: string }[]) => list.every(({ input }) => !input) ? "Clear contents" : list.length === 1 ? `Typing in ${a1(list[0]!.row, list[0]!.col)}` : "Paste";
  const writes = (label: string) => (list: readonly { row: number; col: number; input: string }[]) => history.act(label || labelOf(list), () => write(list));
  const editor = createFormulaEditor({
    grid, input: (row, col) => model()?.input(row, col) ?? "", functions: tabs.functions, merged: (row, col) => merges.at(row, col),
    write: (row, col, input) => writes("")([{ row, col, input }]),
    selected: () => { changed(); const area = at(); return area && { row: area.top, col: area.left }; }, error: (row, col) => model()?.error(row, col) ?? null,
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
  const filters = createSheetFilter(look, model, at, hub, (row, col) => Boolean(styles.at(row, col)?.bold)), [filtering, setFiltering] = createSignal<{ col: number; box: SheetBox } | null>(null);
  const sizes = createSheetSizes(look, model, styles.lines, filters.hidden), [question, setQuestion] = createSignal<SizeQuestion | null>(null);
  const merges = createSheetMerges(look, model), rules = createSheetRules(look, model), [ruling, setRuling] = createSignal<SheetRange | null>(null), decisions = createDecisionScope(() => props.id);
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
    write: (list, label) => writes(label ?? "")(list),
    fill: (range, values, from) => hub({ op: "fill", range: rangeA1(range), values, ...(from ? { from: rangeA1(from) } : {}) }),
    resized: (col, width) => history.act("Column width", () => sizes.setWidths(span("cols", col), width / zoom())),
    menu: setMenu,
    moved: () => { setScrolled((n) => n + 1); moved(); },
    drawn: () => props.onDrawn?.(),
    pressed: (row, col) => { const hit = anchors.find((anchor) => { const range = rangeOf(anchor); return range && row >= range.top && row <= range.bottom && col >= range.left && col <= range.right; }); if (hit) moved(hit.key); },
    key: (event, row, col) => {
      if (event.key === " " && event.ctrlKey !== event.shiftKey && !event.altKey && !event.metaKey) { event.preventDefault(); grid()?.whole(event.ctrlKey ? "cols" : "rows"); return true; }
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
      // AltGr is Ctrl and Alt together: what it types is typed.
      if ((event.ctrlKey || event.metaKey) && !(event.ctrlKey && event.altKey)) return false;
      if (event.key === "Enter" || event.key === "F2") { event.preventDefault(); editor.begin({ row, col }, "edit", "cell"); return true; }
      // Not held back: the editor has focus before the browser types the key, so it lands there, and every key after it.
      if (event.key.length !== 1 && event.key !== "Process") return false;
      editor.begin({ row, col }, "enter", "cell");
      return true;
    },
    activated: (row, col) => editor.begin({ row, col }, "edit", "cell"),
    filter: (_, col, box) => { filters.reapply(); setFiltering({ col, box }); },
  };

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
    void import("./grid").then(({ mountGrid }) => {
      if (over) return;
      made = mountGrid(into, { model: sheet, events, look: untrack(drawnLook), columns: {
        width: (col) => { const width = sizes.width(col); return width === undefined ? undefined : Math.round(width * zoom()); }, freeze: sizes.freeze, hidden: sizes.hidden, hiddenCols: sizes.hiddenCols,
        heights: () => { const by = zoom(), kept = sizes.heights(); return by === 1 ? kept : new Map([...kept].map(([row, height]) => [row, Math.round(height * by)])); },
        type: (col) => { const type = look.get(`type:${sheet.colAt(col)}`); return typeof type === "string" ? type : undefined; }, draw: formats.draw, dated: formats.dated, style: (row, col) => rules.style(filters.style(styles.at(row, col), row, col), row, col), frozen: (row, col) => Boolean(frozenAt(row, col)), mark: filters.mark, banded: filters.banded, merges: merges.list,
      } });
      setGrid(made);
    }, (error: Error) => { setFailed(error.message); props.onDrawn?.(); });
    const off = sheet.onChange((change) => {
      const cells = change.structure ? null : change.cells;
      rules.changed();
      made?.update(rules.wide() ? null : cells);
      // The formula bar reads the selected cell again only when it may have changed.
      const area = at();
      if (!cells || (area && cells.some(({ row, col }) => row === area.top && col === area.left))) setChanged((n) => n + 1);
      if (!cells) moved();
      if (change.structure) setFiltering(null);
    });
    const restyled = () => { made?.update(null); moved(); };
    look.observe(restyled);
    onCleanup(() => { over = true; off(); look.unobserve(restyled); made?.destroy(); setGrid(undefined); });
  });
  const art = createArtWindow(true);
  // The app's tokens change with the Interface size and the theme, each set on the root element.
  const relook = new MutationObserver(() => { const made = grid(); if (made && root) made.theme(untrack(drawnLook)); });
  relook.observe(document.documentElement, { attributes: true });
  onCleanup(() => relook.disconnect());
  // Drawn at another zoom, what stands where has moved.
  createEffect(on(() => props.host.display?.(), () => { const made = untrack(grid); if (made && root) { made.theme(drawnLook()); moved(); } }, { defer: true }));

  const input = () => { changed(); const area = at(), sheet = model(); return area && sheet ? sheet.input(area.top, area.left) : ""; };
  // The references of the formula being edited, outlined on the grid in their inks.
  createEffect(() => grid()?.references(editor.references()));
  // The cell editor stands over its cell, and may grow over the neighbours to its right as far as the grid's edge.
  let body: HTMLDivElement | undefined, formula: HTMLDivElement | undefined;
  // Key sequences and row edges are the grid's while it has the keyboard and the pointer (sequences.tsx, sizes.ts).
  createEffect(() => {
    const into = island();
    if (!into) return;
    const offKeys = sequences.attach(into), offEdges = dragRowEdges(into, grid, (row, height) => history.act("Row height", () => sizes.setHeights(span("rows", row), height / zoom())));
    onCleanup(() => { offKeys(); offEdges(); });
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
  // `Data!B2` shows its tab; `B:D` and `3:9` are whole columns and rows.
  const go = () => {
    const typed = (address() ?? "").trim(), local = typed ? tabs.reveal(typed).replace(/\$/g, "") : "", cols = /^([A-Za-z]{1,3}):([A-Za-z]{1,3})$/.exec(local), rows = /^(\d+):(\d+)$/.exec(local);
    const range = cols ? { top: 0, bottom: 0, left: Math.min(colIndex(cols[1]!), colIndex(cols[2]!)), right: Math.max(colIndex(cols[1]!), colIndex(cols[2]!)) }
      : rows ? { left: 0, right: 0, top: Math.max(0, Math.min(+rows[1]!, +rows[2]!) - 1), bottom: Math.max(+rows[1]!, +rows[2]!) - 1 } : parseRange(local);
    setAddress(null);
    if (range) { grid()?.select(range); if (cols || rows) grid()?.whole(cols ? "cols" : "rows"); }
    // After the grid has drawn the selection: focused with none, it selects its first cell.
    requestAnimationFrame(() => grid()?.focus());
  };
  const structure = (op: "insert-rows" | "insert-cols" | "delete-rows" | "delete-cols", at: number, count = 1) => hub({ op, at, count });

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
    return { text: lines.join("\n"), label: corners.range, under: corners, boxes: () => { const now = rangeOf({ under: corners }), box = now && grid()?.bounds(now); return box ? [box] : []; } };
  };
  const find = createSheetFind({ model, grid, at, hidden: sizes.hidden, hiddenCols: sizes.hiddenCols, draw: formats.draw, write: (list) => writes(list.length === 1 ? "Replace" : "Replace all")(list) });
  const tools = createSheetTools({ tip: sequences.tip, at, styles, formats, offered: props.host.tools, done: () => grid()?.focus(), spread: (range, way) => spread(range, way), act: history.act,
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
      grid()?.highlight(list.filter((anchor) => !anchor.resolved).flatMap((anchor) => { const range = rangeOf(anchor); return range ? [{ range, current: anchor.current }] : []; }));
    },
    where: (name) => { const anchor = anchors.find((one) => one.key === name), range = anchor && rangeOf(anchor); return range ? grid()?.bounds(range) ?? null : null; },
    watch: (listener) => { watchers.add(listener); return () => watchers.delete(listener); },
    reveal: (address) => { const range = parseRange(tabs.reveal(address)); if (range) grid()?.select(range); },
    focus: () => grid()?.focus(),
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
  const paste = (range: SheetRange, values = false) => void navigator.clipboard.readText().then((text) => grid()?.paste({ row: range.top, col: range.left }, text, values), (error: Error) => props.host.failed(error.message));
  // Each run of shown rows on its own, the last first, so the runs above keep their places.
  const deleteRows = (range: SheetRange) => history.act(`Delete ${range.bottom > range.top ? "rows" : "row"}`, () => { const rows = shownRows(range); for (let end = rows.length - 1; end >= 0;) { let start = end; while (start > 0 && rows[start - 1] === rows[start]! - 1) start--; structure("delete-rows", rows[start]!, end - start + 1); end = start - 1; } });
  // Fill down and Fill right: the selection's first shown row (or column) into the rest of it, from the shown row above (or column left) where it is
  // one deep, as a spreadsheet's; the hub moves the formulas. Each run of shown rows and columns is a fill of its own, its formulas first moved to where
  // the run starts.
  const spread = (picked: SheetRange, way: "down" | "right") => history.act(`Fill ${way}`, () => {
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
      hub({ op: "fill", range: rangeA1({ top: lines[0]!, bottom: lines.at(-1)!, left: across[0]!, right: across.at(-1)! }),
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
    // A sheet's sort: every row under the frozen ones, by one column, the frozen header naming it.
    const frozen = sizes.freeze().rows, header = frozen ? valueText(model()?.value(frozen - 1, byCol) ?? null) : "", named = header ? `“${header}”` : `column ${colName(byCol)}`;
    const sortSheet = (descending: boolean) => history.act(`Sort sheet ${descending ? "Z–A" : "A–Z"}`, () => { if (frozen < lastRow) hub({ op: "sort", range: rangeA1({ top: frozen, bottom: lastRow, left: 0, right: lastCol }), column: colName(byCol), descending }); });
    const hideRows = () => history.act("Hide rows", () => sizes.setHidden(between(range.top, range.bottom), true));
    return [
      Boolean(props.onAsk) && [{ label: "Comment", icon: <Icons.Chat />, run: () => { grid()?.select(range); props.onAsk?.(); } }],
      [
        { label: "Cut", icon: <Icons.Cut />, keys: ["Ctrl", "X"], run: () => void copy(range, true).then(() => clear(range, "Cut")) },
        { label: "Copy", icon: <Icons.Copy />, keys: ["Ctrl", "C"], run: () => void copy(range) },
        { label: "Paste", icon: <Icons.Paste />, keys: ["Ctrl", "V"], run: () => paste(range) },
        ...grid()?.held() ? [{ label: "Paste values only", icon: <Icons.Paste />, keys: ["Ctrl", "Shift", "V"], run: () => paste(range, true) }] : [],
      ],
      [
        ...kind !== "cols" ? [{ label: range.bottom ? `Freeze rows 1 to ${range.bottom + 1}` : "Freeze row 1", icon: <Icons.Pin />, run: () => history.act("Freeze panes", () => sizes.setFreeze(range.bottom + 1, sizes.freeze().cols)) }] : [],
        ...kind !== "rows" ? [{ label: range.right ? `Freeze columns A to ${colName(range.right)}` : "Freeze column A", icon: <Icons.Pin />, run: () => history.act("Freeze panes", () => sizes.setFreeze(sizes.freeze().rows, range.right + 1)) }] : [],
        ...sizes.freeze().rows || sizes.freeze().cols ? [{ label: "Unfreeze", icon: <Icons.PinOff />, keys: ["Alt", "W", "F", "F"], run: () => history.act("Freeze panes", () => sizes.setFreeze(0, 0)) }] : [],
      ],
      [
        ...kind !== "cols" ? [
          { label: `Insert ${rowsSaid} above`, icon: <Icons.Add />, keys: whole ? ["Ctrl", "Shift", "="] : undefined, run: () => structure("insert-rows", range.top, nRows) },
          ...kind === "rows" ? [{ label: `Insert ${rowsSaid} below`, icon: <Icons.Add />, run: () => structure("insert-rows", range.bottom + 1, nRows) }] : [],
        ] : [],
        ...kind !== "rows" ? [
          { label: `Insert ${colsSaid} left`, icon: <Icons.Add />, keys: whole ? ["Ctrl", "Shift", "="] : undefined, run: () => structure("insert-cols", range.left, nCols) },
          ...kind === "cols" ? [{ label: `Insert ${colsSaid} right`, icon: <Icons.Add />, run: () => structure("insert-cols", range.right + 1, nCols) }] : [],
        ] : [],
      ],
      kind === "rows" && [
        { label: `Move ${rowsSaid} up`, icon: <LineIcons.up />, disabled: range.top === 0, run: () => moveBy(true, -1) },
        { label: `Move ${rowsSaid} down`, icon: <LineIcons.down />, disabled: range.bottom >= lastRow, run: () => moveBy(true, 1) },
      ],
      kind === "cols" && [
        { label: `Move ${colsSaid} left`, icon: <LineIcons.left />, disabled: range.left === 0, run: () => moveBy(false, -1) },
        { label: `Move ${colsSaid} right`, icon: <LineIcons.right />, disabled: range.right >= lastCol, run: () => moveBy(false, 1) },
      ],
      [
        { label: "Clear", icon: <Icons.Erase />, sub: [
          { label: "Clear contents", keys: ["Delete"], run: () => clear(range) },
          { label: "Clear formatting", keys: ["Alt", "H", "E", "F"], run: () => history.act("Clear formatting", clearFormats) },
          { label: "Clear all", run: () => history.act("Clear all", () => { clear(range); clearFormats(); }) },
        ] },
        ...kind !== "cols" ? [{ label: `Delete ${rowsSaid}`, icon: <Icons.Delete />, destructive: true, keys: whole ? ["Ctrl", "-"] : undefined, run: () => deleteRows(range) }] : [],
        ...kind !== "rows" ? [{ label: `Delete ${colsSaid}`, icon: <Icons.Delete />, destructive: true, keys: whole ? ["Ctrl", "-"] : undefined, run: () => structure("delete-cols", range.left, nCols) }] : [],
        ...kind === "rows" ? [
          { label: `Hide ${rowsSaid}`, icon: <Icons.Hide />, run: hideRows },
          ...hiddenIn(range) ? [{ label: "Unhide rows", icon: <Icons.Preview />, run: () => { const lines = between(range.top, range.bottom); history.act("Unhide rows", () => { sizes.setHidden(lines, false); filters.show(lines); }); } }] : [],
        ] : [],
        ...kind === "cols" ? [
          { label: `Hide ${colsSaid}`, icon: <Icons.Hide />, keys: ["Ctrl", "0"], run: () => history.act("Hide columns", () => sizes.setHiddenCols(between(range.left, range.right), true)) },
          ...hiddenColsBy(range).length ? [{ label: "Unhide columns", icon: <Icons.Preview />, keys: ["Ctrl", "Shift", "0"], run: () => history.act("Unhide columns", () => sizes.setHiddenCols(hiddenColsBy(range), false)) }] : [],
        ] : [],
      ],
      kind === "rows" && [
        { label: `Resize ${rowsSaid}…`, icon: <Icons.Resize />, keys: ["Alt", "H", "O", "H"], run: () => sized("HOH", range) },
        { label: "Fit row height", icon: <Icons.Resize />, keys: ["Alt", "H", "O", "A"], run: () => history.act("Row height", () => sized("HOA", range)) },
      ],
      kind === "cols" && [
        { label: `Resize ${colsSaid}…`, icon: <Icons.Resize />, keys: ["Alt", "H", "O", "W"], run: () => sized("HOW", range) },
        { label: "Fit column width", icon: <Icons.Resize />, keys: ["Alt", "H", "O", "I"], run: () => history.act("Column width", () => sized("HOI", range)) },
        { label: "Default width…", icon: <Icons.Resize />, keys: ["Alt", "H", "O", "D"], run: () => sized("HOD", range) },
      ],
      [
        { label: "Sort range", icon: <SortIcons.ascending />, sub: [
          { label: `A to Z by column ${colName(byCol)}`, icon: <SortIcons.ascending />, keys: ["Alt", "H", "S", "S"], run: () => filters.keys.sort(false, byCol) },
          { label: `Z to A by column ${colName(byCol)}`, icon: <SortIcons.descending />, keys: ["Alt", "H", "S", "O"], run: () => filters.keys.sort(true, byCol) },
        ] },
        { label: "Sort sheet", icon: <SortIcons.ascending />, sub: [
          { label: `A to Z by ${named}`, icon: <SortIcons.ascending />, run: () => sortSheet(false) },
          { label: `Z to A by ${named}`, icon: <SortIcons.descending />, run: () => sortSheet(true) },
        ] },
        { label: filters.filter() ? "Remove filter" : "Create a filter", icon: <SortIcons.filter />, keys: ["Ctrl", "Shift", "L"], run: filters.keys.filter },
        ...filteredBy(byCol) ? [{ label: "Filter column…", icon: <SortIcons.filter />, run: () => openFilter(filteredBy(byCol)!, byCol) }] : [],
        { label: inTable() ? "Remove table" : "Format as table", icon: <SortIcons.table />, keys: ["Alt", "H", "T"], run: filters.keys.table },
      ],
    ];
  };
  createEffect(on(tabs.shown, () => setFiltering(null), { defer: true }));
  return <section ref={(element) => { root = element; art(element); }} class="ui-spreadsheet" aria-label={props.name} data-margin={props.marginEmpty ? "none" : "beside"}
    onKeyDown={(event) => {
      if (!(event.ctrlKey || event.metaKey) || !island()?.contains(event.target as Node)) return;
      // A style's chord is its tool's step: Ctrl+B is Bold.
      const tool = tools.find((one) => one.keys?.length === 2 && one.keys[1]!.toLowerCase() === event.key.toLowerCase())?.label ?? "";
      if (find.keys(event) || tabs.key(event) || history.act(tool, () => formats.key(event, at()) || styles.key(event, at())) || filters.key(event)) return;
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
        if (!area || !lines) return;
        if (lines === "rows") return void (adding ? structure("insert-rows", area.top, count(area.top, area.bottom)) : deleteRows(area));
        return void structure(adding ? "insert-cols" : "delete-cols", area.left, count(area.left, area.right));
      }
      // Ctrl+Shift+V pastes what the cells copied here showed, not their formulas; held back, it is not the browser's paste as plain text.
      if (event.shiftKey && !event.altKey && event.code === "KeyV") { event.preventDefault(); const area = at(); if (area) paste(area, true); return; }
      if (event.altKey && event.code === ASK_KEY) { event.preventDefault(); return props.onAsk?.(); }
      // The grid has no history of its own: what this page did is undone here, never what others did.
      const redo = event.key === "y" || (event.key === "z" && event.shiftKey);
      if (event.key !== "z" && !redo) return;
      event.preventDefault();
      if (redo) history.redo(); else history.undo();
    }}>
    <div class="ui-spreadsheet-bar">
      <Input class="ui-spreadsheet-address ui-frost ui-frost-raised" aria-label="Cell" spellcheck={false} value={address() ?? (at() ? addressOf(at()!) : "")} onFocus={(event) => event.currentTarget.select()} onInput={(event) => setAddress(event.currentTarget.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); go(); } else if (event.key === "Escape") { setAddress(null); grid()?.focus(); } }} onBlur={() => setAddress(null)} />
      {/* The formula bar edits the selected cell: focused, it opens the cell to edit as F2 does. */}
      <Frost lift="raised" ref={formula} class="ui-input ui-spreadsheet-formula" onFocusIn={() => { const area = at(); if (area && !editor.editing()) editor.begin({ row: area.top, col: area.left }, "edit", "bar"); }}>
        <FormulaField editor={editor} place="bar" label="Formula" class="ui-formula-text" idle={input} disabled={!at()} />
      </Frost>
      {/* The ribbon (Markup's bar with the sheet's tools) stands here, at the row's end, folding to the room the formula field leaves it. */}
      <div ref={setSlot} class="ui-spreadsheet-slot" />
      <Show when={frozenHere()}>{(cell) => <Notice kind="tool" title={cell().why ? `${cell().formula}: ${cell().why}` : cell().formula}>Frozen on import: ={cell().formula.replace(/^=/, "")}</Notice>}</Show>
    </div>
    <div ref={body} class="ui-spreadsheet-body">
      <Show when={!failed()} fallback={<Empty role="alert">The sheet could not be drawn: {failed()}</Empty>}>
        <ContextMenu placement="bottom-start">
          <ContextMenuTrigger as="div" ref={setIsland} class="ui-spreadsheet-grid" data-own-keys={OWN_KEYS} />
          <ContextMenuContent onCloseAutoFocus={(event) => { const open = opening; opening = undefined; if (open) { event.preventDefault(); open(); } }}>
            <SheetMenu groups={menuGroups()} after={<>
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
              {/* The formatting submenus (Formatting, Conditional formatting) stand here, with Number format. */}
              <Show when={formatted()}>{(range) => <FormatMenu formats={formats} range={range()} />}</Show>
              <Show when={props.host.openSettings}>{(open) => <MenuSection><MenuRow icon={<Icons.Settings />} onSelect={() => open()()}>View settings…</MenuRow></MenuSection>}</Show>
            </>} />
          </ContextMenuContent>
        </ContextMenu>
        <div class="ui-spreadsheet-editor" data-open={editor.editing() ? "" : undefined} style={{ ...cellBox(), "--sheet-zoom": zoom() }}><FormulaField editor={editor} place="cell" label="Cell" class="ui-formula-text" /></div>
        <FormulaHelp editor={editor} frame={() => body} />
        <SequenceHint typed={sequences.typed} next={sequences.next} anchor={slot} />
        <SizePrompt question={question()} onClose={() => { setQuestion(null); grid()?.focus(); }} />
        <RulePrompt area={ruling()} rules={rules} act={(label, run) => history.act(label, run)} onClose={() => { setRuling(null); grid()?.focus(); }} />
        <FilterMenu filter={filters} at={filtering()} frame={() => body} onClose={() => { setFiltering(null); grid()?.focus(); }} />
        <find.view beside={Boolean(props.margin) && !props.marginEmpty} />
        <Show when={!model()}><Empty role="status" class="ui-spreadsheet-waiting">Opening the sheet…</Empty></Show>
      </Show>
      <Show when={props.margin}><aside class="ui-spreadsheet-margin" aria-label="Comments">{props.margin}</aside></Show>
    </div>
    <SheetFoot tabs={tabs} id={props.id} format={() => formats.figure(at())} />
  </section>;
}
