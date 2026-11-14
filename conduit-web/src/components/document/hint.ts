import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { documentHintClass } from "@/components/ui/document";
import { redrawBlocks } from "./blocks";

/** The empty headings, kept by block so a keystroke draws again only the block it changed; and the caret's own empty line (where it starts, or -1) drawn with them. */
type Hints = { headings: DecorationSet; caret: number; shown: DecorationSet };
const hints = new PluginKey<Hints>("hint");
const say = (node: Node, pos: number, says: string, more?: Record<string, string>) => Decoration.node(pos, pos + node.nodeSize, { class: documentHintClass, "data-hint": says, ...more });
/** A block's empty headings, looked for where hints are: not in a table or code. */
const headingsIn = (block: Node, at: number) => {
  const found: Decoration[] = [];
  const look = (node: Node, pos: number) => {
    if (node.type.name === "table" || node.type.spec.code) return false;
    if (!node.isTextblock) return true;
    if (!node.content.size && node.type.name === "heading") found.push(say(node, pos, `Heading ${node.attrs.level}`));
    return false;
  };
  if (look(block, at)) block.descendants((node, pos) => look(node, at + 1 + pos));
  return found;
};
/** The caret's empty line of text (not a heading, which says its level anyway; not in a table or code). */
const caretLine = ({ selection: { $from, empty } }: EditorState) => {
  if (!empty || !$from.parent.isTextblock || $from.parent.content.size || $from.parent.type.spec.code || $from.parent.type.name === "heading") return -1;
  for (let depth = $from.depth - 1; depth > 0; depth--) if ($from.node(depth).type.name === "table") return -1;
  return $from.before();
};

/**
 * What each empty block of text is, shown while the editor has focus so no gap goes unexplained: the caret's says what it is for (`hint`), an empty
 * heading its level; an empty paragraph elsewhere is a gap the writer left and says nothing. An empty document's one paragraph says it always. Drawn, never written. A table's cells and code
 * say nothing: an empty cell is no gap.
 */
export const hinted = (hint: string) => {
  const make = (state: EditorState, headings: DecorationSet): Hints => {
    const caret = caretLine(state);
    return { headings, caret, shown: caret < 0 ? headings : headings.add(state.doc, [say(state.doc.nodeAt(caret)!, caret, hint)]) };
  };
  return Extension.create({
    name: "hint",
    addProseMirrorPlugins: () => [new Plugin<Hints>({
      key: hints,
      state: {
        init: (_, state) => { const found: Decoration[] = []; state.doc.forEach((block, at) => found.push(...headingsIn(block, at))); return make(state, DecorationSet.create(state.doc, found)); },
        apply: (tr, old, was, state) => {
          const headings = tr.docChanged ? redrawBlocks(old.headings, was.doc, state.doc, headingsIn) : old.headings;
          return headings === old.headings && caretLine(state) === old.caret ? old : make(state, headings);
        },
      },
      props: {
        decorations: (state) => {
          const { doc } = state, only = doc.firstChild!;
          return doc.childCount === 1 && only.type.name === "paragraph" && !only.content.size ? DecorationSet.create(doc, [say(only, 0, hint, { "data-empty": "" })]) : hints.getState(state)!.shown;
        },
      },
    })],
  });
};
