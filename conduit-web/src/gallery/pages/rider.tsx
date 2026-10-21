import { RiderTop, RiderFoot, Summary as RiderSummary, ChoiceInput, ChoicesPage, Prompt as RiderPrompt, Hints as RiderHints, Tabs as RiderTabs, Tab as RiderTab } from "@/components/ui";
import { Icons } from "@/components/ui";
import { createSignal, onMount } from "solid-js";
import { Reference, References, Choices, RiderButton, Button, Chip, Choice, Line, TextArea, Rider, RiderTitle, Lines } from "@/components/ui";
import { QuestionCard } from "../../client/chat/question-card";
import { Question } from "../../client/api/contracts";
import { Replay, Presence } from "../specs";
import { row, token, type Page } from "../model";
import { queued, thumb, noop, attachments } from "../demos";

// The real QuestionCard, drawn with components v2, so the cell shows all the live card can: a
// single question's title, tabs with their ticks, pick-any, an option's preview,
// one's own answer, a note, the Submit page, the hints, Stop and Submit.
export const q = (id: string, header: string, prompt: string, options: [string, string, Question["options"][number]["preview"]?][], more: Partial<Question> = {}): Question =>
  ({ id, header, prompt, multiSelect: false, secret: false, required: true, freeform: { placeholder: "Type your own answer" }, ...more,
    options: options.map(([label, description, preview], i) => ({ id: `${id}${i}`, label, description, preview })) });
export const questionCard = (questions: Question[], extra: { notes?: boolean; page?: "submit" } = {}) => {
  let box!: HTMLDivElement;
  onMount(() => { if (extra.page === "submit") box.querySelector<HTMLButtonElement>("[role=tab]:last-child")?.click(); });
  return <div ref={box} class="g-composer">
    <QuestionCard request={{ id: questions[0]!.id, kind: "question", questions, notes: extra.notes }} onStop={() => {}} onRespond={() => {}} />
  </div>;
};
export const LANGUAGE = q("lang", "Preferred language", "Which programming language should I use for this task?",
  [["Python", "Use Python for the task"], ["TypeScript", "Use TypeScript for the task"], ["Rust", "Use Rust for the task"]]);
export const TABS = [
  q("fmt", "Format", "Which sections should the file have?", [["A heading", "a title line at the top"], ["Paragraphs", ""], ["A list", "the main points, bulleted"]], { multiSelect: true, freeform: false }),
  q("len", "Length", "How long should the second paragraph be?", [["Two sentences", "the shortest that keeps its point", { format: "monospace", text: "Lorem ipsum dolor sit amet.\nConsectetur adipiscing elit." }], ["Half as long", ""], ["Keep it", "leave the paragraph as it is"]],
    { freeform: { placeholder: "Or say how long", multiline: true } }),
];
export const SUMMARY = [q("name", "File name", "What should the file be called?", [], { freeform: { initial: "lorem.txt" } }), q("key", "API key", "Paste the key it should use", [], { secret: true, required: false })];

function RiderButtonMotion(props: { hidden?: boolean; initialAway: boolean }) {
  const [away, setAway] = createSignal(props.initialAway);
  return <div class="g-stack"><Button size="sm" variant="ghost" outline onClick={() => setAway(!away())}>{away() ? "At the latest" : "Scrolled up"}</Button><div class="g-row">
    {props.hidden ? <RiderButton icon={<Icons.ArrowDown />} label="Scroll to latest" hidden={!away()} /> : <Presence when={away()}>{(motion) => <RiderButton icon={<Icons.ArrowDown />} label="Scroll to latest" motion={motion()} />}</Presence>}
  </div></div>;
}

