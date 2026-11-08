import { Show, type JSX } from "solid-js";
import { Note } from "./state";
import { Row } from "./row";

/*
 * A workbench: a page that works on one thing at a time (Settings › Prompts: a document; Blocks: a block). Below its
 * title, the split takes the rest of the height so the page never scrolls: a side column scrolling on its own, and
 * the main column, one pane that fills it (a TextEditor fill).
 */
export const Workbench = (props: { label: string; children: JSX.Element }) => <div class="ui-workbench" role="region" aria-label={props.label}>{props.children}</div>;
/** title: the thing worked on, a Select look="title" to choose another. actions: icon buttons beside it. meta: what it is. */
export const WorkbenchTitle = (props: { title: JSX.Element; actions?: JSX.Element; meta?: string }) => <header class="ui-workbench-title">
  <div class="ui-workbench-title-line">{props.title}<Show when={props.actions}><span class="ui-workbench-actions">{props.actions}</span></Show></div>
  <Show when={props.meta}><Note kind="workbench">{props.meta}</Note></Show>
</header>;
/** The side column beside the main pane: side by side, one line, each column scrolling on its own. */
export const WorkbenchSplit = (props: { side: JSX.Element; main: JSX.Element }) => <div class="ui-workbench-split">
  <div class="ui-workbench-side">{props.side}</div>
  <section class="ui-workbench-main">{props.main}</section>
</div>;
/** A titled group in the side column (Used in, Slots). */
/** A fact in a side section: its name (code: written in the text as is) and its value, quiet. */
export const WorkbenchFact = (props: { name: string; value?: string; title?: string; code?: boolean; children?: JSX.Element }) =>
  <Row density="line" class="ui-workbench-fact" title={props.title} label={props.code ? <code>{props.name}</code> : props.name} context={props.value} end={props.children} />;

/** A quiet line in a Group or under a title: what there is none of, or what follows (Conduit then adds…). */

/* A TextEditor's head (its `head` slot), here so a page can draw it without loading CodeMirror. live: what it shows
 * is filled in as it stands, quieter. */
