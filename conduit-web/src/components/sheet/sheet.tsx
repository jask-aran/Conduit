import { createEffect, createMemo, createResource, createSignal, onCleanup, Show, untrack, type JSX } from "solid-js";
import * as Y from "yjs";
import { Empty, Icons, Notice } from "@/components/ui";
import { Input } from "@/components/ui/controls";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, MenuRow, MenuSection } from "@/components/ui/menus";
import { CELLS, COL_LIMIT, LOOK, a1, colIndex, key, parseRange, rangeA1, type SheetView } from "@/sheet-format.js";
import { SheetFoot } from "./foot";
import { createSheetTabs } from "./tabs";
import { ASK_KEY, type SheetAnchor, type SheetBox, type SheetGrid, type SheetGridEvents, type SheetHost, type SheetMarks, type SheetPlace, type SheetRange, type SheetState } from "./host";
import { createLiveSheet } from "./live";
import { readLook } from "./theme";
import { createArtWindow } from "@/components/ui/chat-art";
import { createFormulaEditor, FormulaField, FormulaHelp } from "./formula-editor";
import { createSequenceKeys, SequenceHint, SHEET_SEQUENCES, SizePrompt, type SheetSequence, type SizeQuestion } from "./sequences";
import { createSheetSizes, dragRowEdges } from "./sizes";
import { createSheetFormats } from "./formats";
import { createSheetStyles } from "./styles";
import { createSheetTools } from "./tools";
import { FormatMenu } from "./format-menu";

// Cells written into the text a comment quotes, and how much of each: enough to read.
const QUOTED_CELLS = 200, QUOTED_CHARS = 40;
type Menu = { rows?: SheetRange; cols?: SheetRange };

