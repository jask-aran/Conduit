import type { JSX } from "solid-js";
import { Button } from "@/components/ui";
import { DocumentSheet, documentMarkClass, documentTextClass } from "@/components/ui/document"; // Comes with the editor: imported on its own, never from the barrel
import { MarkupMarginNotes, MarkupNote } from "@/components/ui/markup";
import { row, type Page } from "../model";
import { noop } from "../demos";

const TEXT = `<h1>Trip plan</h1><p>Two weeks, three cities. What is <strong>booked</strong> is ticked; the rest is still <a href="#">open</a>.</p><h2>To do</h2>
<ul data-type="taskList"><li><label><input type="checkbox" checked></label><div><p>Book the ferry</p></div></li><li><label><input type="checkbox"></label><div><p>Choose a day for the hike</p></div></li></ul>
<blockquote><p>Leave the last day empty.</p></blockquote><pre><code>ferry  09:40  platform 2</code></pre><div class="tableWrapper"><table><tr><th>City</th><th>Nights</th></tr><tr><td>Osaka</td><td>4</td></tr></table></div>`;
const MARKED = TEXT.replace("Two weeks, three cities", `<span class="${documentMarkClass.comment}">Two weeks, three cities</span>`).replace("<blockquote>", `<div class="${documentMarkClass.removed}">Decide on the last day by Friday.</div><blockquote class="${documentMarkClass.changed}">`);
const MARKS = `<p>A <span class="${documentMarkClass.comment}">run a comment is about</span>, and <span class="${documentMarkClass.comment}" data-current>the one whose card is open</span>.</p><p class="${documentMarkClass.commented}">A whole block a comment is about.</p><p class="${documentMarkClass.commented}" data-current>The same, its card open.</p><p class="${documentMarkClass.changed}">A block an agent changed, not yet accepted.</p><div class="${documentMarkClass.removed}">A block that was deleted, where it stood.</div>`;
const sheet = (state?: string, text = TEXT, margin?: JSX.Element) => <DocumentSheet name="Trip plan" state={state} margin={margin} actions={<><Button variant="ghost" size="sm">Text</Button><Button variant="ghost" size="sm">Mark up</Button></>}><div class={documentTextClass} innerHTML={text} /></DocumentSheet>;
const thread = (more: Partial<Parameters<typeof MarkupNote>[0]>) => <MarkupNote open={false} tag="" name="“Two weeks, three cities”" value="" onOpen={noop} onInput={noop} onResolve={noop} said={[]} {...more} />;
const margin = () => <MarkupMarginNotes beside={false}>
  {thread({ words: "Is it three cities or four?", state: { label: "Answered" }, said: [{ from: "agent", text: "Three: Osaka, Kyoto and Nara." }] })}
  {thread({ name: "“Leave the last day empty.”", open: true, words: "Make this a note to self.", state: { label: "Changed" }, said: [{ from: "agent", text: "Put it in a quote and took out the line above it." }], placeholder: "Write back", onSay: noop, onRevert: noop })}
  {thread({ name: "“Osaka”", words: "Add the hotel to the table.", state: { label: "Working on it", busy: true } })}
</MarkupMarginNotes>;

export const documentPage: Page = {
  title: "Document",
  summary: "DocumentSheet is a Conduit document on its page: a bar over one reading column that scrolls. Its text is an answer's Markdown (.ui-answer) with what editing adds: a checklist, a code block, a table in the wrapper the editor gives it. Its margin (MarkupMarginNotes) holds the comments as threads beside the text, under it where the page is too narrow; the text wears marks for what they are about and what an agent changed (documentMarkClass).",
  preview: () => sheet(),
  examples: [
    row("a document", "The bar names it and holds what can be done to it: the caret's block kind, which opens the kinds, and Mark up", () => sheet(), { code: "<DocumentSheet name actions>", surfaces: ["ground"] }),
    row("away from the hub", "The bar says so beside the name; with the hub answering it says nothing", () => sheet("Reconnecting"), { code: "<DocumentSheet state>", surfaces: ["ground"] }),
    row("with its margin", "Each comment's thread beside the text: answered and shut, changed and open (Revert takes the change back, Reply, the tick resolves it), being worked on. In the app each stands at the height of what it is about (beside); here they flow as a list", () => sheet(undefined, MARKED, margin()), { code: "<DocumentSheet margin={<MarkupMarginNotes beside>…}>", surfaces: ["ground"] }),
    row("marks in the text", "comment: a run of text a comment is about, with data-current while its card is open; commented: a whole block, the same; changed: a block an agent changed that is not yet accepted; removed: the line where a block was deleted", () => sheet(undefined, MARKS), { code: "documentMarkClass", surfaces: ["ground"] }),
  ],
  api: ["DocumentSheet", "MarkupMarginNotes", "MarkupNote"],
};
