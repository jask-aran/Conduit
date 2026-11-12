import { Button } from "@/components/ui";
import { DocumentSheet, documentTextClass } from "@/components/ui/document"; // Comes with the editor: imported on its own, never from the barrel
import { row, type Page } from "../model";

const TEXT = `<h1>Trip plan</h1><p>Two weeks, three cities. What is <strong>booked</strong> is ticked; the rest is still <a href="#">open</a>.</p><h2>To do</h2>
<ul data-type="taskList"><li><label><input type="checkbox" checked></label><div><p>Book the ferry</p></div></li><li><label><input type="checkbox"></label><div><p>Choose a day for the hike</p></div></li></ul>
<blockquote><p>Leave the last day empty.</p></blockquote><pre><code>ferry  09:40  platform 2</code></pre><div class="tableWrapper"><table><tr><th>City</th><th>Nights</th></tr><tr><td>Osaka</td><td>4</td></tr></table></div>`;
const sheet = (state?: string) => <DocumentSheet name="Trip plan" state={state} actions={<><Button variant="ghost" size="sm">Text</Button><Button variant="ghost" size="sm">Mark up</Button></>}><div class={documentTextClass} innerHTML={TEXT} /></DocumentSheet>;

export const documentPage: Page = {
  title: "Document",
  summary: "DocumentSheet is a Conduit document on its page: a bar over one reading column that scrolls. Its text is an answer's Markdown (.ui-answer) with what editing adds: a checklist, a code block, a table in the wrapper the editor gives it.",
  preview: () => sheet(),
  examples: [
    row("a document", "The bar names it and holds what can be done to it: the caret's block kind, which opens the kinds, and Mark up", () => sheet(), { code: "<DocumentSheet name actions>", surfaces: ["ground"] }),
    row("away from the hub", "The bar says so beside the name; with the hub answering it says nothing", () => sheet("Reconnecting"), { code: "<DocumentSheet state>", surfaces: ["ground"] }),
  ],
  api: ["DocumentSheet"],
};
