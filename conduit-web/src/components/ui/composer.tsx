import { Frost } from "./frost";
import * as Icons from "./icons";
import { children, createEffect, createSignal, onCleanup, onMount, Show, splitProps, type JSX } from "solid-js";

import { cn } from "@/lib/utils";
import { Button, TextArea } from "./controls";
import { Aura, PillWave } from "./pill";
import { Rider } from "./rider";
import { reducedMotion } from "./motion";
import type { Motion } from "./shared";

/*
 * DesktopComposer: resting frost holding a Field above a Toolbar, desktop only
 * (a phone's composer is Pills). Its field is a TextArea (a control), which it pads. Geometry is
 * tokens (--cmp-*), measured from the app and scaled by density; its width is
 * the pane's to declare (--composer-width).
 */
/** Riders split by what they are about. riders: what goes with the message being written (queued messages,
 *  attachments, references, the voice), on the composer's top edge. under: the state of work under way (background
 *  agents), below it -- not part of what is written, so a takeover leaves them where they are.
 *  takeover: a card Rider (the question) that takes the composer's place: the composer drops out of the pane but
 *  keeps its room, and the card rises into the slot. opening: its chat is still arriving (reattaching), so only the
 *  field shows; its toolbar and riders keep their room, unseen. */
export function DesktopComposer(props: { riders?: JSX.Element; under?: JSX.Element; takeover?: JSX.Element; opening?: boolean; class?: string; children: JSX.Element }) {
  const takeover = children(() => props.takeover);
  const under = children(() => props.under);
  let slot!: HTMLDivElement;
  let stack!: HTMLDivElement;
  // A takeover taller than the composer gave the slot its height; when it goes, that room closes gently (a transcript
  // following the bottom glides back down with it) instead of in one frame.
  let held = 0;
  let watch: ResizeObserver | undefined;
  createEffect((was: boolean) => {
    const now = Boolean(takeover());
    if (now) requestAnimationFrame(() => {
      const card = [...slot.children].find((child) => child !== stack && !child.classList.contains("ui-composer-under")) as HTMLElement | undefined;
      watch?.disconnect();
      if (!card) return;
      watch = new ResizeObserver(() => { held = Math.max(card.offsetHeight, stack.offsetHeight); });
      watch.observe(card);
    });
    else if (was) {
      watch?.disconnect();
      const to = stack.offsetHeight;
      if (held > to + 1 && !reducedMotion()) {
        slot.style.gridTemplateRows = `${held}px`;
        void slot.offsetHeight;
        slot.style.transition = "grid-template-rows var(--duration-gentle) var(--ease-room)";
        slot.style.gridTemplateRows = `${to}px`;
        const done = () => { slot.style.gridTemplateRows = ""; slot.style.transition = ""; slot.removeEventListener("transitionend", ended); };
        const ended = (event: TransitionEvent) => { if (event.target === slot) done(); };
        slot.addEventListener("transitionend", ended);
        setTimeout(done, 600);
      }
      held = 0;
    }
    return now;
  }, false);
  onCleanup(() => watch?.disconnect());
  return <div ref={slot} class="ui-composer-slot ui-composer-width" data-taken={takeover() ? "" : undefined} data-opening={props.opening ? "" : undefined}>
    <div ref={stack} class="ui-composer-stack">{props.riders}<Frost class={cn("ui-desktop-composer", props.class)}>{props.children}</Frost></div>{takeover()}
    <Show when={under.toArray().length}><div class="ui-composer-under">{under()}</div></Show></div>;
}
/** The voice while dictating, riding just over the composer: a PillWave across a wave Rider, an Aura glowing under it
 *  as under a phone's voice track. The words go into the field as they come. levels: the waveform's history (0-1);
 *  gain: how much it is lifted; level: the voice now (0-1), which the Aura follows. */
export const VoiceRider = (props: { levels: number[]; gain?: number; level?: number; motion?: Motion }) =>
  <Rider label="Listening" layout="wave" motion={props.motion}><Aura on level={props.level} /><PillWave levels={props.levels} gain={props.gain} /></Rider>;
/** The composer's field slot: where its TextArea (or the app's, with its behaviour) sits, padded by the composer. */
/** A toolbar picker: a small ghost button showing what is picked -- a mark, the value, a quieter second value -- and a chevron.
 *  Muted as a setting; subject: what the message goes to (the model), at full weight. */
