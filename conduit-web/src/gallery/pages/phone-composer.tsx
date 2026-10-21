import { createSignal, For } from "solid-js";
import { Button, Icons } from "@/components/ui";
import { Captions, PhoneComposer, PHONE_COMPOSER_STATES, type PhonePart, type VoiceMode, PillButton, PillField, PillWave } from "@/components/ui";

import { speech, queued, icon } from "../demos";
import { row, token, type Page } from "../model";

/** The phone's composer, as components v2 builds it; each option a value or an accessor (the Motion cell switches them). */
export type Live<T> = T | (() => T);
export const read = <T,>(value: Live<T>) => typeof value === "function" ? (value as () => T)() : value;
export const phoneComposer = (mode: Live<VoiceMode>, opts: { draft?: Live<boolean>; away?: Live<boolean>; editing?: Live<boolean>; under?: Live<boolean>; riders?: boolean; layout?: "bar" | "surface" } = {}) => {
  const m = () => read(mode), draft = () => !!read(opts.draft ?? false), under = () => !!read(opts.under ?? false), voice = speech(() => m() === "listening");
  return <PhoneComposer mode={m()} layout={opts.layout} under={under()} editing={!!read(opts.editing ?? false)} level={voice.level()} riders={opts.riders ? queued() : undefined}
    field={<PillField value={draft() ? "make the second paragraph shorter" : ""} placeholder="Send a message…" />}
    track={<PillWave levels={voice.bars()} />}
    captions={<Captions lead="make the second paragraph shorter" words={["then ", "rename ", "the ", "file ", "to ", "lorem.txt"]} />}
    edit={<><PillButton {...icon("Undo", <Icons.Undo />)} /><PillButton {...icon("Delete word or selection", <Icons.Backspace />)} /><PillButton {...icon("Previous word", <Icons.ChevronLeft />)} /><PillButton {...icon("Next word", <Icons.ChevronRight />)} /><PillButton {...icon("End of draft", <Icons.InsertText />)} /></>}>
    <PillButton open={under()} {...icon("Message options", <Icons.Add />)} />
    <PillButton {...icon("Take a photo", <Icons.Camera />)} />
    <PillButton {...icon(m() === "typing" ? "Close the keyboard" : "Type a message", <Icons.Keyboard />)} />
    <PillButton folded={!read(opts.away ?? false)} {...icon("Scroll to latest", <Icons.ArrowDown />)} />
    <PillButton stretch aura {...icon("Dictate", <Icons.Microphone />)} />
    {/* Send and Stop and send are one slot, one arrow: with a draft it stays put as listening starts and stops. */}
    <PillButton voice folded={m() !== "listening" && !draft()} {...icon(m() === "listening" ? "Stop and send" : "Send", <Icons.Send />)} />
  </PhoneComposer>;
};
export const pill = (label: string) => `[aria-label="${label}"]`;

export const PART_NAMES: Record<PhonePart, string> = { field: "Field", pills: "Options · Camera · Keyboard · Scroll to latest", edit: "Edit pills", track: "Voice track", captions: "Captions", orb: "Dictate as an orb pill" };
export const StateTable = () => <table class="g-state-table"><thead><tr><th />{(Object.keys(PHONE_COMPOSER_STATES) as (keyof typeof PHONE_COMPOSER_STATES)[]).map((state) => <th>{state}</th>)}</tr></thead>
  <tbody>{(Object.keys(PART_NAMES) as PhonePart[]).map((part) => <tr><th>{PART_NAMES[part]}</th>{Object.values(PHONE_COMPOSER_STATES).map((shown) => <td>{(shown as readonly PhonePart[]).includes(part) ? "●" : ""}</td>)}</tr>)}</tbody></table>;

function PhoneMotion(props: { layout?: "bar" | "surface"; initial: string }) {
  const [state, setState] = createSignal(props.initial);
  return <div class="g-stack"><div class="g-row"><For each={["Idle", "Scrolled up", "Typing", "Typing a draft", "Editing", "Menu open", "Listening"]}>{(name) => <Button size="sm" variant="ghost" outline={state() === name} aria-pressed={state() === name} onClick={() => setState(name)}>{name}</Button>}</For></div>
    <div class="g-phone-composer">{phoneComposer(() => state() === "Listening" ? "listening" : state().startsWith("Typing") || state() === "Editing" || state() === "Menu open" ? "typing" : "idle",
      { layout: props.layout, draft: () => ["Typing a draft", "Editing", "Menu open"].includes(state()), away: () => state() === "Scrolled up", editing: () => state() === "Editing", under: () => state() === "Menu open" })}</div>
  </div>;
}

