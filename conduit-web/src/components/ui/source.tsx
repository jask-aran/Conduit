import { For, Show, splitProps, type JSX } from "solid-js";
import { Button } from "./controls";
import { GroupToggle } from "./dashboard";

/*
 * Source control (DESIGN Panes and windows): the branch's line, the commit box, the staged and unstaged groups of
 * ChangeRows with an action each, the history's commits and a patch's lines. Git (what runs, what is staged) is the
 * app's: these draw.
 */

/** A tool's status line under its header: a mark, the strong name and a muted detail; controls at its end. */
export function ToolLine(props: { icon?: JSX.Element; title: JSX.Element; detail?: JSX.Element; end?: JSX.Element }) {
  return <div class="ui-tool-line">
    <span class="ui-tool-line-main">{props.icon}<strong>{props.title}</strong><Show when={props.detail}><small>{props.detail}</small></Show></span>
    <Show when={props.end}><span class="ui-tool-line-end">{props.end}</span></Show>
  </div>;
}

/** The commit box: a message that grows with what is typed, and the commit button (its count under the word). */
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
    <Button type="submit" variant="primary" size="sm" disabled={props.disabled}>{props.busy ? props.busyIcon : props.icon}<span>Commit</span><Show when={props.count}><small>{props.count}</small></Show></Button>
  </form>;
}

/** Changes in a run of groups: two side by side when the tool is wide enough. */
export const ChangeLedger = (props: { children: JSX.Element }) => <div class="ui-change-ledger"><div>{props.children}</div></div>;
/** A group of changes: its heading folds it, an action at the heading's right (stage all); then its rows, or a note. */
export function ChangeSection(props: { open: boolean; label: string; count?: number; onToggle: () => void; action?: JSX.Element; children: JSX.Element }) {
  return <section class="ui-change-section" data-open={props.open ? "" : undefined}>
    <header><GroupToggle open={props.open} count={props.count} onClick={props.onToggle}>{props.label}</GroupToggle>{props.action}</header>
    <Show when={props.open}>{props.children}</Show>
  </section>;
}
/** The rows of changes, scrolling. */
export const ChangeList = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-change-list" />;
/** A change and its action (stage, unstage), the action shown on the pointer or focus. */
export const ChangeItem = (props: { action?: JSX.Element; children: JSX.Element }) => <div class="ui-change-item">{props.children}{props.action}</div>;
/** When a group has nothing: centred and quiet. */
export const ChangeEmpty = (props: { children: JSX.Element }) => <div class="ui-change-empty">{props.children}</div>;

/** A commit: the graph's column, the subject and its refs (HEAD's lit), the author, the short hash. A context menu's trigger takes it with `as`. */
export function CommitRow(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { graph: string; subject: string; refs?: { label: string; current?: boolean; kind?: string }[]; author: string; hash: string }) {
  const [local, rest] = splitProps(props, ["graph", "subject", "refs", "author", "hash"]);
  return <button type="button" {...rest} class="ui-commit">
    <code class="ui-commit-graph" aria-hidden="true">{local.graph}</code>
    <span class="ui-commit-subject"><span>{local.subject}</span><Show when={local.refs?.length}><span class="ui-commit-refs"><For each={local.refs}>{(ref) => <code data-kind={ref.kind} data-current={ref.current ? "" : undefined}>{ref.label}</code>}</For></span></Show></span>
    <small>{local.author}</small>
    <code class="ui-commit-hash">{local.hash}</code>
  </button>;
}
export const CommitList = (props: { children: JSX.Element }) => <div class="ui-commit-list">{props.children}</div>;

const lineKind = (line: string) => line.startsWith("+") && !line.startsWith("+++") ? "addition" : line.startsWith("-") && !line.startsWith("---") ? "deletion" : line.startsWith("@@") ? "hunk" : line.startsWith("# ") || line.startsWith("diff ") ? "heading" : "context";
/** A patch as text: additions, deletions, hunks and headings tinted. */
export const PatchLines = (props: { lines: string[] }) =>
  <pre class="ui-patch"><code><For each={props.lines}>{(line) => <span data-kind={lineKind(line)}>{line || " "}</span>}</For></code></pre>;
