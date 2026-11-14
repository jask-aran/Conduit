import { Extension, type Editor } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { DOMSerializer, type Node, type Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { ySyncPluginKey } from "y-prosemirror";
import { DOCUMENT_SEAT_INKS, documentBlockClass, documentSeatCaret, documentSeatClass, documentSeatFlag, documentSeatStream, type DocumentSeatInk } from "@/components/ui/document";
import { documentExtensions } from "@/document-format.js";
import { blockById } from "./blocks";
import type { DocumentSeat } from "./host";

// The hub sends an edit and its seat's move one after the other, as two frames: a stream whose seat stopped writing stays this many frames unless the
// edit is seen landing first, so the paper never shows neither.
const LANDING_FRAMES = 2;
const drawn = new PluginKey<DecorationSet>("documentSeats");
const SAYS: Record<DocumentSeat["state"], string> = { thinking: "is thinking", reading: "is reading", writing: "is writing" };

/** Each agent's ink: the one its name asks for, else the next free, so one agent keeps its ink and two at once differ. */
export const seatInks = (names: readonly string[]) => {
  const inks = new Map<string, DocumentSeatInk>(), taken = new Set<number>();
  const asks = (name: string) => [...name].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) >>> 0, 7) % DOCUMENT_SEAT_INKS.length;
  for (const name of [...new Set(names)].sort((a, b) => asks(a) - asks(b) || a.localeCompare(b))) {
    let at = asks(name);
    for (let tried = 0; tried < DOCUMENT_SEAT_INKS.length && taken.has(at); tried += 1) at = (at + 1) % DOCUMENT_SEAT_INKS.length;
    taken.add(at);
    inks.set(name, DOCUMENT_SEAT_INKS[at]!);
  }
  return inks;
};

const writes = (seat: DocumentSeat) => seat.state === "writing" && (seat.op === "replace" || seat.op === "insert") && Boolean(seat.blocks[0]);
const keyOf = (seat: DocumentSeat) => `${seat.op} ${seat.blocks[0]}`;
/** A block and the id of the one after it (`start`: before the first). */
const near = (doc: Node, id: string) => {
  let node: Node | undefined, next: string | null = null, seen = id === "start";
  doc.forEach((block) => { if (seen && next === null && block !== node) { next = block.attrs.id ?? ""; return; } if (block.attrs.id === id) { node = block; seen = true; } });
  return { node, next };
};

let manager: MarkdownManager | undefined;
/** Markdown drawn as the paper's blocks are, by the schema's own rendering; a callout and a toggle take their boxes (a view's buttons are left out). */
const blocksOf = (schema: Schema, markdown: string) => {
  const out = document.createDocumentFragment();
  if (!markdown.trim()) return out;
  try {
    out.append(DOMSerializer.fromSchema(schema).serializeFragment(schema.nodeFromJSON((manager ??= new MarkdownManager({ extensions: documentExtensions() })).parse(markdown)).content));
  } catch {
    out.append(Object.assign(document.createElement("p"), { textContent: markdown }));
  }
  for (const box of out.querySelectorAll<HTMLElement>("aside[data-callout], div[data-toggle]")) {
    const toggle = box.tagName === "DIV", body = document.createElement("div");
    body.append(...box.childNodes);
    if (toggle) { body.className = documentBlockClass.toggleBody; box.dataset.open = ""; }
    box.replaceChildren(document.createElement("span"), body);
    box.classList.add(toggle ? documentBlockClass.toggle : documentBlockClass.callout);
  }
  return out;
};

