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
/** `recent`: the tabs shown, last first, so closing the shown tab goes back to the one before it. */
export type Pane = { id: string; views: View[]; active: number; recent?: View[] };
export type Summon = "jbot" | "files" | "terminal";
export type Layout = { panes: Record<string, Pane>; row: string[]; dock: string | null; summon: Summon | null; focus: string; used: string[] };
/** How a view was asked for: `beside` (Alt) opens a pane beside, `tab` (Ctrl) adds a session tab; neither replaces. */
export type Verb = { beside?: boolean; tab?: boolean };

export const ROW_MAX = 3;
export const TAB_CAP = 5;

/** The new-chat pages (the dashboard, a project's page) are a chat not yet begun, so they are session tabs too. */
export const sessionView = (view: View) => view === "home" || view === "page:jbot" || view === "page:dashboard" || view.startsWith("page:project:") || view.startsWith("chat:") || view.startsWith("term:");
export const kindOf = (pane: Pane): PaneKind => pane.views.every(sessionView) ? "session" : "document";
export const shownView = (pane: Pane) => pane.views[pane.active] ?? pane.views[0]!;
const showing = (pane: Pane, index: number): Pane => ({ ...pane, active: index, recent: [pane.views[index]!, ...(pane.recent ?? [shownView(pane)]).filter((view) => view !== pane.views[index] && pane.views.includes(view))] });

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

/** Where a view already stands, if anywhere: a view is open once (the launcher excepted). */
export function findView(layout: Layout, view: View) {
  if (view === "home") return null;
  for (const id of placed(layout)) {
    const index = layout.panes[id]!.views.indexOf(view);
    if (index >= 0) return { id, index };
  }
  return null;
}

/** What a caller knows that views alone do not: `held` tabs (a draft) are never dropped. */
export type Rules = { held?: (view: View) => boolean };

/** The session pane a Ctrl-opened tab joins: the focused one, else the one used last, else the nearest in the row (a
 *  restored layout has used only the focused pane). */
function sessionPaneFor(layout: Layout) {
  const at = Math.max(0, layout.row.indexOf(layout.focus));
  const near = [...layout.row].sort((a, b) => Math.abs(layout.row.indexOf(a) - at) - Math.abs(layout.row.indexOf(b) - at));
  return [...layout.used, ...near].find((id) => kindOf(layout.panes[id]!) === "session");
}

/** Adds a tab, dropping the least recently shown one that has no draft. */
function withTab(pane: Pane, view: View, held: (view: View) => boolean = () => false): Pane {
  let views = [...pane.views, view];
  if (views.length > TAB_CAP) {
    const recent = pane.recent ?? [];
    const drop = [...pane.views.filter((other) => !recent.includes(other)), ...[...recent].reverse()].find((other) => pane.views.includes(other) && other !== shownView(pane) && !held(other));
    if (drop) views = views.filter((other) => other !== drop);
  }
  return showing({ ...pane, views }, views.length - 1);
}

export function open(layout: Layout, view: View, verb: Verb = {}, rules: Rules = {}): Layout {
  const at = findView(layout, view);
  if (at) return focusing(withPane(layout, showing(layout.panes[at.id]!, at.index)), at.id);
  if (verb.tab && sessionView(view)) {
    const target = sessionPaneFor(layout);
    if (target) return focusing(withPane(layout, withTab(layout.panes[target]!, view, rules.held)), target);
  }
  if (verb.beside || verb.tab) {
    const pane = paneOf([view]);
    const after = layout.row.indexOf(layout.focus);
    // A tab with no session pane to join is a session pane of its own, given the keyboard as a joined tab would be.
    const placing = (next: Layout) => verb.beside ? next : focusing(next, pane.id);
    if (layout.row.length < ROW_MAX) {
      const row = [...layout.row];
      row.splice(after < 0 ? row.length : after + 1, 0, pane.id);
      return placing({ ...withPane(layout, pane), row });
    }
    // A full row: beside means the neighbour, replaced.
    const neighbour = layout.row[after + 1] ?? layout.row[after - 1] ?? layout.row[0]!;
    return placing({ ...withPane(dropPane(layout, neighbour), pane), row: layout.row.map((id) => id === neighbour ? pane.id : id) });
  }
  // Plain replaces what the focused pane shows, whatever kind it is, keeping its place and id.
  return withPane(layout, paneOf([view], 0, layout.focus));
}