export const phoneComposerPage: Page = { title: "PhoneComposer", summary: "The phone's composer: Pills on the page, a PillField over a row of PillButtons, one gap apart. Its mode says what shows, and nothing reflows between them: idle (the row), typing (the field above it), listening (the voice track and captions). Circles that come and go fold (Scroll to latest, Stop and send, Send).", rail: "Blocks",
  preview: () => <div class="g-phone-composer">{phoneComposer("idle")}</div>,
  usage: `import { PhoneComposer, PillField, PillWave, Captions, PillButton, Icons } from "@/components/ui";

<PhoneComposer mode={mode()} riders={riders()}
  field={<PillField value={draft()} onInput={setDraft} placeholder="Send a message…" />}
  track={<PillWave levels={levels()} />} onTrack={stopDictation}
  captions={<Captions words={words()} />}>
  <PillButton label="Message options" icon={<Icons.Add />} onPick={openOptions} />
  <PillButton stretch aura label="Dictate" icon={<Icons.Microphone />} onPick={toggleDictation} />
  <PillButton voice folded={!draft()} label="Send" icon={<Icons.Send />} onPick={sendMessage} />
</PhoneComposer>`,
  anatomy: { scene: () => <div class="g-phone-composer">{phoneComposer("typing", { draft: true, away: true, editing: true })}</div>, parts: [{ selector: ".ui-phone-edit", name: "Edit pills", does: "Undo · Delete word · Previous word · Next word · End of draft: over the field while its cursor is moved by hand", from: "PillButtons in edit" },
    { selector: ".ui-phone-field", name: "Field", does: "the draft; shown while typing", from: "PillField" },
    { selector: pill("Message options"), name: "Options", does: "+: opens the options menu (attach, model, ...); stays lit while the rest dims", from: "PillButton · open" },
    { selector: pill("Take a photo"), name: "Camera", does: "takes a photo to attach", from: "PillButton", side: "below" },
    { selector: pill("Close the keyboard"), name: "Keyboard", does: "opens or closes the keyboard (Type a message / Close the keyboard)", from: "PillButton", side: "below" },
    { selector: pill("Scroll to latest"), name: "Scroll to latest", does: "shown only when scrolled up", from: "PillButton · folded", side: "below" },
    { selector: pill("Dictate"), name: "Dictate", does: "the mic: fills the row's rest; starts listening", from: "PillButton · stretch aura", side: "below" },
    { selector: pill("Send"), name: "Send", does: "the arrow: shown with a draft; Stop and send while listening", from: "PillButton · voice folded", side: "below" }] },
  examples: [
    row("Anatomy · listening", "Captions show the newest three lines on the ground. PillWave runs from the row start to Dictate; tap it to stop. Dictate becomes an Aura orb pill that follows the voice level. Stop and send stops dictation and sends the words.", () => <div class="g-phone-composer">{phoneComposer("listening")}</div>, { surfaces: ["ground"], phone: "only" }),
    row("State table", "PHONE_COMPOSER_STATES", () => <StateTable />, { surfaces: ["ground"], phone: "only" }),
    row("Idle", "PhoneComposer mode=idle: the row alone; nothing to send, so Send is folded", () => <div class="g-phone-composer">{phoneComposer("idle")}</div>, { surfaces: ["ground"], phone: "only" }),
    row("Typing", "mode=typing: the field above the row, Send beside the mic", () => <div class="g-phone-composer">{phoneComposer("typing", { draft: true })}</div>, { surfaces: ["ground"], phone: "only" }),
    row("Listening", "mode=listening: the mic an orb pill at the row's end, Stop and send beside it, the track and captions", () => <div class="g-phone-composer">{phoneComposer("listening")}</div>, { surfaces: ["ground"], phone: "only" }),
    row("Editing", "edit · editing: pills over the field while its cursor is moved by hand", () => <div class="g-phone-composer">{phoneComposer("typing", { draft: true, editing: true })}</div>, { surfaces: ["ground"], phone: "only" }),
    row("Menu open", "under · PillButton open: the + menu is open, so the rest dims at once and its opener stays lit", () => <div class="g-phone-composer">{phoneComposer("typing", { draft: true, under: true })}</div>, { surfaces: ["ground"], phone: "only" }),
    row("Riding", "riders: Riders over the field, as on a DesktopComposer's top edge (queued messages, attachments, a question)", () => <div class="g-phone-composer">{phoneComposer("typing", { draft: true, riders: true })}</div>, { surfaces: ["ground"], phone: "only" }),
    row("Surface", "layout=surface: the row one frost capsule, its pills slots in it, the mic at its end", () => <div class="g-phone-composer">{phoneComposer("idle", { layout: "surface" })}</div>, { surfaces: ["ground"], phone: "only" }),
    row("Surface · listening", "layout=surface · mode=listening: an Aura fills the capsule under the waveform; Stop and send beside the mic", () => <div class="g-phone-composer">{phoneComposer("listening", { layout: "surface" })}</div>, { surfaces: ["ground"], phone: "only" })
  ],
  motion: [
    row("its modes · Idle", "Switch modes to replay the field, editing, menu, scroll and voice transitions. Parts enter over --duration-gentle and leave over --duration-quick.", () => <PhoneMotion layout="bar" initial="Idle" />, { surfaces: ["ground"], phone: "only", code: "<PhoneComposer mode>" }),
    row("its modes · Scrolled up", "Switch modes to replay the field, editing, menu, scroll and voice transitions. Parts enter over --duration-gentle and leave over --duration-quick.", () => <PhoneMotion layout="bar" initial="Scrolled up" />, { surfaces: ["ground"], phone: "only", code: "<PhoneComposer mode>" }),
    row("its modes · Typing", "Switch modes to replay the field, editing, menu, scroll and voice transitions. Parts enter over --duration-gentle and leave over --duration-quick.", () => <PhoneMotion layout="bar" initial="Typing" />, { surfaces: ["ground"], phone: "only", code: "<PhoneComposer mode>" }),
    row("its modes · Typing a draft", "Switch modes to replay the field, editing, menu, scroll and voice transitions. Parts enter over --duration-gentle and leave over --duration-quick.", () => <PhoneMotion layout="bar" initial="Typing a draft" />, { surfaces: ["ground"], phone: "only", code: "<PhoneComposer mode>" }),
    row("its modes · Editing", "Switch modes to replay the field, editing, menu, scroll and voice transitions. Parts enter over --duration-gentle and leave over --duration-quick.", () => <PhoneMotion layout="bar" initial="Editing" />, { surfaces: ["ground"], phone: "only", code: "<PhoneComposer mode>" }),
    row("its modes · Menu open", "Switch modes to replay the field, editing, menu, scroll and voice transitions. Parts enter over --duration-gentle and leave over --duration-quick.", () => <PhoneMotion layout="bar" initial="Menu open" />, { surfaces: ["ground"], phone: "only", code: "<PhoneComposer mode>" }),
    row("its modes · Listening", "Switch modes to replay the field, editing, menu, scroll and voice transitions. Parts enter over --duration-gentle and leave over --duration-quick.", () => <PhoneMotion layout="bar" initial="Listening" />, { surfaces: ["ground"], phone: "only", code: "<PhoneComposer mode>" }),
    row("its modes · surface · Idle", "Switch modes to replay the field, editing, menu, scroll and voice transitions. Parts enter over --duration-gentle and leave over --duration-quick.", () => <PhoneMotion layout="surface" initial="Idle" />, { surfaces: ["ground"], phone: "only", code: "<PhoneComposer mode layout=\"surface\">" }),
    row("its modes · surface · Scrolled up", "Switch modes to replay the field, editing, menu, scroll and voice transitions. Parts enter over --duration-gentle and leave over --duration-quick.", () => <PhoneMotion layout="surface" initial="Scrolled up" />, { surfaces: ["ground"], phone: "only", code: "<PhoneComposer mode layout=\"surface\">" }),
    row("its modes · surface · Typing", "Switch modes to replay the field, editing, menu, scroll and voice transitions. Parts enter over --duration-gentle and leave over --duration-quick.", () => <PhoneMotion layout="surface" initial="Typing" />, { surfaces: ["ground"], phone: "only", code: "<PhoneComposer mode layout=\"surface\">" }),
    row("its modes · surface · Typing a draft", "Switch modes to replay the field, editing, menu, scroll and voice transitions. Parts enter over --duration-gentle and leave over --duration-quick.", () => <PhoneMotion layout="surface" initial="Typing a draft" />, { surfaces: ["ground"], phone: "only", code: "<PhoneComposer mode layout=\"surface\">" }),
    row("its modes · surface · Editing", "Switch modes to replay the field, editing, menu, scroll and voice transitions. Parts enter over --duration-gentle and leave over --duration-quick.", () => <PhoneMotion layout="surface" initial="Editing" />, { surfaces: ["ground"], phone: "only", code: "<PhoneComposer mode layout=\"surface\">" }),
    row("its modes · surface · Menu open", "Switch modes to replay the field, editing, menu, scroll and voice transitions. Parts enter over --duration-gentle and leave over --duration-quick.", () => <PhoneMotion layout="surface" initial="Menu open" />, { surfaces: ["ground"], phone: "only", code: "<PhoneComposer mode layout=\"surface\">" }),
    row("its modes · surface · Listening", "Switch modes to replay the field, editing, menu, scroll and voice transitions. Parts enter over --duration-gentle and leave over --duration-quick.", () => <PhoneMotion layout="surface" initial="Listening" />, { surfaces: ["ground"], phone: "only", code: "<PhoneComposer mode layout=\"surface\">" })
  ],
  tokens: [{ title: "What it reads", tokens: [
    token("--space-md", "medium spacing"),
    token("--pill-size", "pill height"),
    token("--duration-gentle", "entrance duration"),
    token("--ease-arrive", "entrance easing"),
    token("--duration-quick", "exit duration"),
    token("--radius-round", "round capsule corners")
  ] }],
  api: ["PhoneComposer", "Rider", "RiderTitle", "Lines", "Line", "RiderActions", "Button", "PillField", "PillButton", "PillWave", "Captions"],
};
