import { HarnessMark } from "@/components/ui";
import { Icons } from "@/components/ui";
import { Show } from "solid-js";
import { Picker, Gauge, Swatch, Completion, VoiceRider, Spinner, StopGlyph, Choices, Button, Choice, ComposerField, DesktopComposer, TextArea, Rider, RiderTitle, Toolbar } from "@/components/ui";
import { Replay } from "../specs";
import { COMPOSER_SIZES } from "../foundations";
import { ghost, queued, speech, attachments } from "../demos";
import { row, type Page } from "../model";

export const toolbarStart = () => <>{ghost("Attach and more", <Icons.Add />)}{ghost("Context usage", <Gauge value={42} />)}<Picker icon={<HarnessMark id="conduit" />} aria-label="Profile" /><Picker subject value="Meta: Muse Spark 1.3" quiet="medium" /></>;
export const toolbarEnd = () => ghost("Start voice dictation", <Icons.Microphone />);
export const send = () => ghost("Send message", <Icons.Send />);

const composerScene = () => <div class="g-composer"><DesktopComposer><ComposerField><TextArea placeholder="Send a message…" /></ComposerField><Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} /></DesktopComposer></div>;

const dictation = (listening: () => boolean) => {
  const voice = speech(listening);
  return <div class="g-composer"><DesktopComposer riders={<Show when={listening()}><VoiceRider levels={voice.bars()} level={voice.level()} motion="entering" /></Show>}>
    <ComposerField><TextArea value={listening() ? "rename the file to" : ""} placeholder="Send a message…" /></ComposerField>
    <Toolbar start={toolbarStart()} end={<Button variant="ghost" size="icon-sm" aria-label="Voice dictation" aria-pressed={listening()}><Icons.Microphone /></Button>} primary={send()} /></DesktopComposer></div>;
};

