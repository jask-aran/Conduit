import { batch, createSignal } from "solid-js";
import type { SplitView } from "../workspace/workspace-types";

/*
 * The layout as data (DESIGN.md "Places and panes"): panes, where each stands (the row, or the dock's one slot), what
 * is summoned over the dock, and which pane has the keyboard. Every change is a whole new layout, so undo and redo are
 * stepping through layouts and the address is one encoding of one.
 */

export type View = SplitView;
/** A session pane holds chats, terminals and jbot's log as tabs; a document pane holds one of anything else. */
export type PaneKind = "session" | "document";
export type Pane = { id: string; views: View[]; active: number };
export type Summon = "jbot" | "files" | "terminal";
export type Layout = { panes: Record<string, Pane>; row: string[]; dock: string | null; summon: Summon | null; focus: string; used: string[] };
/** How a view was asked for: `beside` (Alt) opens a pane beside, `tab` (Ctrl) adds a session tab; neither replaces. */
export type Verb = { beside?: boolean; tab?: boolean };

export const ROW_MAX = 3;
export const TAB_CAP = 5;

export const sessionView = (view: View) => view === "home" || view === "page:jbot" || view.startsWith("chat:") || view.startsWith("term:");
export const kindOf = (pane: Pane): PaneKind => pane.views.every(sessionView) ? "session" : "document";
export const shownView = (pane: Pane) => pane.views[pane.active] ?? pane.views[0]!;

let made = 0;
const newId = () => `p${Date.now().toString(36)}${(made++).toString(36)}`;
const paneOf = (views: View[], active = 0, id = newId()): Pane => ({ id, views, active });

export function layoutOf(first: View): Layout {
  const pane = paneOf([first]);
  return { panes: { [pane.id]: pane }, row: [pane.id], dock: null, summon: null, focus: pane.id, used: [pane.id] };
}

const placed = (layout: Layout) => [...layout.row, ...(layout.dock ? [layout.dock] : [])];
const withPane = (layout: Layout, pane: Pane): Layout => ({ ...layout, panes: { ...layout.panes, [pane.id]: pane } });
const focusing = (layout: Layout, id: string): Layout => ({ ...layout, focus: id, used: [id, ...layout.used.filter((other) => other !== id)] });
const dropPane = (layout: Layout, id: string): Layout => {
  const { [id]: _, ...panes } = layout.panes;
  const row = layout.row.filter((other) => other !== id);
  const dock = layout.dock === id ? null : layout.dock;
  const used = layout.used.filter((other) => other !== id && (row.includes(other) || other === dock));
  return { ...layout, panes, row, dock, used, focus: layout.focus === id ? used[0] ?? row[0]! : layout.focus };
};

/** Where a view already stands, if anywhere: a view is open once. */
export function findView(layout: Layout, view: View) {
  for (const id of placed(layout)) {
    const index = layout.panes[id]!.views.indexOf(view);
    if (index >= 0) return { id, index };
  }
  return null;
}

/** The session pane a Ctrl-opened tab joins: the focused one if it is a session pane, else the last one used. */
const sessionPaneFor = (layout: Layout) => layout.used.find((id) => kindOf(layout.panes[id]!) === "session");

/** Adds a tab, dropping the one used longest ago (never the shown one) past the cap. */
function withTab(pane: Pane, view: View): Pane {
  let views = [...pane.views, view];
  if (views.length > TAB_CAP) views = views.filter((_, index) => index !== (pane.active === 0 ? 1 : 0));
  return { ...pane, views, active: views.length - 1 };
}

export function open(layout: Layout, view: View, verb: Verb = {}): Layout {
  const at = findView(layout, view);
  if (at) return focusing(withPane(layout, { ...layout.panes[at.id]!, active: at.index }), at.id);
  if (verb.tab && sessionView(view)) {
    const target = sessionPaneFor(layout);
    if (target) return focusing(withPane(layout, withTab(layout.panes[target]!, view)), target);
  }
  if (verb.beside || verb.tab) {
    const pane = paneOf([view]);
    const after = layout.row.indexOf(layout.focus);
    if (layout.row.length < ROW_MAX) {
      const row = [...layout.row];
      row.splice(after < 0 ? row.length : after + 1, 0, pane.id);
      return { ...withPane(layout, pane), row };
    }
    // A full row: beside means the neighbour, replaced.
    const neighbour = layout.row[after + 1] ?? layout.row[after - 1] ?? layout.row[0]!;
    return { ...withPane(dropPane(layout, neighbour), pane), row: layout.row.map((id) => id === neighbour ? pane.id : id) };
  }
  // Plain replaces what the focused pane shows, whatever kind it is, keeping its place and id.
  return withPane(layout, paneOf([view], 0, layout.focus));
}

export const switchTab = (layout: Layout, id: string, index: number): Layout => focusing(withPane(layout, { ...layout.panes[id]!, active: index }), id);