/** Changes what one pane shows in place, without the verbs: a file column, a mode, a page turning into its chat. A
 *  session pane keeps its other tabs while the view is a session view; anything else stands alone. */
export function show(layout: Layout, id: string, view: View): Layout {
  const pane = layout.panes[id];
  if (!pane) return layout;
  const index = pane.views.indexOf(view);
  if (index >= 0) return index === pane.active ? layout : withPane(layout, showing(pane, index));
  if (!sessionView(view) || kindOf(pane) !== "session") return withPane(layout, paneOf([view], 0, id));
  return withPane(layout, showing({ ...pane, views: pane.views.map((other, at) => at === pane.active ? view : other) }, pane.active));
}

/** A new pane in the row at `at`, as a drop on a pane's edge makes it; nothing when the row is full. */
export function place(layout: Layout, view: View, at: number): Layout {
  if (layout.row.length >= ROW_MAX) return layout;
  const pane = paneOf([view]);
  const row = [...layout.row];
  row.splice(Math.max(0, Math.min(at, row.length)), 0, pane.id);
  return focusing({ ...withPane(layout, pane), row }, pane.id);
}

/** Moves some of a pane's tabs to another pane (`to` an id) or to a new pane in the row at `to` (an index). */
export function moveViews(layout: Layout, from: string, views: View[], to: string | number): Layout {
  const source = layout.panes[from];
  if (!source || (typeof to === "number" && layout.row.length >= ROW_MAX) || to === from) return layout;
  const moving = source.views.filter((view) => views.includes(view));
  if (!moving.length) return layout;
  const shown = shownView(source);
  const left = source.views.filter((view) => !moving.includes(view));
  let next = left.length ? withPane(layout, { ...source, views: left, active: Math.max(0, left.indexOf(shown)) }) : layout;
  if (typeof to === "number") {
    const pane = paneOf(moving, moving.length - 1);
    const row = [...next.row];
    row.splice(Math.max(0, Math.min(to, row.length)), 0, pane.id);
    next = focusing({ ...withPane(next, pane), row }, pane.id);
  } else {
    const target = next.panes[to];
    if (!target) return layout;
    const joined = [...target.views, ...moving].slice(-TAB_CAP);
    next = focusing(withPane(next, { ...target, views: joined, active: joined.length - 1 }), to);
  }
  return left.length ? next : closePane(next, from);
}

/** `next` with `current`'s pane ids where the same place holds a pane, so a restored layout keeps each pane's state. */
export function adopt(current: Layout, next: Layout): Layout {
  const was = placed(current), now = placed(next);
  const ids = new Map(now.map((id, index) => [id, was[index] ?? id]));
  const rename = (id: string) => ids.get(id) ?? id;
  return {
    panes: Object.fromEntries(Object.values(next.panes).map((pane) => [rename(pane.id), { ...pane, id: rename(pane.id) }])),
    row: next.row.map(rename), dock: next.dock && rename(next.dock), summon: next.summon, focus: rename(next.focus), used: next.used.map(rename),
  };
}

export const switchTab = (layout: Layout, id: string, index: number): Layout => focusing(withPane(layout, showing(layout.panes[id]!, index)), id);

export function closeTab(layout: Layout, id: string, index: number): Layout {
  const pane = layout.panes[id]!;
  if (pane.views.length <= 1) return closePane(layout, id);
  const views = pane.views.filter((_, at) => at !== index);
  const shown = index === pane.active ? pane.recent?.find((view) => views.includes(view)) ?? views[Math.min(index, views.length - 1)]! : shownView(pane);
  return withPane(layout, { ...pane, views, active: views.indexOf(shown), recent: pane.recent?.filter((view) => views.includes(view)) });
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
    /** The layout undo (-1) or redo (1) would show. */
    target: (step: -1 | 1) => (step < 0 ? past() : future()).at(-1),
    /** The last step starts from `first`: a change made in parts undoes as one. */
    amend: (first: Layout) => setPast([...past().slice(0, -1), first]),
  };
}
