import { Frost } from "./frost";
import * as Icons from "./icons";
import { children, createEffect, createSignal, Show, splitProps, type JSX } from "solid-js";

import { cn } from "@/lib/utils";
import { Button } from "./controls";
import { Aura, PillWave } from "./pill";
import { Rider } from "./rider";
import type { Motion } from "./shared";

/*
 * DesktopComposer: resting frost holding a Field above a Toolbar, desktop only
 * (a phone's composer is Pills). Its field is a TextArea (a control), which it pads. Geometry is
 * tokens (--cmp-*), measured from the app and scaled by density; its width is
 * the pane's to declare (--composer-width).
 */
/** takeover: a card Rider (the question) that takes the composer's place: the composer drops out of the pane but
 *  keeps its room, and the card rises into the slot. opening: its chat is still arriving (reattaching), so only the
 *  field shows; its toolbar and riders keep their room, unseen. */
export function DesktopComposer(props: { riders?: JSX.Element; takeover?: JSX.Element; opening?: boolean; class?: string; children: JSX.Element }) {
  const takeover = children(() => props.takeover);
  return <div class="ui-composer-slot ui-composer-width" data-taken={takeover() ? "" : undefined} data-opening={props.opening ? "" : undefined}>
    <div class="ui-composer-stack">{props.riders}<Frost class={cn("ui-desktop-composer", props.class)}>{props.children}</Frost></div>{takeover()}</div>;
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
