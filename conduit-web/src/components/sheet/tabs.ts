import { createSignal, type Accessor } from "solid-js";
import type * as Y from "yjs";
import { createSheetView, parseRange, parseRef, rangeA1, tabRef, type SheetBook, type SheetChange, type SheetTabOp, type SheetTabsResult, type SheetView, type Tab } from "@/sheet-format.js";
import type { SheetAnchor, SheetCellsOp, SheetGrid, SheetHost, SheetRange } from "./host";

/** What the foot needs of the editor: the workbook's tabs (hidden ones too), the one shown, showing one, the hub's tab verbs, the cells selected, the shown tab and whether values are still being computed. */
export interface SheetTabs {
  tabs(): Tab[];
  shown(): string | undefined;
  show(id: string): void;
  /** Done by the hub; refused, its words are shown and the answer is null. */
  op(op: SheetTabOp): Promise<SheetTabsResult | null>;
  selection(): SheetRange | null;
  model(): SheetView | undefined;
  computing(): boolean;
  /** Whether a tab holds anything typed. */
  filled(id: string): boolean;
  focus(): void;
  failed(message: string): void;
}
/** The editor's half: the model the grid draws (whichever tab is shown, the same object throughout), cell ops sent for the shown tab, addresses with their tab. */
export interface SheetTabsControl extends SheetTabs {
  /** Made once the hub's copy is held; its `destroy` ends the workbook and its engine. */
  open(): SheetView;
  /** The engine's function names, custom ones included ([] until its worker says). */
  functions(): readonly string[];
  cells(op: SheetCellsOp): Promise<unknown>;
  /** A range as a comment says it: with its tab where the workbook has several. */
  where(range: SheetRange): { range: string; tab?: string };
  /** `Data!B2:C3`: shows Data, and gives back `B2:C3`. */
  reveal(address: string): string;
  /** The comment opened in the margin, when it is on another tab, shows that tab. */
  follow(anchors: readonly SheetAnchor[]): void;
  /** Ctrl+PageDown and Ctrl+PageUp: the next or previous tab shown. True when taken. */
  key(event: KeyboardEvent): boolean;
}

type Kept = { range: SheetRange | null; scroll: { row: number; col: number } };
const STORE = "conduit.sheet.tab.";
const A1: SheetRange = { top: 0, left: 0, bottom: 0, right: 0 };

