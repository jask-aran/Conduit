import { dragRegion } from "./window";
import { Frost } from "./frost";
import { createContext, onCleanup, onMount, Show, splitProps, untrack, useContext, type JSX } from "solid-js";
import { PaneMark } from "./row";
import { Button } from "./controls";

/*
 * Header: a pane's top line (DESIGN The top line, Pane header). The name or the tab row at the left, what the page
 * is beside it, quiet controls at the right. On a phone the title gives way, and the leading controls, the page's
 * name (HeaderPill) and the actions float over the transcript as frost pills (DESIGN Phone header pills).
 */

/** lead: the phone's leading controls (the sidebar's toggle, New chat); on a desktop the sidebar's head holds them.
 *  pill: a phone's name for the page between its groups (HeaderPill); a desktop's title says it.
 *  after: beside the title (a HeaderNote). frost: the strip itself is frost, for a tab row read
 *  over the transcript scrolling under it. */
/** Where a pane's top line is: a page's (pane), a tool's in the dock or a pane (tool), a file's (file), a terminal's (term). */
export type PaneHeaderKind = "pane" | "tool" | "file" | "term";
/** What a terminal's header folds when it is too narrow, first to last: the shortcuts into the ⋯, then the actions' labels. */
const TERM_FOLDS = ["shortcuts", "labels"] as const;

/**
 * PaneHeader: a pane's top line (DESIGN The top line, Pane header), the kind its family's (under
 * .ui-pane-header[data-header]):
 *
 *   pane   a page's: lead (the phone's leading controls), the title (children), pill (a phone's name for the page),
 *          after (beside the title: a HeaderNote), actions; frost: the strip itself is frost, for a tab row read over
 *          the transcript scrolling under it
 *   tool   a tool's in the dock or a pane: its name, the place it shows (the dock follows places), its modes (a
 *          Segmented), views and controls; fit: it measures itself short (compact: "labels", "name"). Its drag handle.
 *   file   a file's: what the file is, then its controls in a fixed order (save, actions, tools, the ⋯, close)
 *   term   a terminal's: leading controls, identity, shortcuts, overflow, then actions. It folds by measure: while its
 *          content overflows or the identity's title or context is cut, the next fold goes (TERM_FOLDS); each comes
 *          back once the header is as wide as it was needed at. A change to what it holds measures it again unfolded.
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
    // The header holds the view's name and its modes. When they stop fitting,
    // the modes drop their labels, then the name goes: measured, not a width.
    const fitHeader = (element: HTMLElement) => {
      if (!untrack(() => local.fit)) return;
      const fit = () => {
        element.removeAttribute("data-compact");
        if (element.scrollWidth <= element.clientWidth) return;
        element.setAttribute("data-compact", "labels");
        if (element.scrollWidth > element.clientWidth) element.setAttribute("data-compact", "name");
      };
      // Its width changing, or what it holds: another view's name and modes.
      const resized = new ResizeObserver(fit);
      const changed = new MutationObserver(fit);
      resized.observe(element);
      changed.observe(element, { childList: true, subtree: true, characterData: true });
      onCleanup(() => { resized.disconnect(); changed.disconnect(); });
    };
    return <header ref={fitHeader} {...(rest as JSX.HTMLAttributes<HTMLElement>)} class="ui-pane-header" data-header="tool" data-frost={local.frost ? "" : undefined}>
      {mark()}
      <strong title={local.nameTitle}>{local.name}</strong>
      <Show when={local.place}><span class="ui-tool-place" title={local.placeTitle}>{local.place}</span></Show>
      {local.modes}
      {local.views}
      <div class="ui-tool-actions">{local.actions}</div>
    </header>;
  }
  if (kind === "term") {
    const [local, rest] = splitProps(props, ["kind", "children", "actions", "class", "ref"]);
    let header!: HTMLElement;
    onMount(() => {
      let folds = 0;
      const needs: number[] = [];
      const set = (count: number) => { folds = count; if (count) header.dataset.folded = TERM_FOLDS.slice(0, count).join(" "); else delete header.dataset.folded; };
      const over = () => {
        // The identity's title and context truncate rather than overflow: what they cut is what is missing.
        const parts = [...header.querySelectorAll<HTMLElement>(".ui-term-identity > *")];
        return Math.max(header.scrollWidth - header.clientWidth, parts.reduce((cut, part) => cut + Math.max(0, part.scrollWidth - part.clientWidth), 0));
      };
      const fit = (fresh = false) => {
        if (!header.clientWidth) return;
        if (fresh) set(0);
        while (folds && header.clientWidth >= needs[folds - 1]!) set(folds - 1);
        for (let cut = over(); cut > 0.5 && folds < TERM_FOLDS.length; cut = over()) { needs[folds] = header.clientWidth + cut; set(folds + 1); }
      };
      const resize = new ResizeObserver(() => fit());
      const content = new MutationObserver(() => fit(true));
      resize.observe(header);
      content.observe(header, { childList: true, subtree: true, characterData: true });
      fit(true);
      onCleanup(() => { resize.disconnect(); content.disconnect(); });
    });
    return <header ref={header} data-surface="ground" {...(rest as JSX.HTMLAttributes<HTMLElement>)} class="ui-pane-header" data-header="term" data-tauri-drag-region={dragRegion()}>{mark()}{local.children}{local.actions}</header>;
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

/** A page's name under its place: the place in the section label's caps (a link when onPlace), then the title.
 *  No place: the page is a place itself. */
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

