import { Icons } from "@/components/ui";
import { Captions, PhoneComposer, PHONE_COMPOSER_STATES, type PhonePart, type VoiceMode, PillButton, PillField, PillWave } from "@/components/ui";
import { Anatomy, type Part, FormTable, form, States } from "../specs";
import { speech, queued, icon } from "../demos";
import { type Family, lib } from "../model";

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
export const PHONE_PARTS: Part[] = [
  [".ui-phone-edit", "Edit pills", "PillButtons in edit", "Undo · Delete word · Previous word · Next word · End of draft: over the field while its cursor is moved by hand"],
  [".ui-phone-field", "Field", "PillField", "the draft; shown while typing"],
  [pill("Message options"), "Options", "PillButton · open", "+: opens the options menu (attach, model, ...); stays lit while the rest dims"],
  [pill("Take a photo"), "Camera", "PillButton", "takes a photo to attach", "below"],
  [pill("Close the keyboard"), "Keyboard", "PillButton", "opens or closes the keyboard (Type a message / Close the keyboard)", "below"],
  [pill("Scroll to latest"), "Scroll to latest", "PillButton · folded", "shown only when scrolled up", "below"],
  [pill("Dictate"), "Dictate", "PillButton · stretch aura", "the mic: fills the row's rest; starts listening", "below"],
  [pill("Send"), "Send", "PillButton · voice folded", "the arrow: shown with a draft; Stop and send while listening", "below"],
];
export const PART_NAMES: Record<PhonePart, string> = { field: "Field", pills: "Options · Camera · Keyboard · Scroll to latest", edit: "Edit pills", track: "Voice track", captions: "Captions", orb: "Dictate as an orb pill" };
export const StateTable = () => <table class="g-state-table"><thead><tr><th />{(Object.keys(PHONE_COMPOSER_STATES) as (keyof typeof PHONE_COMPOSER_STATES)[]).map((state) => <th>{state}</th>)}</tr></thead>
  <tbody>{(Object.keys(PART_NAMES) as PhonePart[]).map((part) => <tr><th>{PART_NAMES[part]}</th>{Object.values(PHONE_COMPOSER_STATES).map((shown) => <td>{(shown as readonly PhonePart[]).includes(part) ? "●" : ""}</td>)}</tr>)}</tbody></table>;
export const PHONE_VOICE_PARTS: Part[] = [
  [".ui-voice-captions", "Captions", "PhoneComposer captions", "the newest three lines heard, on the page's ground"],
  [".ui-voice-track", "Voice track", "PillWave", "the waveform, from the row's start to the mic; tap to stop"],
  ['[aria-label="Dictate"]', "Dictate", "PillButton · Aura", "shrunk to an orb pill; its Aura follows the voice level", "below"],
  ['[aria-label="Stop and send"]', "Stop and send", "PillButton · voice", "stops and sends what was heard", "below"],
];

