import { BetweenHorizontalEndIcon, BetweenVerticalEndIcon, BoldIcon, CalendarIcon, ChevronRightIcon, CodeIcon, ExternalLinkIcon, Grid2x2XIcon, GripVerticalIcon, Heading1Icon, Heading2Icon, Heading3Icon, ImageIcon, ImageOffIcon, InfoIcon, ItalicIcon, LinkIcon, ListChecksIcon, ListCollapseIcon, ListIcon, ListOrderedIcon,
  MessageSquarePlusIcon, MinusIcon, PencilIcon, PilcrowIcon, StrikethroughIcon, TableColumnsSplitIcon, TableIcon, TableRowsSplitIcon, TextQuoteIcon, TriangleAlertIcon, UnlinkIcon } from "lucide-solid";
import { For, Show, splitProps, type JSX } from "solid-js";
// Through the barrel, as markup.tsx does, so the editor's chunk takes the header from the app's own.
import { FindBar, IconButton, Icons, PaneHeader, Row } from "./index";
import "./styles/document.css";

/* Not in the library's barrel: the document editor imports this file, so the app's first load does not carry it. */

/** What a document's text wears: an answer's Markdown, edited in place. The editor puts it on the element it types in. */
export const documentTextClass = "ui-answer ui-document-text";

/** What marks in a document's text wear: a run of text a comment is about, a block one is about, a block an agent changed that is not yet accepted, and what stands where a block was deleted. */
export const documentMarkClass = { comment: "ui-document-comment", commented: "ui-document-commented", changed: "ui-document-changed", removed: "ui-document-removed" };
/** What the editor draws over its own text: an `@name` (a chip that shows what it asked), a match of find and the current one, a block just revealed. */
export const documentDrawClass = { mention: "ui-document-mention", match: "ui-document-match", currentMatch: "ui-document-match-current", revealed: "ui-document-revealed" };

/** Each kind of block's icon. Here, not in the library's icons, so only the editor's chunk carries them. */
export const documentBlockIcons = { text: PilcrowIcon, "heading-1": Heading1Icon, "heading-2": Heading2Icon, "heading-3": Heading3Icon, bullets: ListIcon, numbers: ListOrderedIcon, checklist: ListChecksIcon, quote: TextQuoteIcon, callout: InfoIcon, toggle: ListCollapseIcon, code: CodeIcon, table: TableIcon, image: ImageIcon, divider: MinusIcon, date: CalendarIcon };
/** Each tone of a callout, and its mark. */
export const documentToneIcons = { note: InfoIcon, warning: TriangleAlertIcon };

/** What can be done to the text selected (its marks, a link, a comment) and to the table the caret is in. */
export const documentToolIcons = { bold: BoldIcon, italic: ItalicIcon, strike: StrikethroughIcon, code: CodeIcon, link: LinkIcon, unlink: UnlinkIcon, open: ExternalLinkIcon, edit: PencilIcon, comment: MessageSquarePlusIcon,
  grip: GripVerticalIcon, "row-below": BetweenHorizontalEndIcon, "column-right": BetweenVerticalEndIcon, "delete-row": TableRowsSplitIcon, "delete-column": TableColumnsSplitIcon, "delete-table": Grid2x2XIcon };

/** An empty paragraph's hint, its words in `data-hint`; `data-empty`: the document holds nothing else, so it shows without the caret. */
export const documentHintClass = "ui-document-hint";

/** A row of those tools, floating over what they act on; a field (a link's address) stands in it in place of the buttons. */
export const DocumentTools = (props: { ref?: (element: HTMLDivElement) => void; label: string; children: JSX.Element }) => <div ref={props.ref} role="toolbar" aria-label={props.label} class="ui-document-tools">{props.children}</div>;
/** A link's address, as a row of tools shows it, shortened to its room. */
export const DocumentAddress = (props: { href: string }) => <span class="ui-document-address" title={props.href}>{props.href}</span>;

/** How wide a document's text runs: its reading measure, a wider one, or all its column has. */
export type DocumentWidth = "narrow" | "wide" | "full";