export const desktopComposerPage: Page = {
  title: "DesktopComposer", rail: "Blocks",
  summary: "Desktop only, one integrated piece: resting frost holding a TextArea above a Toolbar, with Riders on its top edge. A phone's is PhoneComposer (Pills), sharing the TextArea and the Riders.",
  preview: composerScene,
  usage: `import { DesktopComposer, ComposerField, TextArea, Toolbar, Picker, Button, Icons } from "@/components/ui";

<DesktopComposer riders={riders()} takeover={question()}>
  <ComposerField><TextArea value={draft()} onInput={(event) => setDraft(event.currentTarget.value)} placeholder="Send a message…" /></ComposerField>
  <Toolbar
    start={<Picker subject value={model()} onClick={openModelSelector} />}
    end={<Button variant="ghost" size="icon-sm" aria-label="Voice dictation" onClick={toggleDictation}><Icons.Microphone /></Button>}
    primary={<Button variant="ghost" size="icon-sm" aria-label="Send message" onClick={sendMessage}><Icons.Send /></Button>}
  />
</DesktopComposer>`,
  anatomy: { scene: () => <div class="g-composer"><DesktopComposer riders={queued()}>
        <ComposerField><TextArea placeholder="Send a message…" /></ComposerField>
        <Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} />
      </DesktopComposer></div>, parts: [
    { selector: ".ui-rider", name: "Riders", does: "frost on the composer's top edge (Rider, its own section)", from: "Rider" },
    { selector: ".ui-composer-field", name: "Field", does: "the draft, padded by the composer", from: "ComposerField · TextArea" },
    { selector: ".ui-toolbar-start", name: "Start", does: "ghost icon buttons and pickers", from: "Toolbar start" },
    { selector: ".ui-toolbar-end", name: "End", does: "the mic", from: "Toolbar end", side: "below" },
    { selector: ".ui-toolbar-primary", name: "Primary", does: "Send, or Stop while the agent works", from: "Toolbar primary", side: "below" }
  ] },
  examples: [
    row("Toolbar", "Toolbar start · end · aside · primary, no frost of its own: ghost icon buttons, pickers; the primary its own slot (Send, or Stop while the agent works), Stop stepping in beside it as the aside", () => <div class="g-composer g-part"><Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} /></div>, { surfaces: ["ground"] }),
    row("Composer", "chat/composer.tsx", composerScene, { source: "chat/composer.tsx", surfaces: ["ground"] }),
    row("opening", "its chat still arriving (reattaching): the field alone; the toolbar and riders keep their room, unseen", () => <div class="g-composer"><DesktopComposer opening riders={queued()}><ComposerField><TextArea placeholder="Send a message…" /></ComposerField><Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} /></DesktopComposer></div>, { code: "<DesktopComposer opening>", source: "main.tsx ChatSurface opening", surfaces: ["ground"] }),
    row("a setting", "muted: a mark, its value cut short to its room; --icon-sm · --control-sm", () => <div class="g-row"><Picker icon={<Icons.Permissions />} value="Ask before edits" /><Picker icon={<HarnessMark id="conduit" />} aria-label="Profile" /></div>, { surfaces: ["ground"], code: "<Picker icon value>" }),
    row("the subject", "what the message goes to (the model), at full weight; a quieter second value; --weight-current", () => <Picker subject value="Meta: Muse Spark 1.3 Contributor" quiet="medium" />, { surfaces: ["ground"], code: "<Picker subject quiet>" }),
    row("connecting", "a Spinner as its mark until there is a value", () => <Picker icon={<Spinner />} value="Connecting…" disabled />, { surfaces: ["ground"], code: "<Picker icon={<Spinner />}>" }),
    row("Gauge", "idle (nothing reported), normal, warning, critical; --warn · --destructive", () => <div class="g-row"><Gauge value={0} tone="idle" /><Gauge value={42} /><Gauge value={78} tone="warning" /><Gauge value={94} tone="critical" /></div>, { surfaces: ["ground"], code: "<Gauge value tone>" }),
    row("Swatch", "a part's colour beside its label; hollow for what sits outside; fill: the whole of a colour choice; --icon-dot", () => <div class="g-row"><Swatch colour="oklch(0.72 0.15 300)" /><Swatch hollow /><Button variant="ghost" size="icon-sm" aria-label="Mauve"><Swatch colour="oklch(0.72 0.15 300)" fill /></Button></div>, { surfaces: ["ground"], code: "<Swatch colour hollow fill>" }),
    row("Completion", "a slash command the draft completes to: the rest ghosted after what is typed, then what it does; --cmp-field-pad · --text-caption", () => <div class="g-composer"><DesktopComposer><ComposerField><TextArea value="/" /><Completion typed="/" rest="attach" detail="Choose files to attach" /></ComposerField><Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} /></DesktopComposer></div>, { surfaces: ["ground"], code: "<Completion typed rest detail>" }),
    row("Composer · QueuedMessages + AttachmentStrip", "chat/composer.tsx, queued-messages.tsx, attachment-strip.tsx", () => <div class="g-composer"><DesktopComposer riders={<>{queued()}{attachments()}</>}><ComposerField><TextArea value="see the attached notes" /></ComposerField><Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} /></DesktopComposer></div>, { source: "chat/composer.tsx, queued-messages.tsx, attachment-strip.tsx", surfaces: ["ground"] }),
  ],
  motion: [
    row("voice rider · Off", "the voice rides over the composer as a wave Rider on an Aura, as a phone's voice track; the words go into the field as they come; Rider wave: --control", () => dictation(() => false), { surfaces: ["ground"], code: "<VoiceRider levels level>" }),
    row("voice rider · Listening", "the voice rides over the composer as a wave Rider on an Aura, as a phone's voice track; the words go into the field as they come; Rider wave: --control", () => dictation(() => true), { surfaces: ["ground"], code: "<VoiceRider levels level>" }),
    row("the primary slot · Ready", "each action grows in from 60% where the last was; the aside steps in from the slot's side; --duration-quick · --ease-arrive · the aside: --duration-gentle", () => <Replay leaves={["leaving"]}>{(m) => <div class="g-composer g-part"><Toolbar start={toolbarStart()} end={toolbarEnd()}
            primary={<Show when={m() === "leaving"} fallback={send()}>{ghost("Stop response", <StopGlyph />)}</Show>} /></div>}</Replay>, { surfaces: ["ground"], code: "<Toolbar primary aside>" }),
    row("the primary slot · Working", "each action grows in from 60% where the last was; the aside steps in from the slot's side; --duration-quick · --ease-arrive · the aside: --duration-gentle", () => <Replay leaves={["leaving"]}>{(m) => <div class="g-composer g-part"><Toolbar start={toolbarStart()} end={toolbarEnd()}
            primary={<Show when={m() !== "leaving"} fallback={send()}>{ghost("Stop response", <StopGlyph />)}</Show>} /></div>}</Replay>, { surfaces: ["ground"], code: "<Toolbar primary aside>" }),
    row("the primary slot · Draft in a turn", "each action grows in from 60% where the last was; the aside steps in from the slot's side; --duration-quick · --ease-arrive · the aside: --duration-gentle", () => <Replay leaves={["leaving"]}>{(m) => <div class="g-composer g-part"><Toolbar start={toolbarStart()} end={toolbarEnd()} aside={<Show when={m() !== "leaving"}>{ghost("Stop response", <StopGlyph />)}</Show>}
            primary={<Show when={m() === "leaving"} fallback={send()}>{ghost("Stop response", <StopGlyph />)}</Show>} /></div>}</Replay>, { surfaces: ["ground"], code: "<Toolbar primary aside>" }),
    row("dictating · Off", "the held mic breathes from the text colour to muted and back; 1.6s, its own", () => <div class="g-composer g-part"><Toolbar start={toolbarStart()} end={<Button variant="ghost" size="icon-sm" aria-label="Voice dictation" aria-pressed={false}><Icons.Microphone /></Button>} primary={send()} /></div>, { surfaces: ["ground"], code: "aria-pressed in Toolbar end" }),
    row("dictating · Dictating", "the held mic breathes from the text colour to muted and back; 1.6s, its own", () => <div class="g-composer g-part"><Toolbar start={toolbarStart()} end={<Button variant="ghost" size="icon-sm" aria-label="Voice dictation" aria-pressed={true}><Icons.Microphone /></Button>} primary={send()} /></div>, { surfaces: ["ground"], code: "aria-pressed in Toolbar end" }),
    row("a question takes over · Composer", "the composer drops out keeping its room; the card rises 2 units into the slot after it; out: --duration-quick · --ease-leave · in: --duration-gentle · --ease-arrive, the card after --duration-quick", () => <Replay leaves={["leaving"]}>{(m) => <div class="g-composer"><DesktopComposer riders={queued()} takeover={<Show when={m() === "leaving"}><Rider layout="card" label="Question" motion="entering"><RiderTitle>Preferred language</RiderTitle>
            <Choices><Choice n={1} label="Python" detail="Use Python for the task" chosen active /><Choice n={2} label="TypeScript" detail="Use TypeScript for the task" /><Choice n={3} label="Rust" detail="Use Rust for the task" /></Choices></Rider></Show>}>
            <ComposerField><TextArea placeholder="Send a message…" /></ComposerField><Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} /></DesktopComposer></div>}</Replay>, { surfaces: ["ground"], code: "<DesktopComposer takeover>" }),
    row("a question takes over · Question", "the composer drops out keeping its room; the card rises 2 units into the slot after it; out: --duration-quick · --ease-leave · in: --duration-gentle · --ease-arrive, the card after --duration-quick", () => <Replay leaves={["leaving"]}>{(m) => <div class="g-composer"><DesktopComposer riders={queued()} takeover={<Show when={m() !== "leaving"}><Rider layout="card" label="Question" motion="entering"><RiderTitle>Preferred language</RiderTitle>
            <Choices><Choice n={1} label="Python" detail="Use Python for the task" chosen active /><Choice n={2} label="TypeScript" detail="Use TypeScript for the task" /><Choice n={3} label="Rust" detail="Use Rust for the task" /></Choices></Rider></Show>}>
            <ComposerField><TextArea placeholder="Send a message…" /></ComposerField><Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} /></DesktopComposer></div>}</Replay>, { surfaces: ["ground"], code: "<DesktopComposer takeover>" }),
  ],
  tokens: COMPOSER_SIZES.map((group) => ({ title: group.title, tokens: group.rows })),
  api: ["DesktopComposer", "Rider", "RiderTitle", "Lines", "Line", "RiderActions", "Chips", "Chip", "VoiceRider", "ComposerField", "TextArea", "Completion", "Toolbar", "Button", "Gauge", "Picker", "HarnessMark", "Spinner", "StopGlyph", "Swatch", "Choices", "Choice"],
};
