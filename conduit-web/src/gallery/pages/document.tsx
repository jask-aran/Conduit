import { createSignal, type JSX } from "solid-js";
import { Button, IconButton, Icons, Segmented, Swatch } from "@/components/ui";
import { DocumentAddress, DocumentCount, DocumentDate, DocumentDropLine, DocumentField, DocumentFind, DocumentFold, DocumentHandle, DocumentHead, DocumentImage, DocumentProperty, DocumentSeatJump, DocumentSheet, DocumentSuggested, DocumentTableEdges, DocumentTitle, DocumentToneMark, DocumentTools, documentBlockClass, documentDrawClass, documentHintClass, documentMarkClass, documentSeatCaret, documentSeatClass, documentSeatFlag, documentSeatStream, documentTextClass, documentToolIcons as Tools, type DocumentSeatInk } from "@/components/ui/document"; // Comes with the editor: imported on its own, never from the barrel
import { MARKUP_INKS, MarkupMarginNotes, MarkupNote } from "@/components/ui/markup";
import { row, type Page } from "../model";
import { noop } from "../demos";

const TEXT = `<h1>Trip plan</h1><p>Two weeks, three cities. What is <strong>booked</strong> is ticked; the rest is still <a href="#">open</a>.</p><h2>To do</h2>
<ul data-type="taskList"><li><label><input type="checkbox" checked></label><div><p>Book the ferry</p></div></li><li><label><input type="checkbox"></label><div><p>Choose a day for the hike</p></div></li></ul>
<blockquote><p>Leave the last day empty.</p></blockquote><pre><code>ferry  09:40  platform 2</code></pre><div class="tableWrapper"><table><tr><th>City</th><th>Nights</th></tr><tr><td>Osaka</td><td>4</td></tr></table></div>`;
const MARKED = TEXT.replace("Two weeks, three cities", `<span class="${documentMarkClass.comment}">Two weeks, three cities</span>`).replace("<blockquote>", `<div class="${documentMarkClass.removed}">Decide on the last day by Friday.</div><blockquote class="${documentMarkClass.changed}">`);
const MARKS = `<p>A <span class="${documentMarkClass.comment}">run a comment is about</span>, and <span class="${documentMarkClass.comment}" data-current>the one whose card is open</span>.</p><p class="${documentMarkClass.commented}">A whole block a comment is about.</p><p class="${documentMarkClass.commented}" data-current>The same, its card open.</p><p class="${documentMarkClass.changed}">A block an agent changed, not yet accepted.</p><div class="${documentMarkClass.removed}">A block that was deleted, where it stood.</div><p>Asked <span class="${documentDrawClass.mention}">@conduit</span> to check the dates.</p><p>Found <span class="${documentDrawClass.match}">three</span> and <span class="${documentDrawClass.match} ${documentDrawClass.currentMatch}">three</span> again.</p>`;
type Parts = Pick<Parameters<typeof DocumentSheet>[0], "head" | "foot" | "over" | "width" | "find" | "ref" | "edge">;
const sheet = (state?: string, text = TEXT, margin?: JSX.Element, parts: Parts = {}) => <DocumentSheet name="Trip plan" state={state} margin={margin} {...parts} actions={<><Button variant="ghost" size="sm">Text</Button><Button variant="ghost" size="sm">Mark up</Button></>}><div class={documentTextClass} innerHTML={text} /></DocumentSheet>;
const add = () => ({ label: "Add a property", onClick: noop });
const head = (empty?: boolean) => <DocumentHead add={add()}><DocumentTitle editable value="Trip plan" aria-label="Name" />
  {empty ? null : <><DocumentProperty name="Status"><DocumentField aria-label="Status" value="Booking" /></DocumentProperty><DocumentProperty name="For"><DocumentField aria-label="For" value="Sam and Alex" /></DocumentProperty></>}
