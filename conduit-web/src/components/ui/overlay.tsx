import { For, Show, splitProps, type JSX } from "solid-js";
import { ChevronLeftIcon, XIcon } from "lucide-solid";
import { cn } from "@/lib/utils";
import { Button, Keycap, Spinner } from "./controls";
import { type Density, type Motion, motionOf, moveCursor } from "./shared";

/*
 * Overlay: raised frost over a dimmed page -- the app's large surfaces (the
 * command palette, chat search, settings). Its sections run edge to edge,
 * divided by rules: a Bar (the field), a body -- a List, a List beside an
 * aside (OverlaySplit), or a Rail beside a Page -- and Hints. Its rows are
 * the popover's Items at the overlay's scale; the Rail is the sidebar's
 * NavGroups. Its width is the caller's (--overlay-width).
 */
export function Scrim(props: JSX.HTMLAttributes<HTMLDivElement> & { placement?: "top" | "center"; dialog?: boolean; motion?: Motion }) {
  const [local, rest] = splitProps(props, ["class", "placement", "dialog", "motion"]);
  return <div {...rest} class={cn("ui-scrim", local.class)} data-placement={local.placement ?? "top"} data-dialog={local.dialog ? "" : undefined} {...motionOf(local.motion)} />;
}

/** core: frost on a solid backing, kept for the phone's full-screen overlays should the page behind them be too busy -- off for now. */
export function Overlay(props: { label: string; layout?: "stack" | "rail"; core?: boolean; density?: Density; class?: string; style?: JSX.CSSProperties; motion?: Motion; children: JSX.Element }) {
  return <div role="dialog" aria-label={props.label} class={cn("ui-frost ui-overlay", props.class)} style={props.style} data-layout={props.layout ?? "stack"}
    data-surface="frost" data-lift="raised" data-core={props.core ? "" : undefined} data-density={props.density} {...motionOf(props.motion)}>{props.children}</div>;
}

/** The field across the top: a lead (a prompt glyph, a search icon, a back button), the input, then end controls and close. */
export function OverlayBar(props: { lead?: JSX.Element; placeholder: string; value?: string; onInput?: (value: string) => void; end?: JSX.Element; onClose?: () => void }) {
  return <div class="ui-overlay-bar">
    <Show when={props.lead}><span class="ui-overlay-lead">{props.lead}</span></Show>
    <input class="ui-overlay-input" placeholder={props.placeholder} value={props.value ?? ""} onInput={(event) => props.onInput?.(event.currentTarget.value)} />
    {props.end}
    <Show when={props.onClose}><Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => props.onClose?.()}><XIcon /></Button></Show>
  </div>;
}

/** The scrolling body: Sections of Items, titled as groups. */
export const OverlayList = (props: { children: JSX.Element }) => <div class="ui-overlay-list" role="listbox" onPointerOver={moveCursor}>{props.children}</div>;

/** A list beside an aside (a preview of what the list has selected). */
/** aside: optional, so a preview that can be hidden (chat search's Ctrl+P) leaves the list the whole width. */
export const OverlaySplit = (props: { aside?: JSX.Element; children: JSX.Element }) =>
  <div class="ui-overlay-split" data-aside={props.aside ? "" : undefined}>{props.children}<Show when={props.aside}><aside class="ui-overlay-aside">{props.aside}</aside></Show></div>;

/** The keys along the foot: [keys, what they do], at the start and the end. */
export type Hint = [string[], string];
export function OverlayHints(props: { start: Hint[]; end?: Hint[] }) {
  const hint = ([keys, label]: Hint) => <span><For each={keys}>{(key) => <Keycap>{key}</Keycap>}</For>{label}</span>;
  return <div class="ui-overlay-hints" aria-hidden="true"><For each={props.start}>{hint}</For>
    <Show when={props.end}><span class="ui-overlay-hints-end"><For each={props.end}>{hint}</For></span></Show></div>;
}

/** A rail of sections down the side: a title, NavGroups, and a foot. */
export function OverlayRail(props: { title: string; foot?: JSX.Element; children: JSX.Element }) {
  return <nav class="ui-overlay-rail"><h2 class="ui-overlay-title">{props.title}</h2>{props.children}
    <Show when={props.foot}><div class="ui-overlay-rail-foot">{props.foot}</div></Show></nav>;
}

/** The page beside a rail: its title, its save status (Saving, Saved, Not saved: settings save as they change), close, and SettingGroups. */
export function OverlayPage(props: { title: string; status?: string; failed?: boolean; onBack?: () => void; onClose?: () => void; children: JSX.Element }) {
  return <main class="ui-overlay-page">
    <div class="ui-overlay-page-head"><Show when={props.onBack}><Button variant="ghost" size="icon-sm" aria-label="All settings" onClick={() => props.onBack?.()}><ChevronLeftIcon /></Button></Show><h2 class="ui-overlay-title">{props.title}</h2>
      <Show when={props.status}><span class="ui-overlay-status" data-failed={props.failed ? "" : undefined}>{props.status}</span></Show>
      <Show when={props.onClose}><Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => props.onClose?.()}><XIcon /></Button></Show></div>
    {props.children}
  </main>;
}

