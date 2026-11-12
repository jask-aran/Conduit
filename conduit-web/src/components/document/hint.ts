import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { documentHintClass } from "@/components/ui/document";

/** What an empty paragraph says it is for: the caret's (shown while the editor has focus), and an empty document's always. Drawn, never written. */
export const hinted = (hint: string) => Extension.create({
  name: "hint",
  addProseMirrorPlugins: () => [new Plugin({
    props: {
      decorations: ({ doc, selection: { $from, empty } }) => {
        const blank = doc.childCount === 1 && doc.firstChild!.type.name === "paragraph" && !doc.firstChild!.content.size;
        if (blank) return DecorationSet.create(doc, [Decoration.node(0, doc.firstChild!.nodeSize, { class: documentHintClass, "data-hint": hint, "data-empty": "" })]);
        return empty && $from.depth === 1 && $from.parent.type.name === "paragraph" && !$from.parent.content.size
          ? DecorationSet.create(doc, [Decoration.node($from.before(), $from.after(), { class: documentHintClass, "data-hint": hint })]) : null;
      },
    },
  })],
});
