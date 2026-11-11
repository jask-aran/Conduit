import { For, Show, splitProps, type JSX } from "solid-js";
import { Row, type RowProps } from "./row";
import { Button, Count } from "./controls";

export function ToolLine(props: { icon?: JSX.Element; title: JSX.Element; detail?: JSX.Element; end?: JSX.Element }) {
  return <Row density="line" class="ui-tool-line" lead={props.icon} label={props.title} context={props.detail} end={props.end} />;
}

export function CommitBox(props: {
  value: string;
  placeholder?: string;
  count?: number;
  busy?: boolean;
  disabled?: boolean;
  busyIcon?: JSX.Element;
  icon?: JSX.Element;
  onInput: (value: string) => void;
  onSubmit: () => void;
}) {
  return <form class="ui-commit-box" onSubmit={(event) => { event.preventDefault(); props.onSubmit(); }}>
    <textarea aria-label="Commit message" placeholder={props.placeholder} rows="1" value={props.value}
      onInput={(event) => { const input = event.currentTarget; props.onInput(input.value); input.style.height = "auto"; input.style.height = `${input.scrollHeight}px`; }}
      onKeyDown={(event) => { if (event.key === "Enter" && event.ctrlKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
    <Button type="submit" variant="primary" size="sm" disabled={props.disabled}>{props.busy ? props.busyIcon : props.icon}<span>Commit</span><Show when={props.count}><Count value={props.count!} /></Show></Button>
  </form>;
}

export const ChangeLedger = (props: { children: JSX.Element }) => <div class="ui-change-ledger"><div>{props.children}</div></div>;
export const ChangeList = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-change-list" />;

export function CommitRow(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { graph: string; subject: string; refs?: { label: string; current?: boolean; kind?: string }[]; author: string; hash: string }) {
  const [local, rest] = splitProps(props, ["graph", "subject", "refs", "author", "hash"]);
  return <Row {...(rest as RowProps)} element="button" density="line" class="ui-commit" lead={<code class="ui-commit-graph" aria-hidden="true">{local.graph}</code>}
    label={<><span>{local.subject}</span><Show when={local.refs?.length}><span class="ui-commit-refs"><For each={local.refs}>{(ref) => <code data-kind={ref.kind} data-current={ref.current ? "" : undefined}>{ref.label}</code>}</For></span></Show></>}
    context={local.author} meta={local.hash} />;
}
export const CommitList = (props: { children: JSX.Element }) => <div class="ui-commit-list">{props.children}</div>;

const lineKind = (line: string) => line.startsWith("+") && !line.startsWith("+++") ? "addition" : line.startsWith("-") && !line.startsWith("---") ? "deletion" : line.startsWith("@@") ? "hunk" : line.startsWith("# ") || line.startsWith("diff ") ? "heading" : "context";
export const PatchLines = (props: { lines: string[] }) =>
  <pre class="ui-patch"><code><For each={props.lines}>{(line) => <span data-kind={lineKind(line)}>{line || " "}</span>}</For></code></pre>;

export const SourceView = (props: JSX.HTMLAttributes<HTMLElement>) => <section {...props} class="ui-source-view" />;
export const SourceOverview = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-source-overview" />;
export const SourcePatch = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-source-patch" />;
export const ChangeNav = (props: JSX.HTMLAttributes<HTMLElement>) => <nav {...props} class="ui-change-nav" />;
