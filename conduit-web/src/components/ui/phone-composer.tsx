import { Frost } from "./frost";
import { children, createComputed, createSignal, Index, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Aura } from "./pill";
import { collapse, glide, MoveContext } from "./motion";

export type VoiceMode = "idle" | "typing" | "listening";
export type PhonePart = "field" | "pills" | "edit" | "track" | "captions" | "orb";
/** Every move between two states follows from this table and the moves in styles/phone-composer.css; none depends on
 * the state it came from. */
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
/** A revised word keeps its node, so it does not replay its fade. */
export function Captions(props: { lead?: string; words: string[]; ref?: (element: HTMLElement) => void }) {
  const line = (element: HTMLElement) => { onCleanup(glide(element)); props.ref?.(element); };
  return <p data-piece="Captions"><span ref={line} class="ui-captions"><Show when={props.lead}><span class="ui-captions-lead">{props.lead}</span></Show><Index each={props.words}>{(word) => <span>{word()}</span>}</Index></span></p>;
}
