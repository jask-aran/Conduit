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

/** Backdrop: the page dimmed under a phone's drawer (layer: the sidebar's, or the workspace panel's), a tap on it
 *  dismissing the drawer; it fades in. */
export const Backdrop = (props: { layer: "drawer" | "panel"; label: string; onDismiss: () => void }) =>
  <button type="button" class="ui-backdrop" data-layer={props.layer} aria-label={props.label} onClick={() => props.onDismiss()} />;

/** core: frost on a solid backing, kept for the phone's full-screen overlays should the page behind them be too busy -- off for now.
 *  embedded: inside a behaviour's dialog (OverlayDialog), which carries the role and the name. */
export function Overlay(props: { label: string; layout?: "stack" | "rail"; core?: boolean; embedded?: boolean; density?: Density; class?: string; style?: JSX.CSSProperties; motion?: Motion; children: JSX.Element }) {
  return <div role={props.embedded ? undefined : "dialog"} aria-label={props.embedded ? undefined : props.label} class={cn("ui-frost ui-overlay", props.class)} style={props.style} data-layout={props.layout ?? "stack"}
    data-surface="frost" data-lift="raised" data-core={props.core ? "" : undefined} data-density={props.density} {...motionOf(props.motion)}>{props.children}</div>;
}

/** The field across the top: a lead (a prompt glyph, a search icon, a back button), chips (OverlayChip: a scope, a view),
 *  the input, then end controls and close. field: what a behaviour adds to the input (combobox state, keys, focus).
 *  Neither the close nor a chip takes focus from the field. */
export function OverlayBar(props: { lead?: JSX.Element; chips?: JSX.Element; placeholder: string; value?: string; onInput?: (value: string) => void; field?: JSX.InputHTMLAttributes<HTMLInputElement>; end?: JSX.Element; onClose?: () => void; closeLabel?: string }) {
  return <div class="ui-overlay-bar">
    <Show when={props.lead}><span class="ui-overlay-lead">{props.lead}</span></Show>
    {props.chips}
    <input {...props.field} class="ui-overlay-input" placeholder={props.placeholder} value={props.value ?? ""} onInput={(event) => props.onInput?.(event.currentTarget.value)} />
    {props.end}
    <Show when={props.onClose}><Button variant="ghost" size="icon-sm" aria-label={props.closeLabel ?? "Close"} title="Close" onMouseDown={(event) => event.preventDefault()} onClick={() => props.onClose?.()}><XIcon /></Button></Show>
  </div>;
}

/** A scope or a view narrowing the field (in:Japan, is:unread): a mono token, removed by its × (or Backspace on an empty query, the host's). */
export const OverlayChip = (props: { children: string; onRemove: () => void }) =>
  <button type="button" class="ui-overlay-chip" title={`Remove ${props.children}`} onMouseDown={(event) => event.preventDefault()} onClick={() => props.onRemove()}>{props.children}<XIcon /></button>;

/** The scrolling body: Sections of Items, titled as groups. managed: the host moves the cursor (aria-activedescendant,
 *  each Item's active), so the pointer leaves it to the host; the rest is the host's (role, keys, focus). */
export function OverlayList(props: JSX.HTMLAttributes<HTMLDivElement> & { managed?: boolean }) {
  const [local, rest] = splitProps(props, ["managed", "children"]);
  return <div role="listbox" {...rest} class="ui-overlay-list" onPointerOver={local.managed ? undefined : moveCursor}>{local.children}</div>;
}
/** In place of a list's rows: nothing matched, nothing yet. */
export const OverlayEmpty = (props: { children: JSX.Element }) => <p class="ui-overlay-empty">{props.children}</p>;

/** A list beside an aside (a preview of what the list has selected). */
/** aside: optional, so a preview that can be hidden (chat search's Ctrl+P) leaves the list the whole width. */
export const OverlaySplit = (props: { aside?: JSX.Element; children: JSX.Element }) =>
  <div class="ui-overlay-split" data-aside={props.aside ? "" : undefined}>{props.children}<Show when={props.aside}><aside class="ui-overlay-aside">{props.aside}</aside></Show></div>;

/** The keys along the foot: [keys, what they do], at the start and the end; with a press, the hint is that action's button too.
 *  count: what an edit has chosen ("2 selected"), first. */
export type Hint = [string[], string, (() => void)?];
export function OverlayHints(props: { start: Hint[]; end?: Hint[]; count?: string }) {
  const hint = ([keys, label, press]: Hint) => {
    const inner = () => <><For each={keys}>{(key) => <Keycap>{key}</Keycap>}</For>{label}</>;
    return press ? <button type="button" tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => press()}>{inner()}</button> : <span>{inner()}</span>;
  };
  return <div class="ui-overlay-hints" role="note" aria-label="Keys"><Show when={props.count}><b>{props.count}</b></Show><For each={props.start}>{hint}</For>
    <Show when={props.end}><span class="ui-overlay-hints-end"><For each={props.end}>{hint}</For></span></Show></div>;
}

/** On a phone the keys mean nothing: the hints give way to a bar of the view's actions, as buttons. */
export type OverlayAction = { label: string; onClick: () => void; disabled?: boolean; destructive?: boolean };
export const OverlayActions = (props: { actions: OverlayAction[] }) => <div class="ui-overlay-actions">
  <For each={props.actions}>{(action) => <Button variant={action.destructive ? "destructive" : "ghost"} outline disabled={action.disabled} onClick={() => action.onClick()}>{action.label}</Button>}</For>
</div>;

