import { dragRegion } from "./window";
import * as Icons from "./icons";
import { createEffect, For, on, Show, splitProps, type JSX } from "solid-js";

import { Button, Spinner } from "./controls";
import { haptic } from "./haptics";
import { Expand } from "./expand";
import { cn } from "@/lib/utils";
import { Row, type RowProps } from "./row";
import { Loading, Notice } from "./state";

/* Nav: the sidebar's pieces, on the frame (DESIGN Interaction, List row). The cursor is the wash and white; where you
   are (and its folder) is white with no fill. The keys are the caller's (navigation/sidebar-cursor.ts); while they move
   it the pane marks `data-keyboard-cursor`, and a row under a still pointer rests. */

/** The sidebar: head, list, foot. collapsed: the rail's width (instant: at once); folded: drawn as the rail with its
 *  RailButtons (set once the edge has moved); drawer: a phone's, under the page. The drawer's next change, already
 *  felt as a finger carried it past (drawer-swipe.ts), plays no haptic of its own. */
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


/** A folder's row: its link (icon, mark, name, meta such as "Cloning…") and the chevron, out of the tab order (→ and ←
 *  press it). A div, so a menu's trigger can hold both. */
export function NavFolderRow(props: JSX.HTMLAttributes<HTMLDivElement> & { icon: JSX.Element; mark?: JSX.Element; meta?: JSX.Element; open: boolean; current?: boolean; within?: boolean;
  link: JSX.ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string | undefined>; toggle: JSX.ButtonHTMLAttributes<HTMLButtonElement> }) {
  const [local, rest] = splitProps(props, ["icon", "mark", "meta", "open", "current", "within", "link", "toggle", "children", "class"]);
  // The link is stretched over the whole row (its icon and meta are the link's too); the chevron sits above it.
  return <Row density="nav" {...(rest as unknown as RowProps)} class="ui-nav-folder" data-folder-open={local.open ? "" : undefined} open={local.open} current={local.current} within={local.within}
    lead={local.icon} meta={local.meta}
    label={<button type="button" {...local.link} class="ui-nav-link">{local.mark}<span class="ui-nav-link-name">{local.children}</span></button>}
    end={<button type="button" tabIndex={-1} aria-expanded={local.open} {...local.toggle} class="ui-nav-toggle"><Icons.ChevronRight class="ui-fold-chevron" /></button>} />;
}

/** A folder: its row, then its rows, which slide open and shut (Expand). Shut, nothing stays in the document. */
export function NavFolder(props: { open: boolean; row: JSX.Element; children: JSX.Element }) {
  return <div class="ui-nav-folder-block">
    {props.row}
    <Expand open={props.open} class="ui-nav-folder-body">{props.children}</Expand>
  </div>;
}

/** A phone's first lines of the list: the server switcher beside New chat, search and the palette, then what the server
 *  says (an update). It scrolls with the list, so it grows without moving the head; not an arrow stop. */
export const NavLead = (props: { server: JSX.Element; actions: JSX.Element; children?: JSX.Element }) =>
  <div class="ui-nav-lead"><div class="ui-nav-lead-line">{props.server}<div class="ui-nav-lead-actions">{props.actions}</div></div>{props.children}</div>;


/** Rows that have not arrived: a nav Loading. */
export const NavSkeleton = (props: { rows: number }) => <Loading kind="nav" rows={props.rows} />;

/** The narrow rail's buttons, shown only while the pane is folded; sections of them sit under a hairline gap. */
export const NavRail = (props: { label: string; children: JSX.Element }) => <div class="ui-nav-rail" aria-label={props.label}>{props.children}</div>;
export const NavRailSection = (props: { children: JSX.Element }) => <div class="ui-nav-rail-section">{props.children}</div>;
/** One of the rail's buttons: an icon; current as a row is; live: a dot at its corner (something works there). */

/** A state the app is in about itself, above the foot's server (an update); ready: it waits on a person, at full strength. */

/** A label and its links as icons (the installers). */
export type StatusTone = "success" | "active" | "warn" | "danger" | "muted" | "unread";
/** A row's live state in an --icon slot: a dot in its tone, or a Spinner while it works; stale: it may be out of date. */
export function StatusDot(props: JSX.HTMLAttributes<HTMLSpanElement> & { label: string; tone?: StatusTone; spinning?: boolean; stale?: boolean }) {
  const [local, rest] = splitProps(props, ["label", "tone", "spinning", "stale", "class"]);
  return <span role="status" {...rest} class="ui-status ui-size-icon" aria-label={local.label} data-tone={local.tone ?? "muted"} data-stale={local.stale ? "" : undefined}>
    <Show when={local.spinning} fallback={<Dot />}><Spinner /></Show></span>;
}
/** A StatusDot's dot alone, beside what it marks; hidden from readers unless it carries a label. */
export function Dot(props: JSX.HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone }) {
  const [local, rest] = splitProps(props, ["tone", "class"]);
  return <span aria-hidden={rest["aria-label"] ? undefined : "true"} {...rest} class={cn("ui-status-dot", local.class)} data-tone={local.tone} />;
}