export const phoneComposerFamily: Family = { title: "PhoneComposer", note: "the phone's composer: Pills on the page, a PillField over a row of PillButtons, one gap apart. Its mode says what shows, and nothing reflows between them: idle (the row), typing (the field above it), listening (the voice track and captions). Circles that come and go fold (Scroll to latest, Stop and send, Send)", rail: "Blocks",
  usage: `import { PhoneComposer, PillField, PillWave, Captions, PillButton, Icons } from "@/components/ui";

<PhoneComposer mode={mode()} riders={riders()}
  field={<PillField value={draft()} onInput={setDraft} placeholder="Send a message…" />}
  track={<PillWave levels={levels()} />} onTrack={stopDictation}
  captions={<Captions words={words()} />}>
  <PillButton label="Message options" icon={<Icons.Add />} onPick={openOptions} />
  <PillButton stretch aura label="Dictate" icon={<Icons.Microphone />} onPick={toggleDictation} />
  <PillButton voice folded={!draft()} label="Send" icon={<Icons.Send />} onPick={sendMessage} />
</PhoneComposer>`,
  api: ["PhoneComposer", "Rider", "RiderTitle", "Lines", "Line", "RiderActions", "Button", "PillField", "PillButton", "PillWave", "Captions"],
  groups: [
    { title: "Anatomy", note: "an assembly, not a base component: Pills and foundations (Aura, icons, type), each part named for what it does", layout: "phone", atoms: [
      lib("phone-anatomy", "Anatomy", "phone", "pill", "PhoneComposer > edit · field · row (the mode's pills)", () => <Anatomy scene={() => <div class="g-phone-composer">{phoneComposer("typing", { draft: true, away: true, editing: true })}</div>} parts={PHONE_PARTS} />, "row"),
      lib("phone-anatomy-listening", "Anatomy · listening", "phone", "pill", "PhoneComposer mode=listening > captions · row (track · Dictate · Stop and send)", () => <Anatomy scene={() => <div class="g-phone-composer">{phoneComposer("listening")}</div>} parts={PHONE_VOICE_PARTS} />, "row"),
    ] },
    { title: "State table", note: "what each state shows (PHONE_COMPOSER_STATES, rendered as data-show). Every move between two states follows from it and three moves, none depending on where it came from: in (room at once, fade in over gentle, from the first frame), out (fade over quick from the first frame; room after, or a row pill slides under its neighbour at its own size), in place (the mic's shape, the track's wipe, over gentle). Declared waits: the captions come in after the quick duration. The motion check reads the same table", layout: "phone", atoms: [
      lib("phone-table", "State table", "phone", "pill", "PHONE_COMPOSER_STATES", () => <StateTable />, "row"),
    ] },
    { title: "Forms", note: "each mode, and the field's edit pills", layout: "phone", atoms: [
      lib("phone-idle", "Idle", "phone", "pill", "PhoneComposer mode=idle: the row alone; nothing to send, so Send is folded", () => <div class="g-phone-composer">{phoneComposer("idle")}</div>),
      lib("phone-typing", "Typing", "phone", "pill", "mode=typing: the field above the row, Send beside the mic", () => <div class="g-phone-composer">{phoneComposer("typing", { draft: true })}</div>),
      lib("phone-listening", "Listening", "phone", "pill", "mode=listening: the mic an orb pill at the row's end, Stop and send beside it, the track and captions", () => <div class="g-phone-composer">{phoneComposer("listening")}</div>),
      lib("phone-editing", "Editing", "phone", "pill", "edit · editing: pills over the field while its cursor is moved by hand", () => <div class="g-phone-composer">{phoneComposer("typing", { draft: true, editing: true })}</div>),
      lib("phone-under", "Menu open", "phone", "pill", "under · PillButton open: the + menu is open, so the rest dims at once and its opener stays lit", () => <div class="g-phone-composer">{phoneComposer("typing", { draft: true, under: true })}</div>),
      lib("phone-riders", "Riding", "phone", "pill", "riders: Riders over the field, as on a DesktopComposer's top edge (queued messages, attachments, a question)", () => <div class="g-phone-composer">{phoneComposer("typing", { draft: true, riders: true })}</div>),
      lib("phone-surface", "Surface", "phone", "pill", "layout=surface: the row one frost capsule, its pills slots in it, the mic at its end", () => <div class="g-phone-composer">{phoneComposer("idle", { layout: "surface" })}</div>),
      lib("phone-surface-listening", "Surface · listening", "phone", "pill", "layout=surface · mode=listening: an Aura fills the capsule under the waveform; Stop and send beside the mic", () => <div class="g-phone-composer">{phoneComposer("listening", { layout: "surface" })}</div>),
    ] },
    { title: "Motion", note: "its own moves: the field fades in place and gives up its room once faded; listening, the other pills fade where they stand, the mic shrinks to an orb pill at the row's end, its icon crossfading to the orb, and the track sweeps out of it to the row's start (back, quicker, on stop); captions fade in; folding circles open their room and fade in, or fade and then close it; edit pills fade each", layout: "phone", atoms: [
      lib("phone-motion", "PhoneComposer · motion", "phone", "pill", "PhoneComposer mode · PillButton folded · orb", () => <FormTable rows={[
        ...(["bar", "surface"] as const).map((layout) => form(layout === "bar" ? "its modes" : "its modes · surface", "pick one, then another", () => <States states={["Idle", "Scrolled up", "Typing", "Typing a draft", "Editing", "Menu open", "Listening"] as const}>{(s) => <div class="g-phone-composer">{phoneComposer(
          () => s() === "Listening" ? "listening" : s().startsWith("Typing") || s() === "Editing" || s() === "Menu open" ? "typing" : "idle",
          { layout, draft: () => ["Typing a draft", "Editing", "Menu open"].includes(s()), away: () => s() === "Scrolled up", editing: () => s() === "Editing", under: () => s() === "Menu open" })}</div>}</States>,
          `<PhoneComposer mode${layout === "surface" ? ' layout="surface"' : ""}>`, "in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave")),
      ]} on={["phone"]} widths={["200px", "minmax(0, 1fr)"]} />, "row"),
    ] },
  ] };
