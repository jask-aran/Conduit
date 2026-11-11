import { FeedbackBar, FeedbackDrawing, FeedbackLayer, FeedbackMark, FeedbackNote, FeedbackNotes } from "@/components/ui/feedback";
import { row, token, type Page } from "../model";
import { noop } from "../demos";

const bar = (more: Partial<Parameters<typeof FeedbackBar>[0]> = {}) => <FeedbackBar mode="select" onMode={noop} status="Press or drag" keys={["Alt", "Shift", "F"]} onNote={noop} screenshot onScreenshot={noop} onHand={noop} canSend onSend={noop} onClose={noop} {...more} />;
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
  <FeedbackMark kind="drawn" tag="3" box={{ left: 250, top: 250, width: 80, height: 40 }} />
  {notes()}{bar()}
</>);

export const feedbackPage: Page = {
  title: "Feedback", rail: "Blocks",
  summary: "The UI feedback tool's drawing (development clients): a layer over the app, a mark round each selection, the person's own pen lines, arrows and boxes, every comment stacked in the corner, and the bar at the foot.",
  preview: whole,
  usage: `import { FeedbackBar, FeedbackLayer, FeedbackMark, FeedbackNote } from "@/components/ui";

<FeedbackLayer select={selecting()}>
  <FeedbackMark kind="chosen" tag="1" box={boxOf(selection)} current />
  <FeedbackMark kind="cursor" name="IconButton" box={boxOf(underPointer)} />
  <FeedbackNotes>
    <FeedbackNote open={openId() === 1} tag="1" name="IconButton" source="conduit-web/src/components/ui/actions.tsx:21"
      value={comment()} onOpen={open} onInput={setComment} onRemove={remove} />
  </FeedbackNotes>
  <FeedbackBar mode="select" onMode={setMode} status="Press or drag" screenshot onScreenshot={setScreenshot} canSend onSend={send} onClose={close} />
</FeedbackLayer>`,
  anatomy: { scene: whole, parts: [
    { selector: ".ui-feedback-mark[data-kind='chosen']", name: "Chosen mark", does: "outlines a selection, numbered; heavier while its note is open", from: "FeedbackMark kind chosen" },
    { selector: ".ui-feedback-mark[data-kind='member']", name: "Member", does: "one piece of a group, dashed inside the group's mark", from: "FeedbackMark kind member" },
    { selector: ".ui-feedback-mark[data-kind='cursor']", name: "Cursor mark", does: "what a press would choose, named for its piece", from: "FeedbackMark kind cursor" },
    { selector: ".ui-feedback-drawing", name: "Drawing", does: "what the person drew: a pen line, an arrow or a box, numbered by a drawn mark", from: "FeedbackDrawing, FeedbackMark kind drawn" },
    { selector: ".ui-feedback-note", name: "Note", does: "one comment in the stack: its number and piece, its words on a line; open, where the piece is declared and the words to write", from: "FeedbackNotes > FeedbackNote > Card, TextArea" },
    { selector: ".ui-feedback-bar", name: "Bar", does: "Use app, what the pointer marks with, a note, the screenshot, the listening session, Send", from: "FeedbackBar > Segmented, IconButton, Button" },
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
    row("drawings", "a pen line, an arrow and a box, each with its number", scene(() => <>
      <FeedbackDrawing kind="pen" points={[[30, 90], [44, 60], [62, 84], [80, 52], [100, 80], [122, 50], [140, 76]]} />
      <FeedbackMark kind="drawn" tag="1" box={{ left: 30, top: 50, width: 110, height: 40 }} />
      <FeedbackDrawing kind="arrow" points={[[180, 140], [260, 70]]} />
      <FeedbackMark kind="drawn" tag="2" box={{ left: 180, top: 70, width: 80, height: 70 }} />
      <FeedbackDrawing kind="box" points={[[300, 50], [420, 130]]} current />
      <FeedbackMark kind="drawn" tag="3" box={{ left: 300, top: 50, width: 120, height: 80 }} />
    </>), { surfaces: ["ground"] }),
    row("notes", "the stack: shut notes show their words on a line, the open one is written in; a general note is about no piece", scene(() => <>{notes()}</>), { surfaces: ["ground"] }),
    row("bar", "selecting with nothing to send yet and no session listening", scene(() => <>{bar({ canSend: false })}</>), { surfaces: ["ground"] }),
    row("bar, frozen", "a shell that takes the page's picture shows it under the marks", scene(() => <>{bar({ status: "Frozen: press or drag", canSend: false })}</>), { surfaces: ["ground"] }),
    row("bar, drawing", "the pointer draws: Pen, Arrow or Box", scene(() => <>{bar({ mode: "arrow", status: "Drag to draw", canSend: false })}</>), { surfaces: ["ground"] }),
    row("bar, handing over", "a session listens and the item goes to it; with several waiting its name is a button to the next", scene(() => <>{bar({ hand: true, agent: "ui-feedback", onNextAgent: noop })}</>), { surfaces: ["ground"] }),
    row("bar, compact", "a phone: icons alone, and no screenshot where the client cannot capture its display", scene(() => <>{bar({ compact: true, onScreenshot: undefined, keys: undefined })}</>), { surfaces: ["ground"] }),
    row("bar, using the app", "the pointer goes to the app; the marks stay", scene(() => <>{bar({ mode: "use", tool: "pen", status: "Using the app" })}</>), { surfaces: ["ground"] }),
    row("bar, sending", "Send turns while the item goes", scene(() => <>{bar({ sending: true })}</>), { surfaces: ["ground"] }),
  ],
  tokens: [{ title: "Its lines and layer", tokens: [
    token("--ring", "A mark's line"),
    token("--primary", "A chosen mark's line, its number's fill, a drawing's line"),
    token("--stroke", "A drawing's line width; its arrow head is six of them"),
    token("--glyph-shadow", "The shadow that keeps a drawing readable on any ground"),
    token("--accent", "The wash inside a chosen mark"),
    token("--layer-feedback", "Over everything, notifications included"),
    token("--measure-md", "Note width"),
  ] }],
  api: ["FeedbackLayer", "FeedbackMark", "FeedbackDrawing", "FeedbackNotes", "FeedbackNote", "FeedbackBar", "Card", "TextArea", "Segmented", "IconButton", "Button"],
};