</DocumentHead>;
const handle = () => <><DocumentHandle top={0}><IconButton label="Add a block below"><Icons.Add /></IconButton><IconButton label="Drag to move, press for more" data-grip=""><Tools.grip /></IconButton></DocumentHandle><DocumentDropLine top={0} /></>;
const thread = (more: Partial<Parameters<typeof MarkupNote>[0]>) => <MarkupNote open={false} tag="" name="“Two weeks, three cities”" value="" onOpen={noop} onInput={noop} onResolve={noop} said={[]} {...more} />;
const margin = () => <MarkupMarginNotes beside={false}>
  {thread({ words: "Is it three cities or four?", state: { label: "Answered" }, said: [{ from: "agent", text: "Three: Osaka, Kyoto and Nara." }] })}
  {thread({ name: "“Leave the last day empty.”", open: true, words: "Make this a note to self.", state: { label: "Changed" }, said: [{ from: "agent", text: "Put it in a quote and took out the line above it." }], placeholder: "Write back", onSay: noop, onRevert: noop })}
  {thread({ name: "“Osaka”", words: "Add the hotel to the table.", state: { label: "Working on it", busy: true } })}
</MarkupMarginNotes>;

const find = () => <DocumentFind query="three" count="2 of 2" onQuery={noop} onNext={noop} onPrevious={noop} onEscape={noop} onClose={noop} />;
const TABLE = `<p>Where we stay.</p><div class="tableWrapper"><table><tr><th>City</th><th>Nights</th></tr><tr><td>Osaka</td><td>4</td></tr><tr><td>Kyoto</td><td>3</td></tr></table></div>`;
/** The edges are placed from the table as drawn, as the editor places them. */
const table = () => {
  const [box, setBox] = createSignal<{ top: number; left: number; width: number; height: number }>();
  const place = (content: HTMLDivElement) => requestAnimationFrame(() => {
    const drawn = content.querySelector("table")?.getBoundingClientRect(), body = content.parentElement?.getBoundingClientRect();
    if (drawn && body) setBox({ top: drawn.top - body.top, left: drawn.left - body.left, width: drawn.width, height: drawn.height });
  });
  const edges = <DocumentTableEdges box={box()} onAddRow={noop} onAddColumn={noop} tools={<DocumentTools label="Table">{([["delete-row", "Delete the row"], ["delete-column", "Delete the column"], ["delete-table", "Delete the table"]] as const).map(([name, label]) => { const Icon = Tools[name]; return <IconButton label={label}><Icon /></IconButton>; })}</DocumentTools>} />;
  return sheet(undefined, TABLE, undefined, { ref: place, over: edges });
};
const link = () => <DocumentTools label="Link"><DocumentAddress href="https://example.com/ferry/timetable" /><IconButton label="Open the link"><Tools.open /></IconButton><IconButton label="Edit the link"><Tools.edit /></IconButton><IconButton label="Remove the link"><Tools.unlink /></IconButton></DocumentTools>;

/** The editor's own blocks as their views draw them, in a sheet. */
const drawn = (children: JSX.Element) => <DocumentSheet name="Trip plan"><div class={documentTextClass}>{children}</div></DocumentSheet>;
const PICTURE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="#3a3c42"/><path d="M0 320 220 140 360 260 460 180 640 320Z" fill="#55585f"/></svg>')}`;
const callout = (tone: "note" | "warning", text: string) => <aside class={documentBlockClass.callout} data-tone={tone}><span><DocumentToneMark tone={tone} /></span><div><p>{text}</p></div></aside>;
const toggle = (open: boolean) => {
  const [shown, setShown] = createSignal(open);
  return <div class={documentBlockClass.toggle} data-open={shown() ? "" : undefined}><span><DocumentFold open={shown()} onToggle={() => setShown(!shown())} /></span>
    <div class={documentBlockClass.toggleBody}><p>Ferry times</p><p>09:40 from platform 2, 14:10 from platform 4.</p></div></div>;
};

const suggested = () => drawn(<><p>Two weeks, three cities.</p><DocumentSuggested by="person" onAccept={noop} onReject={noop} />
  <div class={documentMarkClass.removed}>Take the night train to Kyoto.</div><p class={documentMarkClass.changed}>Take the morning train to Kyoto.</p><p class={documentMarkClass.changed}>Book seats on the left for the view.</p></>);

