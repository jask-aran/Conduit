import { Icons } from "@/components/ui";
import { createSignal } from "solid-js";
import { Welcome, ANSWER_MARKDOWN, Disclosure, Transcript, TranscriptRow, Message, Turn, Failure, HarnessPrompt, Changes, LoadingEarlier, TraceHeader, Trail, Step, Answer, CodeBlock, MessageFoot, StopLine, Orb, Button } from "@/components/ui";
import { InUse, FormTable, form, px, fg, Replay, type Mark, type FormRow } from "../specs";
import katex from "katex";
import { orb, typeOf, reading } from "../demos";
import { type Family, lib } from "../model";

/* Transcript: a turn measured, each piece's forms, and a conversation, all from v2 (the orb is the library's Orb, passed in). */
export const liveOrb = () => <Orb state="working" />;
export const ANSWER_HTML = `<p>Created <code>lorem_ipsum.txt</code> in this folder, with <a href="#">three paragraphs</a> of lorem ipsum.</p><ul><li>The first is the classic opening.</li><li>The second is now two sentences.</li></ul><blockquote><p>Lorem ipsum dolor sit amet. Consectetur adipiscing elit.</p></blockquote>`;
export const copyRetry = () => <><Button variant="ghost" size="icon-xs" aria-label="Copy"><Icons.Copy /></Button><Button variant="ghost" size="icon-xs" aria-label="Retry"><Icons.Refresh /></Button></>;
export const turnScene = () => <div class="g-card-scene"><Transcript><Turn>
  <TraceHeader orb={orb(true)} status="Done" time="2m 00s" work="1 edit · 2 reads" latest="Edited lorem_ipsum.txt" opens />
  <Answer html={ANSWER_HTML} />
  <MessageFoot time="22:16">{copyRetry()}</MessageFoot>
