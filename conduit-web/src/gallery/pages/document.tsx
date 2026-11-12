import type { JSX } from "solid-js";
import { Button, IconButton, Icons } from "@/components/ui";
import { DocumentCount, DocumentDropLine, DocumentField, DocumentHandle, DocumentHead, DocumentProperty, DocumentSheet, DocumentTitle, DocumentTools, documentHintClass, documentMarkClass, documentTextClass, documentToolIcons as Tools } from "@/components/ui/document"; // Comes with the editor: imported on its own, never from the barrel
import { MarkupMarginNotes, MarkupNote } from "@/components/ui/markup";
import { row, type Page } from "../model";
import { noop } from "../demos";

const TEXT = `<h1>Trip plan</h1><p>Two weeks, three cities. What is <strong>booked</strong> is ticked; the rest is still <a href="#">open</a>.</p><h2>To do</h2>
<ul data-type="taskList"><li><label><input type="checkbox" checked></label><div><p>Book the ferry</p></div></li><li><label><input type="checkbox"></label><div><p>Choose a day for the hike</p></div></li></ul>
<blockquote><p>Leave the last day empty.</p></blockquote><pre><code>ferry  09:40  platform 2</code></pre><div class="tableWrapper"><table><tr><th>City</th><th>Nights</th></tr><tr><td>Osaka</td><td>4</td></tr></table></div>`;
const MARKED = TEXT.replace("Two weeks, three cities", `<span class="${documentMarkClass.comment}">Two weeks, three cities</span>`).replace("<blockquote>", `<div class="${documentMarkClass.removed}">Decide on the last day by Friday.</div><blockquote class="${documentMarkClass.changed}">`);
const MARKS = `<p>A <span class="${documentMarkClass.comment}">run a comment is about</span>, and <span class="${documentMarkClass.comment}" data-current>the one whose card is open</span>.</p><p class="${documentMarkClass.commented}">A whole block a comment is about.</p><p class="${documentMarkClass.commented}" data-current>The same, its card open.</p><p class="${documentMarkClass.changed}">A block an agent changed, not yet accepted.</p><div class="${documentMarkClass.removed}">A block that was deleted, where it stood.</div>`;
type Parts = Pick<Parameters<typeof DocumentSheet>[0], "head" | "foot" | "over">;
const sheet = (state?: string, text = TEXT, margin?: JSX.Element, parts: Parts = {}) => <DocumentSheet name="Trip plan" state={state} margin={margin} {...parts} actions={<><Button variant="ghost" size="sm">Text</Button><Button variant="ghost" size="sm">Mark up</Button></>}><div class={documentTextClass} innerHTML={text} /></DocumentSheet>;
const add = () => <Button variant="ghost" size="sm"><Icons.Add />Add a property</Button>;
const head = (empty?: boolean) => <DocumentHead empty={empty} add={add()}><DocumentTitle editable value="Trip plan" aria-label="Name" />
  {empty ? null : <><DocumentProperty name="Status"><DocumentField aria-label="Status" value="Booking" /></DocumentProperty><DocumentProperty name="For"><DocumentField aria-label="For" value="Sam and Alex" /></DocumentProperty></>}
</DocumentHead>;
const handle = () => <><DocumentHandle top={0}><IconButton label="Add a block below"><Icons.Add /></IconButton><IconButton label="Drag to move, press for more" data-grip=""><Tools.grip /></IconButton></DocumentHandle><DocumentDropLine top={0} /></>;
const thread = (more: Partial<Parameters<typeof MarkupNote>[0]>) => <MarkupNote open={false} tag="" name="“Two weeks, three cities”" value="" onOpen={noop} onInput={noop} onResolve={noop} said={[]} {...more} />;
const margin = () => <MarkupMarginNotes beside={false}>
  {thread({ words: "Is it three cities or four?", state: { label: "Answered" }, said: [{ from: "agent", text: "Three: Osaka, Kyoto and Nara." }] })}
  {thread({ name: "“Leave the last day empty.”", open: true, words: "Make this a note to self.", state: { label: "Changed" }, said: [{ from: "agent", text: "Put it in a quote and took out the line above it." }], placeholder: "Write back", onSay: noop, onRevert: noop })}
  {thread({ name: "“Osaka”", words: "Add the hotel to the table.", state: { label: "Working on it", busy: true } })}
