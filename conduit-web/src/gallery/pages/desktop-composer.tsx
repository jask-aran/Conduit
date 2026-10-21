import { HarnessMark } from "@/components/ui";
import { Icons } from "@/components/ui";
import { Show } from "solid-js";
import { Picker, Gauge, Swatch, Completion, VoiceRider, Spinner, StopGlyph, Choices, Button, Choice, ComposerField, DesktopComposer, TextArea, Rider, Toolbar } from "@/components/ui";
import { COMPOSER_SIZES, TokenTable } from "../foundations";
import { Anatomy, FormTable, form, States } from "../specs";
import { ghost, queued, speech, attachments } from "../demos";
import { type Family, lib } from "../model";

export const toolbarStart = () => <>{ghost("Attach and more", <Icons.Add />)}{ghost("Context usage", <Gauge value={42} />)}<Picker icon={<HarnessMark id="conduit" />} aria-label="Profile" /><Picker subject value="Meta: Muse Spark 1.3" quiet="medium" /></>;
export const toolbarEnd = () => ghost("Start voice dictation", <Icons.Microphone />);
export const send = () => ghost("Send message", <Icons.Send />);

export const desktopComposerFamily: Family = { title: "DesktopComposer", note: "desktop only, one integrated piece: resting frost holding a TextArea above a Toolbar, with Riders on its top edge. A phone's is PhoneComposer (Pills), sharing the TextArea and the Riders", rail: "Blocks",
  usage: `import { DesktopComposer, ComposerField, TextArea, Toolbar, Picker, Button, Icons } from "@/components/ui";

<DesktopComposer riders={riders()} takeover={question()}>
  <ComposerField><TextArea value={draft()} onInput={(event) => setDraft(event.currentTarget.value)} placeholder="Send a message…" /></ComposerField>
  <Toolbar
    start={<Picker subject value={model()} onClick={openModelSelector} />}
    end={<Button variant="ghost" size="icon-sm" aria-label="Voice dictation" onClick={toggleDictation}><Icons.Microphone /></Button>}
    primary={<Button variant="ghost" size="icon-sm" aria-label="Send message" onClick={sendMessage}><Icons.Send /></Button>}
  />
</DesktopComposer>`,
  api: ["DesktopComposer", "Rider", "RiderTitle", "Lines", "Line", "RiderActions", "Chips", "Chip", "VoiceRider", "ComposerField", "TextArea", "Completion", "Toolbar", "Button", "Gauge", "Picker", "HarnessMark", "Spinner", "StopGlyph", "Swatch", "Choices", "Choice"],
  groups: [
    { atoms: [
      lib("composer-anatomy", "Anatomy", "desktop", "composer", "DesktopComposer > riders · ComposerField (a TextArea) · Toolbar (start · end · primary)", () => <Anatomy scene={() => <div class="g-composer"><DesktopComposer riders={queued()}>
        <ComposerField><TextArea placeholder="Send a message…" /></ComposerField>
        <Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} />
      </DesktopComposer></div>} parts={[
        [".ui-rider", "Riders", "Rider", "frost on the composer's top edge (Rider, its own section)"],
        [".ui-composer-field", "Field", "ComposerField · TextArea", "the draft, padded by the composer"],
        [".ui-toolbar-start", "Start", "Toolbar start", "ghost icon buttons and pickers"],
        [".ui-toolbar-end", "End", "Toolbar end", "the mic", "below"],
        [".ui-toolbar-primary", "Primary", "Toolbar primary", "Send, or Stop while the agent works", "below"],
      ]} />, true),
      lib("composer-toolbar", "Toolbar", "desktop", "composer", "Toolbar start · end · aside · primary, no frost of its own: ghost icon buttons, pickers; the primary its own slot (Send, or Stop while the agent works), Stop stepping in beside it as the aside", () => <div class="g-composer g-part"><Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} /></div>, "row"),
    ] },
    { title: "Assembled", atoms: [
      lib("composer", "Composer", "desktop", "composer", "chat/composer.tsx", () => <div class="g-composer"><DesktopComposer><ComposerField><TextArea placeholder="Send a message…" /></ComposerField><Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} /></DesktopComposer></div>, true),
      lib("composer-pickers", "Picker · Gauge", "desktop", "composer", "Picker: a small ghost button showing what is picked; Gauge: how full, as a ring", () => <FormTable rows={[
        form("a setting", "muted: a mark, its value cut short to its room", () => <div class="g-row"><Picker icon={<Icons.Permissions />} value="Ask before edits" /><Picker icon={<HarnessMark id="conduit" />} aria-label="Profile" /></div>, "<Picker icon value>", "--icon-sm · --control-sm"),
        form("the subject", "what the message goes to (the model), at full weight; a quieter second value", () => <Picker subject value="Meta: Muse Spark 1.3 Contributor" quiet="medium" />, "<Picker subject quiet>", "--weight-current"),
        form("connecting", "a Spinner as its mark until there is a value", () => <Picker icon={<Spinner />} value="Connecting…" disabled />, "<Picker icon={<Spinner />}>", ""),
        form("Gauge", "idle (nothing reported), normal, warning, critical", () => <div class="g-row"><Gauge value={0} tone="idle" /><Gauge value={42} /><Gauge value={78} tone="warning" /><Gauge value={94} tone="critical" /></div>, "<Gauge value tone>", "--warn · --destructive"),
        form("Swatch", "a part's colour beside its label; hollow for what sits outside; fill: the whole of a colour choice", () => <div class="g-row"><Swatch colour="oklch(0.72 0.15 300)" /><Swatch hollow /><Button variant="ghost" size="icon-sm" aria-label="Mauve"><Swatch colour="oklch(0.72 0.15 300)" fill /></Button></div>, "<Swatch colour hollow fill>", "--icon-dot"),
      ]} on={["desktop"]} widths={["200px", "minmax(0, 1fr)", "minmax(0, 1fr)"]} />, "row"),
      lib("composer-voice", "VoiceRider · Completion", "desktop", "composer", "VoiceRider · Completion", () => <FormTable rows={[
        form("dictating", "the voice rides over the composer as a wave Rider on an Aura, as a phone's voice track; the words go into the field as they come", () => <States states={["Off", "Listening"] as const}>{(s) => {
          const voice = speech(() => s() === "Listening");
          return <div class="g-composer"><DesktopComposer riders={<Show when={s() === "Listening"}><VoiceRider levels={voice.bars()} level={voice.level()} motion="entering" /></Show>}>
            <ComposerField><TextArea value={s() === "Listening" ? "rename the file to" : ""} placeholder="Send a message…" /></ComposerField>
            <Toolbar start={toolbarStart()} end={<Button variant="ghost" size="icon-sm" aria-label="Voice dictation" aria-pressed={s() === "Listening"}><Icons.Microphone /></Button>} primary={send()} /></DesktopComposer></div>; }}</States>, "<VoiceRider levels level>", "Rider wave: --control"),
        form("Completion", "a slash command the draft completes to: the rest ghosted after what is typed, then what it does", () => <div class="g-composer"><DesktopComposer><ComposerField><TextArea value="/" /><Completion typed="/" rest="attach" detail="Choose files to attach" /></ComposerField><Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} /></DesktopComposer></div>, "<Completion typed rest detail>", "--cmp-field-pad · --text-caption"),
      ]} on={["desktop"]} widths={["200px", "minmax(0, 1fr)"]} />, "row"),
      lib("composer-ridden", "Composer · QueuedMessages + AttachmentStrip", "desktop", "composer", "chat/composer.tsx, queued-messages.tsx, attachment-strip.tsx", () => <div class="g-composer"><DesktopComposer riders={<>{queued()}{attachments()}</>}><ComposerField><TextArea value="see the attached notes" /></ComposerField><Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} /></DesktopComposer></div>, true),
    ] },
    { title: "Motion", note: "its own moves: the primary slot scales each action in where the last was, so nothing beside it moves, and Stop steps in beside Send when a draft is typed during a turn; dictating, the mic breathes; a question takes the composer's place -- the composer drops out of the pane keeping its room, and the card rises into the slot once it has gone", layout: "desktop", atoms: [
      lib("composer-motion", "DesktopComposer · motion", "desktop", "composer", "Toolbar primary · aside · DesktopComposer takeover", () => <FormTable rows={[
        form("the primary slot", "each action grows in from 60% where the last was; the aside steps in from the slot's side", () => <States states={["Ready", "Working", "Draft in a turn"] as const}>{(s) =>
          <div class="g-composer g-part"><Toolbar start={toolbarStart()} end={toolbarEnd()} aside={<Show when={s() === "Draft in a turn"}>{ghost("Stop response", <StopGlyph />)}</Show>}
            primary={<Show when={s() === "Working"} fallback={send()}>{ghost("Stop response", <StopGlyph />)}</Show>} /></div>}</States>, "<Toolbar primary aside>", "--duration-quick · --ease-arrive · the aside: --duration-gentle"),
        form("dictating", "the held mic breathes from the text colour to muted and back", () => <States states={["Off", "Dictating"] as const}>{(s) =>
          <div class="g-composer g-part"><Toolbar start={toolbarStart()} end={<Button variant="ghost" size="icon-sm" aria-label="Voice dictation" aria-pressed={s() === "Dictating"}><Icons.Microphone /></Button>} primary={send()} /></div>}</States>, "aria-pressed in Toolbar end", "1.6s, its own"),
        form("a question takes over", "the composer drops out keeping its room; the card rises 2 units into the slot after it", () => <States states={["Composer", "Question"] as const}>{(s) =>
          <div class="g-composer"><DesktopComposer riders={queued()} takeover={<Show when={s() === "Question"}><Rider layout="card" label="Question" motion="entering"><span class="ui-title-text">Preferred language</span>
            <Choices><Choice n={1} label="Python" detail="Use Python for the task" chosen active /><Choice n={2} label="TypeScript" detail="Use TypeScript for the task" /><Choice n={3} label="Rust" detail="Use Rust for the task" /></Choices></Rider></Show>}>
            <ComposerField><TextArea placeholder="Send a message…" /></ComposerField><Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} /></DesktopComposer></div>}</States>, "<DesktopComposer takeover>", "out: --duration-quick · --ease-leave · in: --duration-gentle · --ease-arrive, the card after --duration-quick"),
      ]} on={["desktop"]} widths={["200px", "minmax(0, 1fr)"]} />, "row"),
    ] },
    { title: "Sizes", note: "the width the pane declares for its composer", layout: "desktop", atoms: [
      lib("composer-sizes", "Composer sizes", "desktop", "composer", "--composer-width", () => <TokenTable groups={COMPOSER_SIZES} />, "row"),
    ] },
  ] };