</Turn></Transcript></div>;
export const TURN_MARKS: Mark[] = [
  { selector: ".ui-trace", label: "the trace header: the orb, Status · time · work (the Row role), the latest line muted", read: (el) => typeOf(el.querySelector(".ui-trace-line")!) },
  { selector: ".ui-answer", label: "the answer: the Body role at 1.66, no bubble", read: (el) => `${typeOf(el)} · ${px(getComputedStyle(el).lineHeight)}` },
  { selector: ".ui-answer > ul", label: "one gap between blocks: --answer-gap (0.75 units)", read: (el) => px(getComputedStyle(el).marginTop) },
  { selector: ".ui-answer code", label: "inline code: the code face on the tint", read: (el) => typeOf(el) },
  { selector: ".ui-answer blockquote", label: "a quote: a --tint line, muted", read: (el) => fg(el) },
  { selector: ".ui-message-foot", label: "the foot: the time first (caption, tabular), then icon-xs buttons", read: (el) => typeOf(el) },
  { selector: ".ui-turn", label: "a turn's parts, half a unit apart", read: (el) => px(getComputedStyle(el).rowGap) },
];
export const ANSWER_FORMS: FormRow[] = [
  form("paragraph", "prose, with inline code and a link", () => <Answer html={'<p>Run <code>npm run gallery</code>, then open <a href="#">the gallery</a>.</p>'} />, "<Answer html>", "Body · 1.66 · link underline at 45%"),
  form("headings", "a title, then sections", () => <Answer html={"<h1>Trip notes</h1><p>Three days in Kyoto.</p><h2>Day one</h2><p>Fushimi Inari at dawn.</p>"} />, "h1 · h2 · h3", "h1 Heading; h2, h3 Body at strong"),
  form("lists", "bulleted and numbered", () => <Answer html={"<ol><li>Pack the night before.</li><li>Leave by seven.</li></ol><ul><li>Water</li><li>Rail pass</li></ul>"} />, "ul · ol", "1.5em in · 2xs between items"),
  form("quote", "quoted text", () => <Answer html={"<blockquote><p>Lorem ipsum dolor sit amet.</p></blockquote>"} />, "blockquote", "a --tint line · muted"),
  form("table", "scrolls inside itself when wide", () => <Answer html={"<table><thead><tr><th>Day</th><th>Where</th><th>Time</th></tr></thead><tbody><tr><td>1</td><td>Fushimi Inari</td><td>06:00</td></tr><tr><td>2</td><td>Arashiyama</td><td>08:30</td></tr></tbody></table>"} />, "table", "Row role · --tint cells · sm md padding"),
  form("in its scroll box", "a renderer's table (ANSWER_MARKDOWN.table): fills the column, scrolls when wide", () => <Answer html={`<div class="${ANSWER_MARKDOWN.table}"><table><thead><tr><th>Property</th><th>Reno</th><th>CUBIC</th></tr></thead><tbody><tr><td>Growth</td><td>Linear</td><td>Cubic in time since the last loss</td></tr></tbody></table></div>`} />, "ANSWER_MARKDOWN.table", "cells 5em to 32ch · words whole"),
  form("citations", "links whose text is their URL, as host chips", () => <Answer html={'<p>Slow start is in the standard. <a href="#" data-citation="true">rfc-editor.org</a><a href="#" data-citation="true">wikipedia.org</a></p>'} />, "[data-citation]", "caption · round · --tint line"),
  form("formula", "display math centred, scrolling from its start when wider", () => <Answer html={`<p>The window after a loss:</p>${katex.renderToString("cwnd \\leftarrow \\max(cwnd / 2,\\ 2 \\cdot MSS)", { displayMode: true })}`} />, ".katex-display", "centred · scrolls · paints alone"),
];
export const MESSAGE_FORMS: FormRow[] = [
  form("a word", "never narrower than tall", () => <Transcript><Message time="00:08">hi</Message></Transcript>, "<Message time>", "min-width one line · --radius-message"),
  form("a line", "a third of a line above and below", () => <Transcript><Message time="00:08">use the question tool to ask me about dogs</Message></Transcript>, "", "padding md · lg (the composer's text inset)"),
  form("folded", "past its fold (Settings · Transcript): cut at the fold, the last line fading, Show more", () => <Transcript><Message time="00:08" fold={3}>{Array.from({ length: 6 }, (_, i) => `line ${i + 1} of a long message`).join("\n")}</Message></Transcript>, "<Message fold open onToggle>", "-webkit-line-clamp · caption"),
  form("several lines", "wraps inside the column, the radius held", () => <Transcript><Message time="00:08">{"Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua, ut enim ad minim veniam."}</Message></Transcript>, "", "max-width --measure-2xl"),
];
export const TRACE_FORMS: FormRow[] = [
  form("live", "a turn running: what it is doing, ticking", () => <TraceHeader orb={liveOrb()} status="Reading" time="12s" work="3 reads" latest="Reading src/client/chat/transcript.tsx" opens />, "<TraceHeader status time work latest opens>", "Row role · status strong · time tabular"),
  form("done", "settled", () => <TraceHeader orb={orb(true)} status="Done" time="2m 00s" work="1 edit · 2 reads" latest="Edited lorem_ipsum.txt" opens />, "", "the orb turns slowly"),
  form("interrupted", "stopped by the reader", () => <TraceHeader orb={orb(false)} status="Interrupted" time="41s" work="2 commands" opens />, "", "the orb sputters in --destructive"),
  form("no trail", "no thinking or tools: the first line alone, nothing to open", () => <TraceHeader orb={orb(true)} status="Done" time="3s" />, "<TraceHeader> without opens", "not a button you can press"),
  form("disclosure", "anything that folds: a header, one turning chevron, a body (the caller animates it)", () => <DisclosureDemo />, "<Disclosure header open onToggle>", "Row role, muted · chevron icon-sm, turns 180°"),
  form("trail", "the opened trace: a light line a step", () => <><TraceHeader orb={orb(true)} status="Done" time="2m 00s" work="1 edit · 2 reads" opens open /><Trail><Step icon={<Icons.FileText />} verb="Read" subject="src/main.tsx" time="0.4s" /><Step icon={<Icons.Edit />} verb="Edited" subject="lorem_ipsum.txt" time="1.2s" /><Step icon={<Icons.Terminal />} verb="Ran" subject="npm test" time="14s" state="failed" /><Step verb="Running" subject="npm run build" state="running" /></Trail></>, "<Trail><Step icon verb subject time state>", "Row role · subject code face, muted · failed in --destructive"),
  form("foot", "an answer's: time, Copy, Retry; a message's: time, Edit, at the right", () => <div class="g-feet"><MessageFoot time="22:16">{copyRetry()}</MessageFoot><MessageFoot time="22:14" end><Button variant="ghost" size="icon-xs" aria-label="Edit"><Icons.Edit /></Button></MessageFoot></div>, "<MessageFoot time end>", "caption · tabular · icon-xs ghost"),
  form("foot · stopped", "an answer that did not finish says so after its time", () => <MessageFoot time="22:16" status="Interrupted">{copyRetry()}</MessageFoot>, "<MessageFoot status>", "status: Strong weight, foreground"),
  form("stopped before answering", "in the answer's place when nothing was written", () => <StopLine detail="before answering" />, "<StopLine detail>", "stop mark icon-xs, filled · Interrupted strong · Row size, muted"),
  form("foot · changes", "a turn that changed files: its counts open them in Agent changes", () => <MessageFoot time="22:16">{copyRetry()}<Changes added={42} removed={7} label="Open the turn's changes" /></MessageFoot>, "<Changes added removed onOpen>", "data face, caption · added --status-success, removed --destructive"),
  form("failed", "a request that failed, in the answer's place (in a trail it is a TraceError)", () => <Failure time="22:16" facts={["Model: gpt-5", "Provider: openai", "Profile: Assistant"]} message={"429 Too Many Requests: rate limit reached for requests"} />, "<Failure time facts message>", "head --destructive · facts data face, caption · the message in a code box"),
  form("harness prompt", "a prompt the harness sent on its own: a muted line, no bubble, no actions", () => <Transcript><HarnessPrompt>Background task finished: npm run build</HarnessPrompt></Transcript>, "<HarnessPrompt>", "Row size, muted · bell icon-sm"),
  form("rows", "a long chat drawn row by row: a turn's answer row goes on under its trace row", () => <Transcript><TranscriptRow><LoadingEarlier /></TranscriptRow><TranscriptRow><Message time="22:14">make it shorter</Message></TranscriptRow><TranscriptRow><TraceHeader orb={orb(true)} status="Done" time="9s" /></TranscriptRow><TranscriptRow turn><Answer html={"<p>Done: two paragraphs, half the length.</p>"} /></TranscriptRow></Transcript>, "<TranscriptRow turn> · <LoadingEarlier>", "message gap 3xl · a turn's row md under the row above"),
];
export function DisclosureDemo() {
  const [open, setOpen] = createSignal(true);
  return <Disclosure header={<span>The second paragraph has four sentences</span>} open={open()} onToggle={() => setOpen(!open())}><Answer html={"<p>Keep the first two; they carry the point.</p>"} /></Disclosure>;
}
export const conversation = () => <Transcript>
  <Message time="22:14" actions={<Button variant="ghost" size="icon-xs" aria-label="Edit"><Icons.Edit /></Button>}>write a .txt file in this folder that contains lorem ipsum text</Message>
  <Turn><TraceHeader orb={orb(true)} status="Done" time="2m 00s" work="1 edit" latest="Edited lorem_ipsum.txt" opens /><Answer html={"<p>Created <code>lorem_ipsum.txt</code> in this folder with lorem ipsum text.</p>"} /><MessageFoot time="22:16">{copyRetry()}</MessageFoot></Turn>
  <Message time="22:18" actions={<Button variant="ghost" size="icon-xs" aria-label="Edit"><Icons.Edit /></Button>}>and make the second paragraph shorter</Message>
  <Turn><TraceHeader orb={orb(true)} status="Done" time="1m 00s" work="1 edit" opens /><Answer><p>Done. The second paragraph is now two sentences:</p><blockquote><p>Lorem ipsum dolor sit amet. Consectetur adipiscing elit.</p></blockquote><CodeBlock lang="txt" code="lorem_ipsum.txt  412 bytes" /></Answer><MessageFoot time="22:19">{copyRetry()}</MessageFoot></Turn>
