import { children, createComputed, createContext, createSignal, onCleanup, Show, useContext, type JSX } from "solid-js";
import { createBack } from "./back";
import { PHONE_LAYOUT_QUERY } from "./layout";
import { Note } from "./state";
import { Row } from "./row";
import * as Icons from "./icons";
import { holds } from "./shared";

/** Told by the split whether its main side is open, which a phone shows in place of the workbench's title. */
const SplitOpen = createContext<(open: boolean) => void>();
export function Workbench(props: { label: string; children: JSX.Element }) {
  const [open, setOpen] = createSignal(false);
  return <div class="ui-workbench" role="region" aria-label={props.label} data-open={open() ? "" : undefined}><SplitOpen.Provider value={setOpen}>{props.children}</SplitOpen.Provider></div>;
}
export const WorkbenchTitle = (props: { title: JSX.Element; actions?: JSX.Element; meta?: string }) => <header class="ui-workbench-title">
  <div class="ui-workbench-title-line">{typeof props.title === "string" ? <h3 class="ui-workbench-name">{props.title}</h3> : props.title}<Show when={props.actions}><span class="ui-workbench-actions">{props.actions}</span></Show></div>
  <Show when={props.meta}><Note kind="workbench">{props.meta}</Note></Show>
</header>;
export const WorkbenchSplit = (props: { side: JSX.Element; facts?: JSX.Element; main: JSX.Element; open?: boolean; onOpenChange?: (open: boolean) => void; mainLabel?: string; opens?: string }) => {
  createBack(() => props.open && props.onOpenChange && matchMedia(PHONE_LAYOUT_QUERY).matches, () => props.onOpenChange?.(false));
  const tell = useContext(SplitOpen);
  if (tell) createComputed(() => { if (!props.open) return; tell(true); onCleanup(() => tell(false)); });
  const side = children(() => props.side);
  return <div class={props.open ? "ui-workbench-split ui-workbench-split-open" : "ui-workbench-split"}>
    <Show when={props.facts} fallback={<div class="ui-workbench-side">
      <Show when={props.opens}><Row density="nav" element="button" class="ui-workbench-opens" end={<Icons.ChevronRight />} onClick={() => props.onOpenChange?.(true)}>{props.opens}</Row></Show>
      {side()}
    </div>}>
      <div class="ui-workbench-side ui-workbench-side-parts">
        <div class="ui-workbench-picks" data-folds={holds(side(), "ui-workbench-fold") ? "" : undefined}>{side()}</div>
        <div class="ui-workbench-facts">{props.facts}</div>
      </div>
    </Show>
    <section class="ui-workbench-main">
      <Row density="nav" element="button" class="ui-workbench-back" lead={<Icons.ChevronLeft />} onClick={() => props.onOpenChange?.(false)}>{props.mainLabel || "Back"}</Row>
      {props.main}
    </section>
  </div>;
};
export const WorkbenchPair = (props: { list: JSX.Element; pane: JSX.Element }) => <div class="ui-workbench-pair">
  <div class="ui-workbench-pair-list">{props.list}</div>{props.pane}
</div>;
/** children sit beside the row and never inside it, so the control's press is not the row's. */
export const WorkbenchPick = (props: { name: string; context?: string; title?: string; current?: boolean; onSelect: () => void; children?: JSX.Element }) =>
  <div class="ui-workbench-pick">
    <Row density="nav" element="button" current={props.current} aria-pressed={Boolean(props.current)} title={props.title} context={props.context} onClick={() => props.onSelect()}>{props.name}</Row>
    {props.children}
  </div>;
export const WorkbenchFold = (props: { title: string; count?: number; open: boolean; onToggle: () => void; children: JSX.Element }) =>
  <div class="ui-workbench-fold">
    <Row density="nav" element="button" fold="quarter" aria-expanded={props.open} meta={props.count} onClick={() => props.onToggle()}>{props.title}</Row>
    <Show when={props.open}><div class="ui-workbench-fold-body">{props.children}</div></Show>
  </div>;
export const WorkbenchFact = (props: { name: string; value?: string; title?: string; code?: boolean; children?: JSX.Element }) =>
  <Row density="line" class="ui-workbench-fact" title={props.title} label={props.code ? <code>{props.name}</code> : props.name} context={props.value} end={props.children} />;
