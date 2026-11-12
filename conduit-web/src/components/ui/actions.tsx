import * as Icons from "./icons";
import { splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { feel, type HapticProp } from "./haptics";
import { callHandler } from "./shared";
import { Button } from "./controls";

export type IconButtonKind = "dash" | "file" | "tool" | "pane" | "rail" | "tab";

export function IconButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: IconButtonKind; label?: string; wide?: boolean; inMenu?: boolean; close?: boolean; current?: boolean; live?: boolean; count?: number; "data-fold"?: string;
  haptic?: HapticProp;
}) {
  const [local, rest] = splitProps(props, ["kind", "label", "wide", "inMenu", "close", "current", "live", "count", "children", "class", "haptic", "onClick"]);
  const kind = () => local.kind ?? "tool";
  const children = () => local.children ?? (kind() === "dash" ? <Icons.More /> : undefined);
  return <button type="button" tabIndex={kind() === "pane" ? -1 : undefined} aria-label={local.label} title={local.label} {...rest}
    class="ui-icon-button" data-icon-button={kind()}
    data-wide={local.wide ? "" : undefined} data-in-menu={local.inMenu ? "" : undefined} data-close={local.close ? "" : undefined}
    aria-current={local.current ? "page" : undefined} data-live={local.live ? "" : undefined} data-count={local.count ? String(local.count) : undefined}
    onClick={(event) => { feel(local.haptic, local.close ? "dismiss" : "press"); callHandler(local.onClick, event); }}>{children()}</button>;
}

export type ActionsKind = "card" | "setting" | "rider" | "overlay" | "pane" | "file" | "tools" | "term" | "editor" | "browser";
const ELEMENT: Partial<Record<ActionsKind, "span">> = { pane: "span", editor: "span" };
const ROLE: Partial<Record<ActionsKind, string>> = { setting: "group", browser: "toolbar" };

export function Actions(props: JSX.HTMLAttributes<HTMLElement> & { kind?: ActionsKind; stack?: boolean; ref?: HTMLElement | ((element: never) => void) }) {
  const [local, rest] = splitProps(props, ["kind", "stack", "class"]);
  const kind = () => local.kind ?? "card";
  return <Dynamic component={ELEMENT[kind()] ?? "div"} role={ROLE[kind()] as JSX.HTMLAttributes<HTMLElement>["role"]} aria-label={kind() === "browser" ? "Folder actions" : undefined}
    {...(rest as Record<string, unknown>)} class="ui-actions" data-actions={kind()} data-stack={local.stack ? "" : undefined} />;
}

/** `icon`: what the corner does when that is not closing (a tick, to settle). */
export function CloseButton(props: { onClick: (event: MouseEvent) => void; label?: string; title?: string; icon?: JSX.Element; kind?: IconButtonKind; size?: "sm" | "xs";
  class?: string; disabled?: boolean; tabIndex?: number; onMouseDown?: (event: MouseEvent) => void }) {
  const label = () => props.label ?? "Close";
  if (props.kind) return <IconButton kind={props.kind} close label={label()} title={props.title ?? label()} class={props.class} disabled={props.disabled}
    tabIndex={props.tabIndex} onMouseDown={props.onMouseDown} onClick={(event) => props.onClick(event)}>{props.icon ?? <Icons.Close />}</IconButton>;
  return <Button variant="ghost" size={props.size === "xs" ? "icon-xs" : "icon-sm"} haptic="dismiss" class={props.class} aria-label={label()} title={props.title ?? label()}
    disabled={props.disabled} tabIndex={props.tabIndex} onMouseDown={props.onMouseDown} onClick={(event) => props.onClick(event)}>{props.icon ?? <Icons.Close />}</Button>;
}
