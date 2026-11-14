import { BaselineIcon, BetweenHorizontalEndIcon, BetweenVerticalEndIcon, BoldIcon, CalendarIcon, ChevronRightIcon, CodeIcon, ExternalLinkIcon, Grid2x2XIcon, GripVerticalIcon, Heading1Icon, Heading2Icon, Heading3Icon, HighlighterIcon, ImageIcon, ImageOffIcon, InfoIcon, ItalicIcon, LinkIcon, ListChecksIcon, ListCollapseIcon, ListIcon, ListOrderedIcon,
  MessageSquarePlusIcon, MinusIcon, PencilIcon, FileDiffIcon, PilcrowIcon, StrikethroughIcon, TableColumnsSplitIcon, TableIcon, TableRowsSplitIcon, TextQuoteIcon, TriangleAlertIcon, UnlinkIcon } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, splitProps, type JSX } from "solid-js";
// Through the barrel, as markup.tsx does, so the editor's chunk takes the header from the app's own.
import { Button, FindBar, Frost, IconButton, Icons, Item, PaneHeader, Section, Spinner, TextArea } from "./index";
import { Popover, PopoverContent } from "./menus";
import "./styles/document.css";

/* Not in the library's barrel: the document editor imports this file, so the app's first load does not carry it. */

/** What a document's text wears: an answer's Markdown, edited in place. The editor puts it on the element it types in. */
export const documentTextClass = "ui-answer ui-document-text";

/** What marks in a document's text wear: a run of text a comment is about, a block one is about, a block an agent changed that is not yet accepted, and what stands where a block was deleted. */
export const documentMarkClass = { comment: "ui-document-comment", commented: "ui-document-commented", changed: "ui-document-changed", removed: "ui-document-removed" };
/** What the editor draws over its own text: an `@name` (a chip that shows what it asked), a match of find and the current one, a block just revealed. */
/**
 * An agent at work (a seat), drawn by the editor as decorations, so as plain elements: `held`, a block it holds (`data-seat` what it is doing,
 * `data-op="replace"` while it is being written over, `data-seat-ink` its ink). The rest are made by the functions under.
 */
export const documentSeatClass = { held: "ui-document-seat-held" };
/** The inks agents are drawn in, one each (Markup's of those names, MARKUP_INKS); red is left out, since it says something is wrong. */
export const DOCUMENT_SEAT_INKS = ["plain", "green", "amber", "blue"] as const;
export type DocumentSeatInk = typeof DOCUMENT_SEAT_INKS[number];
const made = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, more: Partial<HTMLElementTagNameMap[K]> = {}) => Object.assign(document.createElement(tag), { className, ...more });
/** An agent's caret, as another writer's is drawn: a bar in its ink, `label` (its name, and what it is doing) on a tag over it. In a line of text it stands where it is put. */
export const documentSeatCaret = (label: string) => {
  const caret = made("span", "ui-document-seat-caret"), name = made("span", "ui-document-seat-name", { textContent: label });
  caret.append(name);
  // The name stands from the caret rightward, and leftward where the edge of the text's column would cut it (and back, where the other edge would).
  const cut = new IntersectionObserver(([seen]) => {
    if (!caret.isConnected) return cut.disconnect();
    if (!seen || seen.intersectionRatio >= 1 || !seen.intersectionRect.width) return;
    if (seen.boundingClientRect.right > seen.intersectionRect.right + 0.5) caret.dataset.flip = ""; else if (seen.boundingClientRect.left < seen.intersectionRect.left - 0.5) delete caret.dataset.flip;
  }, { threshold: 1 });
  cut.observe(name);
  return caret;
};
/** The caret of an agent at work on a block, put at the start of the block's first line: it takes no room, so nothing moves as it comes and goes. */
export const documentSeatFlag = (label: string, ink: DocumentSeatInk) => {
  const flag = made("span", "ui-document-seat-flag", { contentEditable: "false" });
  flag.dataset.seatInk = ink;
  flag.append(documentSeatCaret(label));
  return flag;
};
/** What an agent is heard writing, drawn as the blocks it will be, quiet until it is the paper's: `body` holds them, its caret at their end. */
export const documentSeatStream = (ink: DocumentSeatInk) => {
  const root = made("div", "ui-document-seat-stream", { contentEditable: "false" }), body = made("div", "ui-document-seat-body");
  root.dataset.seatInk = ink;
  root.append(body);
  return { root, body };
};
/** Pinned to the sheet's edge while an agent at work is out of view above or below: what it is doing and where; pressed, the text goes to it. */
export const DocumentSeatJump = (props: { label: string; below: boolean; ink: DocumentSeatInk; onJump: () => void }) =>
  <Frost as="button" type="button" class="ui-document-seat-jump" data-at={props.below ? "below" : "above"} data-seat-ink={props.ink} onClick={() => props.onJump()}>
    <Show when={props.below} fallback={<Icons.ArrowUp />}><Icons.ArrowDown /></Show><span>{props.label}</span>
  </Frost>;