/** The workbook behind one sheet editor, and which of its tabs the grid shows: chosen per artifact on this browser, each tab's selection and scroll kept for the session. */
export function createSheetTabs(options: { doc: Y.Doc; host: SheetHost; id: string; name: string; grid: Accessor<SheetGrid | undefined>; at: Accessor<SheetRange | null> }): SheetTabsControl {
  const [tabs, setTabs] = createSignal<Tab[]>([]), [shown, setShown] = createSignal<string>(), [model, setModel] = createSignal<SheetView>();
  const [computing, setComputing] = createSignal(true), [functions, setFunctions] = createSignal<readonly string[]>([]);
  const kept = new Map<string, Kept>(), listeners = new Set<(change: SheetChange) => void>();
  let book: SheetBook | undefined, worker: Worker | undefined, views = new Map<string, SheetView>(), current: SheetView | undefined, off = () => {}, waiting: string | undefined, followed: string | undefined;
  const view = (id: string) => views.get(id) ?? views.set(id, book!.tab(id)).get(id)!;
  const visible = () => tabs().filter((tab) => !tab.hidden);
  const stored = () => { try { return localStorage.getItem(STORE + options.id) ?? undefined; } catch { return undefined; } };

  // The grid's model stands for whichever tab is shown, so a switch draws the other tab in the same grid: nothing is mounted again.
  const proxy: SheetView = {
    get id() { return current?.id; }, get name() { return current?.name ?? ""; },
    size: () => current!.size(), input: (r, c) => current!.input(r, c), inputs: () => current!.inputs(), value: (r, c) => current!.value(r, c), error: (r, c) => current!.error(r, c),
    rowAt: (i) => current!.rowAt(i), colAt: (i) => current!.colAt(i), indexOfRow: (id) => current!.indexOfRow(id), indexOfCol: (id) => current!.indexOfCol(id),
    onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    destroy: () => { off(); listeners.clear(); book?.destroy(); worker?.terminate(); },
  };
  const emit = (change: SheetChange) => { for (const listener of listeners) listener(change); };

  const show = (id: string, select?: SheetRange) => {
    if (!book || !book.tabs().some((tab) => tab.id === id)) return;
    const was = shown(), grid = options.grid();
    if (was === id) { if (select) grid?.select(select); return; }
    if (was && grid) kept.set(was, { range: options.at(), scroll: grid.scroll() });
    off();
    current = view(id);
    off = current.onChange(emit);
    setShown(id); setModel(() => current);
    try { localStorage.setItem(STORE + options.id, id); } catch { /* this session only */ }
    // Told as a structure change, the grid reads the tab's size, widths and cells again, and the editor its formula bar and comments.
    emit({ structure: true, cells: null });
    if (!grid) return;
    const back = kept.get(id), place = back?.scroll ?? { row: 0, col: 0 };
    grid.select(select ?? back?.range ?? A1);
    // Scrolled in the frame before it is painted, in a task of its own (the switch and the scroll together run past a frame's budget); again a frame
    // later, should the grid not yet have had this tab's size.
    const land = () => { if (shown() === id) { if (select) grid.select(select); else grid.scroll(place); } };
    requestAnimationFrame(() => { land(); requestAnimationFrame(() => { const now = grid.scroll(); if (select || now.row !== place.row || now.col !== place.col) land(); }); });
  };
  // A switch pressed or keyed is made in a task of its own: inside an input event the grid's React renders at once, in the same task as the event.
  const soon = (id: string) => { const channel = new MessageChannel(); channel.port1.onmessage = () => show(id); channel.port2.postMessage(null); };
  const step = (by: number) => { const list = visible(), at = list.findIndex((tab) => tab.id === shown()); const next = list[at + by]; if (next) soon(next.id); return Boolean(next); };
  // The shown tab gone or hidden (here or by anyone), its neighbour is shown.
  const settle = () => {
    const list = book!.tabs(), was = tabs().findIndex((tab) => tab.id === shown());
    setTabs(list);
    if (waiting && list.some((tab) => tab.id === waiting && !tab.hidden)) { const id = waiting; waiting = undefined; return show(id); }
    const now = list.find((tab) => tab.id === shown());
    if (now && !now.hidden) return;
    const open = list.filter((tab) => !tab.hidden);
    const next = open.find((tab) => list.indexOf(tab) >= was) ?? open.at(-1);
    if (next) show(next.id);
  };

  const op = async (change: SheetTabOp) => {
    try {
      const done = await options.host.cells(change) as SheetTabsResult;
      if (change.op === "add-tab" || (change.op === "hide-tab" && !change.hidden)) { if (book?.tabs().some((tab) => tab.id === done.tab && !tab.hidden)) show(done.tab); else waiting = done.tab; }
      return done;
    } catch (error) { options.host.failed((error as Error).message); return null; }
  };

  return {
    tabs, shown, show: soon, op, model, computing, functions, selection: options.at,
    filled: (id) => { const tab = book?.tab(id); if (!tab) return false; const { rows, cols } = tab.size(); for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (tab.input(r, c)) return true; return false; },
    focus: () => options.grid()?.focus(),
    failed: (message) => options.host.failed(message),
    open: () => {
      worker = new Worker(new URL("./engine-worker.ts", import.meta.url), { type: "module", name: "Sheet engine" });
      worker.addEventListener("error", (event) => options.host.failed(`The sheet's formulas could not be computed: ${event.message}`));
      const made = book = createSheetView(options.doc, worker, { name: options.name });
      made.onChange((change) => { if (change.tabs) settle(); if (change.computing) setComputing(made.computing()); if (change.functions) setFunctions(made.functions()); });
      const list = book.tabs(), saved = list.find((tab) => tab.id === stored() && !tab.hidden) ?? list.find((tab) => !tab.hidden) ?? list[0]!;
      setTabs(list);
      current = view(saved.id);
      off = current.onChange(emit);
      setShown(saved.id); setModel(() => current);
      return proxy;
    },
    cells: (change) => options.host.cells("tab" in change || !shown() ? change : { ...change, tab: shown() } as SheetCellsOp),
    where: (range) => {
      const tab = tabs().find((one) => one.id === shown());
      return tab && tabs().length > 1 ? { range: `${tabRef(tab.name)}!${rangeA1(range)}`, tab: tab.name } : { range: rangeA1(range) };
    },
    reveal: (address) => { const ref = parseRef(address), id = ref.tab ? book?.find(ref.tab) : null; if (id && id !== shown()) show(id, parseRange(ref.range) ?? undefined); return ref.range; },
    follow: (anchors) => {
      const open = anchors.find((anchor) => anchor.current && !anchor.resolved), key = open?.key;
      if (key === followed) return;
      followed = key;
      const corner = String(open?.under?.cells ?? "").split(" ")[0] ?? "", tab = book?.tabOfRow(corner.slice(0, corner.indexOf(":")));
      if (tab && tab !== shown()) soon(tab);
    },
    key: (event) => {
      if (!(event.ctrlKey || event.metaKey) || (event.key !== "PageDown" && event.key !== "PageUp")) return false;
      event.preventDefault();
      step(event.key === "PageDown" ? 1 : -1);
      return true;
    },
  };
}
