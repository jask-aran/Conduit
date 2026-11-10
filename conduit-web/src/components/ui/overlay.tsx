import { Frost } from "./frost";
import { Dot } from "./nav";
import * as Icons from "./icons";
import { createEffect, createSignal, For, on, onCleanup, onMount, Show, splitProps, type JSX } from "solid-js";
import { haptic } from "./haptics";

import { cn } from "@/lib/utils";
import { Button, Input, Keycap, Spinner } from "./controls";
import { type Density, type Motion, motionOf, moveCursor } from "./shared";
import { Actions, CloseButton } from "./actions";
import { duration, easing, reducedMotion } from "./motion";
import { DropdownMenu, MenuContent, MenuRow, MenuSection } from "./menus";
import { Row } from "./row";

/** Scrim: the dimmed page an Overlay rises over (placement: under the top edge, or centred). */
export function Scrim(props: JSX.HTMLAttributes<HTMLDivElement> & { placement?: "top" | "center"; dialog?: boolean; motion?: Motion }) {
  const [local, rest] = splitProps(props, ["class", "placement", "dialog", "motion"]);
  return <div {...rest} class={cn("ui-scrim", local.class)} data-placement={local.placement ?? "top"} data-dialog={local.dialog ? "" : undefined} {...motionOf(local.motion)} />;
}

/** Backdrop: the page dimmed under a phone's drawer (layer: sidebar or workspace panel); a tap dismisses the drawer.
 *  open: kept mounted, fading both ways with its drawer, rather than mounted while open. */
export const Backdrop = (props: { layer: "drawer" | "panel"; label: string; onDismiss: () => void; open?: boolean }) =>
  <button type="button" class="ui-backdrop" data-layer={props.layer} aria-label={props.label} onClick={() => props.onDismiss()}
    data-fade={props.open === undefined ? undefined : props.open ? "open" : "shut"} aria-hidden={props.open === false ? true : undefined} tabIndex={props.open === false ? -1 : undefined} />;

/* An overlay that changes width (Settings opening wider) settles as panes do (shell.css .ui-sheet[data-moving]): the
   frame eases from rest while the page beside the rail holds its landing width and is clipped, so nothing re-wraps
   mid-motion. Interrupted, it eases on from where it is; reduced motion lands at once. */
function createWidthSettle(frame: () => HTMLElement | undefined, width: () => unknown) {
  let settled = 0;
  let running: Animation | undefined;
  createEffect(on(width, () => {
    const element = frame();
    if (!element) return;
    const from = running ? element.getBoundingClientRect().width : settled;
    running?.cancel();
    const page = element.querySelector<HTMLElement>(":scope > .ui-overlay-page");
    page?.style.removeProperty("--overlay-page-width");
    const to = element.getBoundingClientRect().width;
    settled = to;
    if (!from || Math.abs(from - to) < 1 || reducedMotion()) return;
    if (page) page.style.setProperty("--overlay-page-width", `${page.getBoundingClientRect().width}px`);
    element.dataset.settling = "";
    running = element.animate([{ width: `${from}px` }, { width: `${to}px` }], {
      duration: duration("--duration-fold", element), easing: easing("--ease-settle", element) });
    const done = running;
    const finish = () => { if (running !== done) return; running = undefined; delete element.dataset.settling; page?.style.removeProperty("--overlay-page-width"); };
    done.onfinish = finish; done.oncancel = finish;
  }, { defer: true }));
  // The width it rests at, kept current through window resizes, so the next change eases from what is on screen.
  createEffect(() => {
    const element = frame();
    if (!element) return;
    settled = element.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => { if (!running) settled = element.getBoundingClientRect().width; });
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });
}

/** Overlay: raised frost over a dimmed page (command palette, chat search, settings). Sections run edge to edge
 *  between rules: a Bar, a body (a List, an OverlaySplit, or a Rail beside a Page) and Hints. Rows are the popover's
 *  Items at the overlay's scale; the Rail is the sidebar's NavGroups. Width is the caller's (--overlay-width).
 *  core: frost on a solid backing for the phone's full-screen overlays, off for now.
 *  embedded: inside a behaviour's dialog (OverlayDialog), which carries the role and the name. */