// What was asked before, kept in this browser, newest first: ArrowUp recalls it, and the most used are offered while the field is empty.
const ASKED = "conduit.document.asked";
type Asked = { words: string; uses: number };
const askedBefore = (): Asked[] => { try { const kept: unknown = JSON.parse(localStorage.getItem(ASKED) ?? "[]"); return Array.isArray(kept) ? kept.filter((one): one is Asked => typeof one?.words === "string" && typeof one.uses === "number") : []; } catch { return []; } };
const keepAsked = (words: string) => { const was = askedBefore(), had = was.find((one) => one.words === words); try { localStorage.setItem(ASKED, JSON.stringify([{ words, uses: (had?.uses ?? 0) + 1 }, ...was.filter((one) => one !== had)].slice(0, 20))); } catch { /* not kept */ } };
/** Asking someone to write in the paper, as a line of it: who is asked, what of them, and Send. `at`: the line it stands in, within the sheet's body. Enter sends, Shift Enter is
 *  a new line; ArrowUp in an empty field recalls what was asked before; `@` first offers the others of `names`, picked told to `onName`. Escape, or focus leaving it,
 *  puts it away (`onClose`). */
export function DocumentAsk(props: { name: string; names?: readonly string[]; onName?: (name: string) => void; at: { left: number; top: number; width: number }; onSend: (words: string) => void; onClose: () => void }) {
  const [words, setWords] = createSignal(""), [active, setActive] = createSignal(0), [shut, setShut] = createSignal<string>();
  const before = askedBefore(), used = [...before].sort((a, b) => b.uses - a.uses).slice(0, 3);
  let field: HTMLTextAreaElement | undefined, root: HTMLDivElement | undefined, recalled = -1;
  const put = (said: string) => { setWords(said); queueMicrotask(() => field?.setSelectionRange(said.length, said.length)); };
  const send = () => { const said = words().trim(); if (!said) return; keepAsked(said); props.onSend(said); };
  const others = createMemo(() => { const typed = /^@(\S*)$/.exec(words())?.[1]?.toLowerCase(); return typed === undefined || shut() === words() ? [] : (props.names ?? []).filter((name) => name !== props.name && name.toLowerCase().includes(typed)); });
  createEffect(() => { others(); setActive(0); });
  const rename = (name: string) => { props.onName?.(name); put(""); };
  const keep = (event: MouseEvent) => event.preventDefault();
  const keys = (event: KeyboardEvent) => {
    const menu = others(), up = event.key === "ArrowUp";
    if (menu.length && (up || event.key === "ArrowDown")) { event.preventDefault(); setActive((at) => Math.min(menu.length - 1, Math.max(0, at + (up ? -1 : 1)))); }
    else if (menu.length && (event.key === "Enter" || event.key === "Tab") && !event.isComposing) { event.preventDefault(); rename(menu[active()]!); }
    else if (menu.length && event.key === "Escape") { event.preventDefault(); setShut(words()); }
    else if (event.key === "Escape") { event.preventDefault(); props.onClose(); }
    else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); }
    // As a shell recalls: from empty, or from an ask recalled and left as it was, ArrowUp goes one older and ArrowDown one newer.
    else if ((up || event.key === "ArrowDown") && (!words() || words() === before[recalled]?.words)) {
      const next = (words() ? recalled : -1) + (up ? 1 : -1);
      if (next < -1 || next >= before.length) return;
      event.preventDefault(); recalled = next; put(before[next]?.words ?? "");
    }
  };
  return <div ref={root} class="ui-document-ask" style={{ left: `${props.at.left}px`, top: `${props.at.top}px`, width: `${props.at.width}px` }} onFocusOut={(event) => { if (event.currentTarget.isConnected && !event.currentTarget.contains(event.relatedTarget as Node | null)) props.onClose(); }}>
    <span class="ui-document-mention">@{props.name}</span>
    <TextArea ref={(element) => { field = element; queueMicrotask(() => element.focus({ preventScroll: true })); }} aria-label={`Ask ${props.name}`} placeholder={`Tell ${props.name} what to write or edit`} value={words()} onInput={(event) => setWords(event.currentTarget.value)} onKeyDown={keys} />
    <IconButton label="Send (Enter)" disabled={!words().trim()} onMouseDown={keep} onClick={send}><Icons.Send /></IconButton>
    <Show when={!words() && used.length}><div class="ui-document-ask-asked" role="group" aria-label="Asked before">
      <For each={used}>{(one) => <Button variant="ghost" size="sm" title={one.words} onMouseDown={keep} onClick={() => put(one.words)}><span class="ui-truncate">{one.words}</span></Button>}</For>
    </div></Show>
    <Popover open={others().length > 0} onOpenChange={(open) => { if (!open) setShut(words()); }} anchorRef={() => root} placement="bottom-start">
      <PopoverContent aria-label="Ask someone else" width="sm" onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}>
        <Section role="listbox"><For each={others()}>{(name, at) => <Item role="option" aria-selected={active() === at()} active={active() === at()} onCursor={() => setActive(at())} onMouseDown={keep} onClick={() => rename(name)}>{name}</Item>}</For></Section>
      </PopoverContent>
    </Popover>
  </div>;
}
export const documentDrawClass = { mention: "ui-document-mention", match: "ui-document-match", currentMatch: "ui-document-match-current", revealed: "ui-document-revealed" };