/** Recording a shortcut: a second line under the setting, the same height, in place of a panel. A red dot and
 *  "Press a shortcut" until keys arrive, then the chord as one keycap, as the list shows it; the keys that steer it, and Save once there is something to save. */
export const SettingRecorder = (props: { keys?: string[]; onSave?: () => void; onCancel?: () => void }) =>
  <div class="ui-setting-recorder" role="status" aria-live="polite">
    <span class="ui-recorder-dot" aria-hidden="true" />
    <Show when={props.keys?.length} fallback={<span class="ui-recorder-prompt">Press a shortcut</span>}>
      <Keycap class="ui-recorder-keys">{props.keys!.join(" ")}</Keycap>
    </Show>
    <span class="ui-recorder-hints"><Keycap>Esc</Keycap>cancel<Keycap>Backspace</Keycap>clear</span>
    <Button size="sm" outline disabled={!props.keys?.length} onClick={() => props.onSave?.()}>Save</Button>
  </div>;

/** A titled group of SettingLines; groups after the first are ruled off. */
export const SettingGroup = (props: { title: string; children: JSX.Element }) =>
  <section class="ui-setting-group" aria-label={props.title}><div class="ui-nav-label">{props.title}</div>{props.children}</section>;

/** A setting: its name (state that matters muted after it), then its control in the one control column.
 *  plain: what it holds is buttons, a value or a link, not one field, so the line is not that field's label. */
export const SettingLine = (props: { label: string; state?: string; plain?: boolean; children: JSX.Element }) => {
  const inner = () => <><span>{props.label}<Show when={props.state}><small>{props.state}</small></Show></span><span class="ui-setting-control">{props.children}</span></>;
  return props.plain ? <div class="ui-setting-line">{inner()}</div> : <label class="ui-setting-line">{inner()}</label>;
};
/** A setting's value that is read, not set; mono for ids, addresses and versions. */
export const SettingValue = (props: { mono?: boolean; children: JSX.Element }) => <span class="ui-setting-value" data-mono={props.mono ? "" : undefined}>{props.children}</span>;
/** A link out, as a setting's control: Docs, Open sign-in. */
export const SettingLink = (props: { href: string; children: JSX.Element }) => <a class="ui-setting-link" href={props.href} target="_blank" rel="noreferrer">{props.children}</a>;
/** A line under a setting: what went wrong (error), or a quiet note. */
export const SettingNote = (props: { tone?: "quiet" | "error"; children: JSX.Element }) => <p class="ui-setting-note" data-tone={props.tone ?? "quiet"} role={props.tone === "error" ? "alert" : undefined}>{props.children}</p>;
/** More about a setting, folded under it until asked for. */
export const SettingDetails = (props: { summary: string; children: JSX.Element }) => <details class="ui-setting-details"><summary>{props.summary}</summary>{props.children}</details>;
/** Something a setting needs the page's width for: a prompt's text, a download's progress. */
export const SettingWide = (props: { children: JSX.Element }) => <div class="ui-setting-wide">{props.children}</div>;
/** Waiting on what a page shows. */
export const SettingLoading = (props: { children: JSX.Element }) => <div class="ui-setting-loading"><Spinner />{props.children}</div>;

/*
 * Glance: what chat search's cursor rests on, told apart without opening it -- a chat's title and
 * facts, its last prompt, how that turn ended and the start of its answer; or a folder and its
 * latest chats. The app reads the chat; these only draw what it read.
 */
export const Glance = (props: { label: string; children: JSX.Element }) => <div class="ui-glance" aria-label={props.label} aria-live="polite">{props.children}</div>;
export const GlanceHead = (props: { mark?: JSX.Element; title: string; facts: string[] }) => <>
  <div class="ui-glance-title">{props.mark}<span>{props.title}</span></div>
  <For each={props.facts}>{(fact) => <div class="ui-glance-facts" title={fact}>{fact}</div>}</For>
</>;
/** The last prompt, as the user's message is drawn, clamped to four lines. */
export const GlancePrompt = (props: { children: JSX.Element }) => <p class="ui-frost ui-bubble ui-glance-prompt">{props.children}</p>;
/** How the turn ended: an orb (the app's), the outcome, how long and what it did. */
export const GlanceTurn = (props: { orb?: JSX.Element; outcome: string; detail?: string }) =>
  <div class="ui-glance-turn"><Show when={props.orb}><span class="ui-glance-orb">{props.orb}</span></Show><span><b>{props.outcome}</b>{props.detail ? ` · ${props.detail}` : ""}</span></div>;
/** The start of the answer, clamped; html: the app's rendered math, faded where it is cut. */
export const GlanceAnswer = (props: { html?: string; children?: JSX.Element }) => props.html !== undefined
  ? <div class="ui-glance-answer" data-math="" innerHTML={props.html} />
  : <p class="ui-glance-answer">{props.children}</p>;
export const GlanceEmpty = (props: { children: JSX.Element }) => <p class="ui-glance-empty">{props.children}</p>;

/** An overlay's head without a field: what it is about (the leader's key and path). */
export const OverlayHead = (props: { children: JSX.Element }) => <div class="ui-overlay-bar" data-head>{props.children}</div>;