/** A rail of sections down the side: a title, NavGroups, and a foot. onClose: when it is a screen of its own (a phone's), its close.
 *  The rest goes on the nav: a behaviour's roles and keys (Settings' tablist). */
export function OverlayRail(props: JSX.HTMLAttributes<HTMLElement> & { title: string; foot?: JSX.Element; onClose?: () => void }) {
  const [local, rest] = splitProps(props, ["title", "foot", "onClose", "children"]);
  return <nav {...rest} class="ui-overlay-rail"><div class="ui-overlay-page-head"><h2 class="ui-overlay-title">{local.title}</h2>
    <Show when={local.onClose}><Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => local.onClose?.()}><XIcon /></Button></Show></div>{local.children}
    <Show when={local.foot}><div class="ui-overlay-rail-foot">{local.foot}</div></Show></nav>;
}

/** A rail's foot: facts about this build (About), each a muted label and its value on one line, the value truncating with its whole in the title. */
export const OverlayFacts = (props: { title: string; children: JSX.Element }) => <section class="ui-overlay-facts" aria-label={props.title}><h3 class="ui-title">{props.title}</h3><dl>{props.children}</dl></section>;
export const OverlayFact = (props: { label: string; value: string; title?: string }) => <div title={props.title ?? props.value}><dt>{props.label}</dt><dd>{props.value}</dd></div>;

/** The page beside a rail: its title, its save status (Saving, Saved, Not saved: settings save as they change), close, and SettingGroups.
 *  busy: a spinner before the status (Saving); failed: the status in the destructive colour, why in its title, and Retry when onRetry. */
export function OverlayPage(props: { title: string; status?: string; busy?: boolean; failed?: boolean; why?: string; onRetry?: () => void; onBack?: () => void; onClose?: () => void; children: JSX.Element }) {
  return <main class="ui-overlay-page">
    <div class="ui-overlay-page-head"><Show when={props.onBack}><Button variant="ghost" size="icon-sm" aria-label="All settings" onClick={() => props.onBack?.()}><ChevronLeftIcon /></Button></Show><h2 class="ui-overlay-title" tabIndex={-1}>{props.title}</h2>
      <Show when={props.status}><span class="ui-overlay-status" role="status" data-failed={props.failed ? "" : undefined} title={props.why}><Show when={props.busy}><Spinner /></Show>{props.status}
        <Show when={props.failed && props.onRetry}><Button variant="ghost" size="sm" onClick={() => props.onRetry?.()}>Retry</Button></Show></span></Show>
      <Show when={props.onClose}><Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => props.onClose?.()}><XIcon /></Button></Show></div>
    {props.children}
  </main>;
}

/** Recording a shortcut: a second line under the setting, the same height, in place of a panel. A red dot and
 *  "Press a shortcut" until keys arrive, then the chord as one keycap, as the list shows it; the keys that steer it, and Save once there is something to save.
 *  A behaviour hears the keys: onKeyDown makes the line the focusable capture (role application, named by label); onCancel makes the Esc hint its button.
 *  Keys pressed on the line's own buttons are theirs, not the capture's. */
export function SettingRecorder(props: { keys?: string[]; label?: string; ref?: (element: HTMLDivElement) => void; onKeyDown?: (event: KeyboardEvent) => void; onSave?: () => void; onCancel?: () => void; saveDisabled?: boolean }) {
  const capture = () => Boolean(props.onKeyDown);
  return <div ref={props.ref} class="ui-setting-recorder" role={capture() ? "application" : "status"} aria-live={capture() ? undefined : "polite"} aria-label={props.label} tabIndex={capture() ? 0 : undefined}
    onKeyDown={(event) => { if (event.target === event.currentTarget) props.onKeyDown?.(event); }}>
    <span class="ui-recorder-dot" aria-hidden="true" />
    <Show when={props.keys?.length} fallback={<span class="ui-recorder-prompt">Press a shortcut</span>}>
      <Keycap class="ui-recorder-keys">{props.keys!.join(" ")}</Keycap>
    </Show>
    <span class="ui-recorder-hints">
      <Show when={props.onCancel} fallback={<><Keycap>Esc</Keycap>cancel</>}><button type="button" tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => props.onCancel?.()}><Keycap>Esc</Keycap>cancel</button></Show>
      <Keycap>Backspace</Keycap>clear</span>
    <Button size="sm" outline disabled={!props.keys?.length || props.saveDisabled} onClick={() => props.onSave?.()}>Save</Button>
  </div>;
}

/** Said to a screen reader, not shown: what an action did (a shortcut saved, cleared). */
export const LiveNote = (props: { children: JSX.Element }) => <p class="ui-live-note" aria-live="polite">{props.children}</p>;

/** A titled group of SettingLines; groups after the first are ruled off. */
export const SettingGroup = (props: { title: string; children: JSX.Element }) =>
  <section class="ui-setting-group" aria-label={props.title}><div class="ui-nav-label">{props.title}</div>{props.children}</section>;

/** A setting: its name (state that matters muted after it), then its control in the one control column.
 *  plain: what it holds is buttons, a value or a link, not one field, so the line is not that field's label. */
export const SettingLine = (props: { label: JSX.Element; state?: JSX.Element; plain?: boolean; title?: string; children?: JSX.Element }) => {
  const inner = () => <><span>{props.label}<Show when={props.state}><small>{props.state}</small></Show></span><span class="ui-setting-control">{props.children}</span></>;
  return props.plain ? <div class="ui-setting-line" title={props.title}>{inner()}</div> : <label class="ui-setting-line" title={props.title}>{inner()}</label>;
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