/** Each kind of block's icon. Here, not in the library's icons, so only the editor's chunk carries them. */
export const documentBlockIcons = { text: PilcrowIcon, "heading-1": Heading1Icon, "heading-2": Heading2Icon, "heading-3": Heading3Icon, bullets: ListIcon, numbers: ListOrderedIcon, checklist: ListChecksIcon, quote: TextQuoteIcon, callout: InfoIcon, toggle: ListCollapseIcon, code: CodeIcon, table: TableIcon, image: ImageIcon, divider: MinusIcon, date: CalendarIcon };
/** Each tone of a callout, and its mark. */
export const documentToneIcons = { note: InfoIcon, warning: TriangleAlertIcon };

/** What can be done to the text selected (its marks, a link, a comment) and to the table the caret is in. */
export const documentToolIcons = { bold: BoldIcon, italic: ItalicIcon, strike: StrikethroughIcon, code: CodeIcon, color: BaselineIcon, highlight: HighlighterIcon, link: LinkIcon, unlink: UnlinkIcon, open: ExternalLinkIcon, edit: PencilIcon, comment: MessageSquarePlusIcon,
  grip: GripVerticalIcon, "row-below": BetweenHorizontalEndIcon, "column-right": BetweenVerticalEndIcon, "delete-row": TableRowsSplitIcon, "delete-column": TableColumnsSplitIcon, "delete-table": Grid2x2XIcon };

/** How the reader writes (DocumentWriting): Editing, final; Suggesting, each change standing until it is accepted. */
export const documentWritingIcons = { editing: PencilIcon, suggesting: FileDiffIcon };

/** A suggestion's own controls, standing over its first block where nothing beside the text draws them: who suggested it, Accept (its text stays) and Reject (taken back). */
export const DocumentSuggested = (props: { by: string; onAccept: () => void; onReject: () => void }) => {
  const keep = (event: MouseEvent) => event.preventDefault();
  return <div class="ui-document-suggested" role="group" aria-label={`Suggested by ${props.by}`}><span>Suggested by {props.by}</span>
    <Button variant="ghost" size="sm" onMouseDown={keep} onClick={() => props.onAccept()}><Icons.Check />Accept</Button>
    <Button variant="ghost" size="sm" onMouseDown={keep} onClick={() => props.onReject()}><Icons.Undo />Reject</Button>
  </div>;
};

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
 *  `margin`: what stands beside the text (its comments), and tucked over its right edge where the page is too narrow for both; `marginEmpty`: it holds nothing now, so it takes no room and the text stands centred. `bare`: it is in a pane, whose header is its bar.
 *  `width`: how wide the text runs (narrow, unsaid). `find`: a DocumentFind, at the sheet's top right. `scroller`: the element that scrolls. `edge`: what is pinned
 *  to the sheet's edge over the column whatever is scrolled (DocumentSeatJump). */
