import { Extension } from "@tiptap/core";
import { untrack } from "solid-js";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { documentSeatClass } from "@/components/ui/document";
import type { DocumentSeat } from "./host";

const SAYS: Record<DocumentSeat["state"], string> = { thinking: "thinking", reading: "reading", writing: "writing" };
const drawn = new PluginKey<DecorationSet>("documentSeats");

/**
 * The agents at work in the paper (the hub's seats), drawn as another writer would be: the blocks one holds are marked, its name and what it is
 * doing stand at the first of them, and what it is heard writing stands under the block it will replace (after it, for one it adds) until the
 * change is made. Drawn, never written: a seat is not the paper's text. `seats` is read on each call; `told` hands back how to say they changed.
 */
export const seatsDrawn = (seats: () => DocumentSeat[], told: (redraw: () => void) => void) => {
  const build = (doc: Node) => {
    const found: Decoration[] = [], at = new Map<string, { from: number; to: number }>();
    doc.forEach((block, from) => { if (block.attrs.id) at.set(block.attrs.id, { from, to: from + block.nodeSize }); });
    // Untracked: the plugin is made while the editor is, inside what makes it, and a seat changing must redraw, never make the editor again.
    for (const seat of untrack(seats)) {
      const held = seat.blocks.flatMap((id) => at.get(id) ?? []), first = held[0];
      if (!first) continue;
      for (const block of held) found.push(Decoration.node(block.from, block.to, { class: documentSeatClass.held, "data-seat": seat.state }));
      found.push(Decoration.widget(first.from, () => Object.assign(document.createElement("div"), { className: documentSeatClass.label, contentEditable: "false", textContent: `${seat.name} is ${SAYS[seat.state]}` }), { key: `seat ${seat.name} ${seat.state}`, side: -1 }));
      if (seat.state === "writing" && seat.text) found.push(Decoration.widget(first.to, () => Object.assign(document.createElement("div"), { className: documentSeatClass.writing, contentEditable: "false", textContent: seat.text }), { key: `writing ${seat.name} ${seat.text.length}`, side: seat.op === "insert" ? 1 : -1 }));
    }
    return DecorationSet.create(doc, found);
  };
  return Extension.create({
    name: "documentSeats",
    addProseMirrorPlugins() {
      told(() => { const view = this.editor.view; if (!this.editor.isDestroyed) view.dispatch(view.state.tr.setMeta(drawn, true)); });
      return [new Plugin({ key: drawn, state: { init: (_, state) => build(state.doc), apply: (change, old) => change.docChanged || change.getMeta(drawn) ? build(change.doc) : old }, props: { decorations: (state) => drawn.getState(state) } })];
    },
  });
};
