import { CodeIcon, Heading1Icon, Heading2Icon, Heading3Icon, ListChecksIcon, ListIcon, ListOrderedIcon, MinusIcon, PilcrowIcon, TableIcon, TextQuoteIcon } from "lucide-solid";
import { Show, type JSX } from "solid-js";
// Through the barrel, as markup.tsx does, so the editor's chunk takes the header from the app's own.
import { PaneHeader } from "./index";
import "./styles/document.css";

/* Not in the library's barrel: the document editor imports this file, so the app's first load does not carry it. */

/** What a document's text wears: an answer's Markdown, edited in place. The editor puts it on the element it types in. */
export const documentTextClass = "ui-answer ui-document-text";

/** What marks in a document's text wear: a run of text a comment is about, a block one is about, a block an agent changed that is not yet accepted, and what stands where a block was deleted. */
export const documentMarkClass = { comment: "ui-document-comment", commented: "ui-document-commented", changed: "ui-document-changed", removed: "ui-document-removed" };

/** Each kind of block's icon. Here, not in the library's icons, so only the editor's chunk carries them. */
export const documentBlockIcons = { text: PilcrowIcon, "heading-1": Heading1Icon, "heading-2": Heading2Icon, "heading-3": Heading3Icon, bullets: ListIcon, numbers: ListOrderedIcon, checklist: ListChecksIcon, quote: TextQuoteIcon, code: CodeIcon, table: TableIcon, divider: MinusIcon };

/** A Conduit document on its page: its bar (its name, how its copy stands with the hub's when that needs saying, what can be done to it) over one reading column that scrolls;
 *  `ref` is where its text goes. `margin`: what stands beside the text (its comments), and under it where the page is too narrow for both.
 *  `bare`: it is in a pane, whose header is its bar. */
export function DocumentSheet(props: { ref?: (element: HTMLDivElement) => void; name: string; state?: string; actions?: JSX.Element; margin?: JSX.Element; bare?: boolean; children?: JSX.Element }) {
  return <section class="ui-document" aria-label={props.name}>
    <Show when={!props.bare}><PaneHeader kind="tool" name={props.name} place={props.state} actions={props.actions} /></Show>
    <div class="ui-document-column"><div class="ui-document-page">
      <div ref={props.ref} class="ui-document-body">{props.children}</div>
      <Show when={props.margin}><aside class="ui-document-margin" aria-label="Comments">{props.margin}</aside></Show>
    </div></div>
  </section>;
}
