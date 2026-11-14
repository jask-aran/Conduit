import { Extension, type ChainedCommands, type Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack, type JSX } from "solid-js";
import { createTiptapEditor } from "solid-tiptap";
import { isOn, markAttrs, probeEditor, readEditor, sameJson } from "./read";
import { lateSync, settle } from "./sync";
import { redo, undo, ySyncPlugin, yUndoPlugin, yUndoPluginKey } from "y-prosemirror";
import type { Doc, Map as YMap, XmlFragment } from "yjs";
import { Button, Icons } from "@/components/ui";
import { Popover, PopoverContent } from "@/components/ui/menus";
import { MARKUP_INKS } from "@/components/ui/markup";
import { DocumentAsk, DocumentCount, DocumentSeatJump, DocumentSheet, DocumentStarts, documentBlockIcons, documentMarkClass, documentTextClass, documentToolIcons, documentWritingIcons, type DocumentWidth } from "@/components/ui/document";
import { CHANGES, FRAGMENT, PROPERTIES, documentExtensions, isSuggestion } from "@/document-format.js";
import { blockById, blockKeys, caretBlockAt, shiftBlock } from "./blocks";
import { drawn, revealed } from "./drawn";
import { createFind } from "./find";
import { createBlockHandle } from "./handle";
import { PaperHead } from "./head";
import { DOCUMENT_BLOCKS, DOCUMENT_MARKS, DOCUMENT_TURNABLE, type DocumentAnchor, type DocumentBlockKind, type DocumentControls, type DocumentHeading, type DocumentHost, type DocumentMarking, type DocumentMarks } from "./host";
import { hinted } from "./hint";
import { createLiveDocument } from "./live";
import { createSeatsAway, seatsDrawn } from "./seats";
import { createSuggesting, type Change } from "./suggest";
import { dayFrom, insertMarkdown, paperTyping, pickImages, viewed } from "./nodes";
import { INKED, INKS, inkSwatch, MARKS, putInk, SelectionTools, TableTools, selectedRange, type PaperInk } from "./toolbar";
import { createSlash, menuKeys, TypedMenu, typing, type Typed, type Typing } from "./typed";

