import * as Icons from "./icons";
import { Show, splitProps, type JSX } from "solid-js";


/** The chat history's scrolling list, with optional text wrapping. */
export function HistoryList(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "classList"> & { wrap?: boolean }) {
  const [local, rest] = splitProps(props, ["wrap"]);
  return <div {...rest} class="ui-history" data-wrap={local.wrap ? "" : undefined} />;
}

type HistoryRowContent = {
  kind: string;
  discarded?: boolean;
  active?: boolean;
  leaf?: boolean;
  connected?: boolean;
  time?: string;
  datetime?: string;
};
type HistoryRowProps = HistoryRowContent & (
  | (Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "classList"> & { run?: false })
  | (Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class" | "classList"> & { run: true; open: boolean })
);

/** An entry's timestamp and text, or a button for a folded run of tool calls. */
export function HistoryRow(props: HistoryRowProps) {
  const [local] = splitProps(props, ["kind", "discarded", "active", "leaf", "connected", "time", "datetime", "children", "run"]);
  const content = () => <>
    <Show when={local.connected}><span class="ui-history-tick" aria-hidden="true" /></Show>
    <Show when={local.time}><time class="ui-history-time" datetime={local.datetime}>{local.time}</time></Show>
    <span class="ui-history-text">
      <Show when={props.run}><Icons.ChevronDown class="ui-history-chevron" data-open={props.run && props.open ? "" : undefined} aria-hidden="true" /></Show>
      {local.children}
    </span>
  </>;
  if (props.run) {
    const [, rest] = splitProps(props, ["kind", "discarded", "active", "leaf", "connected", "time", "datetime", "children", "run", "open"]);
    return <button type="button" {...rest} class="ui-history-row ui-history-run"
      data-kind={local.kind} data-discarded={local.discarded ? "" : undefined}
      data-active={local.active ? "" : undefined} data-leaf={local.leaf ? "" : undefined}
      data-collapsed={!props.open ? "" : undefined}>{content()}</button>;
  }
  const [, rest] = splitProps(props, ["kind", "discarded", "active", "leaf", "connected", "time", "datetime", "children", "run"]);
  return <div {...rest} class="ui-history-row"
    data-kind={local.kind} data-discarded={local.discarded ? "" : undefined}
    data-active={local.active ? "" : undefined} data-leaf={local.leaf ? "" : undefined}>{content()}</div>;
}

/** A side branch's rail and body, with its text's nesting depth. */
export function HistoryBranch(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "style" | "class" | "classList"> & { depth: number }) {
  const [local, rest] = splitProps(props, ["depth", "children"]);
  return <div {...rest} class="ui-history-branch" style={{ "--history-depth": String(local.depth) }}>
    <span class="ui-history-branch-rail" aria-hidden="true" />
    <div class="ui-history-branch-body">{local.children}</div>
  </div>;
}
