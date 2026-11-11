import { ColourPicker } from "@/components/ui/controls";
import { FeedbackBar, FeedbackDrawing, FeedbackLayer, FeedbackMark, FeedbackNote, FeedbackNotes, FeedbackText } from "@/components/ui/feedback";
import { row, token, type Page } from "../model";
import { noop } from "../demos";

const bar = (more: Partial<Parameters<typeof FeedbackBar>[0]> = {}) => <FeedbackBar view="page" screenshots onView={noop} tool="select" onTool={noop} onNote={noop} ink="plain" onInk={noop} weight="medium" onWeight={noop} onUndo={noop} status="Press or drag" keys={["Alt", "Shift", "F"]} onRetake={noop} onHand={noop} canSend onSend={noop} onClose={noop} {...more} />;
const note = (more: Partial<Parameters<typeof FeedbackNote>[0]> = {}) => <FeedbackNote open={false} tag="1" name="IconButton" source="conduit-web/src/components/ui/actions.tsx:21"
  value="Match the other rail icons' stroke." onOpen={noop} onInput={noop} onRemove={noop} {...more} />;
const notes = () => <FeedbackNotes>{note()}{note({ tag: "2", name: "2 pieces: Row ×2", source: undefined, value: "" })}{note({ tag: "3", name: "General note", source: "About nothing on the page in particular.", value: "The page feels crowded.", open: true })}</FeedbackNotes>;
// The layer is fixed to the window in the app; in a scene it is held in the scene's.
const scene = (children: () => unknown) => () => <div class="g-page" style={{ transform: "translateZ(0)" }}><div class="g-page-pane" /><div class="g-page-composer" />
  <FeedbackLayer select>{children() as never}</FeedbackLayer></div>;
const whole = scene(() => <>
  <FeedbackMark kind="chosen" current tag="1" box={{ left: 180, top: 56, width: 44, height: 44 }} />
  <FeedbackMark kind="chosen" tag="2" box={{ left: 40, top: 150, width: 180, height: 96 }} />
  <FeedbackMark kind="member" box={{ left: 48, top: 158, width: 76, height: 80 }} />
  <FeedbackMark kind="member" box={{ left: 136, top: 158, width: 76, height: 80 }} />
  <FeedbackMark kind="cursor" name="Row" box={{ left: 40, top: 270, width: 180, height: 30 }} />
  <FeedbackDrawing kind="arrow" points={[[330, 250], [250, 290]]} />
  <FeedbackText at={[250, 296]} value="too close" onInput={noop} onDone={noop} />
  <FeedbackMark kind="drawn" tag="3" box={{ left: 250, top: 250, width: 80, height: 62 }} />
  {note({ float: { left: "240px", top: "56px" }, open: true, onDone: noop })}{notes()}{bar()}
</>);

