import { Show, type JSX } from "solid-js";
import { createBack } from "./back";
import { PHONE_LAYOUT_QUERY } from "./layout";
import { Note } from "./state";
import { Row } from "./row";
import * as Icons from "./icons";

/*
 * A workbench: a page that works on one thing at a time (Settings › Prompts: a document; Blocks: a block; Skills: a
 * skill). Below its title, the split takes the rest of the height so the page never scrolls: a side column scrolling
 * on its own, and the main column, one pane that fills it (a TextEditor fill).
 *
 * The layout for a page of many things of one kind (Blocks, Skills):
 *   - WorkbenchTitle: the chosen thing's name, as words. What changes the set (new, find) is its actions.
 *   - side: every thing, in titled Groups, each a WorkbenchPick -- its name, what is known at a glance, a control of
 *     its own (a switch) -- so choosing another is a click on what is already in view, never a popover.
 *     Where there are more than fit a look, the groups fold (WorkbenchFold), the chosen thing's open.
 *   - facts: what is known of the chosen one (Used in, Slots), under the picks and scrolling apart from them.
 *   - main: its pane, alone.
 * A page on one thing made of parts (Prompts: a document's chain) keeps a Select look="title" to choose the thing.
 */
export const Workbench = (props: { label: string; children: JSX.Element }) => <div class="ui-workbench" role="region" aria-label={props.label}>{props.children}</div>;
/** title: the thing worked on -- its name, where the side column chooses it (WorkbenchPick), or a Select look="title"
 *  to choose another. actions: icon buttons beside it. meta: what it is. */
export const WorkbenchTitle = (props: { title: JSX.Element; actions?: JSX.Element; meta?: string }) => <header class="ui-workbench-title">
  <div class="ui-workbench-title-line">{typeof props.title === "string" ? <h3 class="ui-workbench-name">{props.title}</h3> : props.title}<Show when={props.actions}><span class="ui-workbench-actions">{props.actions}</span></Show></div>
  <Show when={props.meta}><Note kind="workbench">{props.meta}</Note></Show>
</header>;
/** The side column beside the main pane: side by side, one line, each column scrolling on its own.
 *  On a phone there is no room for both, so they take turns: the side column is the page, and the main pane is a
 *  screen of its own once open, with a way back named for what it shows (mainLabel). What opens it is the caller's
 *  (a ChainLink's or a WorkbenchPick's onSelect sets open), or, with opens, a row the split draws at the head of the
 *  side column. facts: what is known of the chosen thing, under the side's picks; the picks give way and scroll,
 *  the facts keep to at most half the column and scroll apart. */
export const WorkbenchSplit = (props: { side: JSX.Element; facts?: JSX.Element; main: JSX.Element; open?: boolean; onOpenChange?: (open: boolean) => void; mainLabel?: string; opens?: string }) => {
  // Where the columns take turns, back from the main pane is the side column (its own Back button's step).
  createBack(() => props.open && props.onOpenChange && matchMedia(PHONE_LAYOUT_QUERY).matches, () => props.onOpenChange?.(false));
  return <div class={props.open ? "ui-workbench-split ui-workbench-split-open" : "ui-workbench-split"}>
    <Show when={props.facts} fallback={<div class="ui-workbench-side">
      <Show when={props.opens}><Row density="nav" element="button" class="ui-workbench-opens" end={<Icons.ChevronRight />} onClick={() => props.onOpenChange?.(true)}>{props.opens}</Row></Show>
      {props.side}
    </div>}>
      <div class="ui-workbench-side ui-workbench-side-parts">
        <div class="ui-workbench-picks">{props.side}</div>
        <div class="ui-workbench-facts">{props.facts}</div>
      </div>
    </Show>
    <section class="ui-workbench-main">
      <Row density="nav" element="button" class="ui-workbench-back" lead={<Icons.ChevronLeft />} onClick={() => props.onOpenChange?.(false)}>{props.mainLabel || "Back"}</Row>
      {props.main}
    </section>
  </div>;
};
/** The main pane as two columns: a short list and the pane of whichever of it is chosen (a document's skills and
 *  the chosen skill's text). On a phone the list sits over the pane. */
export const WorkbenchPair = (props: { list: JSX.Element; pane: JSX.Element }) => <div class="ui-workbench-pair">
  <div class="ui-workbench-pair-list">{props.list}</div>{props.pane}
</div>;
/** One of the things a workbench works on, in its side column: choosing it shows it in the main pane (current), and
 *  what is known of it at a glance (context) sits after its name. children: a control of its own at the end (its
 *  switch), beside the row and never inside it, so the control's press is not the row's. */
export const WorkbenchPick = (props: { name: string; context?: string; title?: string; current?: boolean; onSelect: () => void; children?: JSX.Element }) =>
  <div class="ui-workbench-pick">
    <Row density="nav" element="button" current={props.current} aria-pressed={Boolean(props.current)} title={props.title} context={props.context} onClick={() => props.onSelect()}>{props.name}</Row>
    {props.children}
  </div>;
/** A group of picks that folds, where a side column holds more than fits a look (Settings › Tools): its name, how
 *  many it holds, and its picks when open. One is open at a time by the caller's rule (the chosen thing's). */
export const WorkbenchFold = (props: { title: string; count?: number; open: boolean; onToggle: () => void; children: JSX.Element }) =>
  <div class="ui-workbench-fold">
    <Row density="nav" element="button" fold="quarter" aria-expanded={props.open} meta={props.count} onClick={() => props.onToggle()}>{props.title}</Row>
    <Show when={props.open}><div class="ui-workbench-fold-body">{props.children}</div></Show>
  </div>;
/** A titled group in the side column (Used in, Slots). */
/** A fact in a side section: its name (code: written in the text as is) and its value, quiet. */
export const WorkbenchFact = (props: { name: string; value?: string; title?: string; code?: boolean; children?: JSX.Element }) =>
  <Row density="line" class="ui-workbench-fact" title={props.title} label={props.code ? <code>{props.name}</code> : props.name} context={props.value} end={props.children} />;

/** A quiet line in a Group or under a title: what there is none of, or what follows (Conduit then adds…). */

/* A TextEditor's head (its `head` slot), here so a page can draw it without loading CodeMirror. live: what it shows
 * is filled in as it stands, quieter. */
