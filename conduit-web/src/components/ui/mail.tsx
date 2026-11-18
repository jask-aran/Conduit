import { createSignal, For, onCleanup, onMount, Show, splitProps, type JSX } from "solid-js";
import * as Icons from "./icons";
import { Dot } from "./nav";
import { Row, type RowProps } from "./row";

/** A thread's own labels, by name, as quiet chips. In a row they give way (the last first) before its subject does. */
export const MailLabels = (props: { names: string[] }) =>
  <Show when={props.names.length}><span class="ui-mail-labels"><For each={props.names}>{(name) => <span class="ui-mail-label">{name}</span>}</For></span></Show>;

/** A thread in a mail list, on one line: who wrote (and how many messages), the subject before the start of its text, its
 *  labels, then what it holds and when. Unread is the dot in its mark's place and a lit title. */
export function MailRow(props: Omit<RowProps, "density" | "lead" | "label" | "context" | "meta" | "children"> & {
  from: string; count?: number; subject: string; snippet: string; time: string; dateTime?: string;
  unread?: boolean; starred?: boolean; attachments?: boolean; draft?: boolean; labels?: string[];
}) {
  const [local, rest] = splitProps(props, ["from", "count", "subject", "snippet", "time", "dateTime", "unread", "starred", "attachments", "draft", "labels"]);
  return <Row density="list" element="button" {...rest} data-mail="" data-unread={local.unread ? "" : undefined}
    lead={local.unread ? <Dot tone="unread" aria-label="Unread" /> : undefined}
    label={<>{local.from}<Show when={(local.count ?? 0) > 1}><span class="ui-mail-count">{local.count}</span></Show></>}
    context={<><Show when={local.draft}><span class="ui-mail-draft">Draft</span></Show><span class="ui-mail-subject">{local.subject}</span>
      <span class="ui-mail-snippet">· {local.snippet}</span><MailLabels names={local.labels ?? []} /></>}
    meta={<span class="ui-mail-meta"><Show when={local.attachments}><Icons.Attach aria-label="Attachments" /></Show>
      <Show when={local.starred}><Icons.Star data-starred="" aria-label="Starred" /></Show><time dateTime={local.dateTime}>{local.time}</time></span>} />;
}

/**
 * A list beside what it opens. While the frame holds both at their minimums (`--split-list` beside `--split-reader`, so it
 * grows with the Interface size) both stand; else one at a time, `show` saying which. The other keeps its room and state,
 * faded out where it stands. `onFold` hears the frame cross.
 */
export function ReaderSplit(props: { list: JSX.Element; reader: JSX.Element; show: "list" | "reader"; onFold?: (folded: boolean) => void; label?: string }) {
  const [folded, setFolded] = createSignal(false);
  let frame!: HTMLDivElement, need!: HTMLDivElement;
  onMount(() => {
    const fit = () => { const now = frame.clientWidth < need.offsetWidth; if (now === folded()) return; setFolded(now); props.onFold?.(now); };
    const watch = new ResizeObserver(fit);
    watch.observe(frame);
    fit();
    onCleanup(() => watch.disconnect());
  });
  const away = (side: "list" | "reader") => folded() && props.show !== side;
  return <div ref={frame} class="ui-reader-split" aria-label={props.label} data-folded={folded() ? "" : undefined}>
    <div ref={need} class="ui-reader-split-need" aria-hidden="true" />
    <section class="ui-reader-split-list" data-move="fade" data-out={away("list") ? "" : undefined} inert={away("list")}>{props.list}</section>
    <section class="ui-reader-split-reader" data-move="fade" data-out={away("reader") ? "" : undefined} inert={away("reader")}>{props.reader}</section>
  </div>;
}

/** What is read in a pane: one column at the reading width, the pane scrolling it (its scrollbar at the pane's edge). */
export function ReadingScroll(props: JSX.HTMLAttributes<HTMLDivElement> & { ref?: (element: HTMLDivElement) => void }) {
  const [local, rest] = splitProps(props, ["children", "class"]);
  return <div {...rest} class="ui-reading-scroll"><div class="ui-reading-column">{local.children}</div></div>;
}

/** The name of what is read, at the title role (it sits in a narrow pane as in a wide one), with what can be done to it on its line. */
export const ReadingTitle = (props: { children: JSX.Element; /** Before the name: the way back, where the column took the pane. */ lead?: JSX.Element; /** What can be done to it, at the line's end. */ actions?: JSX.Element }) =>
  <header class="ui-reading-head">{props.lead}<h1 class="ui-reading-title">{props.children}</h1><Show when={props.actions}><div class="ui-reading-actions" role="toolbar">{props.actions}</div></Show></header>;

const DRAFT_STATE = { saving: "Saving", saved: "Saved", sending: "Sending", failed: "Not saved" } as const;
/** Where a draft stands, in the composer's quiet aside; a failure says why. */
export const DraftState = (props: { state: keyof typeof DRAFT_STATE; error?: string }) =>
  <span class="ui-draft-state" role="status" data-state={props.state} title={props.error}>{DRAFT_STATE[props.state]}<Show when={props.state === "failed" && props.error}>: {props.error}</Show></span>;

/** One addressed line at the top of a composer (To, Cc, Subject): its name, a bare field, and `end` (what it can add). */
export function ComposerLine(props: JSX.InputHTMLAttributes<HTMLInputElement> & { label: string; end?: JSX.Element }) {
  const [local, rest] = splitProps(props, ["label", "end", "id"]);
  const id = local.id ?? `composer-line-${local.label.toLowerCase()}`;
  return <div class="ui-composer-line"><label for={id}>{local.label}</label><input id={id} type="text" spellcheck={false} {...rest} />{local.end}</div>;
}
