import { Frost } from "./frost";
import { children, createComputed, createSignal, Index, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Aura } from "./pill";
import { duration } from "./motion";

/**
 * PhoneComposer: the phone's composer, Pills on the page: a PillField over a row of PillButtons. mode says which
 * shows, and nothing reflows between them: idle (the row), typing (the field fades in above it), listening (the
 * row's other pills fade where they stand, the stretched mic shrinks to a short pill at the row's end, filling with colour, the voice
 * track sweeps out of it to the row's start, captions open above). edit: pills over the field while its cursor is
 * moved by hand, fading in when editing. onTrack: a tap on the track while listening (the app stops). level: the voice level (0-1) while listening; the mic's Aura answers it.
 * under: a menu opened from one of the row's pills (PillButton open) is over it; the rest dims at once, as a menu under its submenu.
 * layout: bar (the default: each pill its own frost, the mic stretched) or surface (the row one frost capsule, its pills slots in it,
 * the mic at its end; listening, an Aura fills the capsule under the track). riders: Riders over the field, as on a
 * DesktopComposer's top edge (queued messages, attachments, a question). opening: its chat is still arriving
 * (reattaching), so its riders and edit pills keep their room unseen; the row, which is the field's way in, stays.
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
  const edit = children(() => props.edit);
  const state = (): PhoneState => props.mode === "typing" && props.editing ? "editing" : props.mode;
  const shows = (part: PhonePart) => (PHONE_COMPOSER_STATES[state()] as readonly PhonePart[]).includes(part);
  // The captions stay mounted while they go, until their ground has faded.
  const [captions, setCaptions] = createSignal(shows("captions"));
  createComputed(() => { if (shows("captions")) setCaptions(true); });
  let root!: HTMLDivElement, fieldBox!: HTMLDivElement;
  // The field's height, kept on the root: the captions' words going are clipped above it (it grows as the transcript lands).
  onMount(() => { const observer = new ResizeObserver(() => root.style.setProperty("--under-field", `${fieldBox.offsetHeight}px`)); observer.observe(fieldBox); onCleanup(() => observer.disconnect()); });
  const surface = () => props.layout === "surface";
  return <div ref={root} class="ui-phone-composer" data-state={state()} data-show={PHONE_COMPOSER_STATES[state()].join(" ")} data-layout={surface() ? "surface" : undefined} data-under={props.under ? "" : undefined} data-opening={props.opening ? "" : undefined} style={{ "--voice-level": shows("orb") && props.level !== undefined ? String(props.level) : undefined }}>
    <div class="ui-composer-stack">{props.riders}</div>
    <Show when={edit()}><div class="ui-phone-edit" aria-hidden={shows("edit") ? undefined : "true"}>{edit()}</div></Show>
    <Show when={captions()}><div class="ui-voice-captions" aria-live="polite" data-leaving={shows("captions") ? undefined : ""} onAnimationEnd={(event) => { if (event.target === event.currentTarget && !shows("captions")) setCaptions(false); }}>{props.captions}</div></Show>
    <div ref={fieldBox} class="ui-phone-field">{props.field}</div>
    <Frost plain={!surface()} class="ui-phone-row">{props.children}<div class="ui-voice-track" aria-hidden={shows("track") ? undefined : "true"} onClick={() => shows("track") && props.onTrack?.()}><Show when={surface()}><Aura /></Show>{props.track}</div></Frost>
  </div>;
}
/**
 * Captions: what a dictation has heard so far, for PhoneComposer's captions. lead: the end of what was already in the
 * draft, upright and already there, so the new words read as continuing it. words: each heard word with the space
 * after it; a new one fades in as the transcript's words do (colour), and a revised one keeps its node, so it does not
 * replay. A new line glides the ones above it up rather than jumping. ref: the line's element (the app measures it).
 */
export function Captions(props: { lead?: string; words: string[]; ref?: (element: HTMLElement) => void }) {
  const glide = (element: HTMLElement) => {
    let height = 0;
    const observer = new ResizeObserver(() => {
      const next = element.offsetHeight;
      if (height && next > height) element.animate([{ transform: `translateY(${next - height}px)` }, { transform: "none" }], { duration: duration("--duration-quick"), easing: "ease-out" });
      height = next;
    });
    observer.observe(element);
    onCleanup(() => observer.disconnect());
    props.ref?.(element);
  };
  return <p><span ref={glide} class="ui-captions"><Show when={props.lead}><span class="ui-captions-lead">{props.lead}</span></Show><Index each={props.words}>{(word) => <span>{word()}</span>}</Index></span></p>;
}
