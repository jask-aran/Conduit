import { dragRegion } from "./window";
import { Frost } from "./frost";
import { children, createContext, Show, splitProps, untrack, useContext, type JSX } from "solid-js";
import { createFolds, watchFit } from "./fit";
import "./layout";
import { PaneMark } from "./row";
import { Button } from "./controls";
import { holds } from "./shared";

export type PaneHeaderKind = "pane" | "tool" | "file" | "term";
const TERM_FOLDS = ["shortcuts", "labels"] as const;
const TOOL_FOLDS = ["labels", "name"] as const;

/* The same letter the sidebar's PaneMark gives the chats open in that pane. */
const PaneLetterContext = createContext<() => string | undefined>(() => undefined);
export const PaneLetter = (props: { letter?: string; children?: JSX.Element }) =>
  <PaneLetterContext.Provider value={() => props.letter}>{props.children}</PaneLetterContext.Provider>;

function fitFileHeader(header: HTMLElement) {
  const fit = () => {
    // The name needs room for at least the file's own name, measured from its text; headed by tabs, every tab is the
    // name (their data-need), and the actions fold before a tab does.
    const name = header.querySelector<HTMLElement>(".ui-file-name > span");
    const tabs = header.querySelector<HTMLElement>(".ui-pane-tabs[data-need]");
    const nameFits = () => {
      if (!name && tabs) return tabs.clientWidth + 1 >= Number(tabs.dataset.need);
      const text = name?.firstChild;
      if (!name || !(text instanceof Text)) return true;
      const range = document.createRange();
      range.setStart(text, text.data.lastIndexOf("/") + 1);
      range.setEnd(text, text.data.length);
      return name.clientWidth + 1 >= range.getBoundingClientRect().width;
    };
    const squeezed = () => header.scrollWidth > header.clientWidth || !nameFits();
    const foldable = [...header.querySelectorAll<HTMLElement>("[data-fold]")].sort((a, b) => Number(a.dataset.fold) - Number(b.dataset.fold));
    foldable.forEach((element) => element.removeAttribute("data-folded"));
    const gone: string[] = [];
    for (const element of foldable) {
      if (!squeezed()) break;
      element.setAttribute("data-folded", "");
      gone.push(element.dataset.fold!);
    }
    if (header.dataset.foldedActions !== gone.join()) {
      header.dataset.foldedActions = gone.join();
      header.dispatchEvent(new CustomEvent("headerfold", { detail: gone }));
    }
  };
  watchFit(header, fit, { content: fit, attributes: ["data-need"] });
  queueMicrotask(fit);
}

export function PaneHeader(props: JSX.HTMLAttributes<HTMLElement> & {
  kind?: PaneHeaderKind; ref?: HTMLElement | ((element: never) => void);
  lead?: JSX.Element; pill?: JSX.Element; after?: JSX.Element; frost?: boolean; actions?: JSX.Element;
  name?: string; nameTitle?: string; place?: string; placeTitle?: string; modes?: JSX.Element; views?: JSX.Element;
  fit?: boolean;
}) {
  const kind = untrack(() => props.kind ?? "pane");
  const letter = useContext(PaneLetterContext);
  const mark = () => <Show when={letter()}>{(pane) => <PaneMark pane={pane()} self />}</Show>;
  if (kind === "file") {
    const [local, rest] = splitProps(props, ["kind", "class", "children"]);
    return <header ref={fitFileHeader} {...(rest as JSX.HTMLAttributes<HTMLElement>)} class="ui-pane-header" data-header="file">{mark()}{local.children}</header>;
  }
  if (kind === "tool") {
    const [local, rest] = splitProps(props, ["kind", "name", "nameTitle", "place", "placeTitle", "modes", "views", "actions", "children", "class", "lead", "pill", "after", "frost", "fit"]);
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
  const title = children(() => local.children);
  return <header {...(rest as JSX.HTMLAttributes<HTMLElement>)} class="ui-pane-header" data-header="pane" data-frost={local.frost ? "" : undefined} data-tauri-drag-region={dragRegion()}>
    {mark()}
    <Show when={local.lead}><div class="ui-header-group" data-lead="">{local.lead}</div></Show>
    <div class="ui-header-title" data-tabs={holds(title(), "ui-tabs-row") ? "" : undefined}>{title()}</div>
    {local.pill}
    {local.after}
    {local.modes}
    <div class="ui-header-group" data-actions="">{local.actions}</div>
  </header>;
}

export function Heading(props: { kind: "browser" | "editor" | "connection"; live?: boolean; mark?: JSX.Element; children: JSX.Element }) {
  const kind = untrack(() => props.kind);
  if (kind === "editor") return <span class="ui-heading" data-heading="editor" data-live={props.live ? "" : undefined}>{props.children}</span>;
  if (kind === "connection") return <header class="ui-heading" data-heading="connection">{props.mark}<h1>{props.children}</h1></header>;
  return <h2 class="ui-heading" data-heading="browser">{props.children}</h2>;
}

export function HeaderCrumb(props: { place?: string; onPlace?: () => void; title: string; mark?: JSX.Element }) {
  return <nav aria-label="breadcrumb" class="ui-header-crumb">
    <Show when={props.place}>
      <Show when={props.onPlace} fallback={<span class="ui-header-place">{props.place}</span>}>
        <button type="button" class="ui-header-place" tabIndex={-1} onClick={() => props.onPlace?.()}>{props.place}</button>
      </Show>
    </Show>
    <Show when={props.mark}><span class="ui-header-mark" aria-hidden="true">{props.mark}</span></Show>
    <strong>{props.title}</strong>
  </nav>;
}

export interface HeaderPillCount { value: number; label: string; open?: boolean; onClick: () => void }

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

export function HeaderButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: JSX.Element; only?: "phone" | "desktop" }) {
  const [local, rest] = splitProps(props, ["label", "icon", "only"]);
  return <Button variant="ghost" size="icon-sm" tabIndex={-1} aria-label={local.label} title={local.label} {...rest} data-only={local.only}>{local.icon}</Button>;
}