/** A Conduit document on its page: its bar (its name, how its copy stands with the hub's when that needs saying, what can be done to it) over one reading column that scrolls;
 *  `ref` is where its text goes. `head`: what stands over the text (DocumentHead), `foot` under it (DocumentCount); `over`: what floats beside its blocks
 *  (DocumentHandle, DocumentDropLine, DocumentTableEdges), placed from the top of the text's column. `onHover`: the pointer over the column, null as it leaves.
 *  `margin`: what stands beside the text (its comments), and under it where the page is too narrow for both. `bare`: it is in a pane, whose header is its bar.
 *  `width`: how wide the text runs (narrow, unsaid). `find`: a DocumentFind, at the sheet's top right. `scroller`: the element that scrolls. */
export function DocumentSheet(props: { ref?: (element: HTMLDivElement) => void; name: string; state?: string; actions?: JSX.Element; margin?: JSX.Element; bare?: boolean; head?: JSX.Element; foot?: JSX.Element; over?: JSX.Element;
  width?: DocumentWidth; find?: JSX.Element; scroller?: (element: HTMLDivElement) => void; onHover?: (event: PointerEvent | null) => void; children?: JSX.Element }) {
  return <section class="ui-document" aria-label={props.name} data-bare={props.bare ? "" : undefined} data-width={props.width ?? "narrow"}>
    <Show when={!props.bare}><PaneHeader kind="tool" name={props.name} place={props.state} actions={props.actions} /></Show>
    {props.find}
    <div ref={props.scroller} class="ui-document-column" onPointerMove={(event) => props.onHover?.(event)} onPointerLeave={() => props.onHover?.(null)}><div class="ui-document-page">
      <div class="ui-document-body">{props.head}<div ref={props.ref} class="ui-document-content">{props.children}</div>{props.over}{props.foot}</div>
      <Show when={props.margin}><aside class="ui-document-margin" aria-label="Comments">{props.margin}</aside></Show>
    </div></div>
  </section>;
}

/** What stands over a document's text, ruled off from it: its title, then its properties, then `add`, the way to add one, a quiet row always there
 *  (none while one is being added). */
export const DocumentHead = (props: { add?: { label: string; onClick: () => void }; children: JSX.Element }) =>
  <header class="ui-document-head">{props.children}<Show when={props.add}>{(add) => <button type="button" class="ui-document-add" onClick={() => add().onClick()}><Icons.Add />{add().label}</button>}</Show></header>;
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
/** In the gutter beside the block pointed at, `top` from the column's top (none: it is not shown): a grip and a way to add a block under it.
 *  `inside`: the gutter is narrower than it, so it stands over the column's left edge instead. */
export const DocumentHandle = (props: { ref?: (element: HTMLDivElement) => void; top?: number; inside?: boolean; children: JSX.Element }) =>
  <div ref={props.ref} role="group" aria-label="Block" class="ui-document-handle" data-shown={props.top === undefined ? undefined : ""} data-inside={props.inside ? "" : undefined} style={{ top: `${props.top ?? 0}px` }}>{props.children}</div>;
/** Where a block being dragged will land, `top` from the column's top. */
export const DocumentDropLine = (props: { top?: number }) => <Show when={props.top !== undefined}><div class="ui-document-drop" style={{ top: `${props.top}px` }} /></Show>;

/** A table's own controls while the caret is in it, `box` its place from the column's top (none: not shown): its tools (DocumentTools) on its top edge,
 *  a row added on its bottom edge and a column on its right. */
export const DocumentTableEdges = (props: { box?: { top: number; left: number; width: number; height: number }; tools: JSX.Element; onAddRow: () => void; onAddColumn: () => void }) => {
  const keep = (event: MouseEvent) => event.preventDefault();
  return <Show when={props.box}>{(box) => <div class="ui-document-table" style={{ top: `${box().top}px`, left: `${box().left}px`, width: `${box().width}px`, height: `${box().height}px` }}>
    <div class="ui-document-table-tools" onMouseDown={keep}>{props.tools}</div>
    <IconButton data-edge="row" label="Add a row" onMouseDown={keep} onClick={() => props.onAddRow()}><Icons.Add /></IconButton>
    <IconButton data-edge="column" label="Add a column" onMouseDown={keep} onClick={() => props.onAddColumn()}><Icons.Add /></IconButton>
  </div>}</Show>;
};