export const riderPage: Page = { title: "Rider", summary: "Resting frost at a composer, either composer's: a row or a strip on its top edge (queued messages, attachments), or a card that takes over its slot in its material (the question: the composer takeover).", rail: "Blocks",
  preview: () => <div class="g-composer">{queued()}</div>,
  usage: `import { Rider, RiderTitle, Lines, Line, RiderActions, Button, Icons } from "@/components/ui";

<Rider label="Messages waiting for the agent">
  <RiderTitle>Steering</RiderTitle>
  <Lines><Line text="Make the second paragraph shorter" /></Lines>
  <RiderActions>
    <Button variant="ghost" size="icon-sm" aria-label="Interrupt and send now" onClick={sendNow}><Icons.Send /></Button>
    <Button variant="ghost" size="icon-sm" aria-label="Discard" onClick={discard}><Icons.Close /></Button>
  </RiderActions>
</Rider>`,
  anatomy: { scene: () => <div class="g-composer">{queued()}</div>, parts: [{ selector: ".ui-rider > .ui-title-text", name: "Title", does: "what it holds", from: "RiderTitle" },
    { selector: ".ui-lines", name: "Body", does: "what waits: lines, chips or choices", from: "Lines · Chips · Choices", side: "above" },
    { selector: ".ui-rider-actions", name: "Actions", does: "ghost icon buttons for it", from: "RiderActions", side: "below" }] },
  examples: [
    row("RiderTop · ChoicesPage · RiderFoot", "one question: its title and close, the prompt and choices, then hints and the next step", () => <div class="g-composer"><Rider layout="card" label="The agent has a question">
          <RiderTop><RiderTitle>Deploy</RiderTitle><Button variant="ghost" size="icon-sm" aria-label="Dismiss"><Icons.Close /></Button></RiderTop>
          <ChoicesPage><RiderPrompt>Where should it go?</RiderPrompt><Choices><Choice n={1} label="Staging" detail="the test server" chosen active /><Choice n={2} label="Production" /></Choices></ChoicesPage>
          <RiderFoot><RiderHints hints={[["↑↓", "choose"], ["Enter", "next"]]} /><Button variant="primary" size="sm">Next</Button></RiderFoot>
        </Rider></div>, { surfaces: ["ground"], phone: true, code: "<Rider layout=card><RiderTop /><ChoicesPage><Prompt /><Choices /></ChoicesPage><RiderFoot><Hints /><Button /></RiderFoot></Rider>" }),
    row("ChoiceInput", "a secret answered on one masked line, as a Choice's own answer", () => <div class="g-composer"><Rider layout="card" label="The agent has a question">
          <RiderTop><RiderTitle>Token</RiderTitle></RiderTop>
          <ChoicesPage><RiderPrompt>Paste the API token</RiderPrompt><Choices><Choice n={1} chosen active own={<ChoiceInput type="password" placeholder="Type your answer" aria-label="Type your answer" value="secret-value" />} /></Choices></ChoicesPage>
        </Rider></div>, { surfaces: ["ground"], phone: true, code: "<Choice own={<ChoiceInput type=password />} />" }),
    row("Summary", "several questions: before submitting, each with its answer; one not answered yet", () => <div class="g-composer"><Rider layout="card" label="The agent has a question">
          <RiderTop><RiderTabs><RiderTab done>Deploy</RiderTab><RiderTab>Token</RiderTab><RiderTab selected>Submit</RiderTab></RiderTabs></RiderTop>
          <RiderSummary rows={[{ label: "Deploy", value: "Staging" }, { label: "Token", value: "Needs an answer", empty: true }]} />
          <RiderFoot><RiderHints hints={[["Enter", "submit"]]} /><Button variant="primary" size="sm" disabled>Submit</Button></RiderFoot>
        </Rider></div>, { surfaces: ["ground"], phone: true, code: "<Summary rows={[{ label, value, empty }]} />" }),
    row("Line", "Line: waiting text, one line until opened", () => <div class="g-composer"><Rider><Lines><Line text="and make the second paragraph shorter" /><Line text="then rename the file to lorem.txt, and add a heading at the top that says what it is, and then read it back to me" clipped /></Lines></Rider></div>, { phone: true, surfaces: ["ground"] }),
    row("Chip", "Chip: image · file · uploading · failed · queued · failed, retryable", () => <div class="g-row"><Chip name="photo.png" image={thumb} /><Chip name="notes.txt" detail="2.1 KB" icon={<Icons.FileText />} /><Chip name="big.pdf" detail="64%" icon={<Icons.FileText />} status="uploading" progress={64} /><Chip name="broken.txt" detail="Upload failed" icon={<Icons.FileText />} status="error" /><Chip name="queued.png" image={thumb} status="queued" progress={0} /><Chip name="draft.txt" detail="Upload failed · press to retry" icon={<Icons.FileText />} status="error" retry /></div>, { phone: true, surfaces: ["ground"] }),
    row("References", "Reference: a file's mark, name, lines and note, cut short; a press goes to it. In the composer's Rider with edit and remove; under a sent message without", () => <div class="g-composer g-stack">
        <Rider label="File references"><References><Reference icon={<Icons.FileCode />} name="parser.ts" at=":12-18" note="this guard is never hit" onOpen={noop} onEdit={noop} onRemove={noop} /><Reference icon={<Icons.FileDiff />} name="README.md" at=":4" onOpen={noop} onEdit={noop} onRemove={noop} /></References></Rider>
        <References><Reference icon={<Icons.FileCode />} name="parser.ts" at=":12-18" note="this guard is never hit" onOpen={noop} /></References></div>, { phone: true, surfaces: ["ground"] }),
    row("Choice", "Choices > Choice: number · label · detail. One answer: the current choice white and bold, no tick. Pick any: the wash on each chosen. The cursor follows the pointer", () => <div class="g-composer g-stack"><Rider layout="card"><Choices><Choice n={1} label="Chosen" detail="the current choice" chosen /><Choice n={2} label="Not chosen" active /><Choice n={3} label="Not chosen" detail="with a description" /><div class="ui-choice"><span class="ui-choice-key">4</span><TextArea placeholder="Type your own answer (a TextArea)" /></div></Choices></Rider>
        <Rider layout="card"><Choices multi><Choice n={1} label="Chosen" multi chosen /><Choice n={2} label="Chosen too" multi chosen active /><Choice n={3} label="Not chosen" multi /></Choices></Rider></div>, { phone: true, surfaces: ["ground"] }),
    row("RiderButton", "chat/transcript.tsx · ride: centre (scroll to latest), beside (cancel editing, when both show); the transcript sets --ride-bottom", () => <div class="g-stack"><div class="g-row"><RiderButton icon={<Icons.Close />} label="Cancel editing" show="label" /><RiderButton icon={<Icons.ArrowDown />} label="Scroll to latest" /></div>
        <div class="g-ride"><RiderButton ride="beside" icon={<Icons.Close />} label="Cancel editing" show="label" /><RiderButton ride="centre" icon={<Icons.ArrowDown />} label="Scroll to latest" /></div></div>, { phone: true, surfaces: ["ground"] }),
    row("QueuedMessages", "chat/queued-messages.tsx", () => <div class="g-composer">{queued()}</div>, { phone: true, surfaces: ["ground"] }),
    row("AttachmentStrip", "chat/attachment-strip.tsx", () => <div class="g-composer">{attachments()}</div>, { phone: true, surfaces: ["ground"] }),
    row("QuestionCard", "chat/question-card.tsx · the composer takeover: in the composer's slot and material. One question: its title, Choices, own answer, Stop · Submit", () => questionCard([LANGUAGE]), { phone: true, surfaces: ["ground"] }),
    row("QuestionCard · tabs", "chat/question-card.tsx · tabs (ticked when answered), pick any, a preview, a multi-line own answer, notes", () => questionCard(TABS, { notes: true }), { phone: true, surfaces: ["ground"] }),
    row("QuestionCard · Submit page", "chat/question-card.tsx · the review page; a secret answer", () => questionCard(SUMMARY, { page: "submit" }), { phone: true, surfaces: ["ground"] })
  ],
  motion: [
    row("arrives · taken · removed", "rises out of the composer; drops back into it; fades in place; in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave", () => <Replay leaves={["leaving", "removing"]}>{(m) => <div class="g-composer">{queued(m())}</div>}</Replay>, { surfaces: ["ground"], phone: true, code: "<Rider motion>" }),
    row("RiderButton · At the latest", "fades in where it rides when there is more below, out when there is not; in: --duration-gentle · out: --duration-quick", () => <RiderButtonMotion initialAway={false} />, { surfaces: ["ground"], phone: true, code: "<RiderButton motion>" }),
    row("RiderButton · Scrolled up", "fades in where it rides when there is more below, out when there is not; in: --duration-gentle · out: --duration-quick", () => <RiderButtonMotion initialAway={true} />, { surfaces: ["ground"], phone: true, code: "<RiderButton motion>" }),
    row("RiderButton hidden · At the latest", "always there, hidden in place: fades out and back in, never drawn again (the transcript's scroll to latest); out: --duration-quick, leave · in: --duration-gentle, arrive", () => <RiderButtonMotion hidden initialAway={false} />, { surfaces: ["ground"], phone: true, code: "<RiderButton hidden>" }),
    row("RiderButton hidden · Scrolled up", "always there, hidden in place: fades out and back in, never drawn again (the transcript's scroll to latest); out: --duration-quick, leave · in: --duration-gentle, arrive", () => <RiderButtonMotion hidden initialAway={true} />, { surfaces: ["ground"], phone: true, code: "<RiderButton hidden>" }),
    row("a chip", "grows in from 85%; removed, it fades; --duration-gentle · --ease-arrive · out: --duration-quick", () => <Replay leaves={["removing"]}>{(m) => <div class="g-row"><Chip name="notes.txt" detail="2.1 KB" icon={<Icons.FileText />} motion={m()} /></div>}</Replay>, { surfaces: ["ground"], phone: true, code: "<Chip motion>" })
  ],
  tokens: [{ title: "What it reads", tokens: [
    token("--foreground", "text and icons"),
    token("--muted-foreground", "secondary text"),
    token("--space-lg", "large spacing"),
    token("--space-sm", "small spacing"),
    token("--tint", "surface wash and lines"),
    token("--space-xs", "small gaps")
  ] }],
  api: ["Rider", "RiderTop", "RiderTitle", "Tabs", "Tab", "ChoicesPage", "Prompt", "Choices", "Choice", "ChoiceInput", "TextArea", "Preview", "Summary", "RiderFoot", "Hints", "Lines", "Line", "RiderActions", "Button", "Chips", "Chip", "References", "Reference", "RiderButton"],
};
