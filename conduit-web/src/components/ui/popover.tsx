import { Frost } from "./frost";
import * as Icons from "./icons";
import { For, Show, splitProps, type JSX } from "solid-js";

import { cn } from "@/lib/utils";
import { Keycap } from "./controls";
import { Row, type RowProps } from "./row";
import { type Density, type Motion, hovers, motionOf, moveCursor } from "./shared";

export type Measure = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
export function Menu(props: JSX.HTMLAttributes<HTMLDivElement> & { density?: Density; motion?: Motion; under?: boolean; wide?: boolean; unfolds?: boolean; width?: Measure; height?: Measure }) {
  const [, rest] = splitProps(props, ["class", "density", "motion", "under", "wide", "unfolds", "width", "height", "children", "style"]);
  const caps = () => ({ ...(props.width ? { "--menu-width": `var(--measure-${props.width})` } : {}), ...(props.height ? { "--menu-height": `var(--measure-${props.height})` } : {}), ...(typeof props.style === "object" ? props.style : {}) });
  return <Frost lift="raised" role="menu" class={cn("ui-menu", props.class)} onPointerOver={moveCursor} {...rest} style={caps()} data-wide={props.wide ? "" : undefined} data-unfolds={props.unfolds ? "" : undefined} data-fits="" data-density={props.density} data-under={props.under ? "" : undefined} {...motionOf(props.motion)}>{props.children}</Frost>;
}

export function Section(props: JSX.HTMLAttributes<HTMLDivElement> & { note?: JSX.Element; kind?: "list" | "slider"; scroll?: boolean }) {
  const [, rest] = splitProps(props, ["title", "note", "kind", "scroll", "children", "class", "role"]);
  return <div {...rest} role={props.role ?? "group"} aria-label={props.title} class="ui-section" data-kind={props.kind ?? "list"} data-scroll={props.scroll ? "" : undefined}>
    <Show when={props.title}><div class="ui-title"><span>{props.title}</span><Show when={props.note}><small>{props.note}</small></Show></div></Show>
    {props.children}
  </div>;
}

export function SearchSection(props: { placeholder: string; value?: string; keys?: string[]; onInput?: (value: string) => void; field?: JSX.InputHTMLAttributes<HTMLInputElement> }) {
  return <div role="search" class="ui-section ui-search-section" data-kind="search">
    <Icons.Search /><input {...props.field} class="ui-search" placeholder={props.placeholder} value={props.value ?? ""} onInput={(event) => props.onInput?.(event.currentTarget.value)} />
    <Show when={props.keys}><Keys keys={props.keys!} /></Show>
  </div>;
}

export const RowGroup = (props: { actions: JSX.Element; children: JSX.Element }) =>
  <div class="ui-row-group">{props.children}<span class="ui-row-actions">{props.actions}</span></div>;
export function RowAction(props: JSX.HTMLAttributes<HTMLDivElement> & { label: string; icon: JSX.Element; destructive?: boolean }) {
  const [local, rest] = splitProps(props, ["label", "icon", "destructive", "children"]);
  return <div role="menuitem" {...rest} class="ui-row-action" aria-label={local.label} title={local.label} data-destructive={local.destructive ? "" : undefined}>{local.icon}</div>;
}

