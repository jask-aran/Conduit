import { Show, splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { cn } from "@/lib/utils";

/**
 * Row: one line in a list -- a mark, the title (a detail under it), muted context after it, data at its end and a
 * control's room after that. Every row is one: the sidebar's (density nav), a page's list (list), a menu's (menu:
 * popover.tsx's Item is a Row with a menu's own parts). The density sets its height, padding, voice and cursor
 * (styles/row.css, then nav.css, dashboard.css and popover.css); the states say where you are and what is chosen.
 *
 * element: a button when it does one thing, a link when it goes somewhere, a div when it holds controls of its own.
 * bare: the children are the row's whole inside (a composition with parts of its own: a menu item, a folder's row).
 */
export type RowDensity = "nav" | "list" | "menu";

export type RowProps = {
  density?: RowDensity;
  element?: "button" | "a" | "div";
  /** The leading mark (an icon, a glyph, a harness's mark). A list row keeps its room even without one. */
  lead?: JSX.Element;
  /** The title, when it is not the children (a list row's, passed with its other parts). */
  label?: JSX.Element;
  /** A second, muted line under the title. */
  detail?: JSX.Element;
  /** Muted words after the title, on its line (a folder, a source). A list row keeps their room, so its data stays at the end. */
  context?: JSX.Element;
  /** Data at the end (a count, a time): muted. */
  meta?: JSX.Element;
  /** A mark or a control at the very end, in a control's room. */
  end?: JSX.Element;
  /** Under the row it belongs to; 2: under one of those. */
  indent?: boolean | 2;
  /** Where you are. */
  current?: boolean;
  /** Holds where you are (a folder holding the open chat): drawn as current. */
  within?: boolean;
  /** Open, but not where you are (the chat in the other pane). */
  open?: boolean;
  /** Chosen for an action on several. */
  selected?: boolean;
  /** Smaller and quieter: a row that leads elsewhere ("View all"). */
  quiet?: boolean;
  bare?: boolean;
  class?: string;
  children?: JSX.Element;
  /** Any element's ref: a row is whichever element it is drawn as. */
  ref?: HTMLElement | ((element: never) => void);
}
  & Omit<JSX.HTMLAttributes<HTMLElement>, "children" | "ref" | "class">
  & Partial<Pick<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "target" | "rel">>
  & Partial<Pick<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "type" | "disabled">>;

const PARTS = ["density", "element", "lead", "label", "detail", "context", "meta", "end", "indent", "current", "within", "open", "selected", "quiet", "bare", "class", "children"] as const;

export function Row(props: RowProps) {
  const [local, rest] = splitProps(props, PARTS);
  const density = () => local.density ?? "list";
  const element = () => local.element ?? "div";
  // A list row always draws its mark's room and its context's, so a column of them lines up and its data sits at the end.
  const keepsRoom = () => density() === "list";
  // The row is a button, a link or a div: its attributes are passed through as the element it is.
  return <Dynamic component={element()} type={element() === "button" ? "button" : undefined} {...(rest as Record<string, unknown>)}
    class={cn("ui-row", local.class)} data-density={density()}
    data-indent={local.indent === 2 ? "2" : local.indent ? "" : undefined}
    aria-current={local.current && density() !== "list" ? "page" : undefined}
    data-current={local.current && density() === "list" ? "" : undefined}
    data-within={local.within ? "" : undefined} data-open={local.open ? "" : undefined}
    data-selected={local.selected ? "" : undefined} data-quiet={local.quiet ? "" : undefined}>
    <Show when={!local.bare} fallback={local.children}>
      <Show when={local.lead !== undefined || keepsRoom()}><span class="ui-row-lead">{local.lead}</span></Show>
      <Show when={local.detail} fallback={<span class="ui-row-title">{local.label ?? local.children}</span>}>
        <span class="ui-row-title" data-stacked=""><span>{local.label ?? local.children}</span><small class="ui-row-detail">{local.detail}</small></span>
      </Show>
      <Show when={local.context !== undefined || keepsRoom()}><span class="ui-row-context">{local.context}</span></Show>
      <Show when={local.meta}><small class="ui-row-meta">{local.meta}</small></Show>
      <Show when={local.end}><span class="ui-row-end">{local.end}</span></Show>
    </Show>
  </Dynamic>;
}

/**
 * Where a document is open: the letter of the pane holding it (A, then the panes beside it, then the dock's, in
 * reading order), in Paper Mono at a row's end (its meta). shown: the pane's showing tab, at the foreground; a tab
 * behind another, muted.
 */
export const PaneMark = (props: { pane: string; shown?: boolean }) =>
  <span class="ui-pane-mark" data-shown={props.shown ? "" : undefined} title={props.shown ? `Showing in pane ${props.pane}` : `A tab in pane ${props.pane}`}
    aria-label={props.shown ? `showing in pane ${props.pane}` : `a tab in pane ${props.pane}`}>{props.pane}</span>;
