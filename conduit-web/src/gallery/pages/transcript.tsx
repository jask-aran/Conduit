import { Icons } from "@/components/ui";
import { createSignal } from "solid-js";
import { Welcome, ANSWER_MARKDOWN, Disclosure, Transcript, TranscriptRow, Message, Turn, Failure, HarnessPrompt, Changes, LoadingEarlier, TraceHeader, Trail, Step, Answer, CodeBlock, MessageFoot, StopLine, Orb, Button, Read } from "@/components/ui";
import { px, fg, Replay } from "../specs";
import katex from "katex";
import { orb, typeOf } from "../demos";
import { row, token, type Page } from "../model";

/* Transcript: a turn measured, each piece's forms, and a conversation, all from v2 (the orb is the library's Orb, passed in). */
export const liveOrb = () => <Orb state="working" />;
export const ANSWER_HTML = `<p>Created <code>lorem_ipsum.txt</code> in this folder, with <a href="#">three paragraphs</a> of lorem ipsum.</p><ul><li>The first is the classic opening.</li><li>The second is now two sentences.</li></ul><blockquote><p>Lorem ipsum dolor sit amet. Consectetur adipiscing elit.</p></blockquote>`;
export const copyRetry = () => <><Button variant="ghost" size="icon-xs" aria-label="Copy"><Icons.Copy /></Button><Button variant="ghost" size="icon-xs" aria-label="Retry"><Icons.Refresh /></Button></>;
export const turnScene = () => <div class="g-card-scene"><Transcript><Turn>
  <TraceHeader orb={orb(true)} status="Done" time="2m 00s" work="1 edit · 2 reads" latest="Edited lorem_ipsum.txt" opens />
  <Answer html={ANSWER_HTML} />
  <MessageFoot time="22:16">{copyRetry()}</MessageFoot>
</Turn></Transcript></div>;

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

