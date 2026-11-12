import { Extension, type ChainedCommands, type Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js";
import { createEditorTransaction, createTiptapEditor } from "solid-tiptap";
import { redo, undo, ySyncPlugin, yUndoPlugin } from "y-prosemirror";
import type { Map as YMap, XmlFragment } from "yjs";
import { DocumentSheet, documentBlockIcons, documentMarkClass, documentTextClass } from "@/components/ui/document";
import { CHANGES, FRAGMENT, documentExtensions } from "@/document-format.js";
import { DOCUMENT_BLOCKS, type DocumentAnchor, type DocumentBlockKind, type DocumentHost, type DocumentMarks } from "./host";
import { createLiveDocument } from "./live";

/** What the caret's block is, read in this order (a list inside a quote is a list), and how a block is made that kind. */
const KINDS: Record<DocumentBlockKind, { label: string; is?: [string, Record<string, unknown>?]; make: (chain: ChainedCommands) => ChainedCommands }> = {
  "heading-1": { label: "Heading 1", is: ["heading", { level: 1 }], make: (chain) => chain.setHeading({ level: 1 }) },
  "heading-2": { label: "Heading 2", is: ["heading", { level: 2 }], make: (chain) => chain.setHeading({ level: 2 }) },
  "heading-3": { label: "Heading 3", is: ["heading", { level: 3 }], make: (chain) => chain.setHeading({ level: 3 }) },
  code: { label: "Code", is: ["codeBlock"], make: (chain) => chain.setCodeBlock() },
  table: { label: "Table", is: ["table"], make: (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
  checklist: { label: "Checklist", is: ["taskList"], make: (chain) => chain.toggleTaskList() },
  bullets: { label: "Bullet list", is: ["bulletList"], make: (chain) => chain.toggleBulletList() },
  numbers: { label: "Numbered list", is: ["orderedList"], make: (chain) => chain.toggleOrderedList() },
  quote: { label: "Quote", is: ["blockquote"], make: (chain) => chain.toggleBlockquote() },
  divider: { label: "Divider", make: (chain) => chain.setHorizontalRule() },
  text: { label: "Text", make: (chain) => chain.clearNodes() },
};
const kindAt = (editor: Editor | undefined) => (Object.keys(KINDS) as DocumentBlockKind[]).find((kind) => { const is = KINDS[kind].is; return is && editor?.isActive(...is); }) ?? "text";

/** The editor's text is the Yjs document's blocks, each change merged as it is made; undo takes back only what was written here. */
const merged = (blocks: XmlFragment) => Extension.create({
  name: "liveDocument",
  addProseMirrorPlugins: () => [ySyncPlugin(blocks), yUndoPlugin()],
  addKeyboardShortcuts() { return { "Mod-z": () => undo(this.editor.state), "Mod-y": () => redo(this.editor.state), "Shift-Mod-z": () => redo(this.editor.state) }; },
});

type Change = { for: string; before: { type: string; text?: string; content?: unknown[] } | null; after?: string | null };
const textOf = (node: { text?: string; content?: unknown[] }): string => node.text ?? (node.content ?? []).map((child) => textOf(child as { text?: string })).join(" ");
/** Where a run of text is in a block (which starts at `from`), as positions in the document; null when the block no longer says it. */
const within = (block: Node, from: number, quote: string) => {
  const runs: { at: number; pos: number }[] = [];
  let text = "";
  block.descendants((node, pos) => { if (node.isText) { runs.push({ at: text.length, pos: from + 1 + pos }); text += node.text; } });
  const start = text.indexOf(quote), spot = (offset: number) => { const run = runs.findLast((candidate) => candidate.at <= offset)!; return run.pos + offset - run.at; };
  return start < 0 ? null : [spot(start), spot(start + quote.length - 1) + 1] as const;
};
const shown = new PluginKey<DecorationSet>("documentMarks");
/**
 * What is marked in the text, drawn as decorations so none of it is the document's: each comment `told.anchors` names (the quoted text where its
 * block still says it, else its blocks), each block in the document's changes, and a line where a changed block was deleted. `told.moved` hears
 * when any of it may have moved, and of a press on a comment's mark.
 */
const marked = (changes: YMap<Change>, told: { anchors: DocumentAnchor[]; moved: (pressed?: string) => void }) => {
  const build = (doc: Node) => {
    const found: Decoration[] = [], on = new Map<string, { keys: string[]; current: boolean; open: boolean }>(), at = new Map<string, { from: number; to: number; block: Node }>();
    doc.forEach((block, from) => { if (block.attrs.id) at.set(block.attrs.id, { from, to: from + block.nodeSize, block }); });
    for (const anchor of told.anchors) {
      const blocks = String(anchor.under?.blocks ?? "").split(" ").filter((id) => at.has(id)), first = at.get(blocks[0] ?? "");
      const run = first && anchor.quote && !anchor.resolved ? within(first.block, first.from, anchor.quote) : null;
      if (run) found.push(Decoration.inline(run[0], run[1], { class: documentMarkClass.comment, "data-comment": anchor.key, ...(anchor.current ? { "data-current": "" } : {}) }));
      // A comment about several blocks is found by its first; the rest are only marked.
      else blocks.forEach((id, nth) => { const had = on.get(id) ?? on.set(id, { keys: [], current: false, open: false }).get(id)!; if (!nth) had.keys.push(anchor.key); had.current ||= anchor.current; had.open ||= !anchor.resolved; });
    }
    for (const [id, block] of at) {
      const had = on.get(id), changed = changes.has(id);
      if (had || changed) found.push(Decoration.node(block.from, block.to, { class: [had?.open && documentMarkClass.commented, changed && documentMarkClass.changed].filter(Boolean).join(" "), ...(had?.keys.length ? { "data-comment": had.keys.join(" ") } : {}), ...(had?.current ? { "data-current": "" } : {}) }));
    }
    changes.forEach((change, id) => {
      if (at.has(id) || !change.before) return;
      const line = () => Object.assign(document.createElement("div"), { className: documentMarkClass.removed, contentEditable: "false", textContent: textOf(change.before!) || "A block was removed" });
      found.push(Decoration.widget(change.after === null ? 0 : at.get(change.after ?? "")?.to ?? doc.content.size, line, { key: id, side: -1 }));
    });
    return DecorationSet.create(doc, found);
  };
  return Extension.create({
    name: "documentMarks",
    addProseMirrorPlugins: () => [new Plugin({
      key: shown,
      state: { init: (_, state) => build(state.doc), apply: (change, old) => change.docChanged || change.getMeta(shown) ? build(change.doc) : old },
      props: {
        decorations: (state) => shown.getState(state),
        handleClick: (_view, _pos, event) => { const key = (event.target as Element).closest?.("[data-comment]")?.getAttribute("data-comment")?.split(" ")[0]; if (key) told.moved(key); return false; },
      },
      view: () => ({ update: (view, before) => { if (!before.doc.eq(view.state.doc) || shown.getState(before) !== shown.getState(view.state)) told.moved(); } }),
    })],
  });
};

export function DocumentEditor(props: { host: DocumentHost; id: string; name: string; actions?: JSX.Element; margin?: JSX.Element; onReady?: () => void; marks?: (marks: DocumentMarks) => void }) {
  const copy = createLiveDocument(props.host, props.id);
  const [column, setColumn] = createSignal<HTMLDivElement>(), [editor, setEditor] = createSignal<Editor>();
  const changes = copy.doc.getMap<Change>(CHANGES), [changed, setChanged] = createSignal<string[]>([]);
  const watching = new Set<(pressed?: string) => void>(), told = { anchors: [] as DocumentAnchor[], moved: (pressed?: string) => { for (const listener of watching) listener(pressed); } };
  const redraw = () => { const view = editor()?.view; if (view) view.dispatch(view.state.tr.setMeta(shown, true)); };
  // Redrawn after the merge has reached the editor, never inside it: a change to the editor made before then is written back to the document as it was, undoing what was merged.
  changes.observe(() => queueMicrotask(() => { setChanged([...changes.values()].map((change) => change.for)); redraw(); }));
  // The text reflows when its column changes width, with no change to the document.
  createEffect(() => { const element = column(); if (!element) return; const sized = new ResizeObserver(() => told.moved()); sized.observe(element); onCleanup(() => sized.disconnect()); });
  const kind = createEditorTransaction(editor, kindAt);
  // Ready is the hub's copy drawn, or the hub not answering: never a page still waiting.
  createEffect(() => { if (editor() || copy.state() === "away") props.onReady?.(); });
  // Made once, `active` read where it is drawn: a list made again at each change would have its buttons redrawn under the press (the editor changes as it loses focus to one).
  const tools = DOCUMENT_BLOCKS.filter((offered) => (props.host.blocks ?? DOCUMENT_BLOCKS).includes(offered)).map((name) => {
    const Icon = documentBlockIcons[name];
    return { name, label: KINDS[name].label, icon: () => <Icon />, get active() { return kind() === name; }, run: () => { const made = editor(); if (made) KINDS[name].make(made.chain().focus()).run(); } };
  });
  props.marks?.({
    subject: () => ({ kind: "document", name: props.name, document: props.id }),
    under: (box) => {
      const over = [...(column()?.querySelectorAll<HTMLElement>(".ProseMirror > [data-id]") ?? [])].filter((block) => { const at = block.getBoundingClientRect(); return at.bottom > box.top && at.top < box.top + box.height; });
      return over.length ? { blocks: over.map((block) => block.dataset.id).join(" "), text: over.map((block) => block.textContent ?? "").join("\n") } : null;
    },
    anchors: (list) => { told.anchors = list; redraw(); },
    place: (key) => {
      const boxes = [...(column()?.querySelectorAll(`[data-comment~="${CSS.escape(key)}"]`) ?? [])].map((mark) => mark.getBoundingClientRect());
      if (!boxes.length) return null;
      const left = Math.min(...boxes.map((box) => box.left)), top = Math.min(...boxes.map((box) => box.top));
      return { left, top, width: Math.max(...boxes.map((box) => box.right)) - left, height: Math.max(...boxes.map((box) => box.bottom)) - top };
    },
    watch: (listener) => { watching.add(listener); return () => watching.delete(listener); },
    changed: (key) => changed().includes(key),
    tools: () => tools,
    selection: () => {
      const view = editor()?.view;
      if (!view) return null;
      const { from, to, empty, $from } = view.state.selection, range = document.createRange();
      if (empty) {
        // The caret's top-level block, as it is drawn.
        const block = $from.depth ? view.nodeDOM($from.before(1)) : null;
        if (!block) return null;
        range.selectNodeContents(block);
      } else {
        const start = view.domAtPos(from), end = view.domAtPos(to);
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
      }
      return range;
    },
  });
  return <DocumentSheet ref={setColumn} name={props.name} state={copy.state() === "away" ? "Reconnecting" : undefined} margin={props.margin} actions={props.actions}>
    {/* The editor is made only once the hub's copy is held: made before, its first empty block would be merged in as a block of its own. */}
    <Show when={copy.synced() && column()}>{(element) => {
      const made = createTiptapEditor(() => ({ element: element(), extensions: [...documentExtensions(), merged(copy.doc.getXmlFragment(FRAGMENT)), marked(changes, told)], editorProps: { attributes: { class: documentTextClass, "aria-label": props.name } } }));
      createEffect(() => setEditor(made()));
      return null;
    }}</Show>
  </DocumentSheet>;
}
