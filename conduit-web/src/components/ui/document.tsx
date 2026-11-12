import type { JSX } from "solid-js";
// Through the barrel, as markup.tsx does, so the editor's chunk takes the header from the app's own.
import { PaneHeader } from "./index";
import "./styles/document.css";

/* Not in the library's barrel: the document editor imports this file, so the app's first load does not carry it. */

/** What a document's text wears: an answer's Markdown, edited in place. The editor puts it on the element it types in. */
export const documentTextClass = "ui-answer ui-document-text";

/** A Conduit document on its page: its bar (its name, how its copy stands with the hub's when that needs saying, what can be done to it) over one reading column that scrolls. */
export function DocumentSheet(props: { ref?: (element: HTMLDivElement) => void; name: string; state?: string; actions?: JSX.Element; children?: JSX.Element }) {
  return <section class="ui-document" aria-label={props.name}>
    <PaneHeader kind="tool" name={props.name} place={props.state} actions={props.actions} />
    <div ref={props.ref} class="ui-document-column">{props.children}</div>
  </section>;
}