export function Overlay(props: { label: string; layout?: "rail"; core?: boolean; embedded?: boolean; density?: Density; class?: string; style?: JSX.CSSProperties; motion?: Motion; children: JSX.Element }) {
  const [frame, setFrame] = createSignal<HTMLElement>();
  createWidthSettle(frame, () => (props.style as Record<string, unknown> | undefined)?.["--overlay-width"]);
  return <Frost ref={setFrame} lift="raised" core={props.core} role={props.embedded ? undefined : "dialog"} aria-label={props.embedded ? undefined : props.label} class={cn("ui-overlay", props.class)} style={props.style} data-layout={props.layout}
    data-density={props.density} {...motionOf(props.motion)}>{props.children}</Frost>;
}

/** The field across the top: a lead, chips (OverlayChip), the input, end controls and close; neither close nor a chip
 *  takes focus from the field. field: what a behaviour adds to the input (combobox state, keys, focus). */
export function OverlayBar(props: { lead?: JSX.Element; chips?: JSX.Element; placeholder: string; value?: string; onInput?: (value: string) => void; field?: JSX.InputHTMLAttributes<HTMLInputElement>; end?: JSX.Element; onClose?: () => void; closeLabel?: string }) {
  return <div class="ui-overlay-bar">
    <Show when={props.lead}><span class="ui-overlay-lead">{props.lead}</span></Show>
    {props.chips}
    <input {...props.field} class="ui-overlay-input" placeholder={props.placeholder} value={props.value ?? ""} onInput={(event) => props.onInput?.(event.currentTarget.value)} />
    {props.end}
    <Show when={props.onClose}><CloseButton label={props.closeLabel} title="Close" onMouseDown={(event) => event.preventDefault()} onClick={() => props.onClose?.()} /></Show>
  </div>;
}

/** A scope or a view narrowing the field (in:Japan, is:unread): a mono token, removed by its × (or Backspace on an empty query, the host's). */
export const OverlayChip = (props: { children: string; onRemove: () => void }) =>
  <button type="button" class="ui-overlay-chip" title={`Remove ${props.children}`} onMouseDown={(event) => event.preventDefault()} onClick={() => props.onRemove()}>{props.children}<Icons.Close /></button>;

/** The scrolling body: Sections of Items, titled as groups. managed: the host moves the cursor (aria-activedescendant,
 *  each Item's active), so the pointer leaves it to the host; the rest is the host's (role, keys, focus). */
export function OverlayList(props: JSX.HTMLAttributes<HTMLDivElement> & { managed?: boolean }) {
  const [local, rest] = splitProps(props, ["managed", "children"]);
  return <div role="listbox" {...rest} class="ui-overlay-list" onPointerOver={local.managed ? undefined : moveCursor}>{local.children}</div>;
}

/** A list beside an aside (a preview of the selection); with no aside (chat search's Ctrl+P) the list takes the width. */
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
export const OverlayActions = (props: { actions: OverlayAction[] }) => <Actions kind="overlay">
  <For each={props.actions}>{(action) => <Button variant={action.destructive ? "destructive" : "ghost"} outline disabled={action.disabled} onClick={() => action.onClick()}>{action.label}</Button>}</For>
</Actions>;

/** The head of a rail or a page: a lead (the way back), the title, what follows it (the save status), and close. */
function OverlayPageHead(props: { title: string; focusable?: boolean; lead?: JSX.Element; detail?: JSX.Element; onClose?: () => void }) {
  return <div class="ui-overlay-page-head">{props.lead}<h2 class="ui-overlay-title" tabIndex={props.focusable ? -1 : undefined}>{props.title}</h2>{props.detail}
    <Show when={props.onClose}><CloseButton onClick={() => props.onClose?.()} /></Show></div>;
}

/** A rail of sections down the side: a title, NavGroups, and a foot. onClose: when it is a screen of its own (a phone's), its close.
 *  The rest goes on the nav: a behaviour's roles and keys (Settings' tablist). */
export function OverlayRail(props: JSX.HTMLAttributes<HTMLElement> & { title: string; foot?: JSX.Element; onClose?: () => void }) {
  const [local, rest] = splitProps(props, ["title", "foot", "onClose", "children"]);
  return <nav {...rest} class="ui-overlay-rail"><OverlayPageHead title={local.title} onClose={local.onClose} />{local.children}
    <Show when={local.foot}><div class="ui-overlay-rail-foot">{local.foot}</div></Show></nav>;
}

/** A rail's foot: facts about this build (About), each a muted label and its value on one line, the value truncating with its whole in the title. */
export const OverlayFacts = (props: { title: string; children: JSX.Element }) => <section class="ui-overlay-facts" aria-label={props.title}><h3 class="ui-title">{props.title}</h3><dl>{props.children}</dl></section>;
export const OverlayFact = (props: { label: string; value: string; title?: string }) => <div title={props.title ?? props.value}><dt>{props.label}</dt><dd>{props.value}</dd></div>;

