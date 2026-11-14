import { createEffect, createSignal, onCleanup, Show, untrack, type JSX } from "solid-js";
import * as Y from "yjs";
import { Empty, Icons } from "@/components/ui";
import { Input } from "@/components/ui/controls";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, MenuRow, MenuSection } from "@/components/ui/menus";
import { CELLS, LOOK, a1, createSheetModel, key, parseRange, rangeA1, type SheetModel } from "@/sheet-format.js";
import type { SheetAnchor, SheetBox, SheetGrid, SheetGridEvents, SheetHost, SheetMarks, SheetRange, SheetState } from "./host";
import { createLiveSheet } from "./live";
import { readLook } from "./theme";

// Cells written into the run of text a comment quotes: enough to read, few enough to stand over at once.
const QUOTED_CELLS = 200, QUOTED_CHARS = 40;
type Menu = { rows?: SheetRange; cols?: SheetRange };

/** A sheet: the hub's live copy drawn in the grid, a formula bar over it, the comment margin beside it. */
export function SheetEditor(props: { host: SheetHost; id: string; name: string; margin?: JSX.Element; marginEmpty?: boolean; marks?(marks: SheetMarks): void; onState?(state: SheetState): void; onDrawn?(): void }) {
  const live = createLiveSheet(props.host, props.id), cells = live.doc.getMap<string>(CELLS), look = live.doc.getMap<number | string>(LOOK);
  const history = new Y.UndoManager([cells, look]);
  const [model, setModel] = createSignal<SheetModel>(), [grid, setGrid] = createSignal<SheetGrid>(), [failed, setFailed] = createSignal<string>();
  const [at, setAt] = createSignal<SheetRange | null>(null), [changed, setChanged] = createSignal(0), [draft, setDraft] = createSignal<string | null>(null), [address, setAddress] = createSignal<string | null>(null);
  const [menu, setMenu] = createSignal<Menu>({});
  // The grid's element is a signal: the menu trigger that makes it may make it again, and the grid then mounts in the one that stands.
  const [island, setIsland] = createSignal<HTMLDivElement>();
  let root: HTMLElement | undefined, quote: HTMLDivElement | undefined, anchors: SheetAnchor[] = [];
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
  const named = (range: SheetRange) => { const sheet = model()!; return { cells: `${key(sheet.rowAt(range.top)!, sheet.colAt(range.left)!)} ${key(sheet.rowAt(range.bottom)!, sheet.colAt(range.right)!)}`, range: rangeA1(range) }; };
  /** The selection as text standing over its cells, which the comment tool quotes as it quotes a paper's selected text: each cell's value in its own box. */
  const quoted = (): Range | null => {
    const area = at(), sheet = model(), made = grid();
    if (!area || !sheet || !made || !quote || !root) return null;
    const frame = root.getBoundingClientRect(), parts: HTMLElement[] = [];
    for (let row = area.top; row <= area.bottom && parts.length < QUOTED_CELLS; row++) for (let col = area.left; col <= area.right && parts.length < QUOTED_CELLS; col++) {
      const box = made.bounds({ top: row, bottom: row, left: col, right: col });
      if (!box) continue;
      const value = sheet.value(row, col), part = document.createElement("span");
      part.textContent = `${(value === null ? "" : String(value)).slice(0, QUOTED_CHARS)}${col === area.right ? "\n" : "\t"}`;
      Object.assign(part.style, { left: `${box.left - frame.left}px`, top: `${box.top - frame.top}px`, width: `${box.width}px`, height: `${box.height}px` });
      parts.push(part);
    }
    quote.replaceChildren(...parts);
    if (!parts.length) return null;
    const range = document.createRange();
    range.selectNodeContents(quote);
    return range;
  };
  const marks: SheetMarks = {
    subject: () => ({ ...model()?.size() }),
    under: (box: SheetBox) => {
      const made = grid(), first = made?.cellAt(box.left + 1, box.top + 1), last = made?.cellAt(box.left + box.width - 1, box.top + box.height - 1) ?? first;
      return first && last && model() ? named({ top: Math.min(first.row, last.row), bottom: Math.max(first.row, last.row), left: Math.min(first.col, last.col), right: Math.max(first.col, last.col) }) : null;
    },
    selection: quoted,
    anchors: (list) => {
      anchors = list;
      grid()?.highlight(list.filter((anchor) => !anchor.resolved).flatMap((anchor) => { const range = rangeOf(anchor); return range ? [{ range, current: anchor.current }] : []; }));
    },
    place: (name) => { const anchor = anchors.find((one) => one.key === name), range = anchor && rangeOf(anchor); return range ? grid()?.bounds(range) ?? null : null; },
    watch: (listener) => { watchers.add(listener); return () => watchers.delete(listener); },
    reveal: (place) => {
      const sheet = model(), [row, col] = place.split(" ")[0]!.split(":"), top = sheet?.indexOfRow(row ?? "") ?? -1, left = sheet?.indexOfCol(col ?? "") ?? -1;
      if (top >= 0 && left >= 0) grid()?.select({ top, left, bottom: top, right: left }, true);
    },
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
      // The grid has no history of its own: what this page wrote is undone here, never what others wrote.
      if (!(event.ctrlKey || event.metaKey) || !island()?.contains(event.target as Node)) return;
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
    </div>
    <div ref={quote} class="ui-spreadsheet-quote" aria-hidden="true" />
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