export function DocumentSheet(props: { ref?: (element: HTMLDivElement) => void; name: string; state?: string; actions?: JSX.Element; margin?: JSX.Element; marginEmpty?: boolean; bare?: boolean; head?: JSX.Element; foot?: JSX.Element; over?: JSX.Element;
  width?: DocumentWidth; find?: JSX.Element; edge?: JSX.Element; scroller?: (element: HTMLDivElement) => void; onHover?: (event: PointerEvent | null) => void; children?: JSX.Element }) {
  // Where the text at its full measure and the margin with cards in it do not fit side by side, the sheet first gives up its side room (snug), and
  // where that is not enough the margin is tucked: it takes no room, and its cards stand over the text's right edge as small marks until one is opened.
  // Each fold's need is measured as it is drawn (as the ribbon's are), so no width is named here. (The margin keeps its flex basis while tucked: it is
  // what says how wide it would stand.)
  const SNUG = 1, TUCKED = 2;
  const [fold, setFold] = createSignal(0);
  const needs: number[] = [];
  let column: HTMLDivElement | undefined, body: HTMLDivElement | undefined, aside: HTMLElement | undefined;
  const fit = () => {
    for (let tries = 0; tries <= 2 * TUCKED; tries++) {
      if (!column || !body || !aside || props.marginEmpty) return setFold(0);
      const at = fold(), room = column.clientWidth;
      if (at < TUCKED) {
        const look = getComputedStyle(column), page = getComputedStyle(column.firstElementChild!);
        needs[at] = parseFloat(getComputedStyle(body).maxWidth) + (parseFloat(page.columnGap) || 0) + parseFloat(getComputedStyle(aside).flexBasis) + parseFloat(look.paddingLeft) + parseFloat(look.paddingRight);
      }
      const next = at < TUCKED && needs[at]! > room ? at + 1 : at > 0 && (needs[at - 1] ?? Infinity) <= room ? at - 1 : at;
      if (next === at) return;
      setFold(next);
    }
  };
  const sized = new ResizeObserver(fit);
  onCleanup(() => sized.disconnect());
  // A new measure or a margin come or gone makes each fold's need new: measured again from the widest.
  createEffect(() => { props.width; props.marginEmpty; queueMicrotask(() => { needs.length = 0; setFold(0); fit(); }); });
  return <section class="ui-document" aria-label={props.name} data-bare={props.bare ? "" : undefined} data-width={props.width ?? "narrow"}>
    <Show when={!props.bare}><PaneHeader kind="tool" name={props.name} place={props.state} actions={props.actions} /></Show>
    {props.find}
    <div ref={(element) => { column = element; sized.observe(element); props.scroller?.(element); }} class="ui-document-column" data-snug={fold() === SNUG ? "" : undefined} onPointerMove={(event) => props.onHover?.(event)} onPointerLeave={() => props.onHover?.(null)}><div class="ui-document-page" data-margin={props.marginEmpty ? "none" : fold() === TUCKED ? "tucked" : "beside"}>
      <div ref={body} class="ui-document-body">{props.head}<div ref={props.ref} class="ui-document-content">{props.children}</div>{props.over}{props.foot}</div>
      <Show when={props.margin}><aside ref={aside} class="ui-document-margin" aria-label="Comments">{props.margin}</aside></Show>
    </div></div>
    {props.edge}
  </section>;
}

/** What stands over a document's text, ruled off from it: its title, then its properties, then `add`, the way to add one, a quiet row always there
 *  (none while one is being added). */
export const DocumentHead = (props: { add?: { label: string; onClick: () => void }; children: JSX.Element }) =>
  <header class="ui-document-head">{props.children}<Show when={props.add}>{(add) => <Button variant="ghost" size="sm" class="ui-document-add" onClick={() => add().onClick()}><Icons.Add />{add().label}</Button>}</Show></header>;
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
    <Show when={props.src} fallback={<div class="ui-document-image-missing" role="img" aria-label={props.caption || "Image"}><Show when={props.missing} fallback={<Spinner />}><ImageOffIcon /></Show>{props.missing ?? "Loading the image"}</div>}><img src={props.src} alt={props.caption} draggable={false} /></Show>
    <Show when={props.onCaption || props.caption}>
      <figcaption><input class="ui-document-field ui-document-caption" aria-label="Caption" placeholder="Add a caption" value={props.caption} readOnly={!props.onCaption} onInput={(event) => props.onCaption?.(event.currentTarget.value)} /></figcaption>
    </Show>
  </figure>;

/** A date in the text, as a quiet chip in the reader's own way of writing dates; pressed, it can be changed (`onPress`). */
export const DocumentDate = (props: { date: string; onPress?: () => void; ref?: (element: HTMLButtonElement) => void }) => {
  const shown = () => { const day = new Date(`${props.date}T00:00:00`); return Number.isNaN(day.getTime()) ? props.date : day.toLocaleDateString(undefined, { dateStyle: "medium" }); };
  return <button ref={props.ref} type="button" class="ui-document-date-chip" onClick={() => props.onPress?.()}><time datetime={props.date}>{shown()}</time></button>;
};

