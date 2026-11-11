import { For, Show, splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Frost } from "./frost";
import { Button, Spinner } from "./controls";

export type EmptyKind = "pane" | "dash" | "change" | "overlay" | "browser" | "glance" | "file" | "client";
const EMPTY_ELEMENT: Record<EmptyKind, "div" | "p"> = { pane: "div", dash: "div", change: "div", overlay: "p", browser: "div", glance: "p", file: "div", client: "p" };

export function Empty(props: JSX.HTMLAttributes<HTMLElement> & { kind?: EmptyKind; role?: "status" | "alert" }) {
  const [local, rest] = splitProps(props, ["kind", "class"]);
  const kind = () => local.kind ?? "pane";
  return <Dynamic component={EMPTY_ELEMENT[kind()]} {...(rest as Record<string, unknown>)} class="ui-empty" data-empty={kind()} />;
}

export type LoadingKind = "setting" | "pane" | "browser" | "nav" | "earlier";

export function Loading(props: { kind?: LoadingKind; rows?: number; label?: string; children?: JSX.Element }) {
  const kind = props.kind ?? "setting";
  return <Dynamic component={kind === "pane" ? Frost : "div"} class="ui-loading" data-loading={kind} role={kind === "setting" ? undefined : "status"}
    aria-label={kind === "nav" ? props.label ?? "Loading" : props.label}>
    <Show when={kind === "setting" || kind === "earlier"}><Spinner /></Show>
    <Show when={kind === "nav"} fallback={props.children}><For each={Array.from({ length: props.rows ?? 0 })}>{() => <span />}</For></Show>
  </Dynamic>;
}

export type NoteKind = "setting" | "dash" | "card" | "menu" | "nav" | "workbench" | "browser" | "term";

export function Note(props: JSX.HTMLAttributes<HTMLElement> & { kind?: NoteKind; tone?: "quiet" | "error" }) {
  const [local, rest] = splitProps(props, ["kind", "tone", "class"]);
  const kind = () => local.kind ?? "setting";
  const error = () => local.tone === "error" || kind() === "browser" || kind() === "term";
  return <Dynamic component={kind() === "nav" ? "div" : "p"} role={error() ? "alert" : undefined} {...(rest as Record<string, unknown>)}
    class="ui-note" data-note={kind()} data-tone={kind() === "setting" ? local.tone ?? "quiet" : undefined}
    data-error={kind() !== "setting" && local.tone === "error" ? "" : undefined} />;
}

export type NoticeKind = "reading" | "nav" | "tool" | "capsule";
export type NoticeAction = { label: string; name?: string; busy?: boolean; busyLabel?: string; disabled?: boolean; quiet?: boolean; onClick: () => void };

export function Notice(props: { kind?: NoticeKind; icon?: JSX.Element; title?: JSX.Element; busy?: boolean; ready?: boolean; tone?: "warn"; live?: boolean; hint?: string; action?: NoticeAction | NoticeAction[]; children?: JSX.Element }) {
  const kind = props.kind ?? "reading";
  const act = (action: NoticeAction) => kind === "nav"
    ? <Button size="sm" variant={action.quiet ? "ghost" : undefined} onClick={() => action.onClick()}>{action.label}</Button>
    : <button type="button" tabIndex={kind === "capsule" ? -1 : undefined} disabled={action.busy || action.disabled} aria-label={kind === "capsule" ? action.name ?? action.label : undefined}
      onClick={() => action.onClick()}>{action.busy ? action.busyLabel ?? action.label : action.label}</button>;
  return <Dynamic component={kind === "capsule" ? Frost : "div"} as={kind === "capsule" ? "span" : undefined} class="ui-notice" data-notice={kind} title={props.hint}
    role={kind === "reading" ? "note" : kind === "nav" || props.live ? "status" : undefined} aria-live={props.live ? "polite" : undefined}
    data-ready={props.ready ? "" : undefined} data-tone={props.tone}>
    <Show when={props.busy} fallback={props.icon}><Spinner /></Show>
    {kind === "reading" ? <div><strong>{props.title}</strong><Show when={props.children}><p>{props.children}</p></Show></div> : kind === "tool" ? props.children : <span>{props.children}</span>}
    <For each={props.action ? [props.action].flat() : []}>{act}</For>
  </Dynamic>;
}
