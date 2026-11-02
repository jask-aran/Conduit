import { splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Frost } from "./frost";
import { Spinner } from "./controls";

/*
 * States: what a place says when it has nothing to show, is still loading, or has a line to add. One of each, its kind
 * the family it sits in (each kind's look stays in that family's stylesheet, under .ui-empty[data-empty],
 * .ui-loading[data-loading] and .ui-note[data-note]).
 */

/** Where an Empty sits: a pane or tool (centred, quiet), a dashboard group, a source group, an overlay's list, the file
 *  browser, a glance, a file viewer's empty side. */
export type EmptyKind = "pane" | "dash" | "change" | "overlay" | "browser" | "glance" | "file";
const EMPTY_ELEMENT: Record<EmptyKind, "div" | "p"> = { pane: "div", dash: "div", change: "div", overlay: "p", browser: "div", glance: "p", file: "div" };

/** Nothing to show: one quiet line (or a centred block) in its place's voice. role: status or alert when it reports. */
export function Empty(props: JSX.HTMLAttributes<HTMLElement> & { kind?: EmptyKind; role?: "status" | "alert" }) {
  const [local, rest] = splitProps(props, ["kind", "class"]);
  const kind = () => local.kind ?? "pane";
  return <Dynamic component={EMPTY_ELEMENT[kind()]} {...(rest as Record<string, unknown>)} class="ui-empty" data-empty={kind()} />;
}

/** Where a Loading sits: a Settings page (a spinner and its words), a pane's corner (a frost capsule), the file browser. */
export type LoadingKind = "setting" | "pane" | "browser";

/** Still loading: said as a status. */
export function Loading(props: { kind?: LoadingKind; children: JSX.Element }) {
  const kind = props.kind ?? "setting";
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