const FENCE = /^ {0,3}(?:```|~~~)/;
const TEXTBLOCK = /^(?:P|H[1-6]|PRE)$/;
/** The line being written: its kind read from how it starts, its words drawn as they are, so an open `**` or half a table row never flips it between two drawings. */
const lineOf = (line: string) => {
  const heading = /^(#{1,6})\s+/.exec(line), item = /^\s*(?:([-*+])|\d+[.)])\s+(?:\[[ xX]\]\s+)?/.exec(line), quote = /^\s*>\s?/.exec(line);
  if (heading) return { tag: `h${Math.min(3, heading[1]!.length)}`, text: line.slice(heading[0].length) };
  if (item) return { tag: "li", list: item[1] ? "UL" : "OL", text: line.slice(item[0].length) };
  if (quote) return { tag: "blockquote", text: line.slice(quote[0].length) };
  return { tag: "p", text: line };
};

/** What one agent is heard writing, kept while it writes so each update changes only what changed: the whole lines drawn again when one more is whole, the line being written only its words. */
type Stream = { id: number; key: string; block: string; op: string; root: HTMLElement; body: HTMLElement; caret: HTMLElement; words: Text; done?: string; line?: { kind: string; outer: HTMLElement; inner: HTMLElement; list?: HTMLElement };
  anchor?: Node; next: string | null; landed: boolean; leaving?: { on: boolean } };

const paint = (stream: Stream, schema: Schema, text: string) => {
  const cut = text.lastIndexOf("\n") + 1, done = text.slice(0, cut), line = text.slice(cut), { body, caret, words } = stream;
  if (done !== stream.done) {
    stream.done = done;
    body.replaceChildren(blocksOf(schema, done));
    stream.root.dataset.lead = /^H[1-3]$/.test(body.firstElementChild?.tagName ?? "") ? "heading" : "";
  }
  words.data = line;
  // Inside a fence that is still open the code is drawn as it is: the line joins it.
  const code = done.split("\n").filter((one) => FENCE.test(one)).length % 2 ? body.lastElementChild?.querySelector("code") : null;
  if (code) { stream.line?.outer.remove(); code.append(words, caret); return; }
  if (!line) {
    stream.line?.outer.remove();
    let at: Element = body;
    while (!TEXTBLOCK.test(at.tagName) && at.lastElementChild) at = at.lastElementChild;
    (at.tagName === "PRE" ? at.querySelector("code") ?? at : at).append(caret);
    return;
  }
  const kind = lineOf(line), name = kind.list ?? kind.tag;
  if (stream.line?.kind !== name) {
    const outer = document.createElement(kind.tag), inner = kind.tag === "li" || kind.tag === "blockquote" ? outer.appendChild(document.createElement("p")) : outer;
    stream.line?.outer.remove();
    stream.line = { kind: name, outer, inner, ...(kind.list ? { list: document.createElement(kind.list) } : {}) };
  }
  words.data = kind.text;
  const { outer, inner, list } = stream.line;
  inner.append(words, caret);
  // A list item joins the list over it, as it will once its line is whole.
  if (!list) body.append(outer);
  else if (body.lastElementChild !== list && body.lastElementChild?.tagName === list.tagName && body.lastElementChild.getAttribute("data-type") !== "taskList") body.lastElementChild.append(outer);
  else { list.append(outer); body.append(list); }
};

const later = (frames: number, then: () => void) => {
  const mark = { on: true }, step = (left: number) => requestAnimationFrame(() => { if (mark.on) left > 1 ? step(left - 1) : then(); });
  step(frames);
  return mark;
};

/**
 * The agents at work in the paper (the hub's seats), drawn as other writers are: an agent's caret and name at the start of the first block it holds,
 * those blocks washed in its ink; while it writes, what it is heard writing drawn as the blocks it will be, where they will stand (under the block it
 * writes over, which stays, marked; after the one it writes after), its caret at their end, until the edit lands. Drawn, never written: a seat is not
 * the paper's text. `seats` is read on each call; `told` hands back how to say they changed. More words only change the stream's own elements; a
 * transaction is dispatched only when what is drawn where changes.
 */
export const seatsDrawn = (seats: () => DocumentSeat[], told: (redraw: () => void) => void) => {
  const streams = new Map<string, Stream>();
  let made = 0;
  // Untracked: the plugin is made while the editor is, inside what makes it, and a seat changing must redraw, never make the editor again.
  const now = () => untrack(seats);
  const build = (doc: Node) => {
    const found: Decoration[] = [], at = new Map<string, { from: number; to: number; node: Node }>(), list = now(), inks = seatInks(list.map((seat) => seat.name));
    doc.forEach((block, from) => { if (block.attrs.id) at.set(block.attrs.id, { from, to: from + block.nodeSize, node: block }); });
    for (const seat of list) {
      const ink = inks.get(seat.name)!, stream = streams.get(seat.name), streaming = Boolean(stream && !stream.landed && writes(seat) && stream.key === keyOf(seat));
      const held = seat.blocks.flatMap((id) => at.get(id) ?? []), first = held[0];
      if (stream) stream.root.dataset.seatInk = ink;
      // A block written after is only where the new ones go: it is not being changed.
      if (!first || (streaming && seat.op === "insert")) continue;
      for (const block of held) found.push(Decoration.node(block.from, block.to, { class: documentSeatClass.held, "data-seat": seat.state, "data-seat-ink": ink, ...(streaming ? { "data-op": "replace" } : {}) }));
      // At the start of the first line of text in the block, else (an image, a divider) just before it.
      let line = first.node.isTextblock ? first.from + 1 : -1;
      if (line < 0) first.node.descendants((node, offset) => { if (line >= 0) return false; if (node.isTextblock) { line = first.from + offset + 2; return false; } return true; });
      const label = `${seat.name} ${streaming ? "is writing over this" : SAYS[seat.state]}`;
      found.push(Decoration.widget(line < 0 ? first.from : line, () => documentSeatFlag(label, ink), { key: `flag ${label} ${ink}`, side: -1, ignoreSelection: true }));
    }
    for (const stream of streams.values()) {
      const place = stream.block === "start" ? 0 : at.get(stream.block)?.to;
      if (!stream.landed && place !== undefined) found.push(Decoration.widget(place, () => stream.root, { key: `stream ${stream.id}`, side: 1, ignoreSelection: true, stopEvent: () => true }));
    }
    return DecorationSet.create(doc, found);
  };
  /** An edit merged from the hub that changes a block being written over, or puts blocks where one is being written after, is that stream landing. */
  const land = (doc: Node) => {
    for (const [name, stream] of streams) {
      if (stream.landed) continue;
      const { node, next } = near(doc, stream.block);
      if (stream.op === "replace" ? !node || !stream.anchor || !node.eq(stream.anchor) : next !== stream.next) {
        stream.landed = true;
        if (stream.leaving) { stream.leaving.on = false; streams.delete(name); }
      }
    }
  };
  return Extension.create({
    name: "documentSeats",
    addProseMirrorPlugins() {
      const editor = this.editor, schema = editor.schema;
      const dispatch = () => { if (!editor.isDestroyed) editor.view.dispatch(editor.view.state.tr.setMeta(drawn, true)); };
      let shape = "";
      const redraw = () => {
        if (editor.isDestroyed) return;
        const list = now(), inks = seatInks(list.map((seat) => seat.name));
        let moved = false;
        for (const [name, stream] of streams) {
          const seat = list.find((one) => one.name === name);
          if ((seat && writes(seat) && keyOf(seat) === stream.key) || stream.leaving) continue;
          if (stream.landed) { streams.delete(name); moved = true; continue; }
          stream.leaving = later(LANDING_FRAMES, () => { if (streams.get(name) === stream) { streams.delete(name); dispatch(); } });
        }
        for (const seat of list) {
          if (!writes(seat)) continue;
          let stream = streams.get(seat.name);
          // Landed while still told writing is the edit come before the seat's move: kept, not drawn again.
          if (stream?.key !== keyOf(seat) || stream.leaving) {
            if (stream?.leaving) stream.leaving.on = false;
            const { root, body } = documentSeatStream(inks.get(seat.name)!), { node, next } = near(editor.state.doc, seat.blocks[0]!);
            stream = { id: made += 1, key: keyOf(seat), block: seat.blocks[0]!, op: seat.op!, root, body, caret: documentSeatCaret(seat.name), words: document.createTextNode(""), anchor: node, next, landed: false };
            streams.set(seat.name, stream);
            moved = true;
          }
          if (!stream.landed) paint(stream, schema, seat.text ?? "");
        }
        // Only what is drawn where: more words alone were painted into the stream above.
        const next = JSON.stringify(list.map(({ text: _, ...rest }) => [rest, inks.get(rest.name)]));
        if (moved || next !== shape) { shape = next; dispatch(); }
      };
      told(redraw);
      return [new Plugin({
        key: drawn,
        state: { init: (_, state) => build(state.doc), apply: (change, old) => { if (change.docChanged && change.getMeta(ySyncPluginKey)?.isChangeOrigin) land(change.doc); return change.docChanged || change.getMeta(drawn) ? build(change.doc) : old; } },
        props: { decorations: (state) => drawn.getState(state) },
        // Seats told before the editor was made are drawn once it is.
        view: () => { queueMicrotask(redraw); return { destroy: () => { for (const stream of streams.values()) if (stream.leaving) stream.leaving.on = false; streams.clear(); } }; },
      })];
    },
  });
};

export type SeatAway = { name: string; label: string; below: boolean; block: string; ink: DocumentSeatInk };
/** The first agent at work whose place is out of the reader's view, and which way it is: never scrolled to, only said, for a DocumentSeatJump to go there. */
export function createSeatsAway(editor: () => Editor | undefined, seats: () => DocumentSeat[], scroller: () => HTMLElement | undefined) {
  const [away, setAway] = createSignal<SeatAway | undefined>(undefined, { equals: (a, b) => a?.label === b?.label && a?.block === b?.block && a?.ink === b?.ink });
  const measure = () => {
    const view = editor()?.view, box = scroller()?.getBoundingClientRect(), list = seats(), inks = seatInks(list.map((seat) => seat.name));
    if (!view || view.isDestroyed || !box) return undefined;
    for (const seat of list) {
      const block = seat.blocks[0] === "start" ? view.state.doc.firstChild?.attrs.id as string | undefined : seat.blocks[0], at = block ? blockById(view.state.doc, block) : null;
      const place = at === null ? null : (view.nodeDOM(at) as HTMLElement | null)?.getBoundingClientRect();
      if (!place || !block) continue;
      // An insert is written under its block, so it is below once that block's foot is.
      const below = (seat.state === "writing" && seat.op === "insert" ? place.bottom : place.top) >= box.bottom, above = place.bottom <= box.top;
      if (below || above) return { name: seat.name, label: `${seat.name} ${SAYS[seat.state]} ${below ? "below" : "above"}`, below, block, ink: inks.get(seat.name)! };
    }
    return undefined;
  };
  let frame = 0;
  const check = () => { frame ||= requestAnimationFrame(() => { frame = 0; setAway(untrack(measure)); }); };
  createEffect(() => { seats(); check(); });
  createEffect(() => { const element = scroller(); if (!element) return; element.addEventListener("scroll", check, { passive: true }); onCleanup(() => element.removeEventListener("scroll", check)); });
  createEffect(() => { const made = editor(); if (!made) return; made.on("transaction", check); onCleanup(() => made.off("transaction", check)); });
  onCleanup(() => cancelAnimationFrame(frame));
  return away;
}
