import { findParentNode, posToDOMRect, type Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { createEffect, createMemo, createSignal, For, on, Show, type Accessor } from "solid-js";
import { createEditorTransaction } from "solid-tiptap";
import { IconButton, Input } from "@/components/ui";
import { DocumentTools, documentToolIcons as Icons } from "@/components/ui/document";
import { Popover, PopoverContent } from "@/components/ui/menus";

/** The text selected, as it is drawn. */
export const selectedRange = (view: EditorView) => {
  const { from, to } = view.state.selection, range = document.createRange(), start = view.domAtPos(from), end = view.domAtPos(to);
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
};

export const MARKS = [["bold", "Bold"], ["italic", "Italic"], ["strike", "Strikethrough"], ["code", "Code"]] as const;
const TABLE = [["row-below", "Add a row below", "addRowAfter"], ["column-right", "Add a column to the right", "addColumnAfter"], ["delete-row", "Delete the row", "deleteRow"], ["delete-column", "Delete the column", "deleteColumn"], ["delete-table", "Delete the table", "deleteTable"]] as const;
// A press on a tool keeps the editor's focus, and with it the selection the tool acts on.
const keep = (event: MouseEvent) => event.preventDefault();

/**
 * What can be done to the text selected, and to the table the caret is in, over it while the editor has focus: the marks (pressed where the selection
 * wears them), a link (its address asked for in place), a comment (`onComment`), and a table's rows and columns. Escape or a press away shuts it
 * until the selection changes.
 */
export function SelectionTools(props: { editor: Accessor<Editor | undefined>; onComment?: (about: Range) => void }) {
  const [linking, setLinking] = createSignal(false), [shut, setShut] = createSignal<string>();
  const state = createEditorTransaction(props.editor, (made) => {
    if (!made?.isEditable) return null;
    const { selection } = made.state, text = selection instanceof TextSelection && !selection.empty, table = findParentNode((node) => node.type.name === "table")(selection);
    if (!text && !table) return null;
    return { text, table: Boolean(table), focused: made.isFocused, key: text ? `${selection.from} ${selection.to}` : `table ${table!.pos}`, link: made.getAttributes("link").href as string | undefined,
      marks: Object.fromEntries(MARKS.map(([name]) => [name, made.isActive(name)])) as Record<string, boolean>,
      rect: () => text ? posToDOMRect(made.view, selection.from, selection.to) : (made.view.nodeDOM(table!.pos) as HTMLElement | null)?.getBoundingClientRect() };
  });
  // Placed again only when what it is over changes, not at every keystroke in a table.
  const rect = createMemo(on(() => state()?.key, () => state()?.rect));
  createEffect(on(() => state()?.key, () => { setLinking(false); setShut(undefined); }, { defer: true }));
  const open = () => { const now = state(); return Boolean(now && (now.focused || linking()) && shut() !== now.key); };
  const chain = () => props.editor()!.chain().focus();
  const link = (href: string) => { const made = chain().extendMarkRange("link"); (href.trim() ? made.setLink({ href: href.trim() }) : made.unsetLink()).run(); setLinking(false); };
  const comment = () => { const view = props.editor()?.view; if (!view) return; setShut(state()?.key); props.onComment?.(selectedRange(view)); };
  return <Popover open={open()} onOpenChange={(now) => { if (now) return; setShut(state()?.key); if (linking()) { setLinking(false); props.editor()?.commands.focus(); } }} anchorRef={() => props.editor()?.view.dom as HTMLElement | undefined} anchorRect={rect()} placement="top-start">
    <PopoverContent aria-label="Text tools" onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}>
      <Show when={state()}>{(now) => <DocumentTools label={now().text ? "Format" : "Table"}>
        <Show when={linking()} fallback={<>
          <Show when={now().text}>
            <For each={MARKS}>{([name, label]) => { const Icon = Icons[name]; return <IconButton label={label} aria-pressed={now().marks[name]} onMouseDown={keep} onClick={() => chain().toggleMark(name).run()}><Icon /></IconButton>; }}</For>
            <IconButton label={now().link ? "Change the link" : "Link"} aria-pressed={Boolean(now().link)} onMouseDown={keep} onClick={() => setLinking(true)}><Icons.link /></IconButton>
            <Show when={props.onComment}><IconButton label="Comment" onMouseDown={keep} onClick={comment}><Icons.comment /></IconButton></Show>
          </Show>
          <Show when={now().table}>
            <For each={TABLE}>{([name, label, command]) => { const Icon = Icons[name]; return <IconButton label={label} onMouseDown={keep} onClick={() => chain()[command]().run()}><Icon /></IconButton>; }}</For>
          </Show>
        </>}>
          <Input ref={(field) => queueMicrotask(() => field.focus())} aria-label="Link address" placeholder="Link address" value={now().link ?? ""}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); link(event.currentTarget.value); } }} />
          <Show when={now().link}><IconButton label="Remove the link" onClick={() => link("")}><Icons.unlink /></IconButton></Show>
        </Show>
      </DocumentTools>}</Show>
    </PopoverContent>
  </Popover>;
}