export const feedbackPage: Page = {
  title: "Feedback", rail: "Blocks",
  summary: "The UI feedback tool's drawing (development clients): a layer over the app, a mark round each selection, the person's own pen lines, arrows and boxes, words written on it, the note being written beside what it is about, every other comment stacked in the corner, and the bar at the foot.",
  preview: whole,
  usage: `import { FeedbackBar, FeedbackLayer, FeedbackMark, FeedbackNote } from "@/components/ui";

<FeedbackLayer select={selecting()}>
  <FeedbackMark kind="chosen" tag="1" box={boxOf(selection)} current />
  <FeedbackMark kind="cursor" name="IconButton" box={boxOf(underPointer)} />
  <FeedbackNote float={beside(selection)} open tag="2" name="Row" value={comment()} onOpen={open} onInput={setComment} onDone={done} onRemove={remove} />
  <FeedbackNotes>
    <FeedbackNote open={false} tag="1" name="IconButton" picture={preview()} value={words()} onOpen={open} onInput={setWords} onRemove={remove} />
  </FeedbackNotes>
  <FeedbackBar view={view()} screenshots onView={setView} tool={tool()} onTool={setTool} onNote={addNote} status="Press or drag" canSend onSend={send} onClose={close} />
</FeedbackLayer>`,
  anatomy: { scene: whole, parts: [
    { selector: ".ui-feedback-mark[data-kind='chosen']", name: "Chosen mark", does: "outlines a selection, numbered; heavier while its note is open", from: "FeedbackMark kind chosen" },
    { selector: ".ui-feedback-mark[data-kind='member']", name: "Member", does: "one piece of a group, dashed inside the group's mark", from: "FeedbackMark kind member" },
    { selector: ".ui-feedback-mark[data-kind='cursor']", name: "Cursor mark", does: "what a press would choose, named for its piece", from: "FeedbackMark kind cursor" },
    { selector: ".ui-feedback-drawing", name: "Drawing", does: "what the person drew for one comment, any number together: a pen line, a highlight, an arrow, a box, words; numbered by a drawn mark", from: "FeedbackDrawing, FeedbackText, FeedbackMark kind drawn" },
    { selector: ".ui-feedback-note", name: "Note", does: "one comment: beside what it is about while it is written, then in the stack with its words on a line and its picture", from: "FeedbackNotes > FeedbackNote > Card, CardPreview, TextArea" },
    { selector: ".ui-feedback-bar", name: "Bar", does: "the mode (use the app, annotate the live page, annotate a screenshot), the annotating tools, the ink and line picker and Undo, the listening session, Send", from: "FeedbackBar > Segmented, Popover, IconButton, Button" },
  ] },
  examples: [
    row("marks", "cursor, chosen, a group with its members, a drag's marquee", scene(() => <>
      <FeedbackMark kind="cursor" name="Segmented" box={{ left: 30, top: 40, width: 120, height: 30 }} />
      <FeedbackMark kind="chosen" tag="1" box={{ left: 180, top: 40, width: 44, height: 44 }} />
      <FeedbackMark kind="chosen" current tag="2" box={{ left: 30, top: 110, width: 200, height: 70 }} />
      <FeedbackMark kind="member" box={{ left: 36, top: 116, width: 90, height: 58 }} />
      <FeedbackMark kind="member" box={{ left: 134, top: 116, width: 90, height: 58 }} />
      <FeedbackMark kind="marquee" box={{ left: 260, top: 40, width: 140, height: 140 }} />
    </>), { surfaces: ["ground"] }),
    row("drawings", "a pen line, an arrow and a box (in red ink), each with its number", scene(() => <>
      <FeedbackDrawing kind="pen" points={[[30, 90], [44, 60], [62, 84], [80, 52], [100, 80], [122, 50], [140, 76]]} />
      <FeedbackMark kind="drawn" tag="1" box={{ left: 30, top: 50, width: 110, height: 40 }} />
      <FeedbackDrawing kind="arrow" points={[[180, 140], [260, 70]]} />
      <FeedbackMark kind="drawn" tag="2" box={{ left: 180, top: 70, width: 80, height: 70 }} />
      <FeedbackDrawing kind="box" points={[[300, 50], [420, 130]]} ink="red" current />
      <FeedbackMark kind="drawn" tag="3" box={{ left: 300, top: 50, width: 120, height: 80 }} />
    </>), { surfaces: ["ground"] }),
    row("highlight and line weights", "a highlighter stroke, and the pen thin, medium and thick", scene(() => <>
      <FeedbackDrawing kind="highlight" points={[[30, 60], [80, 58], [140, 62], [200, 60]]} ink="amber" />
      <FeedbackDrawing kind="pen" weight="thin" points={[[30, 110], [200, 110]]} />
      <FeedbackDrawing kind="pen" points={[[30, 140], [200, 140]]} />
      <FeedbackDrawing kind="pen" weight="thick" points={[[30, 170], [200, 170]]} ink="red" />
    </>), { surfaces: ["ground"] }),
    row("selected text", "a run of text over two lines, each line marked, numbered on its first", scene(() => <>
      <FeedbackMark kind="quote" tag="1" current box={{ left: 120, top: 60, width: 220, height: 18 }} />
      <FeedbackMark kind="quote" box={{ left: 30, top: 80, width: 160, height: 18 }} />
    </>), { surfaces: ["ground"] }),
    row("notes", "the stack: shut notes show their words on a line, the open one is written in; a general note is about no piece", scene(() => <>{notes()}</>), { surfaces: ["ground"] }),
    row("bar", "selecting with nothing to send yet and no session listening", scene(() => <>{bar({ canSend: false })}</>), { surfaces: ["ground"] }),
    row("bar, on a screenshot", "no Select: a screenshot is drawn and written on; the camera takes it again", scene(() => <>{bar({ view: "screenshot", tool: "pen", status: "Drag to draw", canSend: false })}</>), { surfaces: ["ground"] }),
    row("note, being written", "beside what it is about, with Done to send it to the stack", scene(() => <>{note({ float: { left: "24px", top: "24px" }, open: true, onDone: noop })}</>), { surfaces: ["ground"] }),
    row("note, sent", "a thread: the comment, what the agent answered, and the field to write back in; the bar says where the item stands", scene(() => <><FeedbackNotes>{note({ open: true, onRemove: undefined, placeholder: "Write back", value: "", said: [{ from: "person", text: "Match the other rail icons' stroke." }, { from: "agent", text: "Done: it is 1.5px now, like the rest." }] })}</FeedbackNotes>{bar({ thread: true, status: "ui-feedback is working on it" })}</>), { surfaces: ["ground"] }),
    row("bar, live", "each comment goes as it is Done: no Send, and where the growing item stands", scene(() => <>{bar({ live: true, onLive: noop, agent: "ui-feedback", hand: true, standing: "ui-feedback is working on it" })}</>), { surfaces: ["ground"] }),
    row("any colour", "ColourPicker, which stands over the options while the ink that is any colour is held: its shade on a field of its hue, the hue, and its hex to read or type", () => <ColourPicker label="Any colour" value="#22cc88" onChange={noop} />),
    row("bar, drawing", "the held tool's options stand over the bar: the shape, its ink (a preset or any colour) and its line, each size as it will be drawn", scene(() => <>{bar({ tool: "shape", shape: "arrow", ink: "red", status: "Drag to draw", canSend: false })}</>), { surfaces: ["ground"] }),
    row("bar, handing over", "a session listens and the item goes to it; with several waiting its name is a button to the next", scene(() => <>{bar({ hand: true, agent: "ui-feedback", onNextAgent: noop })}</>), { surfaces: ["ground"] }),
    row("bar, compact", "a phone: icons alone, and no Screenshot where the client cannot capture its display", scene(() => <>{bar({ compact: true, screenshots: false, keys: undefined })}</>), { surfaces: ["ground"] }),
    row("bar, using the app", "the pointer goes to the app; the marks stay", scene(() => <>{bar({ view: "use", tool: "pen", status: "Using the app" })}</>), { surfaces: ["ground"] }),
    row("bar, sending", "Send turns while the item goes", scene(() => <>{bar({ sending: true })}</>), { surfaces: ["ground"] }),
  ],
  tokens: [{ title: "Its lines and layer", tokens: [
    token("--ring", "A mark's line"),
    token("--primary", "A chosen mark's line, its number's fill, a drawing's line"),
    token("--stroke", "A drawing's medium line width (thin is --stroke-thin, thick two of it); its arrow head is six of them, a highlighter eight"),
    token("--opacity-faint", "How see-through a highlighter's line is"),
    token("--glyph-shadow", "The shadow that keeps a drawing readable on any ground"),
    token("--accent", "The wash inside a chosen mark"),
    token("--layer-feedback", "Over everything, notifications included"),
    token("--measure-md", "Note width"),
  ] }],
  api: ["FeedbackLayer", "FeedbackMark", "FeedbackDrawing", "FeedbackText", "FeedbackNotes", "FeedbackNote", "FeedbackBar", "Card", "CardPreview", "TextArea", "Segmented", "Popover", "IconButton", "Button"],
};
