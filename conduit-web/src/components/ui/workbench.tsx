import { Show, type JSX } from "solid-js";

/*
 * A workbench: a page that works on one thing at a time (Settings › Prompts: a document; Blocks: a block). Its title
 * is the thing, and pressing it chooses another (a Select look="title"); its actions beside, what it is under. Below,
 * the split takes the rest of the height so the page never scrolls: a side column (a chain, the facts about it) that
 * scrolls on its own, and the main column, one pane that fills it (a TextEditor fill) -- its actions in the pane's
 * bar, what is known of it in the pane's foot.
 */
export const Workbench = (props: { label: string; children: JSX.Element }) => <div class="ui-workbench" role="region" aria-label={props.label}>{props.children}</div>;
/** title: the thing worked on, a Select look="title" to choose another. actions: icon buttons beside it. meta: what it is. */
export const WorkbenchTitle = (props: { title: JSX.Element; actions?: JSX.Element; meta?: string }) => <header class="ui-workbench-title">
  <div class="ui-workbench-title-line">{props.title}<Show when={props.actions}><span class="ui-workbench-actions">{props.actions}</span></Show></div>
  <Show when={props.meta}><p class="ui-workbench-meta">{props.meta}</p></Show>
</header>;
/** The side column beside the main pane: side by side, one line, each column scrolling on its own. */
export const WorkbenchSplit = (props: { side: JSX.Element; main: JSX.Element }) => <div class="ui-workbench-split">
  <div class="ui-workbench-side">{props.side}</div>
  <section class="ui-workbench-main">{props.main}</section>
</div>;
/** A titled group in the side column (Used in, Slots). */
export const WorkbenchSection = (props: { title: string; children: JSX.Element }) => <section class="ui-workbench-section"><h4 class="ui-title">{props.title}</h4>{props.children}</section>;
/** A fact in a side section: its name (code: written in the text as is) and its value, quiet. */
export const WorkbenchFact = (props: { name: string; value?: string; title?: string; code?: boolean }) => <div class="ui-workbench-fact" title={props.title}>
  {props.code ? <code>{props.name}</code> : <span>{props.name}</span>}<Show when={props.value}><span class="ui-workbench-fact-value">{props.value}</span></Show>
</div>;
