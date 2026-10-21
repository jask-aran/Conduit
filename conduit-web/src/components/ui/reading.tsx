import { Show, splitProps, type JSX } from "solid-js";
import { ChevronRightIcon } from "lucide-solid";
import { Swatch } from "./controls";

/*
 * Reading: what a gauge measures, laid out to be read at a glance -- the context window in the composer's gauge
 * and the chat menu's Context (DESIGN Readings). Under its Meter, one line of totals; the parts as a legend; the
 * figures beside them (a cache, a plan's windows) as tiles, each a number over its name; a caption at its foot.
 * Every line is the caption's size: the numbers in the data face, the names in the text's, so nothing outweighs
 * the bar. Shapes only; what is measured and what a part does stay with the caller.
 */
export const Reading = (props: { children: JSX.Element }) => <div class="ui-reading">{props.children}</div>;

/** The totals under the bar: what is used of what there is (and where it compacts), a figure at the end. */
export const ReadingTotal = (props: { label: JSX.Element; value?: JSX.Element }) =>
  <div class="ui-reading-total"><span>{props.label}</span><Show when={props.value}><span>{props.value}</span></Show></div>;

/** The parts, a legend of the bar: each its colour, its name, its share. */
export const ReadingParts = (props: { label?: string; children: JSX.Element }) => <ul class="ui-reading-parts" aria-label={props.label}>{props.children}</ul>;

/** One part. hollow: room rather than content (free space). opens: it holds parts of its own, shown under it while
 *  expanded; the caller makes it act (role="button", its keys). sub: one of those, under its part. */
export function ReadingPart(props: Omit<JSX.LiHTMLAttributes<HTMLLIElement>, "class" | "value"> & { label: JSX.Element; value?: JSX.Element; colour?: string; hollow?: boolean; opens?: boolean; expanded?: boolean; sub?: boolean }) {
  const [, rest] = splitProps(props, ["label", "value", "colour", "hollow", "opens", "expanded", "sub"]);
  return <li {...rest} class="ui-reading-part" aria-expanded={props.opens ? !!props.expanded : undefined} data-sub={props.sub ? "" : undefined}>
    <Swatch colour={props.colour} hollow={props.hollow} />
    <span class="ui-reading-name">{props.label}</span>
    <Show when={props.value}><span class="ui-reading-value">{props.value}</span></Show>
    <Show when={props.opens}><ChevronRightIcon class="ui-reading-chevron" aria-hidden="true" /></Show>
  </li>;
}

/** The figures beside the parts, side by side, each a tile. */
export const ReadingStats = (props: { label?: string; children: JSX.Element }) => <dl class="ui-reading-stats" aria-label={props.label}>{props.children}</dl>;

/** One figure: its number, its name in the label's voice, and a line under it (when it resets, what it is of). */
export const ReadingStat = (props: { value: JSX.Element; label: string; detail?: JSX.Element }) =>
  <div class="ui-reading-stat"><dt>{props.label}</dt><dd>{props.value}</dd><Show when={props.detail}><dd>{props.detail}</dd></Show></div>;

/** The foot: what is being measured (a model, its plan), and one quiet control at the end (a session's copy). */
export const ReadingFoot = (props: { children: JSX.Element; action?: JSX.Element }) =>
  <div class="ui-reading-foot"><span>{props.children}</span>{props.action}</div>;
