import { findParentNode, posToDOMRect, type ChainedCommands, type Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { addColumn, addRow, TableMap } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";
import { createEffect, createMemo, createSignal, For, on, Show, type Accessor } from "solid-js";
import { isOn, markAttrs, sameJson, track } from "./read";
import { IconButton, Input, Segmented, Swatch } from "@/components/ui";
import { DocumentAddress, DocumentTableEdges, DocumentTools, documentToolIcons as Icons } from "@/components/ui/document";
import { MARKUP_INKS } from "@/components/ui/markup";
import { Popover, PopoverContent } from "@/components/ui/menus";
import { PAPER_INKS } from "@/document-format.js";
import { PAPER_MARK_KEYS } from "./shortcuts";

/** The text selected, as it is drawn. */
export const selectedRange = (view: EditorView) => {
  const { from, to } = view.state.selection, range = document.createRange(), start = view.domAtPos(from), end = view.domAtPos(to);
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
};

export const MARKS = [["bold", "Bold"], ["italic", "Italic"], ["strike", "Strikethrough"], ["code", "Code"]] as const;
/** The marks that take an ink, each chosen from a row of the inks and None: its name, its label, None's, and what an ink of it is called ("Red text"). */
export const INKED = [["color", "Text colour", "No colour", "text"], ["highlight", "Highlight", "No highlight", "highlight"]] as const;
export type InkedMark = typeof INKED[number][0];
export type PaperInk = Exclude<keyof typeof MARKUP_INKS, "plain">;
export const INKS = PAPER_INKS as PaperInk[];
export const inkSwatch = (ink?: PaperInk) => ink ? <Swatch colour={MARKUP_INKS[ink].colour} /> : <Swatch hollow />;
/** The ink put on the text selected, or the mark taken off it (none). */
export const putInk = (chain: ChainedCommands, mark: InkedMark, ink?: PaperInk) => (ink ? chain.setMark(mark, { ink }) : chain.unsetMark(mark)).run();
const TABLE = [["delete-row", "Delete the row", "deleteRow"], ["delete-column", "Delete the column", "deleteColumn"], ["delete-table", "Delete the table", "deleteTable"]] as const;
// The app's own writing of a chord is passed in (`chord`); without it, the ribbon's.
const ribbonChord = (keys: string) => keys.split("-").map((key) => key === "Mod" ? "Ctrl" : key.length === 1 ? key.toUpperCase() : key).join(" ");
// A press on a tool keeps the editor's focus, and with it the selection the tool acts on.
const keep = (event: MouseEvent) => event.preventDefault();

/** The lines from `from` to `to` as they stand, each line's whole height and not only its letters', so what floats over them clears the line. */
const linesOf = (view: EditorView, from: number, to: number) => {
  const box = posToDOMRect(view, from, to), glyph = view.coordsAtPos(from), at = view.domAtPos(from).node;
  const block = (at.nodeType === Node.ELEMENT_NODE ? at : at.parentElement) as HTMLElement | null, line = block ? parseFloat(getComputedStyle(block).lineHeight) : NaN;
  const lead = Number.isFinite(line) ? Math.max(0, (line - (glyph.bottom - glyph.top)) / 2) : 0;
  return new DOMRect(box.left, box.top - lead, box.width, box.height + 2 * lead);
};

/**
 * What can be done to the text selected, over it while the editor has focus: the marks (pressed where the selection wears them; a text colour and a
 * highlight each picked from a row of the inks in place of the buttons), a link (its address asked for in place), a comment (`onComment`); and with
 * the caret in a link, its address, Open, Edit and Remove. `chord` writes a chord in the editor's notation (`Mod-b`) as the app writes keys. It stands clear above the lines it is about, or under them where `bounds` (the view the
 * text scrolls in) has no room above. Escape or a press away shuts it until the selection changes.
 */
export function SelectionTools(props: { editor: Accessor<Editor | undefined>; bounds: Accessor<HTMLElement | undefined>; /** The marks offered (every one, unsaid). */ marks?: readonly string[]; onComment?: (about: Range) => void; chord?: (keys: string) => string }) {
  const [linking, setLinking] = createSignal(false), [inking, setInking] = createSignal<typeof INKED[number]>(), [shut, setShut] = createSignal<string>();
  let tools: HTMLElement | undefined;
  // Where the selection is matters only while there is something to stand over: a caret in plain text has nothing, and typing there reads none of this.
  const state = createMemo(() => {
    const made = props.editor();
    track(made, "caret");
    if (!made?.isEditable) return null;
    const { selection } = made.state, text = selection instanceof TextSelection && !selection.empty, link = markAttrs(made, "link").href as string | undefined;
    if (!text && !(selection.empty && link)) return null;
    const { from, to } = text ? selection : { from: selection.from, to: selection.from };
    track(made, "selection");
    return { text, focused: made.isFocused, key: `${from} ${to}`, link, marks: Object.fromEntries([...MARKS, ...INKED].map(([name]) => [name, isOn(made, name)])) as Record<string, boolean>,
      inks: { color: markAttrs(made, "color").ink, highlight: markAttrs(made, "highlight").ink } as Record<InkedMark, PaperInk | undefined>, lines: () => linesOf(made.view, from, to) };
  }, undefined, { equals: sameJson });
  // Placed again only when what it is over changes.
  const lines = createMemo(on(() => state()?.key, () => state()?.lines));
  const placement = createMemo(on(() => state()?.key, () => {
    const now = state()?.lines(), top = props.bounds()?.getBoundingClientRect().top;
    return now && top !== undefined && now.y - top < (tools?.offsetHeight ?? 0) * 1.5 ? "bottom-start" as const : "top-start" as const;
  }));
  createEffect(on(() => state()?.key, () => { setLinking(false); setInking(undefined); setShut(undefined); }, { defer: true }));
  const open = () => { const now = state(); return Boolean(now && (now.focused || linking() || inking()) && shut() !== now.key); };
  const chain = () => props.editor()!.chain().focus();
  const link = (href: string) => { const made = chain().extendMarkRange("link"); (href.trim() ? made.setLink({ href: href.trim() }) : made.unsetLink()).run(); setLinking(false); };
  const ink = (mark: InkedMark, to: PaperInk | "none") => { putInk(chain(), mark, to === "none" ? undefined : to); setInking(undefined); };
  const comment = () => { const view = props.editor()?.view; if (!view) return; setShut(state()?.key); props.onComment?.(selectedRange(view)); };
  return <Popover open={open()} onOpenChange={(now) => { if (now) return; setShut(state()?.key); if (linking() || inking()) { setLinking(false); setInking(undefined); props.editor()?.commands.focus(); } }} anchorRef={() => props.editor()?.view.dom as HTMLElement | undefined} anchorRect={lines()} placement={placement()}>
    <PopoverContent snug aria-label="Text tools" onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}>
      <Show when={state()}>{(now) => <DocumentTools ref={(element) => { tools = element; }} label={inking()?.[1] ?? (now().text ? "Format" : "Link")}>
        <Show when={inking()} fallback={<Show when={linking()} fallback={<Show when={now().text} fallback={<>
          <DocumentAddress href={now().link!} />
          <IconButton label="Open the link" onMouseDown={keep} onClick={() => window.open(now().link, "_blank", "noopener")}><Icons.open /></IconButton>
          <IconButton label="Edit the link" onMouseDown={keep} onClick={() => setLinking(true)}><Icons.edit /></IconButton>
          <IconButton label="Remove the link" onMouseDown={keep} onClick={() => link("")}><Icons.unlink /></IconButton>
        </>}>
          <For each={MARKS.filter(([name]) => !props.marks || props.marks.includes(name))}>{([name, label]) => { const Icon = Icons[name]; return <IconButton label={`${label} (${(props.chord ?? ribbonChord)(PAPER_MARK_KEYS[name])})`} aria-pressed={now().marks[name]} onMouseDown={keep} onClick={() => chain().toggleMark(name).run()}><Icon /></IconButton>; }}</For>
          <For each={INKED.filter(([name]) => !props.marks || props.marks.includes(name))}>{(inked) => { const Icon = Icons[inked[0]]; return <IconButton label={inked[1]} aria-pressed={now().marks[inked[0]]} onMouseDown={keep} onClick={() => setInking(inked)}><Icon /></IconButton>; }}</For>
          <IconButton label={now().link ? "Change the link" : "Link"} aria-pressed={Boolean(now().link)} onMouseDown={keep} onClick={() => setLinking(true)}><Icons.link /></IconButton>
          <Show when={props.onComment}><IconButton label="Comment" onMouseDown={keep} onClick={comment}><Icons.comment /></IconButton></Show>
        </Show>}>
          <Input ref={(field) => queueMicrotask(() => field.focus())} aria-label="Link address" placeholder="Link address" value={now().link ?? ""}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); link(event.currentTarget.value); } }} />
          <Show when={now().link}><IconButton label="Remove the link" onClick={() => link("")}><Icons.unlink /></IconButton></Show>
        </Show>}>{(asked) => { const [mark, label, none] = asked();
          return <Segmented label={label} icons size="sm" value={now().inks[mark] ?? "none"} onChange={(to) => ink(mark, to)}
            options={[{ value: "none" as const, label: none, icon: inkSwatch() }, ...INKS.map((value) => ({ value, label: MARKUP_INKS[value].label, icon: inkSwatch(value) }))]} />; }}
        </Show>
      </DocumentTools>}</Show>
    </PopoverContent>
  </Popover>;
}

