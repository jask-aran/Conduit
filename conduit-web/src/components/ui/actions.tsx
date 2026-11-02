import * as Icons from "./icons";
import { splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";

/**
 * IconButton: an action drawn as its icon alone, its label its name and its tooltip. The kind is where it sits, which
 * sets its size and its rest and cursor (each kind's look in its family's stylesheet, under .ui-icon-button):
 *
 *   dash   a dashboard line's small button (the ⋯ when given nothing)
 *   file   a file header's or status bar's control: an icon, or words with one (wide); inMenu: the ⋯ has it too, so a
 *          narrow header folds it there; close: the header's ×
 *   tool   a ToolBar's
 *   pane   a pane's own controls after its title or tabs (dock, swap, close): out of the tab order
 *   rail   the folded sidebar's: current as a row is; live: a dot at its corner
 *
 * A menu's trigger takes one with `as`.
 */
export type IconButtonKind = "dash" | "file" | "tool" | "pane" | "rail";

export function IconButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: IconButtonKind; label?: string; wide?: boolean; inMenu?: boolean; close?: boolean; current?: boolean; live?: boolean; "data-fold"?: string;
}) {
  const [local, rest] = splitProps(props, ["kind", "label", "wide", "inMenu", "close", "current", "live", "children", "class"]);
  const kind = () => local.kind ?? "tool";
  // A dash button with nothing in it is the ⋯; a rail's draws what the caller gives it.
  const children = () => local.children ?? (kind() === "dash" ? <Icons.More /> : undefined);
  return <button type="button" tabIndex={kind() === "pane" ? -1 : undefined} aria-label={local.label} title={local.label} {...rest}
    class="ui-icon-button" data-icon-button={kind()}
    data-wide={local.wide ? "" : undefined} data-in-menu={local.inMenu ? "" : undefined} data-close={local.close ? "" : undefined}
    aria-current={local.current ? "page" : undefined} data-live={local.live ? "" : undefined}>{children()}</button>;
}

/**
 * Actions: a run of controls that act on what they sit with. The kind is the family whose spacing and folding it takes
 * (under .ui-actions[data-actions]):
 *
 *   card      a card's buttons, at its foot
 *   setting   what can be done with a group's subject, at the lines' edge, wrapping
 *   rider     a rider's buttons; stack: one above another
 *   overlay   an overlay page's buttons
 *   pane      a pane's own controls after its title or tabs
 *   file      a file's actions (review, copy, download): the ones fitting fold first
 *   tools     an editor's tools (find, wrap): last, only when the header is bare
 *   term      a terminal's session and focus controls
 *   editor    a text editor's buttons beside its title
 *   browser   the file browser's folder actions
 */
export type ActionsKind = "card" | "setting" | "rider" | "overlay" | "pane" | "file" | "tools" | "term" | "editor" | "browser";
const ELEMENT: Partial<Record<ActionsKind, "span">> = { pane: "span", editor: "span" };
const ROLE: Partial<Record<ActionsKind, string>> = { setting: "group", browser: "toolbar" };

export function Actions(props: JSX.HTMLAttributes<HTMLElement> & { kind?: ActionsKind; stack?: boolean; ref?: HTMLElement | ((element: never) => void) }) {
  const [local, rest] = splitProps(props, ["kind", "stack", "class"]);
  const kind = () => local.kind ?? "card";
  return <Dynamic component={ELEMENT[kind()] ?? "div"} role={ROLE[kind()] as JSX.HTMLAttributes<HTMLElement>["role"]} aria-label={kind() === "browser" ? "Folder actions" : undefined}
    {...(rest as Record<string, unknown>)} class="ui-actions" data-actions={kind()} data-stack={local.stack ? "" : undefined} />;
}
