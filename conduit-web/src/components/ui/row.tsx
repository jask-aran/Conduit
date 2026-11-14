import { children, Show, splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { cn } from "@/lib/utils";
import { callHandler, holds } from "./shared";
import { feel, type HapticProp } from "./haptics";
import * as Icons from "./icons";

export type RowDensity = "nav" | "list" | "menu" | "line" | "trail" | "tree";

export type RowProps = {
  density?: RowDensity;
  element?: "button" | "a" | "div" | "label";
  lead?: JSX.Element;
  label?: JSX.Element;
  detail?: JSX.Element;
  context?: JSX.Element;
  meta?: JSX.Element;
  end?: JSX.Element;
  indent?: boolean | 2;
  depth?: number;
  fold?: "quarter" | "half";
  current?: boolean;
  within?: boolean;
  open?: boolean;
  selected?: boolean;
  quiet?: boolean;
  bare?: boolean;
  haptic?: HapticProp;
  class?: string;
  children?: JSX.Element;
  ref?: HTMLElement | ((element: never) => void);
}
  & Omit<JSX.HTMLAttributes<HTMLElement>, "children" | "ref" | "class">
  & Partial<Pick<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "target" | "rel">>
  & Partial<Pick<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "type" | "disabled">>;

const PARTS = ["density", "element", "lead", "label", "detail", "context", "meta", "end", "indent", "depth", "fold", "current", "within", "open", "selected", "quiet", "bare", "haptic", "class", "children"] as const;

export function Row(props: RowProps) {
  const [local, rest] = splitProps(props, PARTS);
  const density = () => local.density ?? "list";
  const element = () => local.element ?? "div";
  const lead = children(() => local.lead);
  // A list row always draws its mark's room and its context's, so a column of them lines up and its data sits at the end.
  const keepsRoom = () => density() === "list";
  const click = (event: MouseEvent) => { if (element() !== "div") feel(local.haptic, "select"); callHandler(rest.onClick, event); };
  return <Dynamic component={element()} type={element() === "button" ? "button" : undefined} {...(rest as Record<string, unknown>)}
    onClick={click} class={cn("ui-row", local.class)} data-density={density()}
    data-indent={local.indent === 2 ? "2" : local.indent ? "" : undefined}
    style={local.depth ? { "--depth": local.depth } : undefined}
    aria-current={local.current && density() !== "list" ? "page" : undefined}
    data-current={local.current && density() === "list" ? "" : undefined}
    data-within={local.within ? "" : undefined} data-open={local.open ? "" : undefined}
    data-selected={local.selected ? "" : undefined} data-quiet={local.quiet ? "" : undefined}>
    <Show when={!local.bare} fallback={local.children}>
      <Show when={local.lead !== undefined || keepsRoom()}><span class="ui-row-lead" data-mark={holds(lead(), "ui-harness-mark") ? "" : undefined}>{lead()}</span></Show>
      <Show when={local.detail} fallback={<span class="ui-row-title">{local.label ?? local.children}</span>}>
        <span class="ui-row-title" data-stacked=""><span>{local.label ?? local.children}</span><small class="ui-row-detail">{local.detail}</small></span>
      </Show>
      <Show when={local.context !== undefined || keepsRoom()}><span class="ui-row-context">{local.context}</span></Show>
      <Show when={local.meta}><small class="ui-row-meta">{local.meta}</small></Show>
      <Show when={local.end}><span class="ui-row-end">{local.end}</span></Show>
      <Show when={local.fold}>{(turn) => turn() === "half"
        ? <Icons.ChevronDown class="ui-row-fold ui-fold-chevron ui-size-icon-sm" data-turn="half" aria-hidden="true" />
        : <Icons.ChevronRight class="ui-row-fold ui-fold-chevron ui-size-icon-sm" aria-hidden="true" />}</Show>
    </Show>
  </Dynamic>;
}

export const PaneMark = (props: { pane: string; shown?: boolean; self?: boolean }) =>
  <span class="ui-pane-mark" data-shown={props.shown ? "" : undefined} data-self={props.self ? "" : undefined}
    title={props.self ? `Pane ${props.pane}` : props.shown ? `Showing in pane ${props.pane}` : `A tab in pane ${props.pane}`}
    aria-label={props.self ? `pane ${props.pane}` : props.shown ? `showing in pane ${props.pane}` : `a tab in pane ${props.pane}`}>{props.pane}</span>;
