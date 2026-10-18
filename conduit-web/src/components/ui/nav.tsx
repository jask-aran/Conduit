import { Show, type JSX } from "solid-js";
import { Spinner } from "./controls";

/** A group of nav rows (the sidebar's), with its label. */
export function NavGroup(props: { label?: string; children: JSX.Element }) {
  return <section class="ui-nav-group"><Show when={props.label}><div class="ui-nav-label">{props.label}</div></Show>{props.children}</section>;
}

/** A nav row: icon, label, an optional toggle at the end; indent under the row it belongs to. */
export function NavRow(props: { icon?: JSX.Element; indent?: boolean; current?: boolean; toggle?: JSX.Element; onClick?: () => void; children: JSX.Element }) {
  return <div role="link" class="ui-nav-row" data-indent={props.indent ? "" : undefined} aria-current={props.current ? "page" : undefined} onClick={props.onClick}>
    <Show when={props.icon}><span class="ui-nav-icon">{props.icon}</span></Show><span>{props.children}</span>
    <Show when={props.toggle}><span class="ui-nav-toggle">{props.toggle}</span></Show>
  </div>;
}

export type StatusTone = "success" | "active" | "warn" | "danger" | "muted" | "unread";
/** A row's live state in an --icon slot: a dot in its tone, or a Spinner while it works; stale: it may be out of date. */
export function StatusDot(props: { label: string; tone?: StatusTone; spinning?: boolean; stale?: boolean }) {
  return <span class="ui-status" role="status" aria-label={props.label} data-tone={props.tone ?? "muted"} data-stale={props.stale ? "" : undefined}>
    <Show when={props.spinning} fallback={<span class="ui-status-dot" aria-hidden="true" />}><Spinner /></Show></span>;
}