export function Item(props: JSX.HTMLAttributes<HTMLDivElement> & {
  icon?: JSX.Element; meta?: JSX.Element; detail?: JSX.Element; keys?: string[]; opens?: boolean; active?: boolean;
  detailData?: boolean;
  field?: boolean;
  keysFirst?: boolean;
  checked?: boolean; disabled?: boolean; destructive?: boolean; children: JSX.Element;
  end?: JSX.Element; reveal?: boolean;
  away?: boolean;
  onCursor?: () => void;
  onOpens?: () => void; opensLabel?: string;
  indent?: boolean; picked?: boolean;
}) {
  const [, rest] = splitProps(props, ["icon", "meta", "detail", "detailData", "keys", "opens", "active", "field", "keysFirst", "checked", "disabled", "destructive", "children", "end", "class", "onOpens", "opensLabel", "indent", "picked", "reveal", "away", "onCursor"]);
  return <Row density="menu" bare role={props.checked !== undefined ? "menuitemradio" : "menuitem"} aria-checked={props.checked} data-field={props.field ? "" : undefined}
    data-highlighted={props.active ? "" : undefined} data-checked={props.checked ? "" : undefined} data-disabled={props.disabled ? "" : undefined} data-destructive={props.destructive ? "" : undefined} data-indent={props.indent ? "" : undefined} data-picked={props.picked ? "" : undefined} onPointerMove={props.onCursor ? (event: PointerEvent) => { if (hovers(event)) props.onCursor!(); } : undefined} {...(rest as unknown as RowProps)}>
    <Show when={props.picked !== undefined}><span class="ui-row-check ui-size-icon" aria-hidden="true"><Show when={props.picked}><Icons.Check /></Show></span></Show>
    <Show when={props.keysFirst && props.keys}><Keys keys={props.keys!} first /></Show>
    <Show when={props.icon}><span class="ui-icon">{props.icon}</span></Show><span class="ui-label" data-stacked={props.detail ? "" : undefined}><Show when={props.detail} fallback={props.children}><span>{props.children}</span><small class="ui-detail" data-data={props.detailData ? "" : undefined}>{props.detail}</small></Show></span>
    <Show when={props.meta}><small>{props.meta}</small></Show>
    <Show when={!props.keysFirst && props.keys}><Keys keys={props.keys!} /></Show>
    <Show when={props.opens}><Show when={props.onOpens} fallback={<Icons.ChevronRight class="ui-chevron ui-fold-chevron" />}>
      <button type="button" class="ui-chevron ui-fold-chevron" tabIndex={-1} aria-label={props.opensLabel} onMouseDown={(event) => event.preventDefault()} onClick={(event) => { event.stopPropagation(); props.onOpens?.(); }}><Icons.ChevronRight /></button>
    </Show></Show>
    <Show when={props.away && !props.opens}><Icons.ExternalLink class="ui-chevron" data-away="" aria-hidden="true" /></Show>
    <Show when={props.end}><span class="ui-row-end" data-reveal={props.reveal ? "" : undefined}>{props.end}</span></Show>
  </Row>;
}

export function matchedLetters(text: string, query: string): Set<number> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const lower = text.toLowerCase();
  const at = lower.indexOf(q);
  if (at >= 0) return new Set(Array.from({ length: q.length }, (_, index) => at + index));
  const hits = new Set<number>();
  let from = 0;
  for (const char of q.replace(/\s+/g, "")) {
    const index = lower.indexOf(char, from);
    if (index < 0) return null;
    hits.add(index); from = index + 1;
  }
  return hits;
}

export function Match(props: { text: string; query: string }) {
  const hits = () => matchedLetters(props.text, props.query);
  return <Show when={hits()} fallback={props.text}>{(lit) =>
    <span class="ui-match">{[...props.text].map((char, index) => lit().has(index) ? <b>{char}</b> : char)}</span>}</Show>;
}

const Keys = (props: { keys: string[]; first?: boolean }) => <span class="ui-keys" data-first={props.first ? "" : undefined}><For each={props.keys}>{(key) => <Keycap>{key}</Keycap>}</For></span>;

export const Readout = (props: { label: JSX.Element; value?: JSX.Element }) => <Row density="line" bare class="ui-readout" data-still=""><span>{props.label}</span><Show when={props.value}><span>{props.value}</span></Show></Row>;

export const Rule = () => <hr class="ui-rule" />;

export const MenuAction = (props: JSX.HTMLAttributes<HTMLDivElement>) => <Row density="menu" bare {...(props as unknown as RowProps)} class="ui-menu-action" />;

export const MenuParent = (props: JSX.HTMLAttributes<HTMLDivElement> & { under: boolean }) => {
  const [local, rest] = splitProps(props, ["under"]);
  return <div {...rest} class="ui-menu-parent" data-under={local.under ? "" : undefined} />;
};
export const MenuPanel = (props: JSX.HTMLAttributes<HTMLDivElement> & { width?: Measure; height?: Measure }) => <Menu {...props} class="ui-menu-panel" />;