/**
 * The table the caret is in, its controls on its own edges (DocumentTableEdges) while the editor has focus: a row added at its foot, a column at its
 * right, and deleting a row, a column or the table on its top edge. `body` is what the controls are placed in; `moved` changes when the text may have
 * reflowed with no change to the document.
 */
export function TableTools(props: { editor: Accessor<Editor | undefined>; body: Accessor<HTMLElement | undefined>; moved: Accessor<unknown> }) {
  // With the document while the caret is in a table, so a row or column added places it again.
  const table = createMemo(() => {
    const made = props.editor();
    track(made, "caret");
    const pos = made?.isEditable && made.isFocused ? findParentNode((node) => node.type.name === "table")(made.state.selection)?.pos : undefined;
    if (pos === undefined) return null;
    track(made, "doc");
    return { pos, doc: made!.state.doc };
  }, null, { equals: (a, b) => a?.pos === b?.pos && a?.doc === b?.doc });
  const box = createMemo(() => {
    props.moved();
    const pos = table()?.pos ?? null, view = props.editor()?.view, body = props.body()?.getBoundingClientRect(), wrapper = pos === null ? null : view?.nodeDOM(pos) as HTMLElement | null;
    const drawn = wrapper?.querySelector?.("table")?.getBoundingClientRect(), room = wrapper?.getBoundingClientRect();
    if (!drawn || !room || !body) return undefined;
    // A table wider than its column scrolls in its wrapper: its edges are the wrapper's where it runs past them.
    const left = Math.max(drawn.left, room.left), right = Math.min(drawn.right, room.right);
    return { top: drawn.top - body.top, left: left - body.left, width: right - left, height: drawn.height };
  });
  const chain = () => props.editor()!.chain().focus();
  const grow = (at: "row" | "column") => {
    const view = props.editor()?.view, pos = table()?.pos, node = pos === undefined ? null : view?.state.doc.nodeAt(pos);
    if (!view || !node) return;
    const map = TableMap.get(node), whole = { map, table: node, tableStart: pos! + 1, left: 0, top: 0, right: map.width, bottom: map.height };
    view.dispatch(at === "row" ? addRow(view.state.tr, whole, map.height) : addColumn(view.state.tr, whole, map.width));
  };
  return <DocumentTableEdges box={box()} onAddRow={() => grow("row")} onAddColumn={() => grow("column")}
    tools={<DocumentTools label="Table"><For each={TABLE}>{([name, label, command]) => { const Icon = Icons[name]; return <IconButton label={label} onMouseDown={keep} onClick={() => chain()[command]().run()}><Icon /></IconButton>; }}</For></DocumentTools>} />;
}
