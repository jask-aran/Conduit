import { Frost } from "./frost";
import { Show, splitProps, type JSX } from "solid-js";
import { Button } from "./controls";

/*
 * Header: a pane's top line (DESIGN The top line, Pane header). The name or the tab row at the left, what the page
 * is beside it, quiet controls at the right. On a phone the title gives way, and the leading controls, the page's
 * name (HeaderPill) and the actions float over the transcript as frost pills (DESIGN Phone header pills).
 */

/** lead: the phone's leading controls (the sidebar's toggle, New chat); on a desktop the sidebar's head holds them.
 *  pill: a phone's name for the page between its groups (HeaderPill); a desktop's title says it.
 *  after: beside the title (a HeaderNote). frost: the strip itself is frost, for a tab row read
 *  over the transcript scrolling under it. */
export function Header(props: JSX.HTMLAttributes<HTMLElement> & { lead?: JSX.Element; pill?: JSX.Element; after?: JSX.Element; actions?: JSX.Element; frost?: boolean }) {
  const [local, rest] = splitProps(props, ["lead", "pill", "after", "actions", "frost", "children", "class"]);
  return <header {...rest} class="ui-header" data-frost={local.frost ? "" : undefined}>
    <Show when={local.lead}><div class="ui-header-group" data-lead="">{local.lead}</div></Show>
    <div class="ui-header-title">{local.children}</div>
    {local.pill}
    {local.after}
    <div class="ui-header-group" data-actions="">{local.actions}</div>
  </header>;
}

/** A page's name under its place: the place in the section label's caps (a link when onPlace), then the title.
 *  No place: the page is a place itself. */
export function HeaderCrumb(props: { place?: string; onPlace?: () => void; title: string }) {
  return <nav aria-label="breadcrumb" class="ui-header-crumb">
    <Show when={props.place}>
      <Show when={props.onPlace} fallback={<span class="ui-header-place">{props.place}</span>}>
        <button type="button" class="ui-header-place" tabIndex={-1} onClick={() => props.onPlace?.()}>{props.place}</button>
      </Show>
    </Show>
    <strong>{props.title}</strong>
  </nav>;
}

/** A phone's name for the page: its place's mark (a folder, a workspace's glyph, Conduit's for a chat in no folder)
 *  and its title, wrapping to two lines, a frost pill between the header's groups. opens: a press opens the page's
 *  menu (MenuControl as={HeaderPill} opens); the pill says so by being pressable, with no chevron to take its room. */
export function HeaderPill(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon?: JSX.Element; opens?: boolean }) {
  const [local, rest] = splitProps(props, ["label", "icon", "opens"]);
  const inner = () => <><Show when={local.icon}><span class="ui-header-pill-icon" aria-hidden="true">{local.icon}</span></Show><strong>{local.label}</strong></>;
  return <Show when={local.opens} fallback={<div class="ui-header-pill" data-surface="frost">{inner()}</div>}>
    <button type="button" tabIndex={-1} {...rest} class="ui-header-pill" data-surface="frost">{inner()}</button>
  </Show>;
}

/** One of the header's controls: an icon, its label as its name. only: drawn on that layout alone. */
export function HeaderButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: JSX.Element; only?: "phone" | "desktop" }) {
  const [local, rest] = splitProps(props, ["label", "icon", "only"]);
  return <Button variant="ghost" size="icon-sm" tabIndex={-1} aria-label={local.label} title={local.label} {...rest} data-only={local.only}>{local.icon}</Button>;
}

/** Beside the title: what the page is, when that needs saying, and the one thing to do about it. A capsule of frost. */
export function HeaderNote(props: { label: string; title?: string; action?: { label: string; name?: string; busy?: boolean; busyLabel?: string; onClick: () => void } }) {
  return <Frost as="span" class="ui-header-note" title={props.title}>
    <span>{props.label}</span>
    <Show when={props.action}>{(action) =>
      <button type="button" tabIndex={-1} disabled={action().busy} aria-label={action().name ?? action().label} onClick={() => action().onClick()}>{action().busy ? action().busyLabel ?? action().label : action().label}</button>}
    </Show>
  </Frost>;
}