/** The page beside a rail: its title, its save status (Saving, Saved, Not saved: settings save as they change), close, and SettingGroups.
 *  busy: a spinner before the status (Saving); failed: the status in the destructive colour, why in its title, and Retry when onRetry. */
export function OverlayPage(props: { title: string; status?: string; busy?: boolean; failed?: boolean; why?: string; onRetry?: () => void; onBack?: () => void; onClose?: () => void; children: JSX.Element }) {
  // Saving is held until its spinner makes one whole turn (--duration-spin), so a quick save does not flash; a failure shows at once.
  const [held, setHeld] = createSignal<string | null>(null);
  // A screen of its own (a phone's section, with its way back): felt arriving from the list, and going back to it.
  onMount(() => { if (props.onBack) haptic("open"); });
  let since = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const busy = Boolean(props.busy);
    if (busy) { clearTimeout(timer); if (held() === null) since = performance.now(); setHeld(props.status ?? "Saving"); return; }
    if (held() === null) return;
    const turn = duration("--duration-spin");
    const left = props.failed ? 0 : turn - (performance.now() - since);
    clearTimeout(timer);
    if (left <= 0) setHeld(null); else timer = setTimeout(() => setHeld(null), left);
  });
  onCleanup(() => clearTimeout(timer));
  const busy = () => Boolean(props.busy) || held() !== null;
  const status = () => held() ?? props.status;
  return <main class="ui-overlay-page">
    <OverlayPageHead title={props.title} focusable onClose={props.onClose}
      lead={<Show when={props.onBack}><Button variant="ghost" size="icon-sm" haptic="dismiss" aria-label="All settings" onClick={() => props.onBack?.()}><Icons.ChevronLeft /></Button></Show>}
      detail={<Show when={status()}><span class="ui-overlay-status" role="status" data-failed={props.failed && held() === null ? "" : undefined} title={props.why}><Show when={busy()}><Spinner /></Show>{status()}
        <Show when={props.failed && props.onRetry}><Button variant="ghost" size="sm" onClick={() => props.onRetry?.()}>Retry</Button></Show></span></Show>} />
    {/* The head stays while the page's body scrolls under it: on a phone it says which section this screen is. */}
    <div class="ui-overlay-page-body">{props.children}</div>
  </main>;
}

/** Recording a shortcut: a second line under the setting, the same height: "Press a shortcut" until keys arrive, then
 *  the chord as one keycap, the steering keys, and Save. onKeyDown makes the line the focusable capture (role
 *  application); onCancel makes the Esc hint its button. Keys pressed on the line's own buttons are theirs. */
export function SettingRecorder(props: { keys?: string[]; label?: string; ref?: (element: HTMLDivElement) => void; onKeyDown?: (event: KeyboardEvent) => void; onSave?: () => void; onCancel?: () => void; saveDisabled?: boolean }) {
  const capture = () => Boolean(props.onKeyDown);
  return <div ref={props.ref} class="ui-setting-recorder" role={capture() ? "application" : "status"} aria-live={capture() ? undefined : "polite"} aria-label={props.label} tabIndex={capture() ? 0 : undefined}
    onKeyDown={(event) => { if (event.target === event.currentTarget) props.onKeyDown?.(event); }}>
    <Dot tone="danger" class="ui-recorder-dot" />
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

/** A group's subject named large under its label (This device's name); editable, a field that reads as a title. */
export const SettingTitle = (props: { value: string; label: string; editable?: boolean; onChange?: (value: string) => void }) => props.editable
  ? <input class="ui-setting-title" aria-label={props.label} value={props.value} spellcheck={false}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.currentTarget.value = props.value; event.currentTarget.blur(); } }}
      onChange={(event) => props.onChange?.(event.currentTarget.value)} />
  : <h3 class="ui-setting-title">{props.value}</h3>;

export type SettingContextItem = { label: string; kind: "block" | "document"; onOpen: () => void };
/** context: a mark after the name opening a menu of the blocks and documents the setting changes (Settings › Blocks and
 *  Prompts). A span, not a <button>: a non-plain line is a <label>, and a button there would take the switch's clicks. */
