import { dragRegion } from "./window";
import { Frost } from "./frost";
import { createContext, Show, splitProps, untrack, useContext, type JSX } from "solid-js";
import { createFolds } from "./fit";
import "./layout";
import { PaneMark } from "./row";
import { Button } from "./controls";

/* Header: on a phone the title gives way, and the leading controls, the page's name (HeaderPill) and the actions float
   over the transcript as frost pills (DESIGN Phone header pills). */

/** Where a pane's top line is: a page's (pane), a tool's in the dock or a pane (tool), a file's (file), a terminal's (term). */
export type PaneHeaderKind = "pane" | "tool" | "file" | "term";
/** What a terminal's header folds as it narrows, first to last: the shortcuts into the ⋯, then the actions' labels. */
const TERM_FOLDS = ["shortcuts", "labels"] as const;
/** What a tool's header gives up as it narrows (data-compact), first to last. */
const TOOL_FOLDS = ["labels", "name"] as const;

/**
 * PaneHeader: a pane's top line (DESIGN The top line, Pane header), by kind:
 *   pane   lead (the phone's leading controls; a desktop's sidebar head holds them), the title (children), pill (a
 *          phone's HeaderPill), after (a Notice kind=header), actions; frost: the strip is frost, for a tab row over the transcript
 *   tool   its name, the place it shows (the dock follows places), modes (a Segmented), views, controls, drag handle; fit
 *   file   what the file is, then controls in a fixed order (save, actions, tools, the ⋯, close)
 *   term   leading controls, identity, shortcuts, overflow, actions. While content overflows or the identity is cut, the
 *          next fold goes (TERM_FOLDS); each returns once the header is as wide as it needed. New content re-measures unfolded.
 */
/* The letter of the pane a header heads (Sheet's `pane`), when there are several: PaneHeader draws it first, the same
   letter the sidebar's PaneMark gives the chats open there. */
const PaneLetterContext = createContext<() => string | undefined>(() => undefined);
export const PaneLetter = (props: { letter?: string; children?: JSX.Element }) =>
  <PaneLetterContext.Provider value={() => props.letter}>{props.children}</PaneLetterContext.Provider>;

export function PaneHeader(props: JSX.HTMLAttributes<HTMLElement> & {
  kind?: PaneHeaderKind; ref?: HTMLElement | ((element: never) => void);
  lead?: JSX.Element; pill?: JSX.Element; after?: JSX.Element; frost?: boolean; actions?: JSX.Element;
  name?: string; nameTitle?: string; place?: string; placeTitle?: string; modes?: JSX.Element; views?: JSX.Element;
  /** tool: drop the modes' labels, then the name, as they stop fitting (data-compact). */
  fit?: boolean;
}) {
  const kind = untrack(() => props.kind ?? "pane");
  const letter = useContext(PaneLetterContext);
  const mark = () => <Show when={letter()}>{(pane) => <PaneMark pane={pane()} self />}</Show>;
  if (kind === "file") {
    const [local, rest] = splitProps(props, ["kind", "class", "children"]);
    return <header {...(rest as JSX.HTMLAttributes<HTMLElement>)} class="ui-pane-header" data-header="file">{mark()}{local.children}</header>;
  }
  if (kind === "tool") {
    const [local, rest] = splitProps(props, ["kind", "name", "nameTitle", "place", "placeTitle", "modes", "views", "actions", "children", "class", "lead", "pill", "after", "frost", "fit"]);
    // Measured, not a width.
    const folds = createFolds(2, { content: true });
    const fitHeader = (element: HTMLElement) => { if (untrack(() => local.fit)) folds.ref(element); };
    return <header ref={fitHeader} {...(rest as JSX.HTMLAttributes<HTMLElement>)} class="ui-pane-header" data-header="tool" data-compact={TOOL_FOLDS[folds.count() - 1]} data-frost={local.frost ? "" : undefined}>
      {mark()}
      <strong title={local.nameTitle}>{local.name}</strong>
      <Show when={local.place}><span class="ui-tool-place ui-truncate" title={local.placeTitle}>{local.place}</span></Show>
      {local.modes}
      {local.views}
      <div class="ui-tool-actions">{local.actions}</div>
    </header>;
  }
  if (kind === "term") {
    const [local, rest] = splitProps(props, ["kind", "children", "actions", "class", "ref"]);
    // The identity's title and context truncate rather than overflow: what they cut is what is missing.
    const folds = createFolds(TERM_FOLDS.length, { content: true, over: (header) => {
      const parts = [...header.querySelectorAll<HTMLElement>(".ui-term-identity > *")];
      return Math.max(header.scrollWidth - header.clientWidth, parts.reduce((cut, part) => cut + Math.max(0, part.scrollWidth - part.clientWidth), 0));
    } });
    return <header ref={folds.ref} data-surface="ground" {...(rest as JSX.HTMLAttributes<HTMLElement>)} class="ui-pane-header" data-header="term"
      data-folded={TERM_FOLDS.slice(0, folds.count()).join(" ") || undefined} data-tauri-drag-region={dragRegion()}>{mark()}{local.children}{local.actions}</header>;
  }
  const [local, rest] = splitProps(props, ["kind", "lead", "pill", "after", "actions", "frost", "children", "class", "name", "nameTitle", "place", "placeTitle", "modes", "views"]);
  return <header {...(rest as JSX.HTMLAttributes<HTMLElement>)} class="ui-pane-header" data-header="pane" data-frost={local.frost ? "" : undefined} data-tauri-drag-region={dragRegion()}>
    {mark()}
    <Show when={local.lead}><div class="ui-header-group" data-lead="">{local.lead}</div></Show>
    <div class="ui-header-title">{local.children}</div>
    {local.pill}
    {local.after}
    <div class="ui-header-group" data-actions="">{local.actions}</div>
  </header>;
}

