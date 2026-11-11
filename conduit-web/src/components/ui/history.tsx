import * as Icons from "./icons";
import { Show, splitProps, type JSX } from "solid-js";
import { Row } from "./row";


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
type HistoryRowProps = HistoryRowContent & Omit<JSX.HTMLAttributes<HTMLElement>, "class" | "classList"> & {
  run?: boolean;
  open?: boolean;
};

export function HistoryRow(props: HistoryRowProps) {
  const [local, rest] = splitProps(props, ["kind", "discarded", "active", "leaf", "connected", "time", "datetime", "children", "run", "open"]);
  return <Row density="trail" bare element={local.run ? "button" : "div"} {...rest} class={local.run ? "ui-history-row ui-history-run" : "ui-history-row"}
    data-kind={local.kind} data-discarded={local.discarded ? "" : undefined}
    data-active={local.active ? "" : undefined} data-leaf={local.leaf ? "" : undefined}
    data-collapsed={local.run && !local.open ? "" : undefined}>
    <Show when={local.connected}><span class="ui-history-tick" aria-hidden="true" /></Show>
    <Show when={local.time}><time class="ui-history-time" datetime={local.datetime}>{local.time}</time></Show>
    <span class="ui-history-text ui-truncate">
      <Show when={local.run}><Icons.ChevronDown class="ui-history-chevron ui-fold-chevron" data-turn="half" data-open={local.open ? "" : undefined} aria-hidden="true" /></Show>
      {local.children}
    </span>
  </Row>;
}

export function HistoryBranch(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "style" | "class" | "classList"> & { depth: number }) {
  const [local, rest] = splitProps(props, ["depth", "children"]);
  return <div {...rest} class="ui-history-branch" style={{ "--history-depth": String(local.depth) }}>
    <span class="ui-history-branch-rail" aria-hidden="true" />
    <div class="ui-history-branch-body">{local.children}</div>
  </div>;
}
