import { Frost } from "./frost";
import * as Icons from "./icons";
import { children, createEffect, createSignal, onCleanup, onMount, Show, splitProps, type JSX } from "solid-js";

import { cn } from "@/lib/utils";
import { Button, TextArea } from "./controls";
import { Aura, PillWave } from "./pill";
import { Rider, RiderGoing } from "./rider";
import { reducedMotion, whenMotionEnds } from "./motion";
import type { Motion } from "./shared";

export function DesktopComposer(props: { riders?: JSX.Element; under?: JSX.Element; takeover?: JSX.Element; opening?: boolean; class?: string; children: JSX.Element }) {
  const takeover = children(() => props.takeover);
  const [going, setGoing] = createSignal(0);
  const under = children(() => <RiderGoing.Provider value={(now) => setGoing((count) => count + (now ? 1 : -1))}>{props.under}</RiderGoing.Provider>);
  let slot!: HTMLDivElement;
  let stack!: HTMLDivElement;
  // A takeover taller than the composer gives the slot its height; when it goes, that room closes gently (a following
  // transcript glides down with it) instead of in one frame.
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
        whenMotionEnds(slot, "grid-template-rows", "--duration-gentle", () => { slot.style.gridTemplateRows = ""; slot.style.transition = ""; });
      }
      held = 0;
    }
    return now;
  }, false);
  onCleanup(() => watch?.disconnect());
  return <div ref={slot} class="ui-composer-slot ui-composer-width" data-taken={takeover() ? "" : undefined} data-opening={props.opening ? "" : undefined}>
    <div ref={stack} class="ui-composer-stack">{props.riders}<Frost class={cn("ui-desktop-composer", props.class)}>{props.children}</Frost></div>{takeover()}
    <Show when={under.toArray().some((part) => part != null && part !== false && part !== "")}><div class="ui-composer-under" data-going={going() ? "" : undefined}>{under()}</div></Show></div>;
}
export const VoiceRider = (props: { levels: number[]; gain?: number; level?: number; motion?: Motion }) =>
  <Rider label="Listening" layout="wave" motion={props.motion}><Aura on level={props.level} /><PillWave levels={props.levels} gain={props.gain} /></Rider>;
export function Picker(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: JSX.Element; value?: JSX.Element; quiet?: JSX.Element; subject?: boolean }) {
  const [local, rest] = splitProps(props, ["icon", "value", "quiet", "subject", "children"]);
  return <Button variant="ghost" size="sm" {...rest} class="ui-picker" data-subject={local.subject ? "" : undefined}>
    {local.icon}<Show when={local.value}><span class="ui-picker-value ui-truncate">{local.value}</span></Show><Show when={local.quiet}><span class="ui-picker-quiet">{local.quiet}</span></Show>{local.children}<Icons.ChevronDown class="ui-picker-chevron" />
  </Button>;
}

export const ComposerField = (props: { children: JSX.Element }) => <div class="ui-composer-field">{props.children}</div>;
export const Completion = (props: { typed: string; rest: string; detail?: string }) =>
  <div class="ui-completion" aria-hidden="true"><span>{props.typed}</span>{props.rest} <small>{props.detail}</small></div>;
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

