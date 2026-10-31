import * as Icons from "./icons";
import { createEffect, createSignal, For, on, onCleanup, Show, splitProps, type JSX } from "solid-js";

import { Button, Spinner } from "./controls";
import { haptic } from "./haptics";
import { Expand } from "./expand";

/*
 * Nav: the sidebar's pieces, on the frame (DESIGN Interaction, List row). Rows rest grey; the cursor (pointer,
 * keyboard focus, a press, a held focus, a selection) is the wash and white; where you are is white at the
 * current weight with no fill, and so is the folder holding it. The keys that move the cursor are the caller's
 * (navigation/sidebar-cursor.ts); these draw what it lands on. The pane marks `data-keyboard-cursor` while the
 * keyboard moves it, and a row under a still pointer then rests.
 */

/** The sidebar itself: a head, the list and a foot. collapsed: the narrow rail's width (its edge moves with
 *  --panel-motion; instant: at once); folded: drawn as the rail, the list's rows away and its RailButtons shown
 *  (set once the edge has moved); drawer: a phone's, over the page, open or shut. */
export function NavPane(props: JSX.HTMLAttributes<HTMLElement> & { collapsed?: boolean; folded?: boolean; instant?: boolean; drawer?: "open" | "shut"; head: JSX.Element; foot?: JSX.Element; listRef?: (element: HTMLDivElement) => void; ref?: (element: HTMLElement) => void }) {
  const [local, rest] = splitProps(props, ["collapsed", "folded", "instant", "drawer", "head", "foot", "listRef", "children", "class"]);
  // The drawer shutting is an overlay closing: felt after a touch (a swipe, a tap outside it or on a row).
  createEffect(on(() => local.drawer, (drawer, was) => { if (was === "open" && drawer === "shut") haptic("dismiss"); }, { defer: true }));
  return <aside {...rest} class="ui-nav-pane" data-surface="frame" data-collapsed={local.collapsed ? "" : undefined} data-folded={local.folded ? "" : undefined}
    data-instant={local.instant ? "" : undefined} data-drawer={local.drawer}>
    <div class="ui-nav-pane-body">
      <div class="ui-nav-head">{local.head}</div>
      <div class="ui-nav-list" ref={local.listRef}>{local.children}</div>
      <Show when={local.foot}><div class="ui-nav-foot">{local.foot}</div></Show>
    </div>
  </aside>;
}

/** The wordmark, which goes home. */
export const NavBrand = (props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { name: string }) => {
  const [local, rest] = splitProps(props, ["name"]);
  return <button type="button" {...rest} class="ui-nav-brand"><span>{local.name}</span></button>;
};

/** A group of nav rows (the sidebar's), with its label. */
/**
 * A titled run of rows. `away`: what they are on is not there now (a client offline): said after the label, the rows
 * faint but still open (a chat's history is the hub's), as `away` names it ("Offline since 14:02").
 */
export function NavGroup(props: { label?: string; away?: string; children: JSX.Element }) {
  return <section class="ui-nav-group" data-away={props.away ? "" : undefined}>
    <Show when={props.label}><div class="ui-nav-label">{props.label}<Show when={props.away}><span class="ui-nav-away">{props.away}</span></Show></div></Show>
    {props.children}
  </section>;
}

type RowState = {
  icon?: JSX.Element;
  /** Under the row it belongs to (a chat under its folder); 2: under one of those (a folder under a device's client). */
  indent?: boolean | 2;
  /** Where you are. */
  current?: boolean;
  /** Holds where you are (a folder holding the open chat): drawn as current. */
  within?: boolean;
  /** Open, but not where you are (the chat in the other pane): white at the resting weight. */
  open?: boolean;
  /** Chosen for an action on several: the wash. */
  selected?: boolean;
  /** A second, muted line under the label. */
  detail?: JSX.Element;
  /** Muted at the end (a count). */
  meta?: JSX.Element;
  /** A mark at the end, in a control's room (an external link, a status). */
  end?: JSX.Element;
  /** Smaller and quieter: a row that leads elsewhere ("View all"). */
  quiet?: boolean;
};
const rowData = (props: RowState) => ({
  "data-indent": props.indent === 2 ? "2" : props.indent ? "" : undefined, "aria-current": props.current ? "page" as const : undefined, "data-within": props.within ? "" : undefined,
  "data-open": props.open ? "" : undefined, "data-selected": props.selected ? "" : undefined, "data-quiet": props.quiet ? "" : undefined,
});
const ROW_PARTS = ["icon", "indent", "current", "within", "open", "selected", "detail", "meta", "end", "quiet", "children", "class"] as const;

/** A nav row: icon, label (and a detail under it), meta or an end mark. A button, so a menu's trigger can be one. */
export function NavRow(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & RowState) {
  const [local, rest] = splitProps(props, ROW_PARTS);
  return <button type="button" {...rest} class="ui-nav-row" {...rowData(local)}>
    <Show when={local.icon}><span class="ui-nav-icon">{local.icon}</span></Show>
    <Show when={local.detail} fallback={<span class="ui-nav-text">{local.children}</span>}>
      <span class="ui-nav-text" data-stacked=""><span>{local.children}</span><small>{local.detail}</small></span>
    </Show>
    <Show when={local.meta}><small class="ui-nav-meta">{local.meta}</small></Show>
    <Show when={local.end}><span class="ui-nav-end">{local.end}</span></Show>
  </button>;
}

/** A row that is not a button, so it can hold controls of its own at its end: a device's client with its actions,
 *  a setting inside a tree. Laid out as a NavRow, the controls where its end mark would be. */
