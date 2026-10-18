import { Show, type JSX } from "solid-js";

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