</MarkupMarginNotes>;

const tools = () => <DocumentTools label="Format">
  <IconButton label="Bold" aria-pressed><Tools.bold /></IconButton><IconButton label="Italic"><Tools.italic /></IconButton><IconButton label="Strikethrough"><Tools.strike /></IconButton><IconButton label="Code"><Tools.code /></IconButton><IconButton label="Link"><Tools.link /></IconButton><IconButton label="Comment"><Tools.comment /></IconButton>
</DocumentTools>;

export const documentPage: Page = {
  title: "Document",
  summary: "DocumentSheet is a Conduit document on its page: a bar over one reading column that scrolls. Its text is an answer's Markdown (.ui-answer) with what editing adds: a checklist, a code block, a table in the wrapper the editor gives it. Its margin (MarkupMarginNotes) holds the comments as threads beside the text, under it where the page is too narrow; the text wears marks for what they are about and what an agent changed (documentMarkClass). Over the text stands its head (title and properties), beside a block its handle, under the text its count.",
  preview: () => sheet(),
  examples: [
    row("a document", "The bar names it and holds what can be done to it: the caret's block kind, which opens the kinds, and Mark up", () => sheet(), { code: "<DocumentSheet name actions>", surfaces: ["ground"] }),
    row("away from the hub", "The bar says so beside the name; with the hub answering it says nothing", () => sheet("Reconnecting"), { code: "<DocumentSheet state>", surfaces: ["ground"] }),
    row("with its margin", "Each comment's thread beside the text: answered and shut, changed and open (Revert takes the change back, Reply, the tick resolves it), being worked on. In the app each stands at the height of what it is about (beside); here they flow as a list", () => sheet(undefined, MARKED, margin()), { code: "<DocumentSheet margin={<MarkupMarginNotes beside>…}>", surfaces: ["ground"] }),
    row("marks in the text", "comment: a run of text a comment is about, with data-current while its card is open; commented: a whole block, the same; changed: a block an agent changed that is not yet accepted; removed: the line where a block was deleted", () => sheet(undefined, MARKS), { code: "documentMarkClass", surfaces: ["ground"] }),
    row("an empty document", "Its one paragraph says what it is for (documentHintClass, its words in data-hint); in the app the caret's empty paragraph says it too, while the editor has focus", () => sheet(undefined, `<p class="${documentHintClass}" data-hint="Write, / for blocks, @ to ask an agent" data-empty></p>`), { code: "documentHintClass", surfaces: ["ground"] }),
    row("its head", "Over the text: the document's name as its title (DocumentTitle, a field where it can be renamed, else plain text), then its properties, a name and a value written in place (DocumentProperty, DocumentField)", () => sheet(undefined, TEXT, undefined, { head: head() }), { code: "<DocumentHead add><DocumentTitle editable /><DocumentProperty name>…", surfaces: ["ground"] }),
    row("a head with no properties", "Only the title; Add a property stays quiet until the head is pointed at or has focus (shown here: always on touch)", () => sheet(undefined, TEXT, undefined, { head: head(true) }), { code: "<DocumentHead empty add>", surfaces: ["ground"] }),
    row("the block handle", "In the gutter beside the block the mouse is over: + adds a block under it, the grip drags it (the line says where it lands) or, pressed, opens what can be done to it. Here on the first block, its line over it", () => sheet(undefined, TEXT, undefined, { over: handle() }), { code: "<DocumentHandle top><DocumentDropLine top>", surfaces: ["ground"] }),
    row("its count", "A quiet line under the text, where the document is set to show it", () => sheet(undefined, TEXT, undefined, { foot: <DocumentCount>9 blocks · 41 words</DocumentCount> }), { code: "<DocumentCount>", surfaces: ["ground"] }),
    row("selection tools", "Over the text selected, in a popover: its marks, pressed where the selection wears them, a link and a comment; in a table, its rows and columns. A link's address is asked for in place of the buttons", tools, { code: "<DocumentTools label>", surfaces: ["frost"] }),
  ],
  api: ["DocumentSheet", "DocumentHead", "DocumentTitle", "DocumentProperty", "DocumentField", "DocumentCount", "DocumentHandle", "DocumentDropLine", "DocumentTools", "MarkupMarginNotes", "MarkupNote"],
};
