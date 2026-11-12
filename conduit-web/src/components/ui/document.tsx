import { BetweenHorizontalEndIcon, BetweenVerticalEndIcon, BoldIcon, CodeIcon, Grid2x2XIcon, GripVerticalIcon, Heading1Icon, Heading2Icon, Heading3Icon, ItalicIcon, LinkIcon, ListChecksIcon, ListIcon, ListOrderedIcon, MessageSquarePlusIcon, MinusIcon, PilcrowIcon, StrikethroughIcon,
  TableColumnsSplitIcon, TableIcon, TableRowsSplitIcon, TextQuoteIcon, UnlinkIcon } from "lucide-solid";
import { Show, splitProps, type JSX } from "solid-js";
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

/** What can be done to the text selected (its marks, a link, a comment) and to the table the caret is in. */
export const documentToolIcons = { bold: BoldIcon, italic: ItalicIcon, strike: StrikethroughIcon, code: CodeIcon, link: LinkIcon, unlink: UnlinkIcon, comment: MessageSquarePlusIcon,
  grip: GripVerticalIcon, "row-below": BetweenHorizontalEndIcon, "column-right": BetweenVerticalEndIcon, "delete-row": TableRowsSplitIcon, "delete-column": TableColumnsSplitIcon, "delete-table": Grid2x2XIcon };

/** An empty paragraph's hint, its words in `data-hint`; `data-empty`: the document holds nothing else, so it shows without the caret. */
export const documentHintClass = "ui-document-hint";

/** A row of those tools, floating over what they act on; a field (a link's address) stands in it in place of the buttons. */
export const DocumentTools = (props: { label: string; children: JSX.Element }) => <div role="toolbar" aria-label={props.label} class="ui-document-tools">{props.children}</div>;

/** A Conduit document on its page: its bar (its name, how its copy stands with the hub's when that needs saying, what can be done to it) over one reading column that scrolls;
 *  `ref` is where its text goes. `head`: what stands over the text (DocumentHead), `foot` under it (DocumentCount); `over`: what floats beside its blocks
 *  (DocumentHandle, DocumentDropLine), placed from the top of the text's column. `onHover`: the pointer over the column, null as it leaves.
 *  `margin`: what stands beside the text (its comments), and under it where the page is too narrow for both. `bare`: it is in a pane, whose header is its bar. */
export function DocumentSheet(props: { ref?: (element: HTMLDivElement) => void; name: string; state?: string; actions?: JSX.Element; margin?: JSX.Element; bare?: boolean; head?: JSX.Element; foot?: JSX.Element; over?: JSX.Element;
  onHover?: (event: PointerEvent | null) => void; children?: JSX.Element }) {
  return <section class="ui-document" aria-label={props.name}>
    <Show when={!props.bare}><PaneHeader kind="tool" name={props.name} place={props.state} actions={props.actions} /></Show>
    <div class="ui-document-column" onPointerMove={(event) => props.onHover?.(event)} onPointerLeave={() => props.onHover?.(null)}><div class="ui-document-page">
      <div class="ui-document-body">{props.head}<div ref={props.ref} class="ui-document-content">{props.children}</div>{props.over}{props.foot}</div>
      <Show when={props.margin}><aside class="ui-document-margin" aria-label="Comments">{props.margin}</aside></Show>
    </div></div>
  </section>;
}

/** What stands over a document's text: its title, then its properties. `add`: the way to add one, which stays quiet until the head is pointed at
 *  or has focus while there are none (`empty`). */
export const DocumentHead = (props: { empty?: boolean; add?: JSX.Element; children: JSX.Element }) =>
  <header class="ui-document-head" data-empty={props.empty ? "" : undefined}>{props.children}<Show when={props.add}><div class="ui-document-add">{props.add}</div></Show></header>;
/** The document's name as its title: a field where it can be renamed (`editable`), else plain text. */
export function DocumentTitle(props: JSX.InputHTMLAttributes<HTMLInputElement> & { editable?: boolean }) {
  const [local, rest] = splitProps(props, ["editable"]);
  return <Show when={local.editable} fallback={<h1 class="ui-document-title">{props.value}</h1>}><input {...rest} class="ui-document-title" /></Show>;
}
/** One of a document's properties: its name, muted, and its value (a DocumentField). */
export const DocumentProperty = (props: { name: JSX.Element; children: JSX.Element }) => <div class="ui-document-property"><span class="ui-document-property-name">{props.name}</span>{props.children}</div>;
/** A field written in place, with nothing round it. */
export const DocumentField = (props: JSX.InputHTMLAttributes<HTMLInputElement>) => <input {...props} class="ui-document-field" />;
/** A quiet line under the text: how much it holds. */
export const DocumentCount = (props: { children: JSX.Element }) => <p class="ui-document-count">{props.children}</p>;
/** In the gutter beside the block pointed at, `top` from the column's top (none: it is not shown): a grip and a way to add a block under it. */
export const DocumentHandle = (props: { ref?: (element: HTMLDivElement) => void; top?: number; children: JSX.Element }) =>
  <div ref={props.ref} role="group" aria-label="Block" class="ui-document-handle" data-shown={props.top === undefined ? undefined : ""} style={{ top: `${props.top ?? 0}px` }}>{props.children}</div>;
/** Where a block being dragged will land, `top` from the column's top. */
export const DocumentDropLine = (props: { top?: number }) => <Show when={props.top !== undefined}><div class="ui-document-drop" style={{ top: `${props.top}px` }} /></Show>;