function SettingContext(props: { items: SettingContextItem[] }) {
  return <DropdownMenu modal={false} placement="bottom-start">
    <DropdownMenu.Trigger as="span" class="ui-setting-context" aria-label="What this changes in context" title="What this changes in context"
      onClick={(event: MouseEvent) => event.preventDefault()}><Icons.Boxes aria-hidden="true" /></DropdownMenu.Trigger>
    <MenuContent>
      <MenuSection title="In context">
        <For each={props.items}>{(item) => <MenuRow icon={item.kind === "block" ? <Icons.Boxes /> : <Icons.FileText />} onSelect={item.onOpen}>{item.label}</MenuRow>}</For>
      </MenuSection>
    </MenuContent>
  </DropdownMenu>;
}
/** A setting: its name (state muted after it), then its control in the one control column.
 *  plain: it holds buttons, a value or a link, so the line is not a field's label. mono: the name is data (a model id). */
export const SettingLine = (props: { label: JSX.Element; state?: JSX.Element; plain?: boolean; mono?: boolean; title?: string; children?: JSX.Element; context?: SettingContextItem[] }) => {
  const inner = () => <><span data-mono={props.mono ? "" : undefined}>{props.label}<Show when={props.context?.length}><SettingContext items={props.context!} /></Show><Show when={props.state}><small>{props.state}</small></Show></span><span class="ui-setting-control">{props.children}</span></>;
  // A label hands any click to its control: right for a field, switch or menu, wrong for an acting button (Remove).
  const guard = (event: MouseEvent) => {
    const control = (event.currentTarget as HTMLLabelElement).control;
    if (control instanceof HTMLButtonElement && !control.matches("[aria-haspopup], [role='switch'], [role='combobox'], [role='checkbox']")
      && !(event.target as Element).closest("button, a, input, select, textarea")) event.preventDefault();
  };
  return <Row element={props.plain ? "div" : "label"} density="line" bare haptic={false} class="ui-setting-line" title={props.title} onClick={props.plain ? undefined : guard}>{inner()}</Row>;
};
/** A step of something done in order (a sign-in: open the page, paste what it ends on): its number, what to do, and
 *  the control that does it. Steps are lines of one Dialog or Group, numbered by the caller. */
export const SettingStep = (props: { step: number; label: JSX.Element; state?: JSX.Element; title?: string; field?: boolean; children?: JSX.Element }) =>
  <SettingLine plain={!props.field} label={<><span class="ui-setting-step">{props.step}</span>{props.label}</>} state={props.state} title={props.title}>{props.children}</SettingLine>;
/** A credential: its name and state, then the caller's actions, Add or Replace, and Remove. Add or Replace opens the
 *  secret's field with Save and Cancel (Esc), fields (an account ID) a line each under it; a throwing onSave keeps it open
 *  beside what was typed. editable false: held elsewhere (the server's environment). */