/** A document's headings as a list to go to, stepped in by level; `current` the one being read. */
export const DocumentOutline = (props: { headings: readonly { id: string; level: number; text: string }[]; current?: string; onPick: (id: string) => void }) =>
  <nav class="ui-document-outline" aria-label="Outline"><For each={props.headings}>{(heading) =>
    <Row element="button" density="tree" depth={heading.level - 1} current={heading.id === props.current} onClick={() => props.onPick(heading.id)}>{heading.text || "Untitled"}</Row>}</For></nav>;

/** Find in a document's text, at the sheet's top right: the field, how many it found and which is current ("3 of 12"), previous, next, close. */
export const DocumentFind = (props: Omit<Parameters<typeof FindBar>[0], "label" | "plain" | "children">) => <FindBar label="Find" {...props} />;

/** What the editor's own blocks wear in its text: a callout's box (its tone in `data-tone`), a toggle (`data-open` while unfolded) and the room its blocks fold in. */
export const documentBlockClass = { callout: "ui-document-callout", toggle: "ui-document-toggle", toggleBody: "ui-document-toggle-body" };

/** A callout's mark, in its tone's colour, at the head of its box. */
export const DocumentToneMark = (props: { tone: keyof typeof documentToneIcons }) =>
  <span class="ui-document-tone" data-tone={props.tone} role="img" aria-label={props.tone === "warning" ? "Warning" : "Note"}><Show when={props.tone === "warning"} fallback={<InfoIcon />}><TriangleAlertIcon /></Show></span>;

/** A toggle's chevron: pressed, its blocks fold under its summary or unfold. */
export const DocumentFold = (props: { open: boolean; onToggle: () => void }) =>
  <span class="ui-document-fold"><IconButton label={props.open ? "Fold" : "Unfold"} aria-expanded={props.open} onMouseDown={(event) => event.preventDefault()} onClick={() => props.onToggle()}><ChevronRightIcon /></IconButton></span>;

/** An image block: the picture (`src`; none yet, it is loading, or `missing`, it is not kept with this document) and its caption, written in place where `onCaption` is given. */
export const DocumentImage = (props: { src?: string; caption: string; missing?: string; onCaption?: (caption: string) => void }) =>
  <figure class="ui-document-image">
    <Show when={props.src} fallback={<div class="ui-document-image-missing" role="img" aria-label={props.caption || "Image"}><ImageOffIcon />{props.missing ?? "Loading the image"}</div>}><img src={props.src} alt={props.caption} draggable={false} /></Show>
    <Show when={props.onCaption || props.caption}>
      <figcaption><input class="ui-document-field ui-document-caption" aria-label="Caption" placeholder="Add a caption" value={props.caption} readOnly={!props.onCaption} onInput={(event) => props.onCaption?.(event.currentTarget.value)} /></figcaption>
    </Show>
  </figure>;

/** A date in the text, as a quiet chip in the reader's own way of writing dates; pressed, it can be changed (`onPress`). */
export const DocumentDate = (props: { date: string; onPress?: () => void; ref?: (element: HTMLButtonElement) => void }) => {
  const shown = () => { const day = new Date(`${props.date}T00:00:00`); return Number.isNaN(day.getTime()) ? props.date : day.toLocaleDateString(undefined, { dateStyle: "medium" }); };
  return <button ref={props.ref} type="button" class="ui-document-date-chip" onClick={() => props.onPress?.()}><time datetime={props.date}>{shown()}</time></button>;
};

/** Under a new, empty document's hint: ways to start it, each a quiet button (Button ghost); `note` says what to do where a button could not do it itself.
 *  `top`: placed from the column's top, under the line it is about (unsaid: where it stands). */
export const DocumentStarts = (props: { top?: number; note?: string; children: JSX.Element }) =>
  <div class="ui-document-starts" role="group" aria-label="Start from" data-placed={props.top === undefined ? undefined : ""} style={props.top === undefined ? undefined : { top: `${props.top}px` }}>{props.children}<Show when={props.note}><p class="ui-document-starts-note" role="status">{props.note}</p></Show></div>;
