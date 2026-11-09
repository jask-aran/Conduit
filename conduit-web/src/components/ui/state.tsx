import { For, Show, splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Frost } from "./frost";
import { Button, Spinner } from "./controls";

/* States: what a place says when it has nothing to show, is loading, or has a line to add; its kind the family it sits
   in (styles/state.css; a Note's in its family's stylesheet under .ui-note[data-note]). */

/** Where an Empty sits: a pane or tool (centred, quiet), a dashboard group, a source group, an overlay's list, the file
 *  browser, a glance, a file viewer's empty side, a client card's workspaces. */
export type EmptyKind = "pane" | "dash" | "change" | "overlay" | "browser" | "glance" | "file" | "client";
const EMPTY_ELEMENT: Record<EmptyKind, "div" | "p"> = { pane: "div", dash: "div", change: "div", overlay: "p", browser: "div", glance: "p", file: "div", client: "p" };

/** Nothing to show: one quiet line (or a centred block) in its place's voice. role: status or alert when it reports. */
export function Empty(props: JSX.HTMLAttributes<HTMLElement> & { kind?: EmptyKind; role?: "status" | "alert" }) {
  const [local, rest] = splitProps(props, ["kind", "class"]);
  const kind = () => local.kind ?? "pane";
  return <Dynamic component={EMPTY_ELEMENT[kind()]} {...(rest as Record<string, unknown>)} class="ui-empty" data-empty={kind()} />;
}

/** Where a Loading sits: a Settings page (a spinner and its words), a pane's corner (a frost capsule), the file browser,
 *  the sidebar's list (rows that have not arrived: its shape, still), a transcript's top (a spinner, centred). */
export type LoadingKind = "setting" | "pane" | "browser" | "nav" | "earlier";

/** Still loading: said as a status. rows: how many still rows a nav Loading draws. label: its name, when it has no words. */
export function Loading(props: { kind?: LoadingKind; rows?: number; label?: string; children?: JSX.Element }) {
  const kind = props.kind ?? "setting";
  return <Dynamic component={kind === "pane" ? Frost : "div"} class="ui-loading" data-loading={kind} role={kind === "setting" ? undefined : "status"}
    aria-label={kind === "nav" ? props.label ?? "Loading" : props.label}>
    <Show when={kind === "setting" || kind === "earlier"}><Spinner /></Show>
    <Show when={kind === "nav"} fallback={props.children}><For each={Array.from({ length: props.rows ?? 0 })}>{() => <span />}</For></Show>
  </Dynamic>;
}

/** Where a Note sits: under a setting, in a dashboard group, on a card, in a menu, in the sidebar, in a workbench's
 *  side, in the file browser, over a terminal's corner. */
export type NoteKind = "setting" | "dash" | "card" | "menu" | "nav" | "workbench" | "browser" | "term";

/** A line of prose: a quiet note, or what went wrong (tone error: said as an alert). */
export function Note(props: JSX.HTMLAttributes<HTMLElement> & { kind?: NoteKind; tone?: "quiet" | "error" }) {
  const [local, rest] = splitProps(props, ["kind", "tone", "class"]);
  const kind = () => local.kind ?? "setting";
  const error = () => local.tone === "error" || kind() === "browser" || kind() === "term";
  return <Dynamic component={kind() === "nav" ? "div" : "p"} role={error() ? "alert" : undefined} {...(rest as Record<string, unknown>)}
    class="ui-note" data-note={kind()} data-tone={kind() === "setting" ? local.tone ?? "quiet" : undefined}
    data-error={kind() !== "setting" && local.tone === "error" ? "" : undefined} />;
}

/** Where a Notice sits: a reading column (on a card ground), the sidebar's foot, a tool's strip, beside a header's title
 *  (a frost capsule). */
export type NoticeKind = "reading" | "nav" | "tool" | "header";
export type NoticeAction = { label: string; name?: string; busy?: boolean; busyLabel?: string; disabled?: boolean; quiet?: boolean; onClick: () => void };

/** A line worth saying where it sits, with one action: busy, a spinner for its icon; ready, it waits on a person; live,
 *  said politely as it changes; hint, the whole on hover. In reading, title is the line and children what it means. */
export function Notice(props: { kind?: NoticeKind; icon?: JSX.Element; title?: JSX.Element; busy?: boolean; ready?: boolean; tone?: "warn"; live?: boolean; hint?: string; action?: NoticeAction; children?: JSX.Element }) {
  const kind = props.kind ?? "reading";
  const act = (action: NoticeAction) => kind === "nav"
    ? <Button size="sm" variant={action.quiet ? "ghost" : undefined} onClick={() => action.onClick()}>{action.label}</Button>
    : <button type="button" tabIndex={kind === "header" ? -1 : undefined} disabled={action.busy || action.disabled} aria-label={kind === "header" ? action.name ?? action.label : undefined}
      onClick={() => action.onClick()}>{action.busy ? action.busyLabel ?? action.label : action.label}</button>;
  return <Dynamic component={kind === "header" ? Frost : "div"} as={kind === "header" ? "span" : undefined} class="ui-notice" data-notice={kind} title={props.hint}
    role={kind === "reading" ? "note" : kind === "nav" || props.live ? "status" : undefined} aria-live={props.live ? "polite" : undefined}
    data-ready={props.ready ? "" : undefined} data-tone={props.tone}>
    <Show when={props.busy} fallback={props.icon}><Spinner /></Show>
    {kind === "reading" ? <div><strong>{props.title}</strong><Show when={props.children}><p>{props.children}</p></Show></div> : kind === "tool" ? props.children : <span>{props.children}</span>}
    <Show when={props.action} keyed>{(action) => act(action)}</Show>
  </Dynamic>;
}
