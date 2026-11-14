import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { documentHintClass } from "@/components/ui/document";

/**
 * What each empty block of text is, shown while the editor has focus so no gap goes unexplained: the caret's says what it is for (`hint`), an empty
 * heading its level; an empty paragraph elsewhere is a gap the writer left and says nothing. An empty document's one paragraph says it always. Drawn, never written. A table's cells and code
 * say nothing: an empty cell is no gap.
 */
export const hinted = (hint: string) => Extension.create({
  name: "hint",
  addProseMirrorPlugins: () => [new Plugin({
    props: {
      decorations: ({ doc, selection: { $from, empty } }) => {
        const blank = doc.childCount === 1 && doc.firstChild!.type.name === "paragraph" && !doc.firstChild!.content.size;
        if (blank) return DecorationSet.create(doc, [Decoration.node(0, doc.firstChild!.nodeSize, { class: documentHintClass, "data-hint": hint, "data-empty": "" })]);
        const caret = empty && $from.parent.isTextblock ? $from.before() : -1, found: Decoration[] = [];
        doc.descendants((node, pos) => {
          if (node.type.name === "table" || node.type.spec.code) return false;
          if (!node.isTextblock) return true;
          const says = node.type.name === "heading" ? `Heading ${node.attrs.level}` : pos === caret ? hint : null;
          if (!node.content.size && says) found.push(Decoration.node(pos, pos + node.nodeSize, { class: documentHintClass, "data-hint": says }));
          return false;
        });
        return found.length ? DecorationSet.create(doc, found) : null;
      },
    },
  })],
});
