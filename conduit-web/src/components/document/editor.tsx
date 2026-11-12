import { Extension, type ChainedCommands, type Editor } from "@tiptap/core";
import { createEffect, createSignal, For, Show, type JSX } from "solid-js";
import { createEditorTransaction, createTiptapEditor } from "solid-tiptap";
import { redo, undo, ySyncPlugin, yUndoPlugin } from "y-prosemirror";
import type { XmlFragment } from "yjs";
import { DocumentSheet, documentTextClass } from "@/components/ui/document";
import { DropdownMenu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/ui/menus";
import { FRAGMENT, documentExtensions } from "@/document-format.js";
import { DOCUMENT_BLOCKS, type DocumentBlockKind, type DocumentHost, type DocumentMarks } from "./host";
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

export function DocumentEditor(props: { host: DocumentHost; id: string; name: string; actions?: JSX.Element; onReady?: () => void; marks?: (marks: DocumentMarks) => void }) {
  const copy = createLiveDocument(props.host, props.id);
  const [column, setColumn] = createSignal<HTMLDivElement>(), [editor, setEditor] = createSignal<Editor>();
  const kind = createEditorTransaction(editor, kindAt);
  // Ready is the hub's copy drawn, or the hub not answering: never a page still waiting.
  createEffect(() => { if (editor() || copy.state() === "away") props.onReady?.(); });
  props.marks?.({
    subject: () => ({ kind: "document", name: props.name, document: props.id }),
    under: (box) => {
      const over = [...(column()?.querySelectorAll<HTMLElement>(".ProseMirror > [data-id]") ?? [])].filter((block) => { const at = block.getBoundingClientRect(); return at.bottom > box.top && at.top < box.top + box.height; });
      return over.length ? { blocks: over.map((block) => block.dataset.id).join(" "), text: over.map((block) => block.textContent ?? "").join("\n") } : null;
    },
  });
  return <DocumentSheet ref={setColumn} name={props.name} state={copy.state() === "away" ? "Reconnecting" : undefined} actions={<>
    <DropdownMenu>
      <MenuTrigger aria-label="Block kind" disabled={!editor()}>{KINDS[kind()].label}</MenuTrigger>
      <MenuContent>
        <MenuRadioGroup value={kind()} onChange={(next) => KINDS[next as DocumentBlockKind].make(editor()!.chain().focus()).run()}>
          <For each={DOCUMENT_BLOCKS.filter((offered) => (props.host.blocks ?? DOCUMENT_BLOCKS).includes(offered))}>{(offered) => <MenuRadioItem value={offered}>{KINDS[offered].label}</MenuRadioItem>}</For>
        </MenuRadioGroup>
      </MenuContent>
    </DropdownMenu>
    {props.actions}
  </>}>
    {/* The editor is made only once the hub's copy is held: made before, its first empty block would be merged in as a block of its own. */}
    <Show when={copy.synced() && column()}>{(element) => {
      const made = createTiptapEditor(() => ({ element: element(), extensions: [...documentExtensions(), merged(copy.doc.getXmlFragment(FRAGMENT))], editorProps: { attributes: { class: documentTextClass, "aria-label": props.name } } }));
      createEffect(() => setEditor(made()));
      return null;
    }}</Show>
  </DocumentSheet>;
}