/** What the caret's block is, read in this order (a list inside a quote is a list), and how a block is made that kind. */
const KINDS: Record<DocumentBlockKind, { label: string; is?: [string, Record<string, unknown>?]; make: (chain: ChainedCommands) => ChainedCommands }> = {
  "heading-1": { label: "Heading 1", is: ["heading", { level: 1 }], make: (chain) => chain.setHeading({ level: 1 }) },
  "heading-2": { label: "Heading 2", is: ["heading", { level: 2 }], make: (chain) => chain.setHeading({ level: 2 }) },
  "heading-3": { label: "Heading 3", is: ["heading", { level: 3 }], make: (chain) => chain.setHeading({ level: 3 }) },
  code: { label: "Code", is: ["codeBlock"], make: (chain) => chain.setCodeBlock() },
  table: { label: "Table", is: ["table"], make: (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
  checklist: { label: "Checklist", is: ["taskList"], make: (chain) => chain.toggleTaskList() },
  bullets: { label: "Bullet list", is: ["bulletList"], make: (chain) => chain.toggleBulletList() },
  numbers: { label: "Numbered list", is: ["orderedList"], make: (chain) => chain.toggleOrderedList() },
  quote: { label: "Quote", is: ["blockquote"], make: (chain) => chain.toggleBlockquote() },
  callout: { label: "Callout", is: ["callout"], make: (chain) => chain.wrapIn("callout") },
  // A toggle's summary is a line of text, so what it is made of becomes one first.
  toggle: { label: "Toggle", is: ["toggle"], make: (chain) => chain.setParagraph().wrapIn("toggle") },
  // Its file is asked for first (the tool's `run`): made when the hub has kept it.
  image: { label: "Image", is: ["image"], make: (chain) => chain },
  divider: { label: "Divider", make: (chain) => chain.setHorizontalRule() },
  date: { label: "Date", make: (chain) => chain.insertContent({ type: "date", attrs: { date: dayFrom() } }) },
  text: { label: "Text", make: (chain) => chain.clearNodes() },
};
const wordsIn = new WeakMap<Node, number>();
const kindAt = (editor: Editor | undefined) => (Object.keys(KINDS) as DocumentBlockKind[]).find((kind) => { const is = KINDS[kind].is; return is && isOn(editor, ...is); }) ?? "text";

const MARK_KEYS: Record<string, string[]> = { bold: ["Ctrl", "B"], italic: ["Ctrl", "I"], strike: ["Ctrl", "Shift", "S"], code: ["Ctrl", "E"] };
// The chords the text keeps from the application while it has the keyboard (`data-own-keys`, read by the shortcut manager): its marks.
const OWN_KEYS = Object.values(MARK_KEYS).map((keys) => [...keys.slice(0, -1).map((key) => key === "Ctrl" ? "primary" : key.toLowerCase()).sort(), `Key${keys.at(-1)}`].join("+")).join(" ");
/** The editor's text is the Yjs document's blocks, each change merged as it is made; undo takes back only what was written here. */
/**
 * A step through the history, which is the document's. What is typed and not yet written to it is written first, or it would be taken back out of
 * order. Then the caret is put at the end of what the step changed: the sync plugin restores it from where it stood when the change was made, which
 * a redo lands a paragraph on and an undo of a whole block lands at the top of the paper.
 */
const step = (made: Editor, doc: Doc | null, run: typeof undo) => {
  if (doc) settle(doc);
  const was = made.state.doc;
  if (!run(made.state)) return false;
  const now = made.state.doc, start = was.content.findDiffStart(now.content), end = start === null ? null : was.content.findDiffEnd(now.content);
  if (start !== null) made.view.dispatch(made.state.tr.setSelection(TextSelection.near(now.resolve(Math.min(now.content.size, Math.max(start, end?.b ?? start))), -1)).scrollIntoView());
  return true;
};
const merged = (blocks: XmlFragment) => Extension.create({
  name: "liveDocument",
  addProseMirrorPlugins: () => [ySyncPlugin(blocks), yUndoPlugin(), lateSync()],
  addKeyboardShortcuts() { return { "Mod-z": () => step(this.editor, blocks.doc, undo), "Mod-y": () => step(this.editor, blocks.doc, redo), "Shift-Mod-z": () => step(this.editor, blocks.doc, redo) }; },
});

const textOf = (node: { text?: string; content?: unknown[] }): string => node.text ?? (node.content ?? []).map((child) => textOf(child as { text?: string })).join(" ");
/** Where a run of text is in a block (which starts at `from`), as positions in the document; null when the block no longer says it. */
const within = (block: Node, from: number, quote: string) => {
  const runs: { at: number; pos: number }[] = [];
  let text = "";
  block.descendants((node, pos) => { if (node.isText) { runs.push({ at: text.length, pos: from + 1 + pos }); text += node.text; } });
  const start = text.indexOf(quote), spot = (offset: number) => { const run = runs.findLast((candidate) => candidate.at <= offset)!; return run.pos + offset - run.at; };
  return start < 0 ? null : [spot(start), spot(start + quote.length - 1) + 1] as const;
};
const shown = new PluginKey<DecorationSet>("documentMarks");
/**
 * What is marked in the text, drawn as decorations so none of it is the document's: each comment `told.anchors` names (the quoted text where its
 * block still says it, else its blocks), each block in the document's changes, and a line where a changed block was deleted. `told.moved` hears
 * when any of it may have moved, and of a press on a comment's mark.
 */
const marked = (changes: YMap<Change>, told: { anchors: DocumentAnchor[]; moved: (pressed?: string) => void }) => {
  // The suggestion the caret is in shows what its blocks were, as a comment's change does while its card is open.
  const focusOf = (state: EditorState) => { const { $from } = state.selection, id = $from.depth ? $from.node(1).attrs.id : undefined, change = id ? changes.get(id) : undefined; return change && isSuggestion(change.for) ? change.for : undefined; };
  const build = (doc: Node, focus?: string) => {
    if (!told.anchors.length && !changes.size) return DecorationSet.empty;
    const found: Decoration[] = [], on = new Map<string, { keys: string[]; current: boolean; open: boolean }>(), at = new Map<string, { from: number; to: number; block: Node }>();
    doc.forEach((block, from) => { if (block.attrs.id) at.set(block.attrs.id, { from, to: from + block.nodeSize, block }); });
    for (const anchor of told.anchors) {
      const blocks = String(anchor.under?.blocks ?? "").split(" ").filter((id) => at.has(id)), first = at.get(blocks[0] ?? "");
      const run = first && anchor.quote && !anchor.resolved ? within(first.block, first.from, anchor.quote) : null;
      if (run) found.push(Decoration.inline(run[0], run[1], { class: documentMarkClass.comment, "data-comment": anchor.key, ...(anchor.current ? { "data-current": "" } : {}) }));
      // A comment about several blocks is found by its first; the rest are only marked.
      else blocks.forEach((id, nth) => { const had = on.get(id) ?? on.set(id, { keys: [], current: false, open: false }).get(id)!; if (!nth) had.keys.push(anchor.key); had.current ||= anchor.current; had.open ||= !anchor.resolved; });
    }
    for (const [id, block] of at) {
      const had = on.get(id), changed = changes.has(id);
      if (had || changed) found.push(Decoration.node(block.from, block.to, { class: [had?.open && documentMarkClass.commented, changed && documentMarkClass.changed].filter(Boolean).join(" "), ...(had?.keys.length ? { "data-comment": had.keys.join(" ") } : {}), ...(had?.current ? { "data-current": "" } : {}), ...(changed ? { "data-change": changes.get(id)!.for } : {}) }));
    }
    changes.forEach((change, id) => {
      // A block changed and still here shows what it was while its comment's card is open: the tint alone does not say what the agent took out.
      if (!change.before || (at.has(id) && change.for !== focus && !told.anchors.some((anchor) => anchor.current && anchor.key === change.for))) return;
      const line = () => { const element = Object.assign(document.createElement("div"), { className: documentMarkClass.removed, contentEditable: "false", textContent: textOf(change.before!) || "A block was removed" }); element.dataset.change = change.for; return element; };
      found.push(Decoration.widget(at.get(id)?.from ?? (change.after === null ? 0 : at.get(change.after ?? "")?.to ?? doc.content.size), line, { key: id, side: -1 }));
    });
    return DecorationSet.create(doc, found);
  };
  return Extension.create({
    name: "documentMarks",
    addProseMirrorPlugins: () => [new Plugin({
      key: shown,
      state: { init: (_, state) => build(state.doc, focusOf(state)), apply: (change, old, was, state) => change.docChanged || change.getMeta(shown) || focusOf(was) !== focusOf(state) ? build(change.doc, focusOf(state)) : old },
      props: {
        decorations: (state) => shown.getState(state),
        handleClick: (_view, _pos, event) => { const key = (event.target as Element).closest?.("[data-comment]")?.getAttribute("data-comment")?.split(" ")[0]; if (key) told.moved(key); return false; },
      },
      view: () => ({ update: (view, before) => { if (!before.doc.eq(view.state.doc) || shown.getState(before) !== shown.getState(view.state)) told.moved(); } }),
    })],
  });
};

/** An `@` typed at a word's start, and what follows it up to the caret (`from`..`to`, the `@` included). */
type Mention = Typed;
const mentioned = new PluginKey<Typing>("mention");
/** Who is asked, as `@` is typed (`typing`, typed.tsx). */
const mentioning = (anchor: HTMLElement, told: (at: Mention | null) => void, keys: (event: KeyboardEvent) => boolean) => typing("mention", mentioned, /(?<!\S)@((?:\S[^@]*)?)$/, anchor, told, keys);
/** The caret's top-level block, as it is drawn. */
const caretBlock = (view: EditorView) => { const { $from } = view.state.selection, block = $from.depth ? view.nodeDOM($from.before(1)) : null; if (!block) return null; const range = document.createRange(); range.selectNodeContents(block); return range; };

/** `bare`: in a pane, whose header is the document's bar; `onAway` then tells that header when the hub's copy is out of reach. `width`: how wide the
 *  text runs. `controls`: told what the editor offers the app round it (DocumentControls), once. */
export function DocumentEditor(props: { host: DocumentHost; id: string; name: string; actions?: JSX.Element; margin?: JSX.Element; marginEmpty?: boolean; bare?: boolean; onAway?: (away: boolean) => void; /** The hub refused this page as older than the paper: only a reload mends it. */ onStale?: (stale: boolean) => void; onReady?: () => void; marks?: (marks: DocumentMarks) => void;
  width?: DocumentWidth; controls?: (controls: DocumentControls) => void;
  /** `mentions`: who `@` offers; picked, the typed `@…` goes and `onMention` is told the caret's block and the name. */
  mentions?: () => string[]; onMention?: (about: Range, name: string, words: string) => void;
  /** `onComment`: the selection tools' Comment, told the text selected, and the block handle's, told the block. */
  onComment?: (about: Range) => void;
  /** `onRename`: the title renames the document; refused (rejected), it shows the name it had. Without it the title is plain text. `count`: a line under the text says how many blocks and words it holds. */
  onRename?: (name: string) => Promise<unknown> | void; count?: boolean }) {
  const copy = createLiveDocument(props.host, props.id);
  // The seats are drawn again when the hub tells them changed; the editor says how once it is made.
  let redrawSeats = () => {};
  createEffect(() => { copy.seats(); redrawSeats(); });
  const [column, setColumn] = createSignal<HTMLDivElement>(), [scroller, setScroller] = createSignal<HTMLDivElement>(), [editor, setEditor] = createSignal<Editor>();
  const [reflowed, setReflowed] = createSignal(0);
  const changes = copy.doc.getMap<Change>(CHANGES), [changed, setChanged] = createSignal<string[]>([]);
  const watching = new Set<(pressed?: string) => void>(), told = { anchors: [] as DocumentAnchor[], moved: (pressed?: string) => { for (const listener of watching) listener(pressed); } };
  const redraw = () => { const view = editor()?.view; if (view) view.dispatch(view.state.tr.setMeta(shown, true)); };
  // Redrawn after the merge has reached the editor, never inside it: a change to the editor made before then is written back to the document as it was, undoing what was merged.
  changes.observe(() => queueMicrotask(() => { setChanged([...changes.values()].map((change) => change.for)); redraw(); }));
  // The text reflows when its column changes width, with no change to the document.
  createEffect(() => { const element = column(); if (!element) return; const sized = new ResizeObserver(() => { told.moved(); setReflowed((n) => n + 1); }); sized.observe(element); onCleanup(() => sized.disconnect()); });
  const kind = readEditor(editor, "caret", kindAt);
  const anchor = document.createElement("span"), [asked, setAsked] = createSignal<Mention | null>(null, { equals: (a, b) => a?.from === b?.from && a?.query === b?.query }), [active, setActive] = createSignal(0);
  const offered = createMemo(() => { const at = asked(), query = at?.query.toLowerCase() ?? ""; return at ? (props.mentions?.() ?? []).filter((name) => name.toLowerCase().includes(query)) : []; });
  createEffect(() => { asked(); setActive(0); });
  const dismiss = () => { const view = editor()?.view; if (view && asked()) view.dispatch(view.state.tr.setMeta(mentioned, true)); };
  const pick = (name: string) => {
    const view = editor()?.view, at = asked();
    if (!view || !at) return;
    view.dispatch(view.state.tr.delete(at.from, at.to));
    const about = caretBlock(view);
    if (about) setAsking({ about, name });
  };
  // Picked, the one asked is told what to write in a field at the caret's block: a comment is about what is there, this asks for what is not.
  const [asking, setAsking] = createSignal<{ about: Range; name: string } | null>(null);
  // On an empty line the field stands in the line's own place; under a block with text, so the text it is about is read.
  const askedOf = () => { const at = asking()?.about.startContainer; if (!(at instanceof Element)) return undefined; const box = at.getBoundingClientRect(); return at.textContent ? box : new DOMRect(box.left, box.top, box.width, 0); };
  const ask = (words: string) => { const at = asking(); setAsking(null); if (at) props.onMention?.(at.about, at.name, words); editor()?.commands.focus(); };
  const keys = (event: KeyboardEvent) => menuKeys(event, offered(), active(), setActive, pick, dismiss);
  // Ready is the hub's copy drawn, or the hub not answering: never a page still waiting.
  createEffect(() => { if (editor() || copy.state() === "away" || copy.state() === "stale") props.onReady?.(); });
  // A page the hub refuses as older than the paper is read only: what is typed in it could never reach the paper.
  createEffect(() => editor()?.setEditable(copy.state() !== "stale"));
  // Set on the view, not in the options the editor is made from: a renamed paper keeps its editor (caret, undo, find).
  createEffect(() => editor()?.view.dom.setAttribute("aria-label", props.name));
  createEffect(() => props.onAway?.(copy.state() === "away"));
  createEffect(() => props.onStale?.(copy.state() === "stale"));
  // Made once, `active` read where it is drawn: a list made again at each change would have its buttons redrawn under the press (the editor changes as it loses focus to one).
  // An image is offered only where the host keeps them.
  const tools = DOCUMENT_BLOCKS.filter((offered) => (props.host.tools ?? DOCUMENT_BLOCKS).includes(offered) && (offered !== "image" || props.host.images)).map((name) => {
    const Icon = documentBlockIcons[name];
    return { name, label: KINDS[name].label, icon: () => <Icon />, get active() { return kind() === name; }, run: () => { const made = editor(); if (made && name === "image") pickImages(made, props.host); else if (made) KINDS[name].make(made.chain().focus()).run(); } };
  });
  const offers = { dates: tools.some((tool) => tool.name === "date"), images: tools.some((tool) => tool.name === "image") };
  const suggesting = createSuggesting(editor, copy.doc, changes, props.host, props.id);
  // How the reader writes, as one menu on the ribbon's edit set, where the host offers Suggesting.
  const writings = props.host.suggest ? (["editing", "suggesting"] as const).map((name) => { const Icon = documentWritingIcons[name]; return { name: `writing-${name}`, label: name === "editing" ? "Editing" : "Suggesting", icon: () => <Icon />, menu: "Writing", get active() { return suggesting.writing() === name; }, run: () => suggesting.setWriting(name) }; }) : [];
  const slash = createSlash(editor, tools), handle = createBlockHandle(editor, tools, { scroller, onComment: () => props.onComment, onAdded: slash.made }), find = createFind(editor, scroller);
  const counted = readEditor(editor, "doc", (made) => made?.state.doc);
  const count = createMemo(() => {
    if (!props.count) return null;
    const doc = counted();
    if (!doc) return null;
    let words = 0;
    // Counted once for each block and kept by the block: a keystroke makes one new block.
    doc.forEach((block) => { let had = wordsIn.get(block); if (had === undefined) wordsIn.set(block, had = block.textBetween(0, block.content.size, " ", " ").split(/\s+/).filter(Boolean).length); words += had; });
    const many = (n: number, what: string) => `${n.toLocaleString()} ${what}${n === 1 ? "" : "s"}`;
    return `${many(doc.childCount, "block")} · ${many(words, "word")}`;
  });
  // A new paper (one empty line, no properties) offers ways to start it under its hint, until it is first written in.
  const properties = copy.doc.getMap(PROPERTIES), [bare, setBare] = createSignal(properties.size === 0), [started, setStarted] = createSignal(false), [note, setNote] = createSignal<string>();
  const kept = () => setBare(properties.size === 0);
  properties.observe(kept);
  onCleanup(() => properties.unobserve(kept));
  // Read only until the paper is started: nothing after asks.
  const blank = createMemo(() => { if (started()) return false; const doc = counted(); return Boolean(doc && doc.childCount === 1 && doc.firstChild!.type.name === "paragraph" && !doc.firstChild!.content.size); });
  createEffect(() => { if (!started() && counted() && (!blank() || !bare())) setStarted(true); });
  const asker = () => props.onMention ? props.mentions?.()[0] : undefined;
  const paste = async () => {
    const made = editor();
    if (!made) return;
    const text = await navigator.clipboard?.readText?.().catch(() => "") ?? "";
    if (text.trim()) return void insertMarkdown(made, text);
    made.commands.focus("start");
    setNote(`Press ${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘V" : "Ctrl+V"} to paste: Markdown becomes blocks`);
  };
  const starts = createMemo(() => {
    const view = editor()?.view, first = view && blank() && !started() ? view.nodeDOM(0) as HTMLElement | null : null, body = column()?.parentElement;
    reflowed();
    return first && body ? first.getBoundingClientRect().bottom - body.getBoundingClientRect().top : undefined;
  });
  // The marks the selection wears, for a bar that is always there; the tools over a selection offer them too.
  const wears = readEditor(editor, "caret", (made) => MARKS.filter(([name]) => isOn(made, name)).map(([name]) => name).join(" "));
  const marking = readEditor(editor, "caret", (made): DocumentMarking => {
    const { selection } = made?.state ?? {}, block = selection?.$from.parent;
    return { can: Boolean(made?.isEditable && selection instanceof TextSelection && block?.isTextblock && !block.type.spec.code), on: Object.fromEntries(DOCUMENT_MARKS.map((name) => [name, Boolean(isOn(made, name))])) as DocumentMarking["on"] };
  }, sameJson);
  const worn = MARKS.filter(([name]) => !props.host.tools || props.host.tools.includes(name)).map(([name, label]) => { const Icon = documentToolIcons[name]; return { name, label, icon: () => <Icon />, get active() { return wears().includes(name); }, get pressed() { return marking().on[name]; }, get disabled() { return !marking().can; }, keys: MARK_KEYS[name], run: () => { editor()?.chain().focus().toggleMark(name).run(); } }; });
  // On the ribbon each inked mark is one menu of the inks and None, showing the one the selection wears.
  const inkOn = readEditor(editor, "caret", (made) => `${markAttrs(made, "color").ink ?? ""} ${markAttrs(made, "highlight").ink ?? ""}`);
  const inked = INKED.filter(([name]) => !props.host.tools || props.host.tools.includes(name)).flatMap(([name, menu, none, noun], nth) => [undefined, ...INKS].map((ink?: PaperInk) => ({
    name: `${name}-${ink ?? "none"}`, label: ink ? `${MARKUP_INKS[ink].label} ${noun}` : none, icon: () => { const Plain = documentToolIcons[name]; return ink ? inkSwatch(ink) : <Plain />; }, menu, compact: true,
    get active() { return inkOn().split(" ")[nth] === (ink ?? ""); }, get disabled() { return !marking().can; }, run: () => { const made = editor(); if (made) putInk(made.chain().focus(), name, ink); } })));
  // What can be taken back here is what was written here (the Yjs undo manager's stacks), read after each change.
  const manager = (made: Editor | undefined) => made ? yUndoPluginKey.getState(made.state)?.undoManager : undefined;
  const undoable = probeEditor(editor, (made) => Boolean(manager(made)?.undoStack.length)), redoable = probeEditor(editor, (made) => Boolean(manager(made)?.redoStack.length));
  const history = { undo: () => Boolean(editor() && step(editor()!, copy.doc, undo)), redo: () => Boolean(editor() && step(editor()!, copy.doc, redo)), canUndo: undoable, canRedo: redoable };
  // One list until a kind that is only put in comes or goes: a bar draws a row for each, and a new list would redraw them all.
  const listed = createMemo(() => [...tools.filter((tool) => (DOCUMENT_TURNABLE as readonly string[]).includes(tool.name) || tool.active).map((tool) => ({ ...tool, menu: "Block", get active() { return tool.active; } })), ...worn, ...inked, ...writings]);
  props.marks?.({
    subject: () => ({ kind: "document", name: props.name, document: props.id }),
    under: (box) => {
      const over = [...(column()?.querySelectorAll<HTMLElement>(".ProseMirror > [data-id]") ?? [])].filter((block) => { const at = block.getBoundingClientRect(); return at.bottom > box.top && at.top < box.top + box.height; });
      return over.length ? { blocks: over.map((block) => block.dataset.id).join(" "), text: over.map((block) => block.textContent ?? "").join("\n") } : null;
    },
    anchors: (list) => { told.anchors = list; redraw(); },
    place: (key) => {
      const boxes = [...(column()?.querySelectorAll(`[data-comment~="${CSS.escape(key)}"], [data-change="${CSS.escape(key)}"]`) ?? [])].map((mark) => mark.getBoundingClientRect());
      if (!boxes.length) return null;
      const left = Math.min(...boxes.map((box) => box.left)), top = Math.min(...boxes.map((box) => box.top));
      return { left, top, width: Math.max(...boxes.map((box) => box.right)) - left, height: Math.max(...boxes.map((box) => box.bottom)) - top };
    },
    watch: (listener) => { watching.add(listener); return () => watching.delete(listener); },
    changed: (key) => changed().includes(key),
    seats: copy.seats,
    suggestions: suggesting.suggestions, accept: suggesting.accept, reject: suggesting.reject,
    // A bar's block menu turns the caret's block into another kind: a kind that is only put in (a table, a divider) is listed while the caret is in one, to name it.
    tools: listed,
    marking, history,
    selection: () => {
      const view = editor()?.view;
      if (!view) return null;
      return view.state.selection.empty ? caretBlock(view) : selectedRange(view);
    },
  });
  // Read by what shows it (an open outline), so typing does not gather it.
  const outline = () => {
    const headings: DocumentHeading[] = [];
    counted()?.forEach((node) => { if (node.type.name === "heading" && node.attrs.id) headings.push({ id: node.attrs.id, level: node.attrs.level, text: node.textContent }); });
    return headings;
  };
  // The heading being read: the last whose top is above the top of the view, read again as it scrolls.
  const [scrolled, setScrolled] = createSignal(0);
  createEffect(() => { const element = scroller(); if (!element) return; const moved = () => setScrolled((n) => n + 1); element.addEventListener("scroll", moved, { passive: true }); onCleanup(() => element.removeEventListener("scroll", moved)); });
  // Read only by what shows it (an open outline): it measures every heading, which typing must not pay for.
  const current = () => {
    scrolled(); reflowed();
    const top = scroller()?.getBoundingClientRect().top, view = editor()?.view;
    if (top === undefined || !view) return undefined;
    return outline().findLast((heading) => { const at = blockById(view.state.doc, heading.id); return at !== null && (view.nodeDOM(at) as HTMLElement | null)?.getBoundingClientRect().top! <= top + 1; })?.id ?? outline()[0]?.id;
  };
  const reveal = (id: string) => {
    const view = editor()?.view, at = view ? blockById(view.state.doc, id) : null, block = at === null ? null : view!.nodeDOM(at) as HTMLElement | null;
    if (!block) return;
    block.scrollIntoView({ block: "center" });
    view!.dispatch(view!.state.tr.setMeta(revealed, id));
    block.addEventListener("animationend", () => { const now = editor()?.view; if (now && revealed.getState(now.state) === id) now.dispatch(now.state.tr.setMeta(revealed, null)); }, { once: true });
  };
  const away = createSeatsAway(editor, copy.seats, scroller);
  props.controls?.({
    openBlockMenu: handle.openMenu,
    moveBlock: (by) => { const view = editor()?.view, at = view ? caretBlockAt(view) : null; return at !== null && shiftBlock(view!, at, by); },
    outline, current, reveal, find: find.show,
  });
  return <>
  <DocumentSheet ref={setColumn} scroller={setScroller} width={props.width} find={find.view()} name={props.name} state={copy.state() === "away" ? "Reconnecting" : copy.state() === "stale" ? "Reload: this page is older than the paper" : undefined}
    edge={<Show when={away()}>{(seat) => <DocumentSeatJump label={seat().label} below={seat().below} ink={seat().ink} onJump={() => reveal(seat().block)} />}</Show>} margin={props.margin} marginEmpty={props.marginEmpty} actions={props.actions} bare={props.bare}
    head={<Show when={copy.synced()}><PaperHead doc={copy.doc} name={props.name} onRename={props.onRename} onDown={() => editor()?.commands.focus("start")} /></Show>}
    over={<>{handle.view}<TableTools editor={editor} body={() => column()?.parentElement ?? undefined} moved={reflowed} />
      <Show when={starts() !== undefined}><DocumentStarts top={starts()} note={note()}>
        <Show when={asker()}>{(name) => <Button variant="ghost" size="sm" onMouseDown={(event) => event.preventDefault()} onClick={() => editor()?.chain().focus("start").insertContent("@").run()}><Icons.Agent />Ask @{name()} to draft…</Button>}</Show>
        <Button variant="ghost" size="sm" onMouseDown={(event) => event.preventDefault()} onClick={() => void paste()}><Icons.Paste />Paste Markdown</Button>
      </DocumentStarts></Show></>} onHover={handle.hover} foot={<Show when={count()}>{(line) => <DocumentCount>{line()}</DocumentCount>}</Show>}>
    {/* The editor is made only once the hub's copy is held: made before, its first empty block would be merged in as a block of its own. */}
    <Show when={copy.synced() && column()}>{(element) => {
      // Untracked: a signal or prop read in what the editor is made from would make it again (caret, undo and find lost) each time it changed.
      const made = createTiptapEditor(() => { const at = element(); return untrack(() => ({ element: at, extensions: [...viewed(documentExtensions(), props.host), paperTyping(props.host, offers), merged(copy.doc.getXmlFragment(FRAGMENT)), marked(changes, told), suggesting.extension(), seatsDrawn(copy.seats, (redraw) => { redrawSeats = redraw; }), hinted(props.onMention ? "Write, / for blocks, @ to ask an agent" : "Write, / for blocks"), slash.extension(), blockKeys, drawn((block, name) => props.host.showMention?.(block, name)), find.extension(), ...(props.onMention ? [mentioning(anchor, setAsked, keys)] : [])], editorProps: { attributes: { class: documentTextClass, "aria-label": props.name, "data-own-keys": OWN_KEYS } } })); });
      createEffect(() => setEditor(made()));
      return null;
    }}</Show>
  </DocumentSheet>
    {/* Menus and tools beside the sheet, never in it: the sheet's column is the editor's to fill, and a child of it that comes and goes clears it. */}
    <Popover open={Boolean(asking())} onOpenChange={(open) => { if (!open) setAsking(null); }} anchorRect={askedOf} placement="bottom-start">
      <PopoverContent aria-label="Ask" snug onCloseAutoFocus={(event) => { event.preventDefault(); editor()?.commands.focus(); }}><Show when={asking()} keyed>{(at) => <DocumentAsk name={at.name} width={askedOf()?.width} onSend={ask} />}</Show></PopoverContent>
    </Popover>
    <TypedMenu label="Ask" anchor={anchor} items={offered()} name={(name) => name} active={active()} onCursor={setActive} onPick={pick} onDismiss={dismiss} />
    {slash.menu()}
    <SelectionTools editor={editor} bounds={scroller} marks={props.host.tools} onComment={props.onComment} />
  </>;
}
