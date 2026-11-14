import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { documentDrawClass } from "@/components/ui/document";
import { blockAt, blockById } from "./blocks";

// `@` where a word may start, then a name (dots only inside it, so a sentence's full stop is not the name's).
const MENTION = /(?<!\S)@([\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*)/gu;
// Found once for each block and kept by the block itself: a keystroke makes one new block, and the rest are the nodes they were.
const found = new WeakMap<Node, [number, number, string][]>();
const mentionsIn = (block: Node) => {
  let runs = found.get(block);
  if (runs) return runs;
  found.set(block, runs = []);
  block.descendants((node, pos) => {
    if (node.type.spec.code) return false;
    if (!node.isText || node.marks.some((mark) => mark.type.spec.code)) return true;
    for (const match of node.text!.matchAll(MENTION)) runs!.push([pos + match.index, pos + match.index + match[0].length, match[1]!]);
    return false;
  });
  return runs;
};
const mentions = (doc: Node) => {
  const drawn: Decoration[] = [];
  doc.forEach((block, at) => { if (!block.type.spec.code) for (const [from, to, name] of mentionsIn(block)) drawn.push(Decoration.inline(at + 1 + from, at + 1 + to, { class: documentDrawClass.mention, "data-mention": name })); });
  return DecorationSet.create(doc, drawn);
};
const mentioned = new PluginKey<DecorationSet>("mentions");
export const revealed = new PluginKey<string | null>("revealed");
// What pasted over selected text makes it a link: one address and nothing else.
const ADDRESS = /^(?:https?:\/\/|mailto:)\S+$/i;

/**
 * What the editor draws over the text and never writes: each `@name` as a chip that, pressed, tells `shown` its block and name; and the block just
 * revealed (`revealed`'s meta, its id; null clears it), flashed once. Also an address pasted over selected text links the text.
 */
export const drawn = (shown: (block: string, name: string) => void) => Extension.create({
  name: "drawn",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: mentioned,
        state: { init: (_, state) => mentions(state.doc), apply: (tr, old) => tr.docChanged ? mentions(tr.doc) : old },
        props: {
          decorations: (state) => mentioned.getState(state),
          handleClick: (view, pos, event) => {
            const name = (event.target as Element).closest?.("[data-mention]")?.getAttribute("data-mention"), at = blockAt(view.state.doc, pos), id = at === null ? null : view.state.doc.nodeAt(at)?.attrs.id;
            if (name && id) shown(id, name);
            return false;
          },
          handlePaste: (view, event) => {
            const address = event.clipboardData?.getData("text/plain").trim() ?? "";
            if (view.state.selection.empty || !ADDRESS.test(address)) return false;
            return editor.chain().focus().setLink({ href: address }).run();
          },
        },
      }),
      new Plugin({
        key: revealed,
        state: { init: (): string | null => null, apply: (tr, old) => { const meta = tr.getMeta(revealed) as string | null | undefined; return meta === undefined ? old : meta; } },
        props: {
          decorations: (state) => {
            const id = revealed.getState(state), at = id ? blockById(state.doc, id) : null, node = at === null ? null : state.doc.nodeAt(at);
            return node ? DecorationSet.create(state.doc, [Decoration.node(at!, at! + node.nodeSize, { class: documentDrawClass.revealed })]) : null;
          },
        },
      }),
    ];
  },
});
