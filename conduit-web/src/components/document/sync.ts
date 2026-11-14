import type { Node } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { ySyncPluginKey } from "y-prosemirror";
import type { Doc } from "yjs";

type Binding = { doc: Doc; mux(run: () => void): void; _prosemirrorChanged(doc: Node): void };
const unsent = new WeakMap<Doc, () => void>();
/** Writes into the document what the editor holds and has not written yet. Called before anything else changes the document or acts on its history
 *  (an update from the hub, an undo): the sync plugin draws the editor from the document then, and a letter not yet in it would be gone. */
export const settle = (doc: Doc) => unsent.get(doc)?.();
// A hidden page is given no frame: what was typed is written this long after at the latest.
const LATEST_MS = 120;

/**
 * The sync plugin's write of the editor into the document, moved out of the keystroke: once after the frame that drew it is painted, for however
 * many keys the frame held. The write compares the whole text with the document, so it is the same write later. Placed after the sync plugin, so
 * its view is made after that plugin's binding and ended before it.
 */
export const lateSync = () => new Plugin({ view: (view) => {
  const binding = ySyncPluginKey.getState(view.state)?.binding as Binding | undefined;
  if (!binding) return {};
  const write = binding._prosemirrorChanged.bind(binding);
  let owed = false, frame = 0, soon: ReturnType<typeof setTimeout> | undefined, latest: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { owed = false; cancelAnimationFrame(frame); clearTimeout(soon); clearTimeout(latest); };
  const flush = () => { if (!owed) return; clear(); binding.mux(() => write(view.state.doc)); };
  binding._prosemirrorChanged = (doc) => {
    // A change kept out of the history is written as it is made, with all owed before it: the plugin has marked this transaction for it.
    if (ySyncPluginKey.getState(view.state)?.addToHistory === false) { clear(); return write(doc); }
    if (owed) return;
    owed = true;
    frame = requestAnimationFrame(() => { soon = setTimeout(flush); });
    latest = setTimeout(flush, LATEST_MS);
  };
  unsent.set(binding.doc, flush);
  window.addEventListener("pagehide", flush);
  return { destroy: () => { flush(); binding._prosemirrorChanged = write; unsent.delete(binding.doc); window.removeEventListener("pagehide", flush); } };
} });
