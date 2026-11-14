import { Extension, type Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js";
import { render } from "solid-js/web";
import { readEditor } from "./read";
import { ySyncPluginKey } from "y-prosemirror";
import type { Doc, Map as YMap } from "yjs";
import { DocumentSuggested } from "@/components/ui/document";
import { SUGGESTION, blockId, isSuggestion } from "@/document-format.js";
import { blockById } from "./blocks";
import type { DocumentHost, DocumentSuggestion, DocumentWriting } from "./host";

type Json = { type: string; text?: string; content?: Json[] };
/** An entry of the document's changes (document-format.js CHANGES). */
export type Change = { for: string; before: Json | null; after?: string | null; by: string; at: string };

// A burst also ends after this long with nothing written, so a suggestion left and come back to is another.
const PAUSE_MS = 30_000;
const CLIP = 48;
const clip = (text: string) => text.length > CLIP ? `${text.slice(0, CLIP - 1)}…` : text;
const textOf = (node: Json): string => node.text ?? (node.content ?? []).map(textOf).join(" ");
const settled = new PluginKey<DecorationSet>("suggesting");
const storeKey = (id: string) => `conduit.paper-writing.${id}`;

/** Each top-level block by id, with the nearest block before it that `kept` still holds (null: none). */
const tops = (doc: Node, kept?: Map<string, unknown>) => {
  const found = new Map<string, { node: Node; prev: string | null }>();
  let prev: string | null = null;
  doc.forEach((node) => { const id = node.attrs.id as string | undefined; if (!id) return; found.set(id, { node, prev }); if (!kept || kept.has(id)) prev = id; });
  return found;
};
const caretId = (doc: Node, from: number) => { const $from = doc.resolve(from); return $from.depth ? $from.node(1).attrs.id as string | undefined : undefined; };

/**
 * Suggesting: how the reader writes (DocumentWriting, kept in this browser for each paper), and in Suggesting each burst of writing recorded as one
 * suggestion in the document's changes, its blocks' `before` taken at their first touch. The writing itself is merged live like any other; only its
 * standing is provisional. A burst is the writing done while the caret stays in the blocks it touched (a block it makes counts), and ends when the
 * caret settles in another block, the reader switches to Editing, or nothing is written for PAUSE_MS; writing again in a block of one's own
 * suggestion goes on with that suggestion. `inline`: each suggestion's Accept and Reject stand at its first block.
 */
export function createSuggesting(editor: Accessor<Editor | undefined>, doc: Doc, changes: YMap<Change>, host: DocumentHost, id: string) {
  const stored = (() => { try { return localStorage.getItem(storeKey(id)); } catch { return null; } })();
  const [writing, setWritingNow] = createSignal<DocumentWriting>(host.suggest && stored === "suggesting" ? "suggesting" : "editing");
  let burst: { key: string; blocks: Set<string>; last: number } | undefined, dirty = false, skip = false;
  const setWriting = (next: DocumentWriting) => { burst = undefined; setWritingNow(next); try { localStorage.setItem(storeKey(id), next); } catch { /* this page only */ } };

  const anySuggested = () => { for (const change of changes.values()) if (isSuggestion(change.for)) return true; return false; };
  /** The one block that differs where writing changed that block alone (the common case: typing), found by which nodes are still the nodes they were, without a map of either paper. */
  const lone = (was: Node, now: Node) => {
    if (was.childCount !== now.childCount) return null;
    let nth = -1;
    for (let i = 0; i < now.childCount; i++) if (was.child(i) !== now.child(i)) { if (nth >= 0) return null; nth = i; }
    const old = nth < 0 ? null : was.child(nth), made = nth < 0 ? null : now.child(nth), id = made?.attrs.id as string | undefined;
    return old && made && id && old.attrs.id === id ? { id, old, made } : null;
  };
  const record = (was: Node, now: Node) => {
    // Editing with no suggestion standing has nothing to record or clear.
    if (untrack(writing) !== "suggesting" && !anySuggested()) return;
    const one = lone(was, now), schema = now.type.schema;
    const after = one ? new Map([[one.id, { node: one.made, prev: null as string | null }]]) : tops(now), before = one ? new Map([[one.id, { node: one.old, prev: null as string | null }]]) : tops(was, after);
    const touched: [string, Node | null][] = [], gone: [string, Node, string | null][] = [];
    for (const [block, { node }] of after) { const old = before.get(block)?.node; if (!old) touched.push([block, null]); else if (old !== node && !old.eq(node)) touched.push([block, old]); }
    for (const [block, { node, prev }] of before) if (!after.has(block)) gone.push([block, node, prev]);
    if (!touched.length && !gone.length) return;
    const suggesting = untrack(writing) === "suggesting", by = host.author(), base = Date.now();
    if (burst && base - burst.last > PAUSE_MS) burst = undefined;
    doc.transact(() => {
      // Writing a suggested block back to what it was, or deleting one a suggestion made, leaves nothing of it to suggest, in either way of writing.
      const cleared = new Set<string>();
      for (const [block] of touched) { const had = changes.get(block); if (had && isSuggestion(had.for) && had.before && schema.nodeFromJSON(had.before).eq(after.get(block)!.node)) { changes.delete(block); cleared.add(block); } }
      for (const [block] of gone) { const had = changes.get(block); if (had && isSuggestion(had.for) && had.before === null) { changes.delete(block); cleared.add(block); } }
      if (!suggesting) return;
      const own = touched.map(([block]) => changes.get(block)).find((had) => had && isSuggestion(had.for) && had.by === by);
      burst ??= { key: own?.for ?? `${SUGGESTION}${blockId()}`, blocks: new Set(), last: base };
      const stamp = new Date(base).toISOString();
      for (const [block, old] of touched) {
        burst.blocks.add(block);
        // A block already changed (in this suggestion, another, or for a comment) keeps the first `before`: rejecting takes back all of it.
        if (!cleared.has(block) && !changes.has(block)) changes.set(block, { for: burst.key, by, at: stamp, before: old?.toJSON() ?? null });
      }
      // A deleted block stands where it was until the suggestion is settled. Later in the paper is later in time, so a reject puts back the last first and each lands after the one before it.
      gone.forEach(([block, old, prev], nth) => {
        if (cleared.has(block)) return;
        changes.set(block, { ...(changes.get(block) ?? { for: burst!.key, by, before: old.toJSON() }), after: prev, at: new Date(base + nth).toISOString() });
      });
      burst.last = base;
    });
  };

  const accept = (key: string) => {
    if (burst?.key === key) burst = undefined;
    doc.transact(() => { for (const [block, change] of [...changes.entries()]) if (change.for === key) changes.delete(block); });
  };
  /** Taken back as the hub takes back a comment's change (server/documents.js revert), in the editor, so it is merged like any other writing. */
  const reject = (key: string) => {
    const view = editor()?.view;
    if (!view || view.isDestroyed) return;
    if (burst?.key === key) burst = undefined;
    const { schema } = view.state, tr = view.state.tr, mine = [...changes.entries()].filter(([, change]) => change.for === key).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at)));
    for (const [block, change] of mine) {
      const at = blockById(tr.doc, block), before = change.before ? schema.nodeFromJSON(change.before) : null;
      if (at !== null) {
        const size = tr.doc.nodeAt(at)!.nodeSize;
        if (before) tr.replaceWith(at, at + size, before); else if (tr.doc.childCount > 1) tr.delete(at, at + size); else tr.replaceWith(at, at + size, schema.nodes.paragraph!.create());
      } else if (before) {
        const prev = change.after ? blockById(tr.doc, change.after) : null;
        tr.insert(change.after === null ? 0 : prev === null ? tr.doc.content.size : prev + tr.doc.nodeAt(prev)!.nodeSize, before);
      }
    }
    view.dispatch(tr.setMeta(settled, true));
    doc.transact(() => { for (const [block] of mine) changes.delete(block); });
  };

  const [version, setVersion] = createSignal(0);
  const bump = () => queueMicrotask(() => setVersion((n) => n + 1));
  changes.observe(bump);
  onCleanup(() => changes.unobserve(bump));
  const current = readEditor(editor, (made) => made?.state.doc);
  const suggestions = createMemo((): DocumentSuggestion[] => {
    version();
    const now = current(), schema = editor()?.schema;
    if (!now || !schema) return [];
    if (!anySuggested()) return [];
    const order = new Map<string, number>();
    now.forEach((node, _at, nth) => { if (node.attrs.id) order.set(node.attrs.id, nth); });
    const found = new Map<string, { key: string; by: string; at: string; entries: [string, Change][] }>();
    for (const [block, change] of changes.entries()) {
      if (!isSuggestion(change.for) || (change.before === null && !order.has(block))) continue;
      const one = found.get(change.for) ?? found.set(change.for, { key: change.for, by: change.by, at: change.at, entries: [] }).get(change.for)!;
      if (change.at < one.at) one.at = change.at;
      one.entries.push([block, change]);
    }
    return [...found.values()].sort((a, b) => a.at.localeCompare(b.at)).map(({ entries, ...one }) => {
      entries.sort((a, b) => (order.get(a[0]) ?? Infinity) - (order.get(b[0]) ?? Infinity));
      const added = entries.filter(([, change]) => !change.before), removed = entries.filter(([block, change]) => change.before && !order.has(block)), edited = entries.length - added.length - removed.length;
      const words = (block: string, change: Change) => clip(order.has(block) ? now.child(order.get(block)!).textContent : textOf(change.before!));
      let summary: string;
      if (entries.length === 1) {
        const [block, change] = entries[0]!, was = change.before ? clip(textOf(change.before)) : "";
        summary = added.length ? (words(block, change) ? `Added “${words(block, change)}”` : "Added a block") : removed.length ? (was ? `Removed “${was}”` : "Removed a block") : `Changed “${was}” to “${words(block, change)}”`;
      } else summary = [[edited, "Changed"], [added.length, "Added"], [removed.length, "Removed"]].filter(([n]) => n).map(([n, verb], nth) => `${nth ? String(verb).toLowerCase() : verb} ${n} block${n === 1 ? "" : "s"}`).join(", ");
      return { ...one, blocks: entries.map(([block]) => block), summary };
    });
  });

  // Untracked, so a suggestion changing redraws the controls and never makes the editor again. A control's Solid root goes with its element, which a redraw may keep.
  const parts = new WeakMap<globalThis.Node, () => void>();
  const controls = (state: { doc: Node }) => {
    if (host.suggest?.controls !== "inline") return DecorationSet.empty;
    const at = new Map<string, { from: number; to: number }>(), found: Decoration[] = [];
    state.doc.forEach((node, from) => { if (node.attrs.id) at.set(node.attrs.id, { from, to: from + node.nodeSize }); });
    for (const one of untrack(suggestions)) {
      const first = one.blocks.find((block) => at.has(block)), change = changes.get(one.blocks[0]!);
      const pos = first ? at.get(first)!.from : change?.after === null ? 0 : at.get(change?.after ?? "")?.to ?? state.doc.content.size;
      found.push(Decoration.widget(pos, () => {
        const element = Object.assign(document.createElement("div"), { contentEditable: "false" });
        element.dataset.suggestion = one.key;
        parts.set(element, render(() => <DocumentSuggested by={one.by} onAccept={() => accept(one.key)} onReject={() => reject(one.key)} />, element));
        return element;
      }, { key: `suggested ${one.key} ${one.by}`, side: -2, ignoreSelection: true, stopEvent: () => true, destroy: (element) => parts.get(element)?.() }));
    }
    return DecorationSet.create(state.doc, found);
  };
  const extension = () => Extension.create({
    name: "suggesting",
    addProseMirrorPlugins: () => [new Plugin({
      key: settled,
      state: {
        init: (_, state) => controls(state),
        apply: (tr, old, _was, state) => {
          const sync = tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean; isUndoRedoOperation?: boolean } | undefined;
          if (tr.getMeta(settled)) skip = true;
          // Written here, or taken back or put back here (which reaches the editor as a merge); never another's writing merged in.
          else if (tr.docChanged && (!sync?.isChangeOrigin || sync.isUndoRedoOperation)) dirty = true;
          return tr.docChanged || tr.getMeta(settled) !== undefined ? controls(state) : old.map(tr.mapping, tr.doc);
        },
      },
      props: { decorations: (state) => settled.getState(state) },
      view: (view) => {
        const redraw = () => queueMicrotask(() => { if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(settled, false)); });
        changes.observe(redraw);
        return {
          update: (view, prev) => {
            if (skip) skip = dirty = false;
            else if (dirty) { dirty = false; record(prev.doc, view.state.doc); }
            const at = caretId(view.state.doc, view.state.selection.from);
            if (burst && at && !burst.blocks.has(at)) burst = undefined;
          },
          destroy: () => changes.unobserve(redraw),
        };
      },
    })],
  });
  return { writing, setWriting, suggestions, accept, reject, extension };
}