/** Heading: a title in its family's voice (under .ui-heading[data-heading]): the file browser's over a place (browser),
 *  a text editor's head (editor: live, it says the text is saved as typed), a connection screen's with its mark. */
export function Heading(props: { kind: "browser" | "editor" | "connection"; live?: boolean; mark?: JSX.Element; children: JSX.Element }) {
  const kind = untrack(() => props.kind);
  if (kind === "editor") return <span class="ui-heading" data-heading="editor" data-live={props.live ? "" : undefined}>{props.children}</span>;
  if (kind === "connection") return <header class="ui-heading" data-heading="connection">{props.mark}<h1>{props.children}</h1></header>;
  return <h2 class="ui-heading" data-heading="browser">{props.children}</h2>;
}

/** A page's name under its place (in the section label's caps, a link when onPlace); no place: the page is a place. */
export function HeaderCrumb(props: { place?: string; onPlace?: () => void; title: string }) {
  return <nav aria-label="breadcrumb" class="ui-header-crumb">
    <Show when={props.place}>
      <Show when={props.onPlace} fallback={<span class="ui-header-place">{props.place}</span>}>
        <button type="button" class="ui-header-place" tabIndex={-1} onClick={() => props.onPlace?.()}>{props.place}</button>
      </Show>
    </Show>
    <strong>{props.title}</strong>
  </nav>;
}

/** What waits by a header pill: a count in a frost capsule of its own beside it, opening what it counts. */
export interface HeaderPillCount { value: number; label: string; open?: boolean; onClick: () => void }

/** A phone's name for the page: its place's mark and title, wrapping to two lines, a frost pill between the header's
 *  groups. opens: a press opens the page's menu (MenuControl as={HeaderPill} opens), with no chevron to take its room.
 *  count: what waits on the person, its own press beside it; the two centre as one. */
export function HeaderPill(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon?: JSX.Element; opens?: boolean; count?: HeaderPillCount }) {
  const [local, rest] = splitProps(props, ["label", "icon", "opens", "count"]);
  const inner = () => <><Show when={local.icon}><span class="ui-header-pill-icon" aria-hidden="true">{local.icon}</span></Show><strong>{local.label}</strong></>;
  const pill = () => <Show when={local.opens} fallback={<Frost class="ui-header-pill">{inner()}</Frost>}>
    <Frost as="button" type="button" tabIndex={-1} {...rest} class="ui-header-pill">{inner()}</Frost>
  </Show>;
  return <Show when={local.count} fallback={pill()}>{(count) => <span class="ui-header-pills">
    {pill()}
    <Frost as="button" type="button" tabIndex={-1} class="ui-header-count" aria-label={count().label} title={count().label}
      aria-expanded={count().open} onClick={() => count().onClick()}>{count().value}</Frost>
  </span>}</Show>;
}

/** One of the header's controls: an icon, its label as its name. only: drawn on that layout alone. */
export function HeaderButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: JSX.Element; only?: "phone" | "desktop" }) {
  const [local, rest] = splitProps(props, ["label", "icon", "only"]);
  return <Button variant="ghost" size="icon-sm" tabIndex={-1} aria-label={local.label} title={local.label} {...rest} data-only={local.only}>{local.icon}</Button>;
}