/** A sheet: the hub's live copy drawn in the grid, a formula bar over it, the comment margin beside it. */
/** `onAsk`: the ask key (ASK_KEY) was pressed in the grid. */
export function SheetEditor(props: { host: SheetHost; id: string; name: string; margin?: JSX.Element; marginEmpty?: boolean; marks?(marks: SheetMarks): void; onState?(state: SheetState): void; onDrawn?(): void; onAsk?(): void }) {
  const live = createLiveSheet(props.host, props.id), cells = live.doc.getMap<string>(CELLS), look = live.doc.getMap<number | string>(LOOK);
  const history = new Y.UndoManager([cells, look]);
  const [model, setModel] = createSignal<SheetView>(), [grid, setGrid] = createSignal<SheetGrid>(), [failed, setFailed] = createSignal<string>();
  const [at, setAt] = createSignal<SheetRange | null>(null), [changed, setChanged] = createSignal(0), [address, setAddress] = createSignal<string | null>(null), [scrolled, setScrolled] = createSignal(0);
  const [menu, setMenu] = createSignal<Menu>({});
  const formats = createSheetFormats(look, model, props.host.failed), styles = createSheetStyles(look, model, props.host.failed);
  // The grid's element is a signal: the menu trigger that makes it may make it again, and the grid then mounts in the one that stands.
  const [island, setIsland] = createSignal<HTMLDivElement>();
  let root: HTMLElement | undefined, anchors: SheetAnchor[] = [];
  const tabs = createSheetTabs({ doc: live.doc, host: props.host, id: props.id, name: props.name, grid, at });
  const watchers = new Set<(pressed?: string) => void>(), moved = (pressed?: string) => watchers.forEach((listener) => listener(pressed));
  createEffect(() => props.onState?.(live.state()));
  onCleanup(() => history.destroy());

  const write = (list: readonly { row: number; col: number; input: string }[]) => {
    const sheet = model();
    if (!sheet) return;
    // A cell past the sheet's edge has no row or column of its own yet: the hub makes them as it sets it.
    const past: { row: number; col: number; input: string }[] = [];
    live.doc.transact(() => { for (const { row, col, input } of list) { const rowId = sheet.rowAt(row), colId = sheet.colAt(col); if (!rowId || !colId) { if (input) past.push({ row, col, input }); continue; } if (input) cells.set(key(rowId, colId), input); else cells.delete(key(rowId, colId)); } });
    for (const { row, col, input } of past) void tabs.cells({ op: "set", at: a1(row, col), value: input }).catch((error: Error) => props.host.failed(error.message));
  };
  const hub = (op: Parameters<SheetHost["cells"]>[0]) => void tabs.cells(op).catch((error: Error) => props.host.failed(error.message));
  const editor = createFormulaEditor({
    grid, input: (row, col) => model()?.input(row, col) ?? "", functions: tabs.functions,
    write: (row, col, input) => write([{ row, col, input }]),
    selected: () => { changed(); const area = at(); return area && { row: area.top, col: area.left }; }, error: (row, col) => model()?.error(row, col) ?? null,
  });
  // The cells its import froze, by tab name then position (a row's index times COL_LIMIT, plus its column's): marked while they hold what the import left.
  const [report] = createResource(() => props.host.frozen?.() ?? null);
  const frozen = createMemo(() => {
    const name = tabs.tabs().find((tab) => tab.id === tabs.shown())?.name, listed = name ? report()?.[name] : undefined, out = new Map<number, { formula: string; why: string }>();
    for (const [address, cell] of Object.entries(listed ?? {})) { const range = parseRange(address); if (range) out.set(range.top * COL_LIMIT + range.left, cell); }
    return out;
  });
  const frozenAt = (row: number, col: number) => frozen().size ? frozen().get(row * COL_LIMIT + col) : undefined;
  const frozenHere = () => { changed(); const area = at(), cell = area && frozenAt(area.top, area.left); return cell && !model()?.input(area!.top, area!.left).startsWith("=") ? cell : undefined; };
  createEffect(() => { if (frozen().size) grid()?.update(null); });
  const sizes = createSheetSizes(look, model, styles.lines), [question, setQuestion] = createSignal<SizeQuestion | null>(null);
  const sequences = createSequenceKeys((sequence) => "tool" in sequence ? tools.find((one) => one.name === sequence.tool)?.run() : sequence.run({ selection: at, sizes, look: () => readLook(root!), ask: setQuestion }),
    (name) => tools.find((one) => one.name === name)?.label ?? name);
  // One edge dragged sizes every whole row or column selected with it, as a spreadsheet does.
  const span = (kind: "rows" | "cols", one: number) => {
    const area = at(), size = model()?.size(), [from, to] = !area ? [one, one] : kind === "cols" ? [area.left, area.right] : [area.top, area.bottom];
    const whole = area && size && (kind === "cols" ? area.top === 0 && area.bottom >= size.rows - 1 : area.left === 0 && area.right >= size.cols - 1) && one >= from && one <= to && to > from;
    return whole ? Array.from({ length: to - from + 1 }, (_, n) => from + n) : [one];
  };
  const events: SheetGridEvents = {
    selected: setAt,
    write,
    fill: (range, values) => hub({ op: "fill", range: rangeA1(range), values }),
    resized: (col, width) => sizes.setWidths(span("cols", col), width),
    menu: setMenu,
    moved: () => { setScrolled((n) => n + 1); moved(); },
    drawn: () => props.onDrawn?.(),
    pressed: (row, col) => { const hit = anchors.find((anchor) => { const range = rangeOf(anchor); return range && row >= range.top && row <= range.bottom && col >= range.left && col <= range.right; }); if (hit) moved(hit.key); },
    key: (event, row, col) => {
      if (event.key === " " && event.ctrlKey !== event.shiftKey && !event.altKey && !event.metaKey) { event.preventDefault(); grid()?.whole(event.ctrlKey ? "cols" : "rows"); return true; }
      // AltGr is Ctrl and Alt together: what it types is typed.
      if ((event.ctrlKey || event.metaKey) && !(event.ctrlKey && event.altKey)) return false;
      if (event.key === "Enter" || event.key === "F2") { event.preventDefault(); editor.begin({ row, col }, "edit", "cell"); return true; }
      // Not held back: the editor has focus before the browser types the key, so it lands there, and every key after it.
      if (event.key.length !== 1 && event.key !== "Process") return false;
      editor.begin({ row, col }, "enter", "cell");
      return true;
    },
    activated: (row, col) => editor.begin({ row, col }, "edit", "cell"),
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
      made = mountGrid(into, { model: sheet, events, look: readLook(root!), columns: {
        width: sizes.width,
        type: (col) => { const type = look.get(`type:${sheet.colAt(col)}`); return typeof type === "string" ? type : undefined; }, heights: sizes.heights, draw: formats.draw, style: styles.at, frozen: (row, col) => Boolean(frozenAt(row, col)),
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
  const art = createArtWindow(true);
  // The app's tokens change with the Interface size and the theme, each set on the root element.
  const relook = new MutationObserver(() => { const made = grid(); if (made && root) made.theme(readLook(root)); });
  relook.observe(document.documentElement, { attributes: true });
  onCleanup(() => relook.disconnect());

  const input = () => { changed(); const area = at(), sheet = model(); return area && sheet ? sheet.input(area.top, area.left) : ""; };
  // The references of the formula being edited, outlined on the grid in their inks.
  createEffect(() => grid()?.references(editor.references()));
  // The cell editor stands over its cell, and may grow over the neighbours to its right as far as the grid's edge.
  let body: HTMLDivElement | undefined, formula: HTMLDivElement | undefined;
  // Key sequences and row edges are the grid's while it has the keyboard and the pointer (sequences.tsx, sizes.ts).
  createEffect(() => {
    const into = island();
    if (!into) return;
    const offKeys = sequences.attach(into), offEdges = dragRowEdges(into, grid, (row, height) => sizes.setHeights(span("rows", row), height));
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
    if (range) { grid()?.select(range, true); if (cols || rows) grid()?.whole(cols ? "cols" : "rows"); }
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
  const tools = createSheetTools({ at, styles, formats, offered: props.host.tools, done: () => grid()?.focus(),
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
    tools: () => tools,
    anchors: (list) => {
      anchors = list;
      tabs.follow(list);
      grid()?.highlight(list.filter((anchor) => !anchor.resolved).flatMap((anchor) => { const range = rangeOf(anchor); return range ? [{ range, current: anchor.current }] : []; }));
    },
    where: (name) => { const anchor = anchors.find((one) => one.key === name), range = anchor && rangeOf(anchor); return range ? grid()?.bounds(range) ?? null : null; },
    watch: (listener) => { watchers.add(listener); return () => watchers.delete(listener); },
    reveal: (address) => { const range = parseRange(tabs.reveal(address)); if (range) grid()?.select(range, true); },
    focus: () => grid()?.focus(),
    history: { undo: () => Boolean(history.undo()), redo: () => Boolean(history.redo()), canUndo: () => history.canUndo(), canRedo: () => history.canRedo() },
  };
  // Highlights are drawn by the grid: told again once it is made.
  createEffect(() => { if (grid()) marks.anchors(anchors); });
  props.marks?.(marks);

  const rows = () => menu().rows, cols = () => menu().cols;
  // The menu's own doings, over what it was opened on: a sequence's (sizes), and the cells' cut, copy, paste and clearing.
  const picked = (): SheetRange | null => { const r = rows(), c = cols(); return r && c ? { top: r.top, bottom: r.bottom, left: c.left, right: c.right } : null; };
  const sized = (keys: string, selection: SheetRange) => SHEET_SEQUENCES.find((sequence): sequence is Extract<SheetSequence, { run: unknown }> => sequence.keys === keys && "run" in sequence)?.run({ selection: () => selection, sizes, look: () => readLook(root!), ask: setQuestion });
  const within = (range: SheetRange) => Array.from({ length: range.bottom - range.top + 1 }, (_, r) => Array.from({ length: range.right - range.left + 1 }, (_, c) => ({ row: range.top + r, col: range.left + c })));
  const copy = (range: SheetRange) => navigator.clipboard.writeText(within(range).map((row) => row.map(({ row: r, col }) => String(model()?.value(r, col) ?? "")).join("\t")).join("\n")).catch((error: Error) => props.host.failed(error.message));
  const clear = (range: SheetRange) => write(within(range).flat().map((cell) => ({ ...cell, input: "" })));
  const paste = (range: SheetRange) => void navigator.clipboard.readText().then((text) => write(text.replace(/\r?\n$/, "").split(/\r?\n/).flatMap((line, r) => line.split("\t").map((input, c) => ({ row: range.top + r, col: range.left + c, input })))), (error: Error) => props.host.failed(error.message));
  // A header's menu is its whole columns, a row number's its whole rows (formats.ts clips both to the tab).
  const formatted = () => { const { rows, cols } = menu(), most = Number.MAX_SAFE_INTEGER; return rows || cols ? { top: rows?.top ?? 0, bottom: rows?.bottom ?? most, left: cols?.left ?? 0, right: cols?.right ?? most } : null; };
  const count = (from: number, to: number) => to - from + 1;
  return <section ref={(element) => { root = element; art(element); }} class="ui-spreadsheet" aria-label={props.name} data-margin={props.marginEmpty ? "none" : "beside"}
    onKeyDown={(event) => {
      if (!(event.ctrlKey || event.metaKey) || !island()?.contains(event.target as Node)) return;
      if (tabs.key(event) || formats.key(event, at()) || styles.key(event, at())) return;
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
      {/* The formula bar edits the selected cell: focused, it opens the cell to edit as F2 does. */}
      <div ref={formula} class="ui-input ui-spreadsheet-formula" onFocusIn={() => { const area = at(); if (area && !editor.editing()) editor.begin({ row: area.top, col: area.left }, "edit", "bar"); }}>
        <FormulaField editor={editor} place="bar" label="Formula" class="ui-formula-text" idle={input} disabled={!at()} />
      </div>
      <Show when={frozenHere()}>{(cell) => <Notice kind="tool" title={`${cell().formula}: ${cell().why}`}>Frozen on import: ={cell().formula.replace(/^=/, "")}</Notice>}</Show>
    </div>
    <div ref={body} class="ui-spreadsheet-body">
      <Show when={!failed()} fallback={<Empty role="alert">The sheet could not be drawn: {failed()}</Empty>}>
        <ContextMenu placement="bottom-start">
          <ContextMenuTrigger as="div" ref={setIsland} class="ui-spreadsheet-grid" />
          <ContextMenuContent>
            <Show when={picked()}>{(range) => <MenuSection>
              <MenuRow icon={<Icons.Cut />} keys={["Ctrl", "X"]} onSelect={() => void copy(range()).then(() => clear(range()))}>Cut</MenuRow>
              <MenuRow icon={<Icons.Copy />} keys={["Ctrl", "C"]} onSelect={() => void copy(range())}>Copy</MenuRow>
              <MenuRow icon={<Icons.Paste />} keys={["Ctrl", "V"]} onSelect={() => paste(range())}>Paste</MenuRow>
              <MenuRow icon={<Icons.Delete />} keys={["Delete"]} onSelect={() => clear(range())}>Clear contents</MenuRow>
              <Show when={props.onAsk}><MenuRow icon={<Icons.Chat />} onSelect={() => { grid()?.select(range(), false); props.onAsk?.(); }}>Comment</MenuRow></Show>
            </MenuSection>}</Show>
            <Show when={rows()}>{(range) => <MenuSection>
              <MenuRow icon={<Icons.Add />} onSelect={() => structure("insert-rows", range().top, count(range().top, range().bottom))}>Insert {count(range().top, range().bottom) > 1 ? `${count(range().top, range().bottom)} rows` : "row"} above</MenuRow>
              <MenuRow icon={<Icons.Add />} onSelect={() => structure("insert-rows", range().bottom + 1, count(range().top, range().bottom))}>Insert {count(range().top, range().bottom) > 1 ? `${count(range().top, range().bottom)} rows` : "row"} below</MenuRow>
              <MenuRow destructive icon={<Icons.Delete />} onSelect={() => structure("delete-rows", range().top, count(range().top, range().bottom))}>Delete {count(range().top, range().bottom) > 1 ? `rows ${range().top + 1}–${range().bottom + 1}` : `row ${range().top + 1}`}</MenuRow>
              <MenuRow icon={<Icons.Resize />} keys={["Alt", "H", "O", "H"]} onSelect={() => sized("HOH", range())}>Row height…</MenuRow>
              <MenuRow icon={<Icons.Resize />} keys={["Alt", "H", "O", "A"]} onSelect={() => sized("HOA", range())}>Fit row height</MenuRow>
            </MenuSection>}</Show>
            <Show when={cols()}>{(range) => <MenuSection>
              <MenuRow icon={<Icons.Add />} onSelect={() => structure("insert-cols", range().left, count(range().left, range().right))}>Insert {count(range().left, range().right) > 1 ? `${count(range().left, range().right)} columns` : "column"} left</MenuRow>
              <MenuRow icon={<Icons.Add />} onSelect={() => structure("insert-cols", range().right + 1, count(range().left, range().right))}>Insert {count(range().left, range().right) > 1 ? `${count(range().left, range().right)} columns` : "column"} right</MenuRow>
              <MenuRow destructive icon={<Icons.Delete />} onSelect={() => structure("delete-cols", range().left, count(range().left, range().right))}>Delete {count(range().left, range().right) > 1 ? "columns" : "column"} {rangeA1({ ...range(), top: 0, bottom: 0 }).replace(/1/g, "")}</MenuRow>
              <MenuRow icon={<Icons.Resize />} keys={["Alt", "H", "O", "W"]} onSelect={() => sized("HOW", range())}>Column width…</MenuRow>
              <MenuRow icon={<Icons.Resize />} keys={["Alt", "H", "O", "I"]} onSelect={() => sized("HOI", range())}>Fit column width</MenuRow>
              <MenuRow icon={<Icons.Resize />} keys={["Alt", "H", "O", "D"]} onSelect={() => sized("HOD", range())}>Default width…</MenuRow>
            </MenuSection>}</Show>
            <Show when={formatted()}>{(range) => <FormatMenu formats={formats} range={range()} />}</Show>
          </ContextMenuContent>
        </ContextMenu>
        <div class="ui-spreadsheet-editor" data-open={editor.editing() ? "" : undefined} style={cellBox()}><FormulaField editor={editor} place="cell" label="Cell" class="ui-formula-text" /></div>
        <FormulaHelp editor={editor} frame={() => body} />
        <SequenceHint typed={sequences.typed} next={sequences.next} anchor={() => formula} />
        <SizePrompt question={question()} onClose={() => { setQuestion(null); grid()?.focus(); }} />
        <Show when={!model()}><Empty role="status" class="ui-spreadsheet-waiting">Opening the sheet…</Empty></Show>
      </Show>
      <Show when={props.margin}><aside class="ui-spreadsheet-margin" aria-label="Comments">{props.margin}</aside></Show>
    </div>
    <SheetFoot tabs={tabs} id={props.id} format={() => formats.figure(at())} />
  </section>;
}