export function closeTab(layout: Layout, id: string, index: number): Layout {
  const pane = layout.panes[id]!;
  if (pane.views.length <= 1) return closePane(layout, id);
  const views = pane.views.filter((_, at) => at !== index);
  return withPane(layout, { ...pane, views, active: Math.min(index < pane.active ? pane.active - 1 : pane.active, views.length - 1) });
}

/** The last pane in the row is never closed: it shows the launcher instead. */
export function closePane(layout: Layout, id: string): Layout {
  if (layout.row.length === 1 && layout.row[0] === id) return withPane(layout, paneOf(["home"], 0, id));
  return dropPane(layout, id);
}

export function moveToDock(layout: Layout, id: string): Layout {
  if (layout.row.length === 1 && layout.row[0] === id) return layout;
  const row = layout.row.filter((other) => other !== id);
  const replaced = layout.dock && layout.dock !== id ? dropPane(layout, layout.dock) : layout;
  return { ...replaced, row, dock: id, summon: null };
}

export function moveToRow(layout: Layout, id: string): Layout {
  if (layout.dock !== id || layout.row.length >= ROW_MAX) return layout;
  return focusing({ ...layout, dock: null, row: [...layout.row, id] }, id);
}

export function swap(layout: Layout, a: string, b: string): Layout {
  const row = layout.row.map((id) => id === a ? b : id === b ? a : id);
  return { ...layout, row };
}

/** Pressing the shown summon dismisses it; another replaces it. */
export const summon = (layout: Layout, what: Summon | null): Layout => ({ ...layout, summon: layout.summon === what ? null : what });

export const focus = (layout: Layout, id: string): Layout => layout.panes[id] ? focusing(layout, id) : layout;

/*
 * The address: `panes=` lists the row then the dock, `;` between panes, `,` between a pane's tabs, `*` before the shown
 * tab when it is not the first; `dock=1` when the last listed stands in the dock; `focus=` the focused pane's index.
 */
export function encode(layout: Layout) {
  const ids = placed(layout);
  const panes = ids.map((id) => { const pane = layout.panes[id]!; return pane.views.map((view, index) => (index === pane.active && index ? "*" : "") + view.replace(/[%,;*]/g, encodeURIComponent)).join(","); }).join(";");
  const params = new URLSearchParams({ panes });
  if (layout.dock) params.set("dock", "1");
  if (layout.summon) params.set("summon", layout.summon);
  const focused = ids.indexOf(layout.focus);
  if (focused > 0) params.set("focus", String(focused));
  return params;
}

export function decode(params: URLSearchParams, isView: (value: string) => value is View): Layout | null {
  const text = params.get("panes");
  if (!text) return null;
  const panes = text.split(";").map((part) => {
    const tabs = part.split(",").flatMap((tab) => { const view = decodeURIComponent(tab.replace(/^\*/, "")); return isView(view) ? [{ shown: tab.startsWith("*"), view }] : []; });
    return tabs.length ? paneOf(tabs.map((tab) => tab.view), Math.max(0, tabs.findIndex((tab) => tab.shown))) : null;
  }).filter((pane): pane is Pane => Boolean(pane));
  if (!panes.length) return null;
  const docked = params.get("dock") === "1" && panes.length > 1 ? panes.pop()! : null;
  const row = panes.slice(0, ROW_MAX);
  const all = [...row, ...(docked ? [docked] : [])];
  const focused = all[Number(params.get("focus")) || 0] ?? row[0]!;
  const what = params.get("summon");
  return {
    panes: Object.fromEntries(all.map((pane) => [pane.id, pane])), row: row.map((pane) => pane.id), dock: docked?.id ?? null,
    summon: what === "jbot" || what === "files" || what === "terminal" ? what : null, focus: focused.id, used: [focused.id],
  };
}

/** The layout with its history: `apply` records, `undo` and `redo` step, `replace` changes without a step (a tab
 *  switch, focus). */
export function createPaneStore(first: Layout) {
  const [layout, setLayout] = createSignal(first);
  const [past, setPast] = createSignal<Layout[]>([]);
  const [future, setFuture] = createSignal<Layout[]>([]);
  const apply = (change: (current: Layout) => Layout) => {
    const before = layout(), after = change(before);
    if (after === before) return false;
    batch(() => { setPast([...past().slice(-49), before]); setFuture([]); setLayout(after); });
    return true;
  };
  const replace = (change: (current: Layout) => Layout) => setLayout(change(layout()));
  const step = (from: () => Layout[], setFrom: (list: Layout[]) => void, to: () => Layout[], setTo: (list: Layout[]) => void) => {
    const list = from();
    const target = list.at(-1);
    if (!target) return false;
    batch(() => { setFrom(list.slice(0, -1)); setTo([...to(), layout()]); setLayout(target); });
    return true;
  };
  return {
    layout, apply, replace,
    undo: () => step(past, setPast, future, setFuture),
    redo: () => step(future, setFuture, past, setPast),
    canUndo: () => past().length > 0, canRedo: () => future().length > 0,
  };
}