/** A phone's name for the page: its place's mark (a folder, a workspace's glyph, Conduit's for a chat in no folder)
 *  and its title, wrapping to two lines, a frost pill between the header's groups. opens: a press opens the page's
 *  menu (MenuControl as={HeaderPill} opens); the pill says so by being pressable, with no chevron to take its room.
 *  count: a number beside it (what waits on the person), its own press; the two are centred as one. */
export function HeaderPill(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon?: JSX.Element; opens?: boolean; count?: HeaderPillCount }) {
  const [local, rest] = splitProps(props, ["label", "icon", "opens", "count"]);
  const inner = () => <><Show when={local.icon}><span class="ui-header-pill-icon" aria-hidden="true">{local.icon}</span></Show><strong>{local.label}</strong></>;
  const pill = () => <Show when={local.opens} fallback={<div class="ui-header-pill" data-surface="frost">{inner()}</div>}>
    <button type="button" tabIndex={-1} {...rest} class="ui-header-pill" data-surface="frost">{inner()}</button>
  </Show>;
  return <Show when={local.count} fallback={pill()}>{(count) => <span class="ui-header-pills">
    {pill()}
    <button type="button" tabIndex={-1} class="ui-header-count" data-surface="frost" aria-label={count().label} title={count().label}
      aria-expanded={count().open} onClick={() => count().onClick()}>{count().value}</button>
  </span>}</Show>;
}

/** One of the header's controls: an icon, its label as its name. only: drawn on that layout alone. */
export function HeaderButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: JSX.Element; only?: "phone" | "desktop" }) {
  const [local, rest] = splitProps(props, ["label", "icon", "only"]);
  return <Button variant="ghost" size="icon-sm" tabIndex={-1} aria-label={local.label} title={local.label} {...rest} data-only={local.only}>{local.icon}</Button>;
}

/** Beside the title: what the page is, when that needs saying, and the one thing to do about it. A capsule of frost. */
export function HeaderNote(props: { label: string; title?: string; action?: { label: string; name?: string; busy?: boolean; busyLabel?: string; onClick: () => void } }) {
  return <Frost as="span" class="ui-header-note" title={props.title}>
    <span>{props.label}</span>
    <Show when={props.action}>{(action) =>
      <button type="button" tabIndex={-1} disabled={action().busy} aria-label={action().name ?? action().label} onClick={() => action().onClick()}>{action().busy ? action().busyLabel ?? action().label : action().label}</button>}
    </Show>
  </Frost>;
}
