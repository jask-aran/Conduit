import { dragRegion } from "./window";
import * as Icons from "./icons";
import { createEffect, For, on, Show, splitProps, type JSX } from "solid-js";

import { Button, Spinner } from "./controls";
import { haptic } from "./haptics";
import { Expand } from "./expand";
import { Row, type RowProps } from "./row";

/*
 * Nav: the sidebar's pieces, on the frame (DESIGN Interaction, List row). Rows rest grey; the cursor (pointer,
 * keyboard focus, a press, a held focus, a selection) is the wash and white; where you are is white at the
 * current weight with no fill, and so is the folder holding it. The keys that move the cursor are the caller's
 * (navigation/sidebar-cursor.ts); these draw what it lands on. The pane marks `data-keyboard-cursor` while the
 * keyboard moves it, and a row under a still pointer then rests.
 */

/** The sidebar itself: a head, the list and a foot. collapsed: the narrow rail's width (its edge moves with
 *  --panel-motion; instant: at once); folded: drawn as the rail, the list's rows away and its RailButtons shown
 *  (set once the edge has moved); drawer: a phone's, under the page, open or shut. */
/** The drawer's next open or shut was already felt as a finger carried it past where it lands (drawer-swipe.ts):
 *  that change plays no haptic of its own. */
let drawerFeltAhead = false;
export function feelDrawerAhead() { drawerFeltAhead = true; }

export function NavPane(props: JSX.HTMLAttributes<HTMLElement> & { collapsed?: boolean; folded?: boolean; instant?: boolean; drawer?: "open" | "shut"; head: JSX.Element; foot?: JSX.Element; listRef?: (element: HTMLDivElement) => void; ref?: (element: HTMLElement) => void }) {
  const [local, rest] = splitProps(props, ["collapsed", "folded", "instant", "drawer", "head", "foot", "listRef", "children", "class"]);
  // The drawer opening and shutting are felt after a touch (its toggle or a swipe; a swipe, a tap outside it or on a row).
  createEffect(on(() => local.drawer, (drawer, was) => {
    if (drawerFeltAhead) { drawerFeltAhead = false; return; }
    if (was === "open" && drawer === "shut") haptic("dismiss");
    else if (was === "shut" && drawer === "open") haptic("open");
  }, { defer: true }));
  return <aside {...rest} class="ui-nav-pane" data-surface="frame" data-collapsed={local.collapsed ? "" : undefined} data-folded={local.folded ? "" : undefined}
    data-instant={local.instant ? "" : undefined} data-drawer={local.drawer}>
    <div class="ui-nav-pane-body">
      <div class="ui-nav-head" data-tauri-drag-region={dragRegion()}>{local.head}</div>
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


/** A folder's row: its link (icon, a mark such as unread, the name, a muted meta such as "Cloning…") and the chevron
 *  that opens it. The chevron is out of the tab order: → and ← press it. The row is a div so a menu's trigger can hold both. */
export function NavFolderRow(props: JSX.HTMLAttributes<HTMLDivElement> & { icon: JSX.Element; mark?: JSX.Element; meta?: JSX.Element; open: boolean; current?: boolean; within?: boolean;
  link: JSX.ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string | undefined>; toggle: JSX.ButtonHTMLAttributes<HTMLButtonElement> }) {
  const [local, rest] = splitProps(props, ["icon", "mark", "meta", "open", "current", "within", "link", "toggle", "children", "class"]);
  return <Row density="nav" bare {...(rest as unknown as RowProps)} class="ui-nav-folder" data-folder-open={local.open ? "" : undefined} open={local.open} current={local.current} within={local.within}>
    <button type="button" {...local.link} class="ui-nav-link"><span class="ui-row-lead">{local.icon}</span>{local.mark}<span class="ui-row-title">{local.children}</span><Show when={local.meta}><small class="ui-row-meta">{local.meta}</small></Show></button>
    <button type="button" tabIndex={-1} aria-expanded={local.open} {...local.toggle} class="ui-nav-toggle"><Icons.ChevronRight class="ui-fold-chevron" /></button>
  </Row>;
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


/** Rows that have not arrived: the shape of a list, still. */
export const NavSkeleton = (props: { rows: number }) => <div class="ui-nav-skeleton" role="status" aria-label="Loading">
  <For each={Array.from({ length: props.rows })}>{() => <span />}</For>
</div>;

/** The narrow rail's buttons, shown only while the pane is folded; sections of them sit under a hairline gap. */
export const NavRail = (props: { label: string; children: JSX.Element }) => <div class="ui-nav-rail" aria-label={props.label}>{props.children}</div>;
export const NavRailSection = (props: { children: JSX.Element }) => <div class="ui-nav-rail-section">{props.children}</div>;
/** One of the rail's buttons: an icon; current as a row is; live: a dot at its corner (something works there). */

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
