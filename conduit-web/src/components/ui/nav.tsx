import { dragRegion } from "./window";
import * as Icons from "./icons";
import { createEffect, on, Show, splitProps, type JSX } from "solid-js";

import { Spinner } from "./controls";
import { haptic } from "./haptics";
import { Expand } from "./expand";
import { cn } from "@/lib/utils";
import { Row, type RowProps } from "./row";
import { Loading } from "./state";

/** The drawer's next change, already felt as a finger carried it past (drawer-swipe.ts), plays no haptic of its own. */
let drawerFeltAhead = false;
export function feelDrawerAhead() { drawerFeltAhead = true; }

export function NavPane(props: JSX.HTMLAttributes<HTMLElement> & { collapsed?: boolean; folded?: boolean; instant?: boolean; drawer?: "open" | "shut"; head: JSX.Element; foot?: JSX.Element; listRef?: (element: HTMLDivElement) => void; ref?: (element: HTMLElement) => void }) {
  const [local, rest] = splitProps(props, ["collapsed", "folded", "instant", "drawer", "head", "foot", "listRef", "children", "class"]);
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

export const NavBrand = (props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { name: string }) => {
  const [local, rest] = splitProps(props, ["name"]);
  return <button type="button" {...rest} class="ui-nav-brand"><span>{local.name}</span></button>;
};


/** A div, so a menu's trigger can hold both the link and the chevron. */
export function NavFolderRow(props: JSX.HTMLAttributes<HTMLDivElement> & { icon: JSX.Element; mark?: JSX.Element; meta?: JSX.Element; open: boolean; current?: boolean; within?: boolean;
  link: JSX.ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string | undefined>; toggle: JSX.ButtonHTMLAttributes<HTMLButtonElement> }) {
  const [local, rest] = splitProps(props, ["icon", "mark", "meta", "open", "current", "within", "link", "toggle", "children", "class"]);
  return <Row density="nav" {...(rest as unknown as RowProps)} class="ui-nav-folder" data-folder-open={local.open ? "" : undefined} open={local.open} current={local.current} within={local.within}
    lead={local.icon} meta={local.meta}
    label={<button type="button" {...local.link} class="ui-nav-link">{local.mark}<span class="ui-nav-link-name">{local.children}</span></button>}
    end={<button type="button" tabIndex={-1} aria-expanded={local.open} {...local.toggle} class="ui-nav-toggle"><Icons.ChevronRight class="ui-fold-chevron" /></button>} />;
}

export function NavFolder(props: { open: boolean; row: JSX.Element; children: JSX.Element }) {
  return <div class="ui-nav-folder-block">
    {props.row}
    <Expand open={props.open} class="ui-nav-folder-body">{props.children}</Expand>
  </div>;
}

/** It scrolls with the list, so it grows without moving the head. */
export const NavLead = (props: { server: JSX.Element; actions: JSX.Element; children?: JSX.Element }) =>
  <div class="ui-nav-lead"><div class="ui-nav-lead-line">{props.server}<div class="ui-nav-lead-actions">{props.actions}</div></div>{props.children}</div>;


export const NavSkeleton = (props: { rows: number }) => <Loading kind="nav" rows={props.rows} />;

export const NavRail = (props: { label: string; children: JSX.Element }) => <div class="ui-nav-rail" aria-label={props.label}>{props.children}</div>;
export const NavRailSection = (props: { children: JSX.Element }) => <div class="ui-nav-rail-section">{props.children}</div>;

export type StatusTone = "success" | "active" | "warn" | "danger" | "muted" | "unread";
export function StatusDot(props: JSX.HTMLAttributes<HTMLSpanElement> & { label: string; tone?: StatusTone; spinning?: boolean; stale?: boolean }) {
  const [local, rest] = splitProps(props, ["label", "tone", "spinning", "stale", "class"]);
  return <span role="status" {...rest} class="ui-status ui-size-icon" aria-label={local.label} data-tone={local.tone ?? "muted"} data-stale={local.stale ? "" : undefined}>
    <Show when={local.spinning} fallback={<Dot />}><Spinner /></Show></span>;
}
export function Dot(props: JSX.HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone }) {
  const [local, rest] = splitProps(props, ["tone", "class"]);
  return <span aria-hidden={rest["aria-label"] ? undefined : "true"} {...rest} class={cn("ui-status-dot", local.class)} data-tone={local.tone} />;
}