</Transcript>;

export const transcriptFamily: Family = { title: "Transcript", note: "what is read, at the transcript's size (Space · Scale); a row's text there (a trace, a trail) is a step under the body on both densities: the user's Message (a Bubble and its foot) and a Turn (its trace header, the answer, the answer's foot). The answer is Markdown with no bubble in the Body role, one gap between blocks; the trail sits a step under it", rail: "Blocks",
  usage: `import { Transcript, TranscriptRow, Message, Turn, Trace, Answer, MessageFoot, Button, Icons } from "@/components/ui";

<Transcript>
  <TranscriptRow><Message time="22:18">Make the paragraph shorter.</Message></TranscriptRow>
  <TranscriptRow><Turn>
    <Trace status="Done" time="12s" />
    <Answer html={renderedMarkdown()} />
    <MessageFoot time="22:19"><Button variant="ghost" size="icon-xs" aria-label="Copy" onClick={copyAnswer}><Icons.Copy /></Button></MessageFoot>
  </Turn></TranscriptRow>
</Transcript>`,
  api: ["Transcript", "TranscriptRow", "LoadingEarlier", "Message", "Turn", "Trace", "TraceHeader", "Orb", "Trail", "Step", "Answer", "CodeBlock", "MessageFoot", "Button", "Changes", "StopLine", "Failure", "HarnessPrompt", "Welcome", "Disclosure", "Bubble"],
  groups: [
    { title: "In use", note: "a turn, measured: green the gaps (a turn's parts half a unit apart, blocks three quarters)", layout: "desktop", atoms: [
      lib("transcript-inuse", "Turn in use", "both", "transcript", "Turn > TraceHeader · Answer · MessageFoot", () => <InUse scene={turnScene} marks={TURN_MARKS} spacing={[".ui-turn", ".ui-answer"]} />, "row"),
    ] },
    { title: "Forms", note: "each piece at each density", layout: "desktop", atoms: [
      lib("transcript-message", "Message · lengths × densities", "both", "transcript", "Message > Bubble · MessageFoot", () => <FormTable rows={reading(MESSAGE_FORMS)} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "360px"]} />, "row"),
      lib("transcript-answer", "Answer · blocks × densities", "both", "transcript", "Answer", () => <FormTable rows={reading(ANSWER_FORMS)} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "360px"]} />, "row"),
      lib("transcript-trace", "TraceHeader · Trail · MessageFoot", "both", "transcript", "TraceHeader · Trail · Step · MessageFoot", () => <FormTable rows={reading(TRACE_FORMS)} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "360px"]} />, "row"),
    ] },
    { title: "Assembled", note: "a conversation, drawn with v2 alone", atoms: [
      lib("transcript-welcome", "Welcome", "both", "transcript", "chat/transcript.tsx · an empty chat's greeting, centred above the room its host keeps for the composer (--welcome-room)", () => <div class="g-transcript-stage"><Welcome title="How can I help you today?" /></div>),
      lib("transcript-desktop", "Transcript", "desktop", "transcript", "Transcript > Message · Turn", () => <div class="g-transcript-stage">{conversation()}</div>, "row"),
      lib("transcript-phone", "Transcript", "phone", "transcript", "Transcript > Message · Turn", () => <div class="g-transcript-stage" data-phone>{conversation()}</div>),
    ] },
    { title: "Motion", note: "its pieces' own moves: a step arriving in an open trail rises a little (its height at once, so nothing above moves); a sent message fades in where it lands; an answer's foot fades in when it is done; a Disclosure unfolds", layout: "desktop", atoms: [
      lib("transcript-motion", "Transcript · motion", "both", "transcript", "Step motion · Message motion · MessageFoot motion · Disclosure", () => <FormTable rows={reading([
        form("a step arrives", "rises --space-xs with a fade", () => <Replay>{(m) => <Trail><Step icon={<Icons.FileText />} verb="Read" subject="src/main.tsx" time="0.4s" /><Step icon={<Icons.FileText />} verb="Read" subject="src/app.tsx" time="0.2s" motion={m()} /></Trail>}</Replay>, "<Step motion>", "--duration-gentle · --ease-arrive"),
        form("a message lands", "fades in where it lands", () => <Replay>{(m) => <Message time="22:18" motion={m()}>and make the second paragraph shorter</Message>}</Replay>, "<Message motion>", "--duration-gentle · --ease-arrive"),
        form("the foot", "fades in when the answer is done", () => <Replay>{(m) => <MessageFoot time="22:19" motion={m()}>{copyRetry()}</MessageFoot>}</Replay>, "<MessageFoot motion>", "--duration-gentle · --ease-arrive"),
        form("a disclosure", "unfolds in height; folds away quicker", () => <DisclosureDemo />, "<Disclosure open onToggle>", "in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave"),
      ])} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "minmax(0, 1fr)"]} />, "row"),
    ] },
  ] };