const tools = () => <DocumentTools label="Format">
  <IconButton label="Bold" aria-pressed><Tools.bold /></IconButton><IconButton label="Italic"><Tools.italic /></IconButton><IconButton label="Strikethrough"><Tools.strike /></IconButton><IconButton label="Code"><Tools.code /></IconButton><IconButton label="Text colour" aria-pressed><Tools.color /></IconButton><IconButton label="Highlight"><Tools.highlight /></IconButton><IconButton label="Link"><Tools.link /></IconButton><IconButton label="Comment"><Tools.comment /></IconButton>
</DocumentTools>;

const INKS = (["red", "amber", "green", "blue"] as const).map((value) => ({ value, label: MARKUP_INKS[value].label, icon: <Swatch colour={MARKUP_INKS[value].colour} /> }));
const inks = () => <>{drawn(<p>The ferry leaves at <span data-color="red">09:40 sharp</span>; <mark data-color="amber">bring the passports</mark>, and <mark data-color="green"><span data-color="blue">both</span></mark> at once.</p>)}
  <DocumentTools label="Text colour"><Segmented label="Text colour" icons size="sm" value="red" onChange={noop} options={[{ value: "none", label: "No colour", icon: <Swatch hollow /> }, ...INKS]} /></DocumentTools></>;

/** Agents at work, made by the library's seat pieces as the editor puts them in its text: a block held (its caret at its start), and what one is heard writing. */
const held = (text: string, state: "thinking" | "reading" | "writing", ink: DocumentSeatInk, name: string) => {
  const block = Object.assign(document.createElement("p"), { className: documentSeatClass.held });
  Object.assign(block.dataset, { seat: state, seatInk: ink }, state === "writing" ? { op: "replace" } : {});
  block.append(documentSeatFlag(`${name} ${state === "writing" ? "is writing over this" : `is ${state}`}`, ink), text);
  return block;
};
const heard = (ink: DocumentSeatInk, name: string, blocks: string, line: string) => {
  const { root, body } = documentSeatStream(ink), tail = document.createElement("p");
  body.innerHTML = blocks;
  tail.append(line, documentSeatCaret(name));
  body.append(tail);
  return root;
};
const seated = (...blocks: (string | HTMLElement)[]) => drawn(<>{blocks.map((block) => typeof block === "string" ? <p>{block}</p> : block)}</>);