export function Picker(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: JSX.Element; value?: JSX.Element; quiet?: JSX.Element; subject?: boolean }) {
  const [local, rest] = splitProps(props, ["icon", "value", "quiet", "subject", "children"]);
  return <Button variant="ghost" size="sm" {...rest} class="ui-picker" data-subject={local.subject ? "" : undefined}>
    {local.icon}<Show when={local.value}><span class="ui-picker-value">{local.value}</span></Show><Show when={local.quiet}><span class="ui-picker-quiet">{local.quiet}</span></Show>{local.children}<Icons.ChevronDown class="ui-picker-chevron" />
  </Button>;
}

export const ComposerField = (props: { children: JSX.Element }) => <div class="ui-composer-field">{props.children}</div>;
/** What the draft completes to (a slash command), over its field's text -- a ComposerField's or a PillField's -- at
 *  its padding and type: what is typed held clear, the rest muted, then what it does. */
export const Completion = (props: { typed: string; rest: string; detail?: string }) =>
  <div class="ui-completion" aria-hidden="true"><span>{props.typed}</span>{props.rest} <small>{props.detail}</small></div>;
/** A row of controls: start (leading) and end (trailing) groups. primary: the end's one slot (Send, or Stop while
 *  the agent works), each action scaling in where the last was; aside: what steps in beside it (Stop, when a draft
 *  is typed during a turn) -- it folds as a Pill does: its room opens, then it fades in; going, it fades, then gives
 *  the room back (it keeps what it last held while it goes), so its neighbours move rather than jump. Controls never
 *  squeeze; the app folds what does not fit. */
export function Toolbar(props: { start?: JSX.Element; end?: JSX.Element; aside?: JSX.Element; primary?: JSX.Element; class?: string; ref?: (element: HTMLDivElement) => void }) {
  const aside = children(() => props.aside);
  const [held, setHeld] = createSignal<JSX.Element>();
  createEffect(() => { const now = aside(); if (now) setHeld(() => now); });
  // A control the pointer opened shows no keyboard wash when Escape hands focus back to it; one opened from the keyboard does.
  return <div ref={props.ref} class={cn("ui-toolbar", props.class)}
    onPointerDown={(event) => { const control = (event.target as Element).closest("button"); if (control) control.dataset.pointerOpened = ""; }}
    onKeyDown={(event) => { if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) delete (event.target as HTMLElement).dataset?.pointerOpened; }}><div class="ui-toolbar-start">{props.start}</div><div class="ui-toolbar-end">
    {props.end}
    <span ref={(el) => createEffect(() => { el.inert = !aside(); })} class="ui-toolbar-aside" data-folded={aside() ? undefined : ""} aria-hidden={aside() ? undefined : "true"}><span>{held()}</span></span>
    <Show when={props.primary !== undefined}><span class="ui-toolbar-primary">{props.primary}</span></Show></div></div>;
}

/**
 * MessageFeedback: a small composer under one message, for the person's words about what it said or did -- the
 * composer's frost, field and toolbar, its Send the primary; a quiet note says where it goes. Ctrl/Cmd+Enter or Enter
 * sends (Shift+Enter a new line), Escape cancels (its own rung of the ladder). Focused on open.
 */
export function MessageFeedback(props: { onSend: (text: string) => Promise<unknown> | unknown; onCancel: () => void; note?: string; placeholder?: string }) {
  const [text, setText] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let field!: HTMLTextAreaElement;
  onMount(() => field.focus({ preventScroll: true }));
  const send = async () => {
    const value = text().trim();
    if (!value || busy()) return;
    setBusy(true);
    try { await props.onSend(value); } finally { setBusy(false); }
  };
  return <Frost class="ui-desktop-composer ui-message-feedback">
    <ComposerField><TextArea ref={field} maxLength={2000} value={text()} aria-label="Feedback on this message"
      placeholder={props.placeholder ?? "What should it have said or done differently?"}
      onInput={(event) => setText(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.isComposing) return;
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
        else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); props.onCancel(); }
      }} /></ComposerField>
    <Toolbar start={<span class="ui-message-feedback-note">{props.note ?? "Feedback"}</span>}
      primary={<Button variant="ghost" size="icon-sm" aria-label="Send feedback" disabled={!text().trim() || busy()} onClick={() => void send()}><Icons.Send /></Button>} />
  </Frost>;
}

