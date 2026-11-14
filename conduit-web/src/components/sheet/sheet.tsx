import { createEffect, createSignal, onCleanup, Show, untrack, type JSX } from "solid-js";
import * as Y from "yjs";
import { Empty, Icons } from "@/components/ui";
import { Input } from "@/components/ui/controls";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, MenuRow, MenuSection } from "@/components/ui/menus";
import { CELLS, LOOK, a1, createSheetModel, key, parseRange, rangeA1, type SheetModel } from "@/sheet-format.js";
import { ASK_KEY, type SheetAnchor, type SheetBox, type SheetGrid, type SheetGridEvents, type SheetHost, type SheetMarks, type SheetPlace, type SheetRange, type SheetState } from "./host";
import { createLiveSheet } from "./live";
import { readLook } from "./theme";

// Cells written into the text a comment quotes, and how much of each: enough to read.
const QUOTED_CELLS = 200, QUOTED_CHARS = 40;
type Menu = { rows?: SheetRange; cols?: SheetRange };

/** A sheet: the hub's live copy drawn in the grid, a formula bar over it, the comment margin beside it. */
/** `onAsk`: the ask key (ASK_KEY) was pressed in the grid. */
export function SheetEditor(props: { host: SheetHost; id: string; name: string; margin?: JSX.Element; marginEmpty?: boolean; marks?(marks: SheetMarks): void; onState?(state: SheetState): void; onDrawn?(): void; onAsk?(): void }) {
  const live = createLiveSheet(props.host, props.id), cells = live.doc.getMap<string>(CELLS), look = live.doc.getMap<number | string>(LOOK);
  const history = new Y.UndoManager([cells, look]);
  const [model, setModel] = createSignal<SheetModel>(), [grid, setGrid] = createSignal<SheetGrid>(), [failed, setFailed] = createSignal<string>();
  const [at, setAt] = createSignal<SheetRange | null>(null), [changed, setChanged] = createSignal(0), [draft, setDraft] = createSignal<string | null>(null), [address, setAddress] = createSignal<string | null>(null);
  const [menu, setMenu] = createSignal<Menu>({});
  // The grid's element is a signal: the menu trigger that makes it may make it again, and the grid then mounts in the one that stands.
  const [island, setIsland] = createSignal<HTMLDivElement>(), [slot, setSlot] = createSignal<HTMLDivElement>();
  let root: HTMLElement | undefined, anchors: SheetAnchor[] = [];
  const watchers = new Set<(pressed?: string) => void>(), moved = (pressed?: string) => watchers.forEach((listener) => listener(pressed));
  createEffect(() => props.onState?.(live.state()));
  onCleanup(() => history.destroy());

  const write = (list: readonly { row: number; col: number; input: string }[]) => {
    const sheet = model();
    if (!sheet) return;
    // A cell past the sheet's edge has no row or column of its own yet: the hub makes them as it sets it.
    const past: { row: number; col: number; input: string }[] = [];
    live.doc.transact(() => { for (const { row, col, input } of list) { const rowId = sheet.rowAt(row), colId = sheet.colAt(col); if (!rowId || !colId) { if (input) past.push({ row, col, input }); continue; } if (input) cells.set(key(rowId, colId), input); else cells.delete(key(rowId, colId)); } });
    for (const { row, col, input } of past) void props.host.cells({ op: "set", at: a1(row, col), value: input }).catch((error: Error) => props.host.failed(error.message));
  };
  const hub = (op: Parameters<SheetHost["cells"]>[0]) => void props.host.cells(op).catch((error: Error) => props.host.failed(error.message));
  const events: SheetGridEvents = {
    selected: (range) => { setAt(range); setDraft(null); },
    write,
    fill: (range, values) => hub({ op: "fill", range: rangeA1(range), values }),
    resized: (col, width) => { const id = model()?.colAt(col); if (id) look.set(`width:${id}`, Math.round(width)); },
    menu: setMenu,
    moved: () => moved(),
    drawn: () => props.onDrawn?.(),
    pressed: (row, col) => { const hit = anchors.find((anchor) => { const range = rangeOf(anchor); return range && row >= range.top && row <= range.bottom && col >= range.left && col <= range.right; }); if (hit) moved(hit.key); },
  };

  // The model is made once the hub's copy is held, so it is built once from it and not cell by cell as it arrives.
  createEffect(() => {
    if (!live.synced() || untrack(model)) return;
    const sheet = createSheetModel(live.doc);
    setModel(sheet);
    onCleanup(() => sheet.destroy());
  });
  createEffect(() => {
    const sheet = model(), into = island();
    if (!sheet || !into) return;
    let made: SheetGrid | undefined, over = false;
    void import("./grid").then(({ mountGrid }) => {
      if (over) return;
      made = mountGrid(into, { model: sheet, events, look: readLook(root!), columns: {
        width: (col) => { const width = look.get(`width:${sheet.colAt(col)}`); return typeof width === "number" ? width : undefined; },
        type: (col) => { const type = look.get(`type:${sheet.colAt(col)}`); return typeof type === "string" ? type : undefined; },
      } });
      setGrid(made);
    }, (error: Error) => { setFailed(error.message); props.onDrawn?.(); });
    const off = sheet.onChange((change) => {
      const cells = change.structure ? null : change.cells;
      made?.update(cells);
      // The formula bar reads the selected cell again only when it may have changed.
      const area = at();
      if (!cells || (area && cells.some(({ row, col }) => row === area.top && col === area.left))) setChanged((n) => n + 1);
      if (!cells) moved();
    });
    const restyled = () => { made?.update(null); moved(); };
    look.observe(restyled);
    onCleanup(() => { over = true; off(); look.unobserve(restyled); made?.destroy(); setGrid(undefined); });
  });
  // The app's tokens change with the Interface size and the theme, each set on the root element.
  const relook = new MutationObserver(() => { const made = grid(); if (made && root) made.theme(readLook(root)); });
  relook.observe(document.documentElement, { attributes: true });
  onCleanup(() => relook.disconnect());

  const input = () => { changed(); const area = at(), sheet = model(); return area && sheet ? sheet.input(area.top, area.left) : ""; };
  const commit = (move: boolean) => {
    const area = at(), typed = draft();
    if (area && typed !== null) write([{ row: area.top, col: area.left, input: typed }]);
    setDraft(null);
    if (area && move) grid()?.select({ top: area.top + 1, bottom: area.top + 1, left: area.left, right: area.left }, true);
    grid()?.focus();
  };
  const go = () => { const range = parseRange(address() ?? ""); setAddress(null); if (range) grid()?.select(range, true); grid()?.focus(); };
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
    return ids?.every(Boolean) ? { cells: `${key(ids[0]!, ids[1]!)} ${key(ids[2]!, ids[3]!)}`, range: rangeA1(range) } : null;
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
    anchors: (list) => {
      anchors = list;
      grid()?.highlight(list.filter((anchor) => !anchor.resolved).flatMap((anchor) => { const range = rangeOf(anchor); return range ? [{ range, current: anchor.current }] : []; }));
    },
    where: (name) => { const anchor = anchors.find((one) => one.key === name), range = anchor && rangeOf(anchor); return range ? grid()?.bounds(range) ?? null : null; },
    watch: (listener) => { watchers.add(listener); return () => watchers.delete(listener); },
    reveal: (address) => { const range = parseRange(address); if (range) grid()?.select(range, true); },
    focus: () => grid()?.focus(),
    history: { undo: () => Boolean(history.undo()), redo: () => Boolean(history.redo()), canUndo: () => history.canUndo(), canRedo: () => history.canRedo() },
  };
  // Highlights are drawn by the grid: told again once it is made.
  createEffect(() => { if (grid()) marks.anchors(anchors); });
  props.marks?.(marks);

  const rows = () => menu().rows, cols = () => menu().cols;
  const count = (from: number, to: number) => to - from + 1;
  return <section ref={root} class="ui-spreadsheet" aria-label={props.name} data-margin={props.marginEmpty ? "none" : "beside"}
    onKeyDown={(event) => {
      if (!(event.ctrlKey || event.metaKey) || !island()?.contains(event.target as Node)) return;
      if (event.altKey && event.code === ASK_KEY) { event.preventDefault(); return props.onAsk?.(); }
      // The grid has no history of its own: what this page wrote is undone here, never what others wrote.
      const redo = event.key === "y" || (event.key === "z" && event.shiftKey);
      if (event.key !== "z" && !redo) return;
      event.preventDefault();
      if (redo) history.redo(); else history.undo();
    }}>
    <div class="ui-spreadsheet-bar">
      <Input class="ui-spreadsheet-address" aria-label="Cell" spellcheck={false} value={address() ?? (at() ? rangeA1(at()!) : "")} onFocus={(event) => event.currentTarget.select()} onInput={(event) => setAddress(event.currentTarget.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); go(); } else if (event.key === "Escape") { setAddress(null); grid()?.focus(); } }} onBlur={() => setAddress(null)} />
      <Input class="ui-spreadsheet-formula" aria-label="Formula" spellcheck={false} disabled={!at()} value={draft() ?? input()} onInput={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(true); } else if (event.key === "Escape") { setDraft(null); grid()?.focus(); } }} onBlur={() => { if (draft() !== null) commit(false); }} />
      {/* Room at the row's end for what a layer over the sheet puts there (Markup's bar, where its kind says so); empty, it takes none. */}
      <div ref={setSlot} class="ui-spreadsheet-slot" />
    </div>
    <div class="ui-spreadsheet-body">
      <Show when={!failed()} fallback={<Empty role="alert">The sheet could not be drawn: {failed()}</Empty>}>
        <ContextMenu placement="bottom-start">
          <ContextMenuTrigger as="div" ref={setIsland} class="ui-spreadsheet-grid" />
          <ContextMenuContent>
            <Show when={rows()}>{(range) => <MenuSection>
              <MenuRow icon={<Icons.Add />} onSelect={() => structure("insert-rows", range().top, count(range().top, range().bottom))}>Insert {count(range().top, range().bottom) > 1 ? `${count(range().top, range().bottom)} rows` : "row"} above</MenuRow>
              <MenuRow icon={<Icons.Add />} onSelect={() => structure("insert-rows", range().bottom + 1, count(range().top, range().bottom))}>Insert {count(range().top, range().bottom) > 1 ? `${count(range().top, range().bottom)} rows` : "row"} below</MenuRow>
              <MenuRow destructive icon={<Icons.Delete />} onSelect={() => structure("delete-rows", range().top, count(range().top, range().bottom))}>Delete {count(range().top, range().bottom) > 1 ? `rows ${range().top + 1}–${range().bottom + 1}` : `row ${range().top + 1}`}</MenuRow>
            </MenuSection>}</Show>
            <Show when={cols()}>{(range) => <MenuSection>
              <MenuRow icon={<Icons.Add />} onSelect={() => structure("insert-cols", range().left, count(range().left, range().right))}>Insert {count(range().left, range().right) > 1 ? `${count(range().left, range().right)} columns` : "column"} left</MenuRow>
              <MenuRow icon={<Icons.Add />} onSelect={() => structure("insert-cols", range().right + 1, count(range().left, range().right))}>Insert {count(range().left, range().right) > 1 ? `${count(range().left, range().right)} columns` : "column"} right</MenuRow>
              <MenuRow destructive icon={<Icons.Delete />} onSelect={() => structure("delete-cols", range().left, count(range().left, range().right))}>Delete {count(range().left, range().right) > 1 ? "columns" : "column"} {rangeA1({ ...range(), top: 0, bottom: 0 }).replace(/1/g, "")}</MenuRow>
            </MenuSection>}</Show>
          </ContextMenuContent>
        </ContextMenu>
        <Show when={!model()}><Empty role="status" class="ui-spreadsheet-waiting">Opening the sheet…</Empty></Show>
      </Show>
      <Show when={props.margin}><aside class="ui-spreadsheet-margin" aria-label="Comments">{props.margin}</aside></Show>
    </div>
  </section>;
}
