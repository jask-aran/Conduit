import { For, Show, splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Frost } from "./frost";
import { Button, Spinner } from "./controls";

/*
 * States: what a place says when it has nothing to show, is still loading, or has a line to add. One of each, its kind
 * the family it sits in (Empty's, Loading's and Notice's kinds are drawn in styles/state.css, a Note's in its family's stylesheet
 * under .ui-note[data-note]).
 */

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
  if (kind === "nav") return <div class="ui-loading" data-loading="nav" role="status" aria-label={props.label ?? "Loading"}><For each={Array.from({ length: props.rows ?? 0 })}>{() => <span />}</For></div>;
  if (kind === "earlier") return <div class="ui-loading" data-loading="earlier" role="status" aria-label={props.label}><Spinner /></div>;
  if (kind === "pane") return <Frost class="ui-loading" data-loading="pane" role="status">{props.children}</Frost>;
  if (kind === "browser") return <div class="ui-loading" data-loading="browser" role="status">{props.children}</div>;
  return <div class="ui-loading" data-loading="setting"><Spinner />{props.children}</div>;
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

/** Where a Notice sits: a pane's reading column (a warning's icon, a strong line and what it means, on a card ground),
 *  the sidebar's foot (an update: an icon or a spinner, a line, a small button), a tool's strip (a muted or warn line,
 *  its action a word), a header's note (a frost capsule, its action a smaller one inside). */
export type NoticeKind = "reading" | "nav" | "tool" | "header";
export type NoticeAction = { label: string; name?: string; busy?: boolean; busyLabel?: string; disabled?: boolean; quiet?: boolean; onClick: () => void };

/** A state worth a line where it sits: its icon, its line (title in reading, else children), what it means (children in
 *  reading), one action. busy: a spinner for the icon. ready: it waits on a person (full strength). tone warn: a
 *  tool's warning. live: said politely as it changes. hint: the whole, on hover. */
export function Notice(props: { kind?: NoticeKind; icon?: JSX.Element; title?: JSX.Element; busy?: boolean; ready?: boolean; tone?: "warn"; live?: boolean; hint?: string; action?: NoticeAction; children?: JSX.Element }) {
  const kind = props.kind ?? "reading";
  if (kind === "reading") return <div class="ui-notice" data-notice="reading" role="note">{props.icon}<div><strong>{props.title}</strong><Show when={props.children}><p>{props.children}</p></Show></div></div>;
  if (kind === "nav") return <div class="ui-notice" data-notice="nav" role="status" data-ready={props.ready ? "" : undefined}>
    <Show when={props.busy} fallback={props.icon}><Spinner /></Show>
    <span>{props.children}</span>
    <Show when={props.action}>{(action) => <Button size="sm" variant={action().quiet ? "ghost" : undefined} onClick={() => action().onClick()}>{action().label}</Button>}</Show>
  </div>;
  if (kind === "tool") return <div class="ui-notice" data-notice="tool" data-tone={props.tone} role={props.live ? "status" : undefined} aria-live={props.live ? "polite" : undefined}>
    {props.children}
    <Show when={props.action}>{(action) => <button type="button" disabled={action().disabled} onClick={() => action().onClick()}>{action().label}</button>}</Show>
  </div>;
  return <Frost as="span" class="ui-notice" data-notice="header" title={props.hint}>
    <span>{props.children}</span>
    <Show when={props.action}>{(action) =>
      <button type="button" tabIndex={-1} disabled={action().busy} aria-label={action().name ?? action().label} onClick={() => action().onClick()}>{action().busy ? action().busyLabel ?? action().label : action().label}</button>}
    </Show>
  </Frost>;
}