export const documentPage: Page = {
  title: "Document",
  summary: "DocumentSheet is a Conduit document on its page: a bar over one reading column that scrolls. Its text is an answer's Markdown (.ui-answer) with what editing adds: a checklist, a code block, a table in the wrapper the editor gives it. Its margin (MarkupMarginNotes) holds the comments as threads beside the text, under it where the page is too narrow; the text wears marks for what they are about and what an agent changed (documentMarkClass). Over the text stands its head (title and properties), beside a block its handle, under the text its count.",
  preview: () => sheet(),
  examples: [
    row("a document", "The bar names it and holds what can be done to it: the caret's block kind, which opens the kinds, and Mark up", () => sheet(), { code: "<DocumentSheet name actions>", surfaces: ["ground"] }),
    row("away from the hub", "The bar says so beside the name; with the hub answering it says nothing", () => sheet("Reconnecting"), { code: "<DocumentSheet state>", surfaces: ["ground"] }),
    row("with its margin", "Each comment's thread beside the text: answered and shut, changed and open (Revert takes the change back, Reply, the tick resolves it), being worked on. In the app each stands at the height of what it is about (beside); here they flow as a list", () => sheet(undefined, MARKED, margin()), { code: "<DocumentSheet margin={<MarkupMarginNotes beside>…}>", surfaces: ["ground"] }),
    row("marks in the text", "comment: a run of text a comment is about, with data-current while its card is open; commented: a whole block, the same; changed: a block an agent changed that is not yet accepted; removed: the line where a block was deleted. Drawn by the editor (documentDrawClass): mention, an @name that shows what it asked when pressed; match and currentMatch, what find found", () => sheet(undefined, MARKS), { code: "documentMarkClass · documentDrawClass", surfaces: ["ground"] }),
    row("its width", "How wide the text runs: narrow, its reading measure (unsaid); wide; full, all its column has", () => sheet(undefined, TEXT, undefined, { width: "wide" }), { code: '<DocumentSheet width="wide">', surfaces: ["ground"] }),
    row("finding in it", "Mod-F with the text focused: the bar at the sheet's top right, how many it found and which is current, each match drawn and the current one apart", () => sheet(undefined, MARKS, undefined, { find: find() }), { code: "<DocumentSheet find={<DocumentFind query count>}>", surfaces: ["ground"] }),
    row("a table's edges", "While the caret is in a table: its tools on its top edge, in the room kept over it; + on its bottom edge adds a row, on its right a column", table, { code: "<DocumentTableEdges box tools onAddRow onAddColumn>", surfaces: ["ground"] }),
    row("an empty document", "Its one paragraph says what it is for (documentHintClass, its words in data-hint); in the app, while the editor has focus, the caret's empty paragraph says it too and every other empty block what it is", () => sheet(undefined, `<p class="${documentHintClass}" data-hint="Write, / for blocks, @ to ask an agent" data-empty></p>`), { code: "documentHintClass", surfaces: ["ground"] }),
    row("its head", "Over the text: the document's name as its title (DocumentTitle, a field where it can be renamed, else plain text), then its properties, a name and a value written in place (DocumentProperty, DocumentField)", () => sheet(undefined, TEXT, undefined, { head: head() }), { code: "<DocumentHead add><DocumentTitle editable /><DocumentProperty name>…", surfaces: ["ground"] }),
    row("a head with no properties", "The title, and Add a property, a quiet row always there", () => sheet(undefined, TEXT, undefined, { head: head(true) }), { code: "<DocumentHead empty add>", surfaces: ["ground"] }),
    row("the block handle", "In the gutter beside the block the mouse is over: + adds a block under it, the grip drags it (the line says where it lands) or, pressed, opens what can be done to it; a touch held on a block opens the same. Where the gutter is too narrow it stands inside the column's left edge (inside). Here on the first block, its line over it", () => sheet(undefined, TEXT, undefined, { over: handle() }), { code: "<DocumentHandle top><DocumentDropLine top>", surfaces: ["ground"] }),
    row("its count", "A quiet line under the text, where the document is set to show it", () => sheet(undefined, TEXT, undefined, { foot: <DocumentCount>9 blocks · 41 words</DocumentCount> }), { code: "<DocumentCount>", surfaces: ["ground"] }),
    row("an image", "An image block: the picture, kept beside the paper by the hub, and its caption written in place under it (its alt text). Made from the block kinds (a file picker), by pasting an image or by dropping one on the text; pressed, the block is the selection", () => drawn(<DocumentImage src={PICTURE} caption="The ferry pier at dawn" onCaption={noop} />), { code: "<DocumentImage src caption onCaption>", surfaces: ["ground"] }),
    row("an image not here", "While it loads, and where its name is not one kept with this paper (an address, or a block copied from another paper): never fetched, it says so", () => drawn(<DocumentImage caption="" missing="Not kept with this paper: https://example.com/pier.png" onCaption={noop} />), { code: "<DocumentImage missing>", surfaces: ["ground"] }),
    row("callouts", "A tinted box of blocks with a tone, chosen from its block menu (Tone): note, and warning, whose mark alone takes the warn colour", () => drawn(<>{callout("note", "Passports must be valid for six months after the trip.")}{callout("warning", "The last ferry leaves at 18:00.")}</>), { code: "documentBlockClass.callout · <DocumentToneMark tone>", surfaces: ["ground"] }),
    row("toggles", "A summary line over blocks that fold under it; how far is each reader's own and is never written. Unfolded, then folded; the caret going into what it folds unfolds it", () => drawn(<>{toggle(true)}{toggle(false)}</>), { code: "documentBlockClass.toggle · <DocumentFold open onToggle>", surfaces: ["ground"] }),
    row("a date", "A day in the text, typed as @today or @tomorrow or put in from the block kinds (Date): a quiet chip in the reader's way of writing dates, kept as its ISO date; pressed, a date field changes it", () => drawn(<p>Book the ferry by <DocumentDate date="2026-11-20" onPress={noop} />, a day before we leave.</p>), { code: "<DocumentDate date onPress>", surfaces: ["ground"] }),
    row("a suggestion", "Written in Suggesting (the ribbon's Writing menu): each block changed, added or deleted in one burst is one suggestion, tinted as an agent's change is, what it was shown while the caret is in it. Over its first block, where the margin does not draw it: who suggested it, Accept (the text stays) and Reject (taken back)", suggested, { code: "<DocumentSuggested by onAccept onReject>", surfaces: ["ground"] }),
    row("link tools", "With the caret in a link: its address, Open, Edit (the address asked for in place) and Remove", link, { code: "<DocumentTools><DocumentAddress href>", surfaces: ["frost"] }),
    row("text colour and highlight", "Text in one of Markup's inks, or washed in one; in Markdown <span data-color> and <mark data-color>. Text colour and Highlight in the selection tools each ask for the ink in place of the buttons (None takes it off); on the ribbon each is a menu of the inks", inks, { code: "document-format.js PAPER_INKS · <Segmented icons> of <Swatch>", surfaces: ["ground"] }),
    row("an agent thinking", "A comment handed to an agent: the blocks it is about washed in its ink and breathing, its caret at the start of the first with its name and what it is doing, taking no room", () => seated("Two weeks, three cities.", held("Leave the last day empty.", "thinking", "plain", "conduit"), "Book the ferry by Friday."), { code: "documentSeatFlag(label, ink) · documentSeatClass.held", surfaces: ["ground"] }),
    row("an agent reading", "The same while it reads the paper, the wash still", () => seated("Two weeks, three cities.", held("Leave the last day empty.", "reading", "plain", "conduit"), "Book the ferry by Friday."), { code: 'data-seat="reading"', surfaces: ["ground"] }),
    row("an agent writing", "Mid-stream: the block it writes over stays, dimmed and struck; under it what it has written so far, drawn as the blocks it will be, the whole lines with their marks, the line being written as plain words, its caret at the end", () => seated("Two weeks, three cities.", held("Leave the last day empty.", "writing", "plain", "conduit"), heard("plain", "conduit", "<h2>The last day</h2><ul><li><p>Keep it <strong>empty</strong></p></li></ul>", "No plans after the **fer"), "Book the ferry by Friday."), { code: "documentSeatStream(ink) · documentSeatCaret(name)", surfaces: ["ground"] }),
    row("two agents at once", "Each in its own ink, kept by its name: one thinking over a block, one writing new blocks after another (nothing of that block is held)", () => seated(held("Two weeks, three cities.", "thinking", "plain", "conduit"), "Leave the last day empty.", heard("green", "Trip planner", "", "Add a day in Nara for the d"), "Book the ferry by Friday."), { code: "seatInks(names)", surfaces: ["ground"] }),
    row("an agent out of view", "Where an agent's block is scrolled out of view, a pill pinned to the sheet's edge says who, what and which way; pressed, the text goes there. The view never moves by itself", () => sheet(undefined, TEXT, undefined, { edge: <DocumentSeatJump label="conduit is writing below" below ink="plain" onJump={noop} /> }), { code: "<DocumentSheet edge={<DocumentSeatJump label below ink onJump>}>", surfaces: ["ground"] }),
    row("selection tools", "Clear above the lines selected, in a popover (under them where there is no room above): its marks, pressed where the selection wears them, a link and a comment. A link's address is asked for in place of the buttons", tools, { code: "<DocumentTools label>", surfaces: ["frost"] }),
  ],
  api: ["DocumentSheet", "DocumentSeatJump", "documentSeatFlag", "documentSeatStream", "documentSeatCaret", "DocumentImage", "DocumentToneMark", "DocumentFold", "DocumentDate", "DocumentSuggested", "DocumentHead", "DocumentTitle", "DocumentProperty", "DocumentField", "DocumentCount", "DocumentHandle", "DocumentDropLine", "DocumentTools", "DocumentAddress", "DocumentTableEdges", "DocumentFind", "MarkupMarginNotes", "MarkupNote"],
};
