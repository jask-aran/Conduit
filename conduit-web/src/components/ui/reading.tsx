import * as Icons from "./icons";
import { Show, splitProps, type JSX } from "solid-js";

import { Gauge, Swatch } from "./controls";

export const Reading = (props: { children: JSX.Element }) => <div class="ui-reading">{props.children}</div>;

export const ReadingTotal = (props: { label: JSX.Element; value?: JSX.Element }) =>
  <div class="ui-reading-total"><span>{props.label}</span><Show when={props.value}><span class="ui-reading-figure">{props.value}</span></Show></div>;

export const ReadingParts = (props: { label?: string; children: JSX.Element }) => <ul class="ui-reading-parts" aria-label={props.label}>{props.children}</ul>;

export function ReadingPart(props: Omit<JSX.LiHTMLAttributes<HTMLLIElement>, "class" | "value"> & { label: JSX.Element; value?: JSX.Element; colour?: string; hollow?: boolean; opens?: boolean; expanded?: boolean; sub?: boolean }) {
  const [, rest] = splitProps(props, ["label", "value", "colour", "hollow", "opens", "expanded", "sub"]);
  return <li {...rest} class="ui-reading-part" aria-expanded={props.opens ? !!props.expanded : undefined} data-sub={props.sub ? "" : undefined}>
    <Swatch colour={props.colour} hollow={props.hollow} />
    <span class="ui-reading-name ui-truncate">{props.label}</span>
    <Show when={props.value}><span class="ui-reading-value">{props.value}</span></Show>
    <Show when={props.opens}><Icons.ChevronRight class="ui-reading-chevron ui-fold-chevron" aria-hidden="true" /></Show>
  </li>;
}

export const ReadingStats = (props: { title: string; children: JSX.Element }) =>
  <section class="ui-reading-group" aria-label={props.title}><h4>{props.title}</h4><dl class="ui-reading-stats">{props.children}</dl></section>;

export const ReadingStat = (props: { value: JSX.Element; label: string; detail?: JSX.Element }) =>
  <div class="ui-reading-stat"><dt>{props.label}</dt><dd>{props.value}</dd><Show when={props.detail}><dd>{props.detail}</dd></Show></div>;

export const ReadingFoot = (props: { children: JSX.Element; action?: JSX.Element }) =>
  <div class="ui-reading-foot"><span>{props.children}</span>{props.action}</div>;

export const GaugeFigure = (props: { value: number; tone?: "idle" | "normal" | "warning" | "critical"; used: string; of?: string; label: string }) =>
  <span class="ui-gauge-figure" role="img" aria-label={props.label} title={props.label}><Gauge value={props.value} tone={props.tone} />
    <span>{props.used}<Show when={props.of}><small> / {props.of}</small></Show></span></span>;