export function SettingCredential(props: {
  label: string; state?: JSX.Element; title?: string; stored?: boolean; editable?: boolean; busy?: boolean;
  /** It already works without a key (a provider that needs none): adding one is a quiet button, not the line's outlined one. */
  optional?: boolean;
  add?: string; placeholder?: string; actions?: JSX.Element;
  fields?: Array<{ name: string; label: string; placeholder?: string; title?: string }>;
  onSave: (secret: string, fields: Record<string, string>) => unknown | Promise<unknown>; onRemove?: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [secret, setSecret] = createSignal("");
  const [fields, setFields] = createSignal<Record<string, string>>({});
  const [saving, setSaving] = createSignal(false);
  const close = () => { setOpen(false); setSecret(""); setFields({}); };
  const save = async () => {
    if (!secret().trim() || saving()) return;
    setSaving(true);
    try { await props.onSave(secret().trim(), fields()); close(); }
    catch { /* the caller says why; the field stays open with what was typed */ }
    finally { setSaving(false); }
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Enter") void save();
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
  };
  return <>
    <SettingLine plain label={props.label} state={props.state} title={props.title}>
      <Show when={open()} fallback={<>
        {props.actions}
        {/* A stored key's actions are icons (replace, remove); adding one is the line's one outlined button. */}
        <Show when={props.editable !== false}><Show when={props.stored} fallback={<Button variant={props.optional ? "ghost" : "secondary"} size="sm" disabled={props.busy} onClick={() => setOpen(true)}>{props.add || "Add key"}</Button>}>
          <Button variant="ghost" size="icon-sm" aria-label={`Replace ${props.label}'s key`} title="Replace key" disabled={props.busy} onClick={() => setOpen(true)}><Icons.Edit /></Button></Show></Show>
        <Show when={props.stored && props.onRemove}><Button variant="ghost" size="icon-sm" haptic="destructive" aria-label={`Remove ${props.label}'s key`} title="Remove" disabled={props.busy} onClick={() => props.onRemove?.()}><Icons.Delete /></Button></Show>
      </>}>
        <Input data-credential="" aria-label={props.label} type="password" autocomplete="new-password" data-1p-ignore data-lpignore="true" data-bwignore
          ref={(element: HTMLInputElement) => queueMicrotask(() => element.focus())} placeholder={props.placeholder || "API key"}
          value={secret()} onInput={(event) => setSecret(event.currentTarget.value)} onKeyDown={keys} />
        <Button size="sm" disabled={saving() || !secret().trim()} onClick={() => void save()}>{saving() ? <Spinner /> : null}Save</Button>
        <Button variant="ghost" size="sm" disabled={saving()} onClick={close}>Cancel</Button>
      </Show>
    </SettingLine>
    <Show when={open()}><For each={props.fields || []}>{(field) =>
      <SettingLine label={field.label} title={field.title}>
        <Input data-credential="" value={fields()[field.name] || ""} placeholder={field.placeholder} onKeyDown={keys}
          onInput={(event) => setFields({ ...fields(), [field.name]: event.currentTarget.value })} />
      </SettingLine>
    }</For></Show>
  </>;
}
/** A setting's value that is read, not set; mono for ids, addresses and versions. */
export const SettingValue = (props: { mono?: boolean; children: JSX.Element }) => <span class="ui-setting-value ui-truncate" data-mono={props.mono ? "" : undefined}>{props.children}</span>;
/** A setting's state that leads somewhere in Settings ("6 tools" opens Tools): text in the state's voice, a button. */
export const SettingStateLink = (props: { onClick: () => void; children: JSX.Element }) =>
  <button type="button" class="ui-setting-state-link" onClick={() => props.onClick()}>{props.children}</button>;
/** A link out, as a setting's control: Docs, Open sign-in. */
export const SettingLink = (props: { href: string; children: JSX.Element }) => <a class="ui-setting-link" href={props.href} target="_blank" rel="noreferrer">{props.children}</a>;
/** More about a setting, folded under it until asked for. */
export const SettingDetails = (props: { summary: string; children: JSX.Element }) => <details class="ui-setting-details"><summary>{props.summary}</summary>{props.children}</details>;
/** Something a setting needs the page's width for: a prompt's text, a download's progress. */
export const SettingWide = (props: { children: JSX.Element }) => <div class="ui-setting-wide">{props.children}</div>;

/* Glance: what chat search's cursor rests on, told apart without opening it: a chat's title, facts, last prompt, how
   that turn ended and its answer's start; or a folder and its latest chats. These only draw what the app read. */
export const Glance = (props: { label: string; children: JSX.Element }) => <div class="ui-glance" aria-label={props.label} aria-live="polite">{props.children}</div>;
export const GlanceHead = (props: { mark?: JSX.Element; title: string; facts: string[] }) => <>
  <div class="ui-glance-title">{props.mark}<span>{props.title}</span></div>
  <For each={props.facts}>{(fact) => <div class="ui-glance-facts ui-truncate" title={fact}>{fact}</div>}</For>
</>;
/** The last prompt, as the user's message is drawn, clamped to four lines. */
export const GlancePrompt = (props: { children: JSX.Element }) => <Frost as="p" class="ui-bubble ui-glance-prompt">{props.children}</Frost>;
/** How the turn ended: an orb (the app's), the outcome, how long and what it did. */
export const GlanceTurn = (props: { orb?: JSX.Element; outcome: string; detail?: string }) =>
  <div class="ui-glance-turn"><Show when={props.orb}><span class="ui-glance-orb ui-size-icon">{props.orb}</span></Show><span><b>{props.outcome}</b>{props.detail ? ` · ${props.detail}` : ""}</span></div>;
/** The start of the answer, clamped; html: the app's rendered math, faded where it is cut. */
export const GlanceAnswer = (props: { html?: string; children?: JSX.Element }) => props.html !== undefined
  ? <div class="ui-glance-answer" data-math="" innerHTML={props.html} />
  : <p class="ui-glance-answer">{props.children}</p>;

/** A whole text under a GlanceHead (a report jbot's panel previews), headings and bold a step heavier than a transcript's. */
export const GlanceBody = (props: { children: JSX.Element }) => <div class="ui-glance-body">{props.children}</div>;

/** An overlay's head without a field: what it is about (the leader's key and path). */
export const OverlayHead = (props: { children: JSX.Element }) => <div class="ui-overlay-bar" data-head>{props.children}</div>;
