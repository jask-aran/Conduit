import { Frost } from "./frost";
import { children, createComputed, createSignal, Index, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Aura } from "./pill";
import { collapse, glide, MoveContext } from "./motion";

/**
 * PhoneComposer: the phone's composer, Pills on the page: a PillField over a row of PillButtons. mode: idle (the row),
 * typing (the field fades in above), listening (the other pills fade, the mic shrinks to the row's end, the voice track
 * sweeps out, captions open above); nothing reflows between them. edit: pills over the field while its cursor is moved.
 * level: the voice level (0-1), answered by the mic's Aura. under: a menu from a pill is over it; the rest dims.
 * layout: bar (each pill its own frost) or surface (one frost capsule). riders: Riders over the field, as on a
 * DesktopComposer. opening: its chat is still arriving, so riders and edit pills keep their room unseen.
 */
export type VoiceMode = "idle" | "typing" | "listening";
/** PhoneComposer's parts, as its state table names them: the field, the row's pills (not the mic or Send, which are
 * always in the row), the edit pills, the voice track, the captions, and orb (the mic as an orb pill at the row's end). */
export type PhonePart = "field" | "pills" | "edit" | "track" | "captions" | "orb";
/** PhoneComposer's state table: what each state shows. Every move between two states follows from it and the three
 * moves in styles/phone-composer.css (in, out, in place) -- none depends on the state it came from. */
export const PHONE_COMPOSER_STATES = {
  idle: ["pills"],
  typing: ["field", "pills"],
  editing: ["field", "pills", "edit"],
  listening: ["track", "captions", "orb"],
} as const satisfies Record<string, readonly PhonePart[]>;
export type PhoneState = keyof typeof PHONE_COMPOSER_STATES;
export function PhoneComposer(props: { mode: VoiceMode; riders?: JSX.Element; layout?: "bar" | "surface"; field: JSX.Element; track?: JSX.Element; onTrack?: () => void; captions?: JSX.Element; edit?: JSX.Element; editing?: boolean; under?: boolean; level?: number; children: JSX.Element ; opening?: boolean}) {
  const state = (): PhoneState => props.mode === "typing" && props.editing ? "editing" : props.mode;
  const shows = (part: PhonePart) => (PHONE_COMPOSER_STATES[state()] as readonly PhonePart[]).includes(part);
  // Each holder tells the parts it holds how they move (motion.ts, MoveScope).
  const under = () => !!props.under;
  const edit = children(() => <MoveContext.Provider value={{ out: () => !shows("edit") }}>{props.edit}</MoveContext.Provider>);
  // The captions stay mounted while they go, until their ground has faded.
  const [captions, setCaptions] = createSignal(shows("captions"));
  createComputed(() => { if (shows("captions")) setCaptions(true); });
  let root!: HTMLDivElement, fieldBox!: HTMLDivElement, editBox: HTMLDivElement | undefined;
  // The field's height, kept on the root: the captions' words going are clipped above it (it grows as the transcript lands).
  onMount(() => { onCleanup(collapse(fieldBox)); if (editBox) onCleanup(collapse(editBox)); const observer = new ResizeObserver(() => root.style.setProperty("--under-field", `${fieldBox.offsetHeight}px`)); observer.observe(fieldBox); onCleanup(() => observer.disconnect()); });
  const surface = () => props.layout === "surface";
  return <div ref={root} class="ui-phone-composer" data-state={state()} data-show={PHONE_COMPOSER_STATES[state()].join(" ")} data-layout={surface() ? "surface" : undefined} data-under={props.under ? "" : undefined} data-opening={props.opening ? "" : undefined} style={{ "--voice-level": shows("orb") && props.level !== undefined ? String(props.level) : undefined }}>
    <div class="ui-composer-stack">{props.riders}</div>
    <Show when={edit()}><div ref={editBox} class="ui-phone-edit" data-move="collapse" data-out={shows("edit") ? undefined : ""} aria-hidden={shows("edit") ? undefined : "true"}><div class="ui-phone-edit-pills">{edit()}</div></div></Show>
    <Show when={captions()}><div class="ui-voice-captions" aria-live="polite" data-leaving={shows("captions") ? undefined : ""} onAnimationEnd={(event) => { if (event.target === event.currentTarget && !shows("captions")) setCaptions(false); }}>{props.captions}</div></Show>
    <div ref={fieldBox} class="ui-phone-field" data-move="collapse" data-out={shows("field") ? undefined : ""}><MoveContext.Provider value={{ out: () => !shows("field"), under }}>{props.field}</MoveContext.Provider></div>
    <Frost plain={!surface()} class="ui-phone-row"><MoveContext.Provider value={{ out: () => !shows("pills"), under, voice: () => shows("orb") }}>{props.children}</MoveContext.Provider>
      <div class="ui-voice-track" data-move={surface() ? undefined : "wipe"} data-out={shows("track") ? undefined : ""} aria-hidden={shows("track") ? undefined : "true"} onClick={() => shows("track") && props.onTrack?.()}>
        <MoveContext.Provider value={{ get out() { return surface() ? () => !shows("track") : undefined; }, voice: () => shows("orb") }}><Show when={surface()}><Aura /></Show>{props.track}</MoveContext.Provider></div></Frost>
  </div>;
}
/** Captions: what a dictation has heard so far. lead: the end of the draft already there, so new words continue it.
 *  words: each heard word; a new one fades in (colour), a revised one keeps its node so it does not replay. */
export function Captions(props: { lead?: string; words: string[]; ref?: (element: HTMLElement) => void }) {
  const line = (element: HTMLElement) => { onCleanup(glide(element)); props.ref?.(element); };
  return <p data-piece="Captions"><span ref={line} class="ui-captions"><Show when={props.lead}><span class="ui-captions-lead">{props.lead}</span></Show><Index each={props.words}>{(word) => <span>{word()}</span>}</Index></span></p>;
}