export function NavLine(props: JSX.HTMLAttributes<HTMLDivElement> & RowState) {
  const [local, rest] = splitProps(props, ROW_PARTS);
  return <div {...rest} class="ui-nav-row ui-nav-line" {...rowData(local)}>
    <Show when={local.icon}><span class="ui-nav-icon">{local.icon}</span></Show>
    <span class="ui-nav-text">{local.children}</span>
    <Show when={local.meta}><small class="ui-nav-meta">{local.meta}</small></Show>
    <Show when={local.end}><span class="ui-nav-controls">{local.end}</span></Show>
  </div>;
}

/** A folder's row: its link (icon, a mark such as unread, the name, a muted meta such as "Cloning…") and the chevron
 *  that opens it. The chevron is out of the tab order: → and ← press it. The row is a div so a menu's trigger can hold both. */
export function NavFolderRow(props: JSX.HTMLAttributes<HTMLDivElement> & { icon: JSX.Element; mark?: JSX.Element; meta?: JSX.Element; open: boolean; current?: boolean; within?: boolean;
  link: JSX.ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string | undefined>; toggle: JSX.ButtonHTMLAttributes<HTMLButtonElement> }) {
  const [local, rest] = splitProps(props, ["icon", "mark", "meta", "open", "current", "within", "link", "toggle", "children", "class"]);
  return <div {...rest} class="ui-nav-row ui-nav-folder" data-folder-open={local.open ? "" : undefined} {...rowData(local)}>
    <button type="button" {...local.link} class="ui-nav-link"><span class="ui-nav-icon">{local.icon}</span>{local.mark}<span class="ui-nav-text">{local.children}</span><Show when={local.meta}><small class="ui-nav-meta">{local.meta}</small></Show></button>
    <button type="button" tabIndex={-1} aria-expanded={local.open} {...local.toggle} class="ui-nav-toggle"><Icons.ChevronRight /></button>
  </div>;
}

/** A folder: its row, then its rows, which slide open and shut (Expand). Shut, nothing stays in the document. */
export function NavFolder(props: { open: boolean; row: JSX.Element; children: JSX.Element }) {
  return <div class="ui-nav-folder-block">
    {props.row}
    <Expand open={props.open} class="ui-nav-folder-body">{props.children}</Expand>
  </div>;
}

/** What a list says when it has nothing: one muted line. */
/** A phone's first lines of the list, on its ground: the server it is on (its switcher) with the actions a phone
 *  reaches from the sidebar beside it (New chat, search, the palette), then what the server has to say (an update).
 *  It scrolls with the list, so it grows without moving the head; it is not one of the list's arrow stops. */
export const NavLead = (props: { server: JSX.Element; actions: JSX.Element; children?: JSX.Element }) =>
  <div class="ui-nav-lead"><div class="ui-nav-lead-line">{props.server}<div class="ui-nav-lead-actions">{props.actions}</div></div>{props.children}</div>;

export const NavNote = (props: { children: JSX.Element }) => <div class="ui-nav-note">{props.children}</div>;

/** Rows that have not arrived: the shape of a list, still. */
export const NavSkeleton = (props: { rows: number }) => <div class="ui-nav-skeleton" role="status" aria-label="Loading">
  <For each={Array.from({ length: props.rows })}>{() => <span />}</For>
</div>;

/** The narrow rail's buttons, shown only while the pane is folded; sections of them sit under a hairline gap. */
export const NavRail = (props: { label: string; children: JSX.Element }) => <div class="ui-nav-rail" aria-label={props.label}>{props.children}</div>;
export const NavRailSection = (props: { children: JSX.Element }) => <div class="ui-nav-rail-section">{props.children}</div>;
/** One of the rail's buttons: an icon; current as a row is; live: a dot at its corner (something works there). */
export function RailButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { current?: boolean; live?: boolean }) {
  const [local, rest] = splitProps(props, ["current", "live", "class"]);
  return <button type="button" {...rest} class="ui-rail-button" aria-current={local.current ? "page" : undefined} data-live={local.live ? "" : undefined} />;
}

/** A state the app is in about itself, above the foot's server (an update): an icon, a line, one action. ready: it waits on a person, so it reads at full strength. */
export function NavNotice(props: { icon?: JSX.Element; busy?: boolean; ready?: boolean; action?: { label: string; onClick: () => void; quiet?: boolean }; children: JSX.Element }) {
  return <div class="ui-nav-notice" role="status" data-ready={props.ready ? "" : undefined}>
    <Show when={props.busy} fallback={props.icon}><Spinner /></Show>
    <span>{props.children}</span>
    <Show when={props.action}>{(action) => <Button size="sm" variant={action().quiet ? "ghost" : undefined} onClick={() => action().onClick()}>{action().label}</Button>}</Show>
  </div>;
}

/** A label and its links as icons (the installers). */
export type StatusTone = "success" | "active" | "warn" | "danger" | "muted" | "unread";
/** A row's live state in an --icon slot: a dot in its tone, or a Spinner while it works; stale: it may be out of date. */
export function StatusDot(props: JSX.HTMLAttributes<HTMLSpanElement> & { label: string; tone?: StatusTone; spinning?: boolean; stale?: boolean }) {
  const [local, rest] = splitProps(props, ["label", "tone", "spinning", "stale", "class"]);
  return <span role="status" {...rest} class="ui-status" aria-label={local.label} data-tone={local.tone ?? "muted"} data-stale={local.stale ? "" : undefined}>
    <Show when={local.spinning} fallback={<span class="ui-status-dot" aria-hidden="true" />}><Spinner /></Show></span>;
}