export const transcriptPage: Page = { title: "Transcript", summary: "What is read, at the transcript's size (Space · Scale); a row's text there (a trace, a trail) is a step under the body on both densities: the user's Message (a Bubble and its foot) and a Turn (its trace header, the answer, the answer's foot). The answer is Markdown with no bubble in the Body role, one gap between blocks; the trail sits a step under it.", rail: "Blocks",
  preview: () => <div class="g-transcript-stage">{conversation()}</div>,
  usage: `import { Transcript, TranscriptRow, Message, Turn, Trace, Answer, MessageFoot, Button, Icons } from "@/components/ui";

<Transcript>
  <TranscriptRow><Message time="22:18">Make the paragraph shorter.</Message></TranscriptRow>
  <TranscriptRow><Turn>
    <Trace status="Done" time="12s" />
    <Answer html={renderedMarkdown()} />
    <MessageFoot time="22:19"><Button variant="ghost" size="icon-xs" aria-label="Copy" onClick={copyAnswer}><Icons.Copy /></Button></MessageFoot>
  </Turn></TranscriptRow>
</Transcript>`,
  anatomy: { scene: turnScene, parts: [{ selector: ".ui-trace", name: "the trace header", does: "the orb, Status · time · work (the Row role), the latest line muted", from: (el) => typeOf(el.querySelector(".ui-trace-line")!) },
    { selector: ".ui-answer", name: "the answer", does: "the Body role at 1.66, no bubble", from: (el) => `${typeOf(el)} · ${px(getComputedStyle(el).lineHeight)}` },
    { selector: ".ui-answer > ul", name: "one gap between blocks", does: "--answer-gap (0.75 units)", from: (el) => px(getComputedStyle(el).marginTop) },
    { selector: ".ui-answer code", name: "inline code", does: "the code face on the tint", from: (el) => typeOf(el) },
    { selector: ".ui-answer blockquote", name: "a quote", does: "a --tint line, muted", from: (el) => fg(el) },
    { selector: ".ui-message-foot", name: "the foot", does: "the time first (caption, tabular), then icon-xs buttons", from: (el) => typeOf(el) },
    { selector: ".ui-turn", name: "a turn's parts", does: "half a unit apart", from: (el) => px(getComputedStyle(el).rowGap) }] },
  examples: [
    row("a word", "never narrower than tall; min-width one line · --radius-message", () => <Read class="g-read"><Transcript><Message time="00:08">hi</Message></Transcript></Read>, { surfaces: ["ground"], phone: true, code: "<Message time>" }),
    row("a line", "a third of a line above and below; padding md · lg (the composer's text inset)", () => <Read class="g-read"><Transcript><Message time="00:08">use the question tool to ask me about dogs</Message></Transcript></Read>, { surfaces: ["ground"], phone: true }),
    row("folded", "past its fold (Settings · Transcript): cut at the fold, the last line fading, Show more; -webkit-line-clamp · caption", () => <Read class="g-read"><Transcript><Message time="00:08" fold={3}>{Array.from({ length: 6 }, (_, i) => `line ${i + 1} of a long message`).join("\n")}</Message></Transcript></Read>, { surfaces: ["ground"], phone: true, code: "<Message fold open onToggle>" }),
    row("several lines", "wraps inside the column, the radius held; max-width --measure-2xl", () => <Read class="g-read"><Transcript><Message time="00:08">{"Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua, ut enim ad minim veniam."}</Message></Transcript></Read>, { surfaces: ["ground"], phone: true }),
    row("paragraph", "prose, with inline code and a link; Body · 1.66 · link underline at 45%", () => <Read class="g-read"><Answer html={'<p>Run <code>npm run gallery</code>, then open <a href="#">the gallery</a>.</p>'} /></Read>, { phone: true, code: "<Answer html>" }),
    row("headings", "a title, then sections; h1 Heading; h2, h3 Body at strong", () => <Read class="g-read"><Answer html={"<h1>Trip notes</h1><p>Three days in Kyoto.</p><h2>Day one</h2><p>Fushimi Inari at dawn.</p>"} /></Read>, { phone: true, code: "h1 · h2 · h3" }),
    row("lists", "bulleted and numbered; 1.5em in · 2xs between items", () => <Read class="g-read"><Answer html={"<ol><li>Pack the night before.</li><li>Leave by seven.</li></ol><ul><li>Water</li><li>Rail pass</li></ul>"} /></Read>, { phone: true, code: "ul · ol" }),
    row("quote", "quoted text; a --tint line · muted", () => <Read class="g-read"><Answer html={"<blockquote><p>Lorem ipsum dolor sit amet.</p></blockquote>"} /></Read>, { phone: true, code: "blockquote" }),
    row("table", "scrolls inside itself when wide; Row role · --tint cells · sm md padding", () => <Read class="g-read"><Answer html={"<table><thead><tr><th>Day</th><th>Where</th><th>Time</th></tr></thead><tbody><tr><td>1</td><td>Fushimi Inari</td><td>06:00</td></tr><tr><td>2</td><td>Arashiyama</td><td>08:30</td></tr></tbody></table>"} /></Read>, { phone: true, code: "table" }),
    row("in its scroll box", "a renderer's table (ANSWER_MARKDOWN.table): fills the column, scrolls when wide; cells 5em to 32ch · words whole", () => <Read class="g-read"><Answer html={`<div class="${ANSWER_MARKDOWN.table}"><table><thead><tr><th>Property</th><th>Reno</th><th>CUBIC</th></tr></thead><tbody><tr><td>Growth</td><td>Linear</td><td>Cubic in time since the last loss</td></tr></tbody></table></div>`} /></Read>, { phone: true, code: "ANSWER_MARKDOWN.table" }),
    row("citations", "links whose text is their URL, as host chips; caption · round · --tint line", () => <Read class="g-read"><Answer html={'<p>Slow start is in the standard. <a href="#" data-citation="true">rfc-editor.org</a><a href="#" data-citation="true">wikipedia.org</a></p>'} /></Read>, { phone: true, code: "[data-citation]" }),
    row("formula", "display math centred, scrolling from its start when wider; centred · scrolls · paints alone", () => <Read class="g-read"><Answer html={`<p>The window after a loss:</p>${katex.renderToString("cwnd \\leftarrow \\max(cwnd / 2,\\ 2 \\cdot MSS)", { displayMode: true })}`} /></Read>, { phone: true, code: ".katex-display" }),
    row("live", "a turn running: what it is doing, ticking; Row role · status strong · time tabular", () => <Read class="g-read"><TraceHeader orb={liveOrb()} status="Reading" time="12s" work="3 reads" latest="Reading src/client/chat/transcript.tsx" opens /></Read>, { phone: true, code: "<TraceHeader status time work latest opens>" }),
    row("done", "settled; the orb turns slowly", () => <Read class="g-read"><TraceHeader orb={orb(true)} status="Done" time="2m 00s" work="1 edit · 2 reads" latest="Edited lorem_ipsum.txt" opens /></Read>, { phone: true }),
    row("interrupted", "stopped by the reader; the orb sputters in --destructive", () => <Read class="g-read"><TraceHeader orb={orb(false)} status="Interrupted" time="41s" work="2 commands" opens /></Read>, { phone: true }),
    row("no trail", "no thinking or tools: the first line alone, nothing to open; not a button you can press", () => <Read class="g-read"><TraceHeader orb={orb(true)} status="Done" time="3s" /></Read>, { phone: true, code: "<TraceHeader> without opens" }),
    row("disclosure", "anything that folds: a header, one turning chevron, a body (the caller animates it); Row role, muted · chevron icon-sm, turns 180°", () => <Read class="g-read"><DisclosureDemo /></Read>, { phone: true, code: "<Disclosure header open onToggle>" }),
    row("trail", "the opened trace: a light line a step; Row role · subject code face, muted · failed in --destructive", () => <Read class="g-read">{<><TraceHeader orb={orb(true)} status="Done" time="2m 00s" work="1 edit · 2 reads" opens open /><Trail><Step icon={<Icons.FileText />} verb="Read" subject="src/main.tsx" time="0.4s" /><Step icon={<Icons.Edit />} verb="Edited" subject="lorem_ipsum.txt" time="1.2s" /><Step icon={<Icons.Terminal />} verb="Ran" subject="npm test" time="14s" state="failed" /><Step verb="Running" subject="npm run build" state="running" /></Trail></>}</Read>, { phone: true, code: "<Trail><Step icon verb subject time state>" }),
    row("foot", "an answer's: time, Copy, Retry; a message's: time, Edit, at the right; caption · tabular · icon-xs ghost", () => <Read class="g-read"><div class="g-feet"><MessageFoot time="22:16">{copyRetry()}</MessageFoot><MessageFoot time="22:14" end><Button variant="ghost" size="icon-xs" aria-label="Edit"><Icons.Edit /></Button></MessageFoot></div></Read>, { phone: true, code: "<MessageFoot time end>" }),
    row("foot · stopped", "an answer that did not finish says so after its time; status: Strong weight, foreground", () => <Read class="g-read"><MessageFoot time="22:16" status="Interrupted">{copyRetry()}</MessageFoot></Read>, { phone: true, code: "<MessageFoot status>" }),
    row("stopped before answering", "in the answer's place when nothing was written; stop mark icon-xs, filled · Interrupted strong · Row size, muted", () => <Read class="g-read"><StopLine detail="before answering" /></Read>, { phone: true, code: "<StopLine detail>" }),
    row("foot · changes", "a turn that changed files: its counts open them in Agent changes; data face, caption · added --status-success, removed --destructive", () => <Read class="g-read"><MessageFoot time="22:16">{copyRetry()}<Changes added={42} removed={7} label="Open the turn's changes" /></MessageFoot></Read>, { phone: true, code: "<Changes added removed onOpen>" }),
    row("failed", "a request that failed, in the answer's place (in a trail it is a TraceError); head --destructive · facts data face, caption · the message in a code box", () => <Read class="g-read"><Failure time="22:16" facts={["Model: gpt-5", "Provider: openai", "Profile: Assistant"]} message={"429 Too Many Requests: rate limit reached for requests"} /></Read>, { surfaces: ["ground"], phone: true, code: "<Failure time facts message>" }),
    row("harness prompt", "a prompt the harness sent on its own: a muted line, no bubble, no actions; Row size, muted · bell icon-sm", () => <Read class="g-read"><Transcript><HarnessPrompt>Background task finished: npm run build</HarnessPrompt></Transcript></Read>, { phone: true, code: "<HarnessPrompt>" }),
    row("rows", "a long chat drawn row by row: a turn's answer row goes on under its trace row; message gap 3xl · a turn's row md under the row above", () => <Read class="g-read"><Transcript><TranscriptRow><LoadingEarlier /></TranscriptRow><TranscriptRow><Message time="22:14">make it shorter</Message></TranscriptRow><TranscriptRow><TraceHeader orb={orb(true)} status="Done" time="9s" /></TranscriptRow><TranscriptRow turn><Answer html={"<p>Done: two paragraphs, half the length.</p>"} /></TranscriptRow></Transcript></Read>, { surfaces: ["ground"], phone: true, code: "<TranscriptRow turn> · <LoadingEarlier>" }),
    row("Welcome", "chat/transcript.tsx · an empty chat's greeting, centred above the room its host keeps for the composer (--welcome-room)", () => <div class="g-transcript-stage"><Welcome title="How can I help you today?" /></div>, { surfaces: ["ground"] }),
    row("Transcript", "Transcript > Message · Turn", () => <div class="g-transcript-stage">{conversation()}</div>, { surfaces: ["ground"] }),
    row("Transcript", "Transcript > Message · Turn", () => <div class="g-transcript-stage" data-phone>{conversation()}</div>, { surfaces: ["ground"], phone: "only" })
  ],
  motion: [
    row("a step arrives", "rises --space-xs with a fade; --duration-gentle · --ease-arrive", () => <Read class="g-read">{<Replay>{(m) => <Trail><Step icon={<Icons.FileText />} verb="Read" subject="src/main.tsx" time="0.4s" /><Step icon={<Icons.FileText />} verb="Read" subject="src/app.tsx" time="0.2s" motion={m()} /></Trail>}</Replay>}</Read>, { phone: true, code: "<Step motion>" }),
    row("a message lands", "fades in where it lands; --duration-gentle · --ease-arrive", () => <Read class="g-read"><Replay>{(m) => <Message time="22:18" motion={m()}>and make the second paragraph shorter</Message>}</Replay></Read>, { surfaces: ["ground"], phone: true, code: "<Message motion>" }),
    row("the foot", "fades in when the answer is done; --duration-gentle · --ease-arrive", () => <Read class="g-read"><Replay>{(m) => <MessageFoot time="22:19" motion={m()}>{copyRetry()}</MessageFoot>}</Replay></Read>, { phone: true, code: "<MessageFoot motion>" }),
    row("a disclosure", "unfolds in height; folds away quicker; in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave", () => <Read class="g-read"><DisclosureDemo /></Read>, { phone: true, code: "<Disclosure open onToggle>" })
  ],
  tokens: [{ title: "What it reads", tokens: [
    token("--muted-foreground", "secondary text"),
    token("--space-xs", "small gaps"),
    token("--foreground", "text and icons"),
    token("--tint", "surface wash and lines"),
    token("--icon-sm", "small icons"),
    token("--text-caption", "caption text size")
  ] }],
  api: ["Transcript", "TranscriptRow", "LoadingEarlier", "Message", "Turn", "Trace", "TraceHeader", "Orb", "Trail", "Step", "Answer", "CodeBlock", "MessageFoot", "Button", "Changes", "StopLine", "Failure", "HarnessPrompt", "Welcome", "Disclosure", "Bubble"],
};
