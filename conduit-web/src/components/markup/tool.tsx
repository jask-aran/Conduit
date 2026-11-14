import { batch, createMemo, createResource, createSignal, For, Index, onCleanup, onMount, Show } from "solid-js";
import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import { Portal } from "solid-js/web";
import { drawingBox, MarkupBar, MarkupDrawing, MarkupLayer, MarkupMark, MarkupNote, MarkupNotes, MarkupText, markupInkColour, MARKUP_INKS, MARKUP_WEIGHT, type MarkupBox, type MarkupDrawingKind, type MarkupInk, type MarkupPoint, type MarkupShape, type MarkupToolKind, type MarkupWeight } from "@/components/ui/markup";
import { captureHeld, captureScreen, cropAreas, previewOf, type Capture } from "./capture";
import { MARKUP_CAPABILITIES, type MarkupHost, type MarkupListener, type MarkupSent, type MarkupThread } from "./host";
import { marginColumn } from "./margin";
import { createPieces } from "./pieces";

/** What a comment was made on: a screenshot of the page, or the live page. Its marks show on that one. */
type View = "screenshot" | "page";
/** `text`: words put on the page at its one point; `size`: what they measure, once written. */
type Drawing = { kind: MarkupDrawingKind | "text"; points: MarkupPoint[]; ink: MarkupInk; weight?: MarkupWeight; text?: string; size?: { width: number; height: number } };
/** A run of text selected on the live page: the range follows the page; `text` is what it said when chosen. */
type Quote = { range: Range; text: string };
/**
 * One comment. `reach`: how far a drag went past what it locked onto, each side (px); the dragged area is the pieces' box grown by it.
 * `drawings`: what was drawn for it, any number; `from`: where its pieces' box was when the last was drawn, so they follow the pieces on the live page.
 * `general`: about nothing on the page in particular. `whole`: the page's picture itself. Neither has elements or a mark.
 * `quote`: a run of text selected on the live page; `elements` is then the piece it is in.
 * `preview`: the picture a note shows of it. `sent`: its number in a live item it has gone to; it is then a thread, not to be changed.
 * `to`: the listener the surface asked it of (a paper's `@`).
 */
type Selection = { id: number; elements: Element[]; comment: string; on: View; reach?: MarkupBox; drawings?: Drawing[]; from?: { left: number; top: number }; quote?: Quote; general?: true; whole?: true; preview?: string; sent?: number; to?: string };
const GENERAL = "General note";
const WHOLE = "Screenshot";
type Tool = MarkupToolKind;
const DRAW_KEYS: Record<string, Tool> = { v: "select", q: "quote", p: "pen", h: "highlight", s: "shape", l: "shape", a: "shape", b: "shape", t: "text", e: "erase" };
const SHAPE_KEYS: Record<string, MarkupShape> = { l: "line", a: "arrow", b: "box" };
/** The tools that draw in an ink, each keeping its own: a highlighter is not the pen's colour or size. */
type Inked = "pen" | "highlight" | "shape" | "text";
const INKS = Object.keys(MARKUP_INKS) as MarkupInk[];
/** The eraser takes a drawing it comes this near (px). */
const ERASE_REACH = 8;
const DRAWN: Record<Drawing["kind"], string> = { pen: "Pen", highlight: "Highlight", line: "Line", arrow: "Arrow", box: "Box", text: "Text" };
/** What is kept of selected text (characters), and how many of its text nodes are marked. */
const QUOTE_CHARS = 1000;
const QUOTE_NODES = 400;
/** A pen's line keeps a point each time the pointer has gone this far (px); an item is sent at most this many. */
const PEN_STEP = 2;
const SENT_POINTS = 64;
const WAITING_EVERY_MS = 3000;
/** A shell that does not answer with its picture in this long is not waited for. */
const PICTURE_WAIT_MS = 2000;
const HAND_KEY = "ui-markup.hand";
const LIVE_KEY = "ui-markup.live";
type Waiter = MarkupListener;
/** Whether the tool's layer has the pointer, or the app under it. */
export type MarkupMode = "select" | "use";
type Mode = MarkupMode;
const DRAG_SLOP = 5;
const CROP_MARGIN = 24;
const NOTE_GAP = 10;

// What the app has taken off the page (a row it redrew) is marked where it last was, not at the corner a gone element measures as.
const lastRect = new WeakMap<Element, DOMRect>();
const rectOf = (element: Element) => {
  if (!element.isConnected) return lastRect.get(element) ?? element.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  lastRect.set(element, rect);
  return rect;
};
const around = (boxes: MarkupBox[]): MarkupBox => {
  const left = Math.min(...boxes.map((box) => box.left)), top = Math.min(...boxes.map((box) => box.top));
  return { left, top, width: Math.max(...boxes.map((box) => box.left + box.width)) - left, height: Math.max(...boxes.map((box) => box.top + box.height)) - top };
};
const boxOf = (elements: Element[]): MarkupBox => around(elements.map(rectOf));
const sameBox = (a: MarkupBox | null, b: MarkupBox | null) => a === b || Boolean(a && b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);
const ends = (drawing: Drawing) => [drawing.points[0]!, drawing.points[drawing.points.length - 1]!] as const;
const drawnBox = (drawing: Drawing): MarkupBox => drawing.kind === "text" ? { left: drawing.points[0]![0], top: drawing.points[0]![1], width: drawing.size?.width ?? 0, height: drawing.size?.height ?? 0 }
  : drawingBox(lined(drawing) ? drawing.points : ends(drawing));
/** Drawn through every point, not from its first to its last. */
const lined = (drawing: { kind: Drawing["kind"] }) => drawing.kind === "pen" || drawing.kind === "highlight";
const nearLine = (x: number, y: number, from: MarkupPoint, to: MarkupPoint) => {
  const dx = to[0] - from[0], dy = to[1] - from[1], along = dx || dy ? Math.max(0, Math.min(1, ((x - from[0]) * dx + (y - from[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(x - from[0] - along * dx, y - from[1] - along * dy) <= ERASE_REACH;
};
/** Whether a point is on a drawing: on a line, or in a box or in words. */
const touches = (drawing: Drawing, x: number, y: number) => {
  if (lined(drawing) || drawing.kind === "arrow" || drawing.kind === "line") { const line = lined(drawing) ? drawing.points : ends(drawing); return line.some((point, at) => nearLine(x, y, line[Math.max(0, at - 1)]!, point)); }
  const box = drawnBox(drawing);
  return x >= box.left - ERASE_REACH && x <= box.left + box.width + ERASE_REACH && y >= box.top - ERASE_REACH && y <= box.top + box.height + ERASE_REACH;
};
/** Where in the page's text a point is; the layer over it is let through for the hit test. */
const caretAt = (layer: HTMLElement, x: number, y: number): { node: Node; offset: number } | null => {
  layer.style.pointerEvents = "none";
  const at = document.caretPositionFromPoint?.(x, y), range = at ? null : document.caretRangeFromPoint?.(x, y);
  layer.style.pointerEvents = "";
  const node = at?.offsetNode ?? range?.startContainer, offset = at?.offset ?? range?.startOffset ?? 0;
  return node && !layer.contains(node) && !(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) ? { node, offset } : null;
};
/** From one caret to another, whichever comes first; null when they are in different documents or shadow roots. */
const rangeBetween = (a: { node: Node; offset: number }, b: { node: Node; offset: number }) => {
  try {
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    if (range.comparePoint(b.node, b.offset) < 0) range.setStart(b.node, b.offset); else range.setEnd(b.node, b.offset);
    return range;
  } catch { return null; }
};
/** A press with no drag takes the word it is on. */
const wordAt = (at: { node: Node; offset: number }) => {
  if (!(at.node instanceof Text)) return null;
  const text = at.node.data;
  let start = at.offset, end = at.offset;
  while (start > 0 && /\S/.test(text[start - 1]!)) start--;
  while (end < text.length && /\S/.test(text[end]!)) end++;
  return start < end ? rangeBetween({ node: at.node, offset: start }, { node: at.node, offset: end }) : null;
};
const quoted = (range: Range) => range.toString().replace(/\s+/g, " ").trim().slice(0, QUOTE_CHARS);
// The text's own lines, not the boxes of the elements it runs through (which a range's own rects include). Kept for when the app redraws the text away.
const lastLines = new WeakMap<Range, MarkupBox[]>();
const linesOf = (range: Range): MarkupBox[] => {
  const lines: MarkupBox[] = [];
  const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  let node: Node | null = range.startContainer instanceof Text ? range.startContainer : (walker.currentNode = range.startContainer, walker.nextNode());
  for (let count = 0; node && count < QUOTE_NODES; node = walker.nextNode(), count++) {
    if (range.comparePoint(node, 0) > 0) break;
    if (!range.intersectsNode(node)) continue;
    const part = document.createRange();
    part.selectNodeContents(node);
    if (node === range.startContainer) part.setStart(node, range.startOffset);
    if (node === range.endContainer) part.setEnd(node, range.endOffset);
    for (const rect of part.getClientRects()) if (rect.width && rect.height) lines.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  }
  if (lines.length) lastLines.set(range, lines);
  return lines.length ? lines : lastLines.get(range) ?? [];
};
const frames = (count: number) => new Promise<void>((resolve) => { const next = (left: number) => left ? requestAnimationFrame(() => next(left - 1)) : resolve(); next(count); });

/** `keys`: the chord that opens the tool, as the bar shows it. */
export function MarkupTool(props: { host: MarkupHost; mode: Mode; onMode: (mode: Mode) => void; onClose: () => void; keys?: () => string[] }) {
  const host = props.host, transport = host.transport;
  const { again, describe, nameOf, pieceRoot, piecesWithin, placeOf, sourceOf, under } = createPieces(host.names, host.anchors);
  const places = new WeakMap<Element, ReturnType<typeof placeOf>>();
  const placed = (elements: Element[]) => { for (const element of elements) if (!places.has(element)) places.set(element, placeOf(element)); return elements; };
  const [selections, setSelections] = createStore<Selection[]>([]);
  const [openId, setOpenId] = createSignal<number | null>(null);
  const [cursor, setCursor] = createSignal<Element | null>(null);
  const [marquee, setMarquee] = createSignal<MarkupBox | null>(null);
  // What this host offers; nothing else is reachable, by the bar or by a key.
  const can = { ...MARKUP_CAPABILITIES, ...host.capabilities };
  const offered = (tool: Tool | "note") => can.tools.includes(tool);
  const drawingTool = (["pen", "highlight", "shape", "text"] as const).find(offered);
  const [pointerTool, setPointerTool] = createSignal<Tool>(offered("select") ? "select" : drawingTool ?? "select");
  const [stroke, setStroke] = createSignal<{ kind: MarkupDrawingKind; points: MarkupPoint[] } | null>(null);
  const [looks, setLooks] = createStore<Record<Inked, { ink: MarkupInk; weight: MarkupWeight }>>({ pen: { ink: "plain", weight: MARKUP_WEIGHT.rest }, highlight: { ink: "amber", weight: MARKUP_WEIGHT.rest }, shape: { ink: "plain", weight: MARKUP_WEIGHT.rest }, text: { ink: "plain", weight: MARKUP_WEIGHT.rest } });
  const inkedTool = (): Inked => { const tool = pointerTool(); return tool === "highlight" || tool === "shape" || tool === "text" ? tool : "pen"; };
  const ink = () => looks[inkedTool()].ink, weight = () => looks[inkedTool()].weight;
  const setInk = (to: MarkupInk) => setLooks(inkedTool(), "ink", to), setWeight = (to: MarkupWeight) => setLooks(inkedTool(), "weight", to);
  const [shape, setShape] = createSignal<MarkupShape>("arrow");
  /** Text being selected: where the press was and where the pointer is now. */
  const [quoting, setQuoting] = createSignal<Range | null>(null);
  let quoteFrom: { node: Node; offset: number } | null = null;
  // An ink as the page resolves it, for a note's picture.
  const colours = new Map<MarkupInk, string>();
  const colourOf = (name: MarkupInk) => {
    if (!colours.has(name) && layer) { const probe = document.createElement("i"); probe.style.color = markupInkColour(name); layer.append(probe); colours.set(name, getComputedStyle(probe).color); probe.remove(); }
    return colours.get(name) ?? "";
  };
  // A drawing's line as the layer draws it (its width and see-through), for a note's picture.
  const lines = new Map<string, { width: number; opacity: number }>();
  const lineOf = (drawing: Drawing) => {
    const key = `${drawing.kind} ${drawing.weight ?? MARKUP_WEIGHT.rest}`;
    if (!lines.has(key) && layer) {
      const probe = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      probe.setAttribute("class", "ui-markup-drawing");
      probe.dataset.kind = drawing.kind;
      probe.style.setProperty("--markup-weight", `${drawing.weight ?? MARKUP_WEIGHT.rest}px`);
      layer.append(probe);
      const style = getComputedStyle(probe);
      lines.set(key, { width: parseFloat(style.strokeWidth) || 1, opacity: parseFloat(style.strokeOpacity) || 1 });
      probe.remove();
    }
    return lines.get(key);
  };
  const aimed = createMemo(() => { const drag = marquee(); return drag ? piecesWithin(drag) : []; });
  // A screen with no keyboard is not shown the chord.
  const touchOnly = matchMedia("(hover: none) and (pointer: coarse)").matches;
  // A phone's webview and browser have no display capture: there the item goes without a picture.
  const canCapture = Boolean(host.capturePage || navigator.mediaDevices?.getDisplayMedia);
  const screenshots = can.screenshot && canCapture;
  const capturePage = host.capturePage && (() => Promise.race([host.capturePage!(), new Promise<null>((resolve) => setTimeout(resolve, PICTURE_WAIT_MS, null))]));
  // A ribbon is on an artifact, which always has a thread to hand to: there the choice is not offered and handing is on.
  const [handing, setHand] = createSignal((() => { try { return localStorage.getItem(HAND_KEY) !== "off"; } catch { return true; } })());
  const hand = () => can.bar === "ribbon" || handing();
  const keepHand = (on: boolean) => { setHand(on); try { localStorage.setItem(HAND_KEY, on ? "on" : "off"); } catch { /* this session only */ } };
  // A failed ask keeps who was last heard of: "No listener" is only ever what the receiver answered.
  let heard: Waiter[] | undefined;
  const [waiters, { refetch: askWaiters }] = createResource(() => can.listeners ? transport.listening().then((all) => heard = all, () => heard) : [] as Waiter[]);
  const [agentName, setAgentName] = createSignal<string | null>(null);
  const agent = () => waiters.latest?.find((waiter) => waiter.name === agentName()) ?? waiters.latest?.[0] ?? null;
  const nextAgent = () => { const all = waiters.latest ?? []; setAgentName(all[(all.findIndex((waiter) => waiter.name === agent()?.name) + 1) % all.length]?.name ?? null); };
  /** Who a comment is for, whatever the bar hands to: a listener its words name with `@` (the longest that matches), else the one it was asked of. */
  const addressOf = (selection: Selection) => (waiters.latest ?? []).map((waiter) => waiter.name).sort((a, b) => b.length - a.length)
    .find((name) => new RegExp(`(?<!\\w)@${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w)`, "i").test(selection.comment)) ?? selection.to ?? null;
  const forWhom = (selection: Selection) => { const to = addressOf(selection); return to ? { label: `For ${to}` } : undefined; };
  const [sending, setSending] = createSignal(false);
  const [capturing, setCapturing] = createSignal(false);
  // The screenshot. Where taking one asks nothing (a shell that takes its own; a browser that was already asked on this page) it is taken
  // as the tool opens, so what does not last (a toast, an answer mid-stream) stays to be marked; elsewhere when Screenshot is first chosen.
  const [picture, setPicture] = createSignal<{ url: string; capture: Capture } | null>(null);
  const atOpen = screenshots && (Boolean(host.capturePage) || captureHeld());
  const [taking, setTaking] = createSignal(atOpen);
  /** Why there is no picture to be had, when there is none. */
  const [noPicture, setNoPicture] = createSignal<string | null>(canCapture ? null : "this client cannot capture its display");
  const [view, setView] = createSignal<View>("page");
  const [shooting, setShooting] = createSignal<View | null>(null);
  /** What is looked at: while the app is in use, the app. */
  const showing = (): View => shooting() ?? (props.mode === "use" ? "page" : view());
  const [barLift, setBarLift] = createSignal(0);
  // Once sent, the item is a thread: its comments stay up with what the agent answers, and the person writes back.
  // Each look at it is merged into what is held, so a comment's card stays the card it was (and its field keeps the words being written).
  const [held, setHeld] = createStore<{ item: MarkupThread | null }>({ item: null });
  const thread = () => held.item;
  const setThread = (next: MarkupThread | null) => {
    if (!next || held.item?.id !== next.id) return setHeld("item", next);
    const { comments, ...rest } = next;
    batch(() => { setHeld("item", rest); setHeld("item", "comments", reconcile(comments, { key: "n" })); });
  };
  /** The list of what was sent before is looked at, to pick one to come back to. */
  const [listing, setListing] = createSignal(false);
  const [replyTo, setReplyTo] = createSignal<number | null | undefined>(undefined);
  const [reply, setReply] = createSignal("");
  const answered = can.deliveries[0] !== "one-way";
  /** Sent comments are the tool's to show, in its corner; with a margin they leave the tool as they go. */
  const cornered = answered && can.sent === "corner";
  const offersLive = can.listeners && (can.deliveries as readonly string[]).includes("live");
  const [earlier, { refetch: askEarlier }] = createResource(() => cornered ? transport.threads().catch(() => [] as MarkupSent[]) : [] as MarkupSent[]);
  const unread = () => (earlier.latest ?? []).filter((item) => item.unread);
  let following: ReturnType<typeof setInterval> | undefined;
  /** `alone`: the thread is all there is to look at (a batch that was sent, or one come back to); a live item's is followed while more is marked. */
  const [alone, setAlone] = createSignal(false);
  const follow = (id: string, only: boolean) => {
    const ask = () => void transport.thread(id, true).then(setThread, () => {});
    clearInterval(following);
    ask();
    following = setInterval(ask, WAITING_EVERY_MS);
    if (only) { setListing(false); setAlone(true); props.onMode("use"); }
  };
  /** From a thread, or the list of them, back to marking up; the item stays in the list to be come back to. */
  const leave = () => {
    clearInterval(following);
    batch(() => { setThread(null); setAlone(false); setListing(false); setReplyTo(undefined); });
    props.onMode("select");
    void askEarlier();
  };
  const sentBefore = () => { const all = earlier.latest ?? [], one = unread()[0] ?? (all.length === 1 ? all[0] : undefined); if (one) return follow(one.id, true); setListing(true); props.onMode("use"); };
  // "Send now": a comment goes as it is Done, where the host offers that and a session is listening; the person's choice is kept. Otherwise it waits for Send.
  const [wantsLive, setWantsLive] = createSignal(offersLive && (() => { try { return localStorage.getItem(LIVE_KEY) !== "off"; } catch { return true; } })());
  const keepLive = (on: boolean) => { setWantsLive(on); try { localStorage.setItem(LIVE_KEY, on ? "on" : "off"); } catch { /* this session only */ } };
  const live = () => wantsLive() && Boolean(agent());
  const [lastSent, setLastSent] = createSignal(0);
  let posting: Promise<void> = Promise.resolve();
  const startReply = (n: number | null) => { openNote(null); setReply(""); setReplyTo(n); queueMicrotask(() => noteField?.focus({ preventScroll: true })); };
  onCleanup(() => clearInterval(following));
  const answer = async () => {
    const item = thread(), about = replyTo(), words = reply().trim();
    if (!item || about === undefined || !words) return;
    setReply("");
    await transport.say(item.id, about, words).then(setThread, (error) => host.notify("failed", `Not said: ${error instanceof Error ? error.message : String(error)}`));
  };
  const settle = (n: number, resolved: boolean) => { const item = thread(); if (resolved) setReplyTo(undefined); if (item) void transport.resolve(item.id, n, resolved).then(setThread, (error) => host.notify("failed", `Not ${resolved ? "resolved" : "reopened"}: ${error instanceof Error ? error.message : String(error)}`)); };
  const saidOf = (n: number | null) => (thread()?.messages ?? []).filter((message) => message.n === n).map((message) => ({ from: message.from, at: message.at, text: message.text ?? (message.resolved ? "Resolved" : "Reopened") }));
  /** Where a sent comment stands, for its card. */
  const stateOf = (n: number) => { const comment = thread()?.comments.find((candidate) => candidate.n === n), said = saidOf(n); return comment?.resolved ? { label: "Resolved" } : comment?.working ? { label: "Working on it", busy: true } : said[said.length - 1]?.from === "agent" ? { label: "Answered" } : { label: "Sent" }; };
  const resolvedOf = (n: number) => Boolean(thread()?.comments.find((comment) => comment.n === n)?.resolved);
  const standing = () => { const item = thread(); return !item ? "" : item.state === "handled" ? "Handled" : item.state === "taken" ? `${item.by ?? "A session"} is working on it` : item.by ? `Sent to ${item.by}` : "Saved: no session was listening"; };
  // Boxes are read once a frame: what is marked scrolls, resizes and animates under the marks.
  const [frame, setFrame] = createSignal(0);
  const [noteAt, setNoteAt] = createSignal<{ left: number; top: number } | null>(null);
  let layer: HTMLDivElement | undefined;
  let noteField: HTMLTextAreaElement | undefined;
  let textField: HTMLInputElement | undefined;
  let nextId = 1;
  let press: { x: number; y: number; shift: boolean } | null = null;
  let pointer = { x: -1, y: -1 };
  let widen = 0;

  // The mark: the hub keeps what it knows now, under an id the item is sent to.
  let marked = transport.mark(host.clientId()).catch(() => null);

  /** A screenshot has nothing under it to select: it is drawn and written on. */
  const onPage = (tool: Tool) => tool === "select" || tool === "quote";
  const show = (next: View) => { setView(next); if (next === "screenshot" && onPage(pointerTool()) && drawingTool) setPointerTool(drawingTool); };
  /** The bar's three: the app has the pointer, or the live page is annotated, or the screenshot is (taken now if there is none). */
  const look = (next: "use" | View) => {
    setCursor(null);
    setStroke(null);
    setQuoting(null);
    openNote(null);
    props.onMode(next === "use" ? "use" : "select");
    if (next === "screenshot" && !picture()) void take(true);
    else if (next !== "use") show(next);
  };
  /** The screenshot, with nothing of the tool in it; it is then what is looked at, and a comment of its own. */
  const take = async (go: boolean) => {
    if (!canCapture) return;
    setTaking(true);
    await frames(2);
    let capture: Capture | null = null;
    try { capture = await captureScreen(capturePage, false); setNoPicture(null); } catch (error) { setNoPicture(error instanceof Error ? error.message : String(error)); }
    const old = picture();
    if (old) URL.revokeObjectURL(old.url);
    setPicture(capture && { url: URL.createObjectURL(capture.blob), capture });
    if (capture) {
      if (go) show("screenshot");
      if (!selections.some((selection) => selection.whole)) setSelections((all) => [{ id: nextId++, elements: [], comment: "", on: "screenshot", whole: true }, ...all]);
    } else if (view() === "screenshot") setView("page");
    setTaking(false);
  };

  const select = () => props.mode === "select" && !sending() && !taking() && !alone();
  const open = () => selections.find((selection) => selection.id === openId()) ?? null;
  /** A comment about a place has its note beside the place while it is written; the others are written in the stack. */
  const floats = (selection: Selection | null) => Boolean(selection && !selection.general && !selection.whole);
  // Where sent comments stand in the host's margin, one written and not yet sent stands beside what it is about too, never in the corner.
  const inline = can.sent === "margin";
  const stands = (selection: Selection) => inline && floats(selection) && !selection.sent && selection.id !== openId();
  const [standsAt, setStandingAt] = createSignal<Record<number, { left: number; top: number; width?: number }>>({});
  /** Where the margin's column last put each, by id: read on the next frame. */
  const columned: Record<number, { left: number; top: number; width: number }> = {};
  const numbered = () => selections.filter((selection) => !selection.whole);
  // What has gone keeps the number it went under; the rest are numbered after.
  const unsent = () => numbered().filter((selection) => !selection.sent);
  const tagOf = (selection: Selection) => selection.whole ? "" : String(selection.sent ?? lastSent() + unsent().indexOf(selection) + 1);
  const openCard = (selection: Selection) => selection.sent ? startReply(selection.sent) : openNote(selection.id);
  // The margin's cards are not the tool's: they keep their own keys and presses.
  // A menu that stands open is heard before the tool: a press in it is its own, a press outside it or Escape shuts it and does nothing else.
  const MENUS = "[data-slot='ui-menu-content'], [data-slot='ui-menu-sub-content']";
  const own = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest(".ui-markup-note, .ui-markup-bar, .ui-markup-tag[data-press], .ui-markup-text[data-editable]")) && !target.closest(".ui-markup-margin");
  /** A comment about pieces as they are, not about what was drawn or text selected over them. */
  const ofPieces = (selection: Selection) => !selection.drawings && !selection.quote;
  const chosenBy = (element: Element) => selections.find((selection) => ofPieces(selection) && selection.on === showing() && selection.elements.includes(element)) ?? null;
  const linesNow = (quote: Quote) => { frame(); return linesOf(quote.range); };
  const box = (elements: Element[]) => { frame(); return boxOf(elements); };
  /** How far a comment's pieces have gone since it was drawn on the live page; a picture's do not move. */
  const shiftOf = (selection: Selection) => {
    frame();
    if (!selection.from || selection.on === "screenshot" || !selection.elements.every((element) => element.isConnected)) return { x: 0, y: 0 };
    const now = boxOf(selection.elements);
    return { x: now.left - selection.from.left, y: now.top - selection.from.top };
  };
  const extent = (selection: Selection): MarkupBox => {
    if (selection.quote) { const lines = linesNow(selection.quote); return lines.length ? around(lines) : boxOf(selection.elements); }
    if (!selection.drawings?.length) return boxOf(selection.elements);
    const drawn = around(selection.drawings.map(drawnBox)), shift = shiftOf(selection);
    return { ...drawn, left: drawn.left + shift.x, top: drawn.top + shift.y };
  };
  /** The part of the page a comment's own picture shows: its marks, what a drag went round, and a margin. */
  const areaOf = (selection: Selection): MarkupBox => {
    const marks = extent(selection), reach = selection.reach ?? { left: 0, top: 0, width: 0, height: 0 };
    const left = Math.max(0, Math.min(marks.left, marks.left - reach.left) - CROP_MARGIN), top = Math.max(0, Math.min(marks.top, marks.top - reach.top) - CROP_MARGIN);
    const right = Math.min(innerWidth, Math.max(marks.left + marks.width, marks.left - reach.left + marks.width + reach.width) + CROP_MARGIN), bottom = Math.min(innerHeight, Math.max(marks.top + marks.height, marks.top - reach.top + marks.height + reach.height) + CROP_MARGIN);
    return { left: Math.round(left), top: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
  };
  /** On a surface with a margin a quote is what its card is about, said in its own words: no number or piece name heads it. */
  const headOf = (selection: Selection) => !(inline && selection.quote);
  const titleOf = (selection: Selection) => selection.whole ? WHOLE : selection.general ? GENERAL : selection.quote ? `Text in ${nameOf(selection.elements)}`
    : selection.drawings ? (selection.drawings.length > 1 ? `${selection.drawings.length} drawings` : inline ? DRAWN[selection.drawings[0]!.kind] : `${DRAWN[selection.drawings[0]!.kind]} over ${nameOf(selection.elements)}`) : nameOf(selection.elements);

  const aim = () => {
    let target = pieceRoot(under(pointer.x, pointer.y));
    for (let step = 0; target && step < widen; step++) {
      const outer = pieceRoot(target.parentElement);
      if (!outer) { widen = step; break; }
      target = outer;
    }
    setCursor(target);
  };

  /** A comment made on the picture shows, shut, that part of the picture with its marks drawn in. */
  const preview = async (id: number) => {
    const selection = selections.find((candidate) => candidate.id === id), shot = picture();
    if (!selection || !shot || !layer || selection.on !== "screenshot" || !floats(selection)) return;
    const line = getComputedStyle(layer), type = getComputedStyle(layer.querySelector(".ui-markup-text") ?? layer);
    const blob = await previewOf(shot.capture, areaOf(selection), { outline: selection.drawings ? undefined : extent(selection), drawings: (selection.drawings ?? []).map((drawing) => ({ ...drawing, colour: colourOf(drawing.ink), ...lineOf(drawing) })) },
      { stroke: colourOf("plain"), width: parseFloat(line.strokeWidth) || 1, font: `${type.fontWeight} ${type.fontSize} ${type.fontFamily}` }).catch(() => null);
    if (blob) setSelections((candidate) => candidate.id === id, "preview", (old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
  };
  /** Opening another note, or none, is Done for the one that was open. */
  const openNote = (id: number | null) => {
    const was = openId();
    setNoteAt(null);
    setOpenId(id);
    if (was !== null && was !== id) void preview(was);
    if (id !== null) { setReplyTo(undefined); queueMicrotask(() => noteField?.focus({ preventScroll: true })); }
    // With "Send now", Done is Send for that comment, one at a time in the order they were finished.
    const done = live() && was !== null && was !== id ? selections.find((selection) => selection.id === was) : undefined;
    if (done && !done.sent && !done.whole && done.comment.trim()) posting = posting.then(() => send(done.id));
  };
  /** Selected text is a comment about the piece it is in. */
  const addQuote = (range: Range, to?: string, words?: string) => {
    const text = quoted(range);
    // Asked of someone in a block with no text yet (a paper's `@` on an empty line), it is a comment about that block.
    if (!text && !to) return;
    const holder = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const id = nextId++;
    keep(); setSelections(selections.length, { id, elements: placed([(text && pieceRoot(holder)) || holder || document.body]), comment: words ?? "", on: "page", ...(text && !words ? { quote: { range, text } } : {}), ...(to ? { to } : {}) });
    // Asked with its words (a paper's `@`): sent as it is, with no card to finish.
    if (words) posting = posting.then(() => send(id)); else openNote(id);
  };
  const add = (elements: Element[], drag?: MarkupBox) => {
    const id = nextId++;
    const held = boxOf(elements);
    const reach = drag && { left: held.left - drag.left, top: held.top - drag.top, width: drag.width - held.width, height: drag.height - held.height };
    keep(); setSelections(selections.length, { id, elements: placed(elements), comment: "", on: showing(), reach });
    openNote(id);
  };
  const piecesUnder = (drawing: Drawing): Element[] => {
    const head = ends(drawing)[1];
    const over = lined(drawing) ? drawing.points.map((point) => pieceRoot(under(point[0], point[1]))) : drawing.kind === "box" ? piecesWithin(drawnBox(drawing)) : [pieceRoot(under(head[0], head[1]))];
    // A piece that holds another of them (the list a line's rows are in) is only where the line passed between them.
    return [...new Set(over.filter((element): element is Element => Boolean(element)))].filter((element, _, all) => !all.some((other) => other !== element && element.contains(other)));
  };
  /** What was drawn joins the comment being written when that one is of drawings, so several make one comment; else it starts one. A drawing too small to see is a slip of the hand. */
  const draw = (drawing: Drawing): number | null => {
    const drawn = drawnBox(drawing);
    if (drawing.kind !== "text" && Math.hypot(drawn.width, drawn.height) <= DRAG_SLOP) return null;
    const over = piecesUnder(drawing), current = open();
    if (current?.drawings && current.on === showing()) {
      const shift = shiftOf(current), elements = placed([...new Set([...current.elements, ...over])]), from = boxOf(elements);
      keep();
      setSelections((candidate) => candidate.id === current.id, produce((draft) => {
        // What was drawn before is set down where it now shows, so all of it follows the pieces from here.
        for (const earlier of draft.drawings!) earlier.points = earlier.points.map((point) => [point[0] + shift.x, point[1] + shift.y] as const);
        draft.drawings!.push(drawing);
        draft.elements = elements;
        draft.from = { left: from.left, top: from.top };
      }));
      return current.id;
    }
    const elements = placed(over.length ? over : [under(drawn.left + drawn.width / 2, drawn.top + drawn.height / 2) ?? document.body]);
    const from = boxOf(elements), id = nextId++;
    keep(); setSelections(selections.length, { id, elements, comment: "", on: showing(), drawings: [drawing], from: { left: from.left, top: from.top } });
    return id;
  };
  // What Undo goes back to: the comments not yet sent, as they were before each change to what is marked. Their words are not part of it.
  const history: Selection[][] = [], undone: Selection[][] = [];
  const [undoable, setUndoable] = createSignal(0), [redoable, setRedoable] = createSignal(0);
  const fixed = (selection: Selection) => Boolean(selection.sent || selection.whole);
  const asNow = () => unwrap(selections).filter((selection) => !fixed(selection)).map((selection) => ({ ...selection, elements: [...selection.elements], drawings: selection.drawings?.map((drawing) => ({ ...drawing })), preview: undefined }));
  const counted = () => { setUndoable(history.length); setRedoable(undone.length); };
  /** Before a change: it can be gone back from, and what was undone before it can no longer be done again. */
  const keep = () => { history.push(asNow()); undone.length = 0; counted(); setMarkedLast(true); };
  /** Whether the last thing done was a mark, not the host's own (typing, or one of its tools): the bar's Undo and Redo step Markup's history then, else the host's (where it has one). */
  const [markedLast, setMarkedLast] = createSignal(false);
  const surface = host.history;
  const stepsOwn = (own: number, theirs?: () => boolean) => Boolean(own) && (markedLast() || !theirs?.());
  const undoAny = () => stepsOwn(undoable(), surface?.canUndo) ? undo() : void surface?.undo();
  const redoAny = () => stepsOwn(redoable(), surface?.canRedo) ? redo() : void surface?.redo();
  const remove = (id: number) => {
    keep();
    const preview = selections.find((selection) => selection.id === id)?.preview;
    if (preview) URL.revokeObjectURL(preview);
    setSelections((all) => all.filter((selection) => selection.id !== id));
    if (openId() === id) setOpenId(null);
  };
  // By its place: what the store hands back is not the same object it was given.
  const erase = (selection: Selection, at: number) => selection.drawings!.length === 1 ? remove(selection.id) : (keep(), setSelections((candidate) => candidate.id === selection.id, "drawings", (all) => all!.filter((_, kept) => kept !== at)));
  /** The eraser takes what it touches of what is drawn on what is looked at; a comment with nothing left drawn goes with it. */
  const eraseAt = (x: number, y: number) => {
    for (const selection of [...selections]) {
      if (!selection.drawings || selection.sent || selection.on !== showing()) continue;
      const shift = shiftOf(selection), hit = selection.drawings.findIndex((drawing) => touches(drawing, x - shift.x, y - shift.y));
      if (hit >= 0) erase(selection, hit);
    }
  };
  /** The last thing drawn for the comment being written, else the last comment. */
  /** Back to how the comments were, from one pile to the other: Undo from what was, Redo from what was undone. */
  const step = (from: Selection[][], to: Selection[][]) => {
    const back = from.pop();
    if (!back) return;
    to.push(asNow());
    counted();
    const now = unwrap(selections), words = new Map(now.map((selection) => [selection.id, selection.comment]));
    for (const selection of now) if (selection.preview && !fixed(selection)) URL.revokeObjectURL(selection.preview);
    // What has gone since stays gone to the agent as it went; what is written stays written.
    const stays = now.filter(fixed), gone = new Set(stays.map((selection) => selection.id));
    const again = back.filter((selection) => !gone.has(selection.id)).map((selection) => ({ ...selection, comment: words.get(selection.id) ?? selection.comment }));
    setSelections([...stays, ...again]);
    if (!selections.some((selection) => selection.id === openId())) { setOpenId(null); setNoteAt(null); }
    for (const selection of again) void preview(selection.id);
  };
  const undo = () => step(history, undone), redo = () => step(undone, history);
  /** Words left empty are not a drawing; a comment of nothing is not a comment. */
  const textDone = (id: number, at: number) => {
    const selection = selections.find((candidate) => candidate.id === id), drawing = selection?.drawings?.[at];
    if (!selection || !drawing || drawing.kind !== "text" || drawing.text?.trim()) return;
    erase(selection, at);
  };
  const toggleIn = (selection: Selection, element: Element) => (keep(), setSelections)((candidate) => candidate.id === selection.id, "elements", (elements) =>
    elements.includes(element) ? (elements.length > 1 ? elements.filter((kept) => kept !== element) : elements) : placed([...elements, element]));

  const choose = (shift: boolean) => {
    const target = cursor();
    if (!target) return openNote(null);
    const current = open();
    if (shift && current && ofPieces(current) && floats(current)) return toggleIn(current, target);
    const existing = chosenBy(target);
    if (existing) return openNote(existing.id);
    add([target]);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!select() || (own(event.target) && !press)) return;
    if (pointer.x !== event.clientX || pointer.y !== event.clientY) { if (under(event.clientX, event.clientY) !== under(pointer.x, pointer.y)) widen = 0; pointer = { x: event.clientX, y: event.clientY }; }
    const drawn = stroke();
    if (pointerTool() === "erase") { setCursor(null); if (press) eraseAt(event.clientX, event.clientY); }
    else if (pointerTool() === "quote") { const to = press && quoteFrom && layer && caretAt(layer, event.clientX, event.clientY); if (to) setQuoting(rangeBetween(quoteFrom!, to)); }
    else if (drawn) {
      const last = drawn.points[drawn.points.length - 1]!, here: MarkupPoint = [event.clientX, event.clientY];
      if (!lined(drawn)) setStroke({ kind: drawn.kind, points: [drawn.points[0]!, here] });
      else if (Math.hypot(here[0] - last[0], here[1] - last[1]) >= PEN_STEP) setStroke({ kind: drawn.kind, points: [...drawn.points, here] });
    } else if (pointerTool() !== "select") setCursor(null);
    else if (press && (marquee() || Math.hypot(event.clientX - press.x, event.clientY - press.y) > DRAG_SLOP)) {
      setCursor(null);
      setMarquee({ left: Math.min(press.x, event.clientX), top: Math.min(press.y, event.clientY), width: Math.abs(event.clientX - press.x), height: Math.abs(event.clientY - press.y) });
    } else aim();
  };
  /** Another general note; one still empty is opened instead. */
  const note = () => {
    const empty = selections.find((selection) => selection.general && !selection.comment.trim());
    if (empty) return openNote(empty.id);
    const id = nextId++;
    keep(); setSelections(selections.length, { id, elements: [], comment: "", on: "page", general: true });
    openNote(id);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!select() || own(event.target) || event.button !== 0) return;
    // A press off the ink picker shuts it, and does nothing else.
    // A finger arrives with no move before it: what it is on is found now.
    pointer = { x: event.clientX, y: event.clientY };
    const tool = pointerTool();
    if (tool === "text") {
      // Words go where the press was, written there.
      const id = draw({ kind: "text", points: [[event.clientX, event.clientY]], ink: ink(), text: "" });
      setNoteAt(null);
      setOpenId(id);
      return queueMicrotask(() => {
        textField?.focus({ preventScroll: true });
        // Its room is known before a word is written, so the comment's note stands clear of it.
        const size = textField && { width: textField.offsetWidth, height: textField.offsetHeight }, at = (open()?.drawings?.length ?? 0) - 1;
        if (size && at >= 0) setSelections((candidate) => candidate.id === id, "drawings", at, "size", size);
      });
    }
    if (tool === "erase") { setCursor(null); press = { x: event.clientX, y: event.clientY, shift: false }; return eraseAt(event.clientX, event.clientY); }
    if (tool === "quote") { setCursor(null); quoteFrom = layer ? caretAt(layer, event.clientX, event.clientY) : null; press = quoteFrom && { x: event.clientX, y: event.clientY, shift: false }; return; }
    if (tool === "select") aim();
    press = { x: event.clientX, y: event.clientY, shift: event.shiftKey };
    if (tool !== "select") { setCursor(null); setStroke({ kind: tool === "shape" ? shape() : tool, points: [[event.clientX, event.clientY]] }); }
  };
  const onPointerUp = () => {
    if (!press || !select()) return;
    if (pointerTool() === "erase") { press = null; return; }
    if (pointerTool() === "quote") {
      const range = quoting() ?? (quoteFrom && wordAt(quoteFrom));
      press = quoteFrom = null;
      setQuoting(null);
      if (range && !range.collapsed) addQuote(range);
      return;
    }
    const drawn = stroke();
    if (drawn) {
      press = null;
      setStroke(null);
      const id = draw({ ...drawn, ink: ink(), weight: weight() });
      if (id !== null && id !== openId()) openNote(id);
      return;
    }
    const drag = marquee();
    const shift = press.shift;
    const gathered = aimed();
    press = null;
    setMarquee(null);
    if (!drag) return choose(shift);
    const current = open();
    if (!gathered.length) return;
    if (shift && current && ofPieces(current) && floats(current)) { keep(); setSelections((candidate) => candidate.id === current.id, "elements", (elements) => placed([...new Set([...elements, ...gathered])])); }
    else add(gathered, drag);
  };
  /** A finger leaves no pointer behind to mark, and a press the system took over (a scroll, a call) chose nothing. */
  const onPointerGone = (event: PointerEvent) => {
    if (event.type === "pointercancel") { press = quoteFrom = null; setMarquee(null); setStroke(null); setQuoting(null); }
    if (event.pointerType !== "mouse") setCursor(null);
  };
  // Nothing under the layer is pressed, and nothing that listens for a press outside itself (a menu, a dialog) hears one.
  const swallow = (event: Event) => {
    // A drag that began on the page is the layer's to its end, over the tool's own note or bar too.
    if (!select() || (own(event.target) && !press)) return;
    if (!press && document.querySelector(MENUS)) return;
    event.stopImmediatePropagation();
    // Touch events are only kept from the app (its swipes would answer a drag); the pointer events they come with do the work.
    if (event.type.startsWith("touch")) return;
    if (event.type !== "pointermove" && event.type !== "wheel") event.preventDefault();
    if (event.type === "pointermove") onPointerMove(event as PointerEvent);
    else if (event.type === "pointerdown") onPointerDown(event as PointerEvent);
    else if (event.type === "pointerup") { onPointerUp(); onPointerGone(event as PointerEvent); }
    else if (event.type === "pointercancel") onPointerGone(event as PointerEvent);
    // The picture stays as it was: it would not follow a scroll.
    else if (event.type === "wheel" && showing() === "page") scrollUnder(event as WheelEvent);
  };
  const scrollUnder = (event: WheelEvent) => {
    for (let node = under(event.clientX, event.clientY); node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const y = /auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight, x = /auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
      if ((y && event.deltaY) || (x && event.deltaX)) { node.scrollBy({ left: x ? event.deltaX : 0, top: y ? event.deltaY : 0 }); return; }
    }
  };
  // Focus going into the tool's own note (or leaving something for it) is not focus leaving a menu or a dialog: neither hears of it, so neither shuts nor takes it back.
  const typed = (event: Event) => { if (!own(event.target)) setMarkedLast(false); };
  const quietFocus = (event: FocusEvent) => { if (own(event.type === "focusout" ? event.relatedTarget : event.target)) event.stopImmediatePropagation(); };

  const onKeyDown = (event: KeyboardEvent) => {
    if (sending()) return;
    // Not from a margin card's field, where Ctrl Enter is its Reply.
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && canSend() && !(event.target instanceof Element && event.target.closest(".ui-markup-margin"))) { event.preventDefault(); event.stopImmediatePropagation(); return void send(); }
    if (own(event.target) && (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)) {
      // The tool's own fields keep their keys; the app's shortcuts do not run on them.
      event.stopImmediatePropagation();
      if (event.target.closest(".ui-colour")) return;
      if (event.key !== "Escape" && (event.key !== "Enter" || event.shiftKey)) return;
      event.preventDefault();
      // Words on the page are followed by the comment about them; the comment's Enter is Done.
      if (event.target instanceof HTMLInputElement) noteField?.focus({ preventScroll: true });
      else if (replyTo() === undefined) openNote(null);
      else if (event.key === "Enter") void answer();
      else setReplyTo(undefined);
      return;
    }
    const handled = () => { event.preventDefault(); event.stopImmediatePropagation(); };
    if (select() && (event.ctrlKey || event.metaKey) && !event.altKey && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
      const again = event.shiftKey || event.key.toLowerCase() === "y";
      if (again ? redoable() : undoable()) { handled(); return again ? redo() : undo(); }
    }
    if (!select() || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.toLowerCase() === "n" && offered("note")) { handled(); return note(); }
    if (event.key.toLowerCase() === "c" && can.inks) { handled(); return void setInk(INKS[(INKS.indexOf(ink()) + 1) % INKS.length]!); }
    const picked = DRAW_KEYS[event.key.toLowerCase()];
    if (picked && offered(picked)) { handled(); setCursor(null); if (!onPage(picked) || view() === "page") setPointerTool(picked); const shaped = SHAPE_KEYS[event.key.toLowerCase()]; if (shaped) setShape(shaped); return; }
    if (event.key === "Escape" && document.querySelector(MENUS)) return;
    if (event.key === "Escape") { handled(); if (openId() !== null) openNote(null); else props.onClose(); }
    else if (event.key === "ArrowUp") { handled(); widen += 1; aim(); }
    else if (event.key === "ArrowDown") { handled(); widen = Math.max(0, widen - 1); aim(); }
    else if (event.key === "Enter") { handled(); choose(event.shiftKey); }
  };

  const POINTER_EVENTS = ["pointermove", "pointerdown", "pointerup", "pointercancel", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "wheel", "touchstart", "touchmove", "touchend", "touchcancel"] as const;
  onMount(() => {
    // The moment is kept in case it is wanted; the tool opens on the live page all the same.
    if (atOpen) void take(false);
    host.asks?.({ names: () => (waiters.latest ?? []).map((waiter) => waiter.name), ask: addQuote });
    onCleanup(() => host.asks?.(null));
    for (const type of POINTER_EVENTS) window.addEventListener(type, swallow, { capture: true, passive: false });
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("beforeinput", typed, { capture: true });
    for (const type of ["focusin", "focusout"] as const) window.addEventListener(type, quietFocus, { capture: true });
    // With nothing marked and no stack of notes, a frame after the first reads and places nothing: the tool stands open through all the typing in a paper.
    let rested = false, stacks: HTMLCollectionOf<Element> | undefined;
    let handle = requestAnimationFrame(function tick() {
      const none = !selections.length && !quoting() && !((stacks ??= layer?.getElementsByClassName("ui-markup-notes"))?.length);
      if (none && rested) { handle = requestAnimationFrame(tick); return; }
      rested = none;
      // Only marks read the frame: with none drawn, nothing is told a frame passed.
      if (selections.length || quoting()) setFrame((value) => value + 1);
      // What the app redrew is found again where it was.
      for (const selection of selections) selection.elements.forEach((element, at) => {
        if (element.isConnected) return;
        const place = places.get(element), found = place && again(place);
        if (!found || selection.elements.includes(found)) return;
        places.set(found, place);
        setSelections((candidate) => candidate.id === selection.id, "elements", at, found);
      });
      // The notes stand over the bar where the window has no room for both side by side.
      const notes = layer?.querySelector(".ui-markup-notes")?.getBoundingClientRect();
      const under = notes ? [...layer!.querySelectorAll(".ui-markup-bar")].map((rail) => rail.getBoundingClientRect()).filter((rail) => rail.right > notes.left) : [];
      const lift = under.length ? Math.max(...under.map((rail) => rail.bottom)) - Math.min(...under.map((rail) => rail.top)) : 0;
      if (lift !== barLift()) setBarLift(lift);
      // Those waiting to be sent: in the margin's column with the sent ones, as one, where the host has it beside the text; else at the edge of the piece each is about,
      // at the height of its marks, one under another where they would cross.
      if (inline) {
        let foot = 0, moved = false;
        const fallback: Record<number, { left: number; top: number }> = {}, column = marginColumn(host), keys = new Set<string>();
        for (const waiting of selections.filter(stands).map((one) => ({ one, marks: extent(one) })).sort((a, b) => a.marks.top - b.marks.top)) {
          const key = `unsent-${waiting.one.id}`, card = layer?.querySelector<HTMLElement>(`.ui-markup-note[data-key="${key}"]`), width = card?.offsetWidth ?? 0, height = card?.offsetHeight ?? 0, edge = boxOf(waiting.one.elements);
          const left = Math.max(NOTE_GAP, Math.min(edge.left + edge.width + NOTE_GAP, innerWidth - width - NOTE_GAP)), top = Math.max(waiting.marks.top, foot);
          fallback[waiting.one.id] = { left, top };
          foot = top + height + NOTE_GAP;
          if (!column) continue;
          keys.add(key);
          const was = column.waiting.get(key);
          if (was?.want !== waiting.marks.top || was.height !== height) { moved = true; column.waiting.set(key, { want: waiting.marks.top, height, at: (place) => { if (place) columned[waiting.one.id] = place; else delete columned[waiting.one.id]; } }); }
        }
        if (column) for (const key of column.waiting.keys()) if (!keys.has(key)) { column.waiting.delete(key); delete columned[+key.slice("unsent-".length)]; moved = true; }
        // Laid out now, so a card follows its place in the frame the place moves.
        if (moved) column?.lay();
        const next: Record<number, { left: number; top: number; width?: number }> = {};
        for (const id of Object.keys(fallback)) next[+id] = columned[+id] ?? fallback[+id]!;
        const now = standsAt(), ids = Object.keys(next);
        if (ids.length !== Object.keys(now).length || ids.some((id) => now[+id]?.left !== next[+id]!.left || now[+id]?.top !== next[+id]!.top || now[+id]?.width !== next[+id]!.width)) setStandingAt(next);
      }
      // The note being written sits beside what it is about: to its right, else its left, else under or over it.
      const selection = open(), note = layer?.querySelector<HTMLElement>(".ui-markup-note[data-float]");
      if (selection && note) {
        const marks = extent(selection), width = note.offsetWidth, height = note.offsetHeight;
        const fits = (left: number) => left >= NOTE_GAP && left + width <= innerWidth - NOTE_GAP;
        const right = marks.left + marks.width + NOTE_GAP, leftSide = marks.left - width - NOTE_GAP;
        const beside = fits(right) ? right : fits(leftSide) ? leftSide : null;
        const clampX = (value: number) => Math.max(NOTE_GAP, Math.min(value, innerWidth - width - NOTE_GAP)), clampY = (value: number) => Math.max(NOTE_GAP, Math.min(value, innerHeight - height - NOTE_GAP));
        const below = marks.top + marks.height + NOTE_GAP;
        const next = beside !== null ? { left: beside, top: clampY(marks.top) } : { left: clampX(marks.left), top: below + height <= innerHeight - NOTE_GAP ? below : clampY(marks.top - height - NOTE_GAP) };
        if (noteAt()?.left !== next.left || noteAt()?.top !== next.top) setNoteAt(next);
      }
      handle = requestAnimationFrame(tick);
    });
    onCleanup(() => cancelAnimationFrame(handle));
    const asking = setInterval(() => { if (can.listeners) void askWaiters(); if (cornered && (!thread() || listing())) void askEarlier(); }, WAITING_EVERY_MS);
    onCleanup(() => clearInterval(asking));
    // The bar is kept on the frame's foot by its insets from the window's edges (markup.css reads them). A frame can move
    // without changing size (a pane sliding in, two panes swapped), which no observer tells: it is looked at again when
    // any motion on the page ends, and each frame until it has held still for a while after the tool opens.
    const framed = host.frame?.();
    if (framed && layer) {
      let last = "", still = 0, settling = 0;
      const place = () => { const box = framed.getBoundingClientRect(), now = `${box.left}px ${innerWidth - box.right}px ${box.top}px`; if (now === last) return false; last = now; layer!.style.setProperty("--markup-frame-top", `${box.top}px`); layer!.style.setProperty("--markup-frame-left", `${box.left}px`); layer!.style.setProperty("--markup-frame-right", `${innerWidth - box.right}px`); return true; };
      const settle = () => { still = place() ? 0 : still + 1; settling = still < 30 ? requestAnimationFrame(settle) : 0; };
      const moved = () => { place(); if (!settling) { still = 0; settle(); } };
      const sized = new ResizeObserver(moved);
      sized.observe(framed);
      const ended = () => void place();
      window.addEventListener("resize", moved);
      for (const event of ["transitionend", "animationend"]) window.addEventListener(event, ended, true);
      settle();
      onCleanup(() => { sized.disconnect(); cancelAnimationFrame(settling); window.removeEventListener("resize", moved); for (const event of ["transitionend", "animationend"]) window.removeEventListener(event, ended, true); });
    }
  });
  onCleanup(() => {
    for (const type of POINTER_EVENTS) window.removeEventListener(type, swallow, { capture: true });
    window.removeEventListener("keydown", onKeyDown, { capture: true });
    window.removeEventListener("beforeinput", typed, { capture: true });
    const column = marginColumn(host);
    if (column) { column.waiting.clear(); column.lay(); }
    for (const type of ["focusin", "focusout"] as const) window.removeEventListener(type, quietFocus, { capture: true });
    for (const url of [picture()?.url, ...selections.map((selection) => selection.preview)]) if (url) URL.revokeObjectURL(url);
    if (!sent) void marked.then((mark) => mark && transport.drop(mark.id).catch(() => {}));
  });
  let sent = false;

  const canSend = () => selections.some((selection) => !selection.sent && selection.comment.trim());
  const status = createMemo(() => {
    if (props.mode === "use") return touchOnly || !props.keys?.().length ? "Using the app" : `Using the app (${props.keys().join(" ")})`;
    const does = pointerTool() === "select" ? "press or drag" : pointerTool() === "quote" ? "drag across text, or press a word" : pointerTool() === "text" ? "press to write" : pointerTool() === "erase" ? "rub a drawing out" : "drag to draw";
    return does[0]!.toUpperCase() + does.slice(1);
  });

  /** A handled item takes no more: what is marked next starts another, and the comments that went to the old one leave with it (it is in the list of what was sent). */
  const startAfresh = () => {
    clearInterval(following);
    batch(() => { setSelections(unwrap(selections).filter((selection) => !selection.sent)); setLastSent(0); setThread(null); setReplyTo(undefined); });
    marked = transport.mark(host.clientId()).catch(() => null);
  };
  /** Comments as one item to `mark`, numbered from `base`, with their pictures. */
  async function deliver(mark: string, listed: Selection[], whole: Selection | undefined, base: number, to: string | null, live: boolean) {
    const numberOf = (index: number) => base + index + 1;
    // What each comment is, read before any capture so the boxes are the ones in the pictures.
    const comments: Array<Record<string, unknown> & { area: MarkupBox | null; on?: View }> = listed.map((selection, index) => {
      if (selection.general) return { n: numberOf(index), comment: selection.comment.trim(), kind: "note" as const, name: GENERAL, area: null };
      const members = selection.elements.map(describe);
      const marks = extent(selection), shift = shiftOf(selection), under = host.under?.(marks);
      const drawings = selection.drawings?.map((drawing) => {
        const every = Math.max(1, Math.ceil(drawing.points.length / SENT_POINTS));
        return { kind: drawing.kind, colour: drawing.ink, ...(drawing.kind === "text" ? { text: drawing.text ?? "" } : { weight: drawing.weight ?? MARKUP_WEIGHT.rest }), points: drawing.points.filter((_, at) => at % every === 0 || at === drawing.points.length - 1).map((point) => [Math.round(point[0] + shift.x), Math.round(point[1] + shift.y)]) };
      });
      // The comment's own box is the last word on where it is: a piece the app took off the page measures as nothing.
      return { ...(members.length > 1 ? { members } : members[0]), n: numberOf(index), on: selection.on, ...(drawings ? { drawings } : {}), ...(selection.quote ? { quote: selection.quote.text } : {}), ...(under ? { under } : {}), dragged: Boolean(selection.reach), area: areaOf(selection), comment: selection.comment.trim(), kind: members.length > 1 ? "group" as const : "component" as const, name: titleOf(selection),
        rect: { left: Math.round(marks.left), top: Math.round(marks.top), width: Math.round(marks.width), height: Math.round(marks.height) } };
    });
    if (whole) comments.push({ n: base + comments.length + 1, comment: whole.comment.trim(), kind: "note", name: WHOLE, area: null });
    // A picture of each thing looked at that has marks on it: the page as it was, the page as it is. The first is the item's screenshot;
    // each comment's own picture is cut from the one it was made on. Words alone need none.
    const marksOn = (on: View) => comments.some((entry) => entry.on === on);
    const shot = picture();
    const views = ([shot && (marksOn("screenshot") || whole) ? "screenshot" : null, marksOn("page") && !noPicture() && (Boolean(host.capturePage) || captureHeld()) ? "page" : null] as const).filter((on): on is View => on !== null);
    let first: { capture: Capture; of: View } | null = null, captureError: string | null = null;
    for (const of of views) {
      let capture: Capture | null = of === "screenshot" && !marksOn("screenshot") ? shot!.capture : null;
      if (!capture) {
        setShooting(of);
        setCapturing(true);
        try { capture = await captureScreen(capturePage); } catch (error) { captureError = error instanceof Error ? error.message : String(error); }
        setCapturing(false);
        setShooting(null);
      }
      if (!capture) continue;
      if (!first) { first = { capture, of }; await transport.picture(mark, capture.blob); }
      for (const [index, blob] of (await cropAreas(capture, comments.map((entry) => entry.on === of ? entry.area : null))).entries()) if (blob) await transport.picture(mark, blob, numberOf(index));
    }
    // A host that has to ask what is under a mark (a site in its frame) answers later: only that is waited for, and before Send.
    for (const entry of comments) if (entry.under instanceof Promise) { const found: unknown = await entry.under.catch(() => null); if (found) entry.under = found; else delete entry.under; }
    const result = await transport.send(mark, {
      comments, live, subject: host.subject?.(), to,
      screenshot: first ? { width: first.capture.width, height: first.capture.height, surface: first.capture.surface, outlined: true, of: first.of } : { missing: views.length ? captureError ?? "capture failed" : marksOn("page") ? noPicture() ?? "not taken: Send does not ask the browser to share its tab" : "text only" },
      client: { id: host.clientId(), userAgent: navigator.userAgent, url: location.pathname + location.search, viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }, ...await host.client?.() },
    });
    const where = result.handed.to ? `Sent, and handed to ${result.handed.to.name}` : "Sent";
    return { result, count: comments.length, told: captureError ? `${where}, without a screenshot: ${captureError}` : where };
  }
  /** Sent comments the margin has from here, or that went as an item of their own: what Undo would bring back has gone with them. */
  const gone = (went: Selection[]) => {
    const ids = new Set(went.map((selection) => selection.id));
    setSelections((all) => all.filter((selection) => !ids.has(selection.id)));
    history.length = undone.length = 0; counted();
  };
  /** Every comment not yet sent; or the one that was just Done (`only`). What is sent in one sitting is one item, which grows; a comment for a listener of its own (`addressOf`) goes to that one, an item for each. */
  async function send(only?: number) {
    const one = only === undefined ? undefined : selections.find((selection) => selection.id === only);
    if (sending() || (only === undefined ? !canSend() : !one || Boolean(one.sent))) return;
    setSending(true);
    if (!one) openNote(null);
    setCursor(null);
    try {
      if (lastSent() && thread()?.state === "handled") startAfresh();
      const all = one ? [one] : unsent(), wholeOne = one ? undefined : selections.find((selection) => selection.whole && !selection.sent && selection.comment.trim());
      const addressed = new Map<string, Selection[]>();
      for (const selection of [...all, ...(wholeOne ? [wholeOne] : [])]) { const to = addressOf(selection); if (to) addressed.set(to, [...(addressed.get(to) ?? []), selection]); }
      for (const [to, group] of addressed) {
        const { told } = await deliver((await transport.mark(host.clientId())).id, group.filter((selection) => !selection.whole), group.find((selection) => selection.whole), 0, to, false);
        gone(group);
        if (cornered || !answered) host.notify("sent", told);
      }
      // Told now: what follows can fail, and these have gone.
      if (addressed.size && answered && !cornered) void host.sent?.();
      const named = new Set([...addressed.values()].flat()), listed = all.filter((selection) => !named.has(selection)), whole = wholeOne && !named.has(wholeOne) ? wholeOne : undefined;
      if (!listed.length && !whole) return answered ? cornered ? undefined : host.sent?.() : props.onClose();
      const mark = await marked ?? await transport.mark(host.clientId());
      const base = lastSent();
      const { result, count, told } = await deliver(mark.id, listed, whole, base, one || hand() ? agent()?.name ?? null : null, cornered);
      sent = true;
      if (answered && !cornered) {
        // The margin has them from here: each Send is an item of its own.
        gone([...listed, ...(whole ? [whole] : [])]);
        marked = transport.mark(host.clientId()).catch(() => null); sent = false;
        return host.sent?.();
      }
      // Each stays where it is, as a thread; the item's is followed while more is marked.
      batch(() => {
        listed.forEach((selection, index) => setSelections((candidate) => candidate.id === selection.id, "sent", base + index + 1));
        if (whole) setSelections((candidate) => candidate.id === whole.id, "sent", base + count);
        setLastSent(base + count);
      });
      if (!one || !answered) host.notify("sent", told);
      // One-way markup is done once it has gone.
      if (!answered) return props.onClose();
      if (!thread()) follow(result.id, false);
    } catch (error) {
      host.notify("failed", `Markup was not sent: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setCapturing(false);
      setShooting(null);
      setSending(false);
    }
  }

  const write = (selection: Selection) => (value: string) => setSelections((candidate) => candidate.id === selection.id, produce((draft) => { draft.comment = value; }));
  const sourceLine = (selection: Selection) => selection.whole ? "The whole page, as it was when this was taken." : selection.general ? "About nothing on the page in particular." : selection.quote ? `“${selection.quote.text}”` : selection.elements.length === 1 ? sourceOf(selection.elements[0]!) : undefined;

  return <Portal>
    <MarkupLayer ref={(element) => { layer = element; }} grounded={can.grounded} select={select()} text={pointerTool() === "quote" && showing() === "page"} frozen={showing() === "screenshot" ? picture()?.url : undefined} hidden={taking()}>
      <For each={selections}>{(selection) => <Show when={floats(selection) && selection.on === showing()}>
        <Show when={selection.drawings} fallback={<Show when={selection.quote} fallback={<MarkupMark kind={selection.to ? "asked" : "chosen"} box={box(selection.elements)} tag={selection.to ? undefined : tagOf(selection)} current={openId() === selection.id} onOpen={() => openCard(selection)} />}>{(quote) =>
          <Index each={linesNow(quote())}>{(line, at) => <MarkupMark kind={selection.to ? "asked" : "quote"} box={line()} tag={at || selection.to ? undefined : tagOf(selection)} current={openId() === selection.id} onOpen={at ? undefined : () => openCard(selection)} />}</Index>}</Show>}>{(drawings) => <>
          <For each={drawings()}>{(drawing, at) => drawing.kind === "text"
            ? <MarkupText ref={(element) => { textField = element; }} at={drawing.points[0]!} ink={drawing.ink} shift={shiftOf(selection)} value={drawing.text ?? ""} editable={openId() === selection.id}
                onInput={(value, element) => setSelections((candidate) => candidate.id === selection.id, "drawings", at(), produce((draft) => { draft.text = value; draft.size = { width: element.offsetWidth, height: element.offsetHeight }; }))} onDone={() => textDone(selection.id, at())} />
            : <MarkupDrawing kind={drawing.kind} points={drawing.points} ink={drawing.ink} weight={drawing.weight} shift={shiftOf(selection)} current={openId() === selection.id} />}</For>
          <MarkupMark kind="drawn" box={extent(selection)} tag={tagOf(selection)} onOpen={() => openCard(selection)} />
        </>}</Show>
        <Show when={ofPieces(selection) && selection.elements.length > 1}><For each={selection.elements}>{(element) => <MarkupMark kind="member" box={box([element])} />}</For></Show>
      </Show>}</For>
      <Show when={select() && cursor()} keyed>{(element) => <Show when={!sameBox(box([element]), open() && floats(open()) ? box(open()!.elements) : null)}><MarkupMark kind="cursor" box={box([element])} name={nameOf([element])} /></Show>}</Show>
      <Show when={stroke()}>{(drawn) => <MarkupDrawing kind={drawn().kind} points={drawn().points} ink={ink()} weight={weight()} current />}</Show>
      <Show when={quoting()}>{(range) => <Index each={(frame(), linesOf(range()))}>{(line) => <MarkupMark kind="quote" box={line()} />}</Index>}</Show>
      <Show when={marquee()}>{(drag) => <>
        <MarkupMark kind="marquee" box={drag()} />
        <Show when={aimed().length > 1}><For each={aimed()}>{(element) => <MarkupMark kind="member" box={box([element])} />}</For></Show>
        <Show when={aimed().length}><MarkupMark kind="cursor" box={box(aimed())} name={nameOf(aimed())} /></Show>
      </>}</Show>
      <Show when={listing()}>
        <MarkupNotes lift={barLift()}><For each={earlier.latest}>{(item) => <MarkupNote open={false} tag="" name={item.first || `${item.comments} comments`} onInput={() => {}} onOpen={() => follow(item.id, true)}
          value={`${item.unread ? `${item.unread} unread · ` : ""}${item.state === "handled" ? "Handled" : item.state === "taken" ? `${item.by ?? "A session"} is working on it` : item.by ? `Sent to ${item.by}` : "Saved"} · ${item.comments} ${item.comments === 1 ? "comment" : "comments"}`} />}</For></MarkupNotes>
        <MarkupBar thin={can.thin} thread onBack={leave} view="use" onView={() => {}} tool="select" onTool={() => {}} onNote={() => {}} status="Sent before" canSend={false} onSend={() => {}} onClose={props.onClose} />
      </Show>
      <Show when={alone() && thread()}>{(item) => <>
        <MarkupNotes lift={barLift()}>
          <Show when={saidOf(null).length || replyTo() === null}><MarkupNote ref={(element) => { noteField = element; }} open={replyTo() === null} tag="" name={item().by ?? "The item"} said={saidOf(null)} by={item().by ?? undefined} state={item().working ? { label: "Working on it", busy: true } : undefined} placeholder="Write back" value={reply()} onOpen={() => { setReply(""); setReplyTo(null); queueMicrotask(() => noteField?.focus()); }} onInput={setReply} onSay={() => void answer()} /></Show>
          <For each={item().comments}>{(comment) => <MarkupNote ref={(element) => { noteField = element; }} open={replyTo() === comment.n} tag={String(comment.n)} name={comment.name} words={comment.comment} said={saidOf(comment.n)} by={item().by ?? undefined} state={stateOf(comment.n)} placeholder="Write back" resolved={comment.resolved}
            value={reply()} onOpen={() => { setReply(""); setReplyTo(comment.n); queueMicrotask(() => noteField?.focus()); }} onInput={setReply} onSay={() => void answer()} onResolve={(resolved) => settle(comment.n, resolved)} />}</For>
        </MarkupNotes>
        <MarkupBar thin={can.thin} thread onBack={leave} view="use" onView={() => {}} tool="select" onTool={() => {}} onNote={() => {}} status={standing()} canSend={false} onSend={() => {}} onClose={props.onClose} />
      </>}</Show>
      <Show when={!capturing() && !alone() && !listing()}>
        <Show when={floats(open()) && open()} keyed>{(selection) =>
          <MarkupNote ref={(element) => { noteField = element; }} float={noteAt() ? { left: `${noteAt()!.left}px`, top: `${noteAt()!.top}px` } : { opacity: 0 }} open tag={headOf(selection) && !selection.to ? tagOf(selection) : ""} name={selection.to ? `Ask ${selection.to}` : headOf(selection) ? titleOf(selection) : ""} quote={selection.quote?.text} source={selection.to ? undefined : sourceLine(selection)} state={selection.to ? undefined : forWhom(selection)} placeholder={selection.to ? "What should it do?" : undefined}
            value={selection.comment} onOpen={() => {}} onInput={write(selection)} onDone={() => openNote(null)} onRemove={() => remove(selection.id)} sendNow={offersLive ? live() : undefined} onSendNow={agent() ? (on) => { keepLive(on); noteField?.focus({ preventScroll: true }); } : undefined} />}
        </Show>
        <For each={selections}>{(selection) => <Show when={stands(selection)}>
          <MarkupNote key={`unsent-${selection.id}`} float={standsAt()[selection.id] ? { left: `${standsAt()[selection.id]!.left}px`, top: `${standsAt()[selection.id]!.top}px`, width: standsAt()[selection.id]!.width === undefined ? undefined : `${standsAt()[selection.id]!.width}px` } : { opacity: 0 }} open={false} tag={headOf(selection) && !selection.to ? tagOf(selection) : ""} name={selection.to ? `Ask ${selection.to}` : headOf(selection) ? titleOf(selection) : ""} quote={selection.quote?.text} source={sourceLine(selection)}
            value={selection.comment} onOpen={() => openNote(selection.id)} onInput={write(selection)} onRemove={() => remove(selection.id)} state={forWhom(selection) ?? { label: "Not sent" }} />
        </Show>}</For>
        <Show when={selections.some((selection) => !stands(selection) && (!floats(selection) || selection.id !== openId()))}>
          <MarkupNotes lift={barLift()}><For each={selections}>{(selection) => <Show when={!stands(selection) && (!floats(selection) || selection.id !== openId())}>
            <Show when={selection.sent} fallback={<>
            <MarkupNote ref={(element) => { noteField = element; }} open={openId() === selection.id} tag={tagOf(selection)} name={titleOf(selection)} quote={selection.quote?.text} source={sourceLine(selection)} picture={selection.whole ? picture()?.url : selection.preview}
              value={selection.comment} onOpen={() => { if (floats(selection) && props.mode === "select") show(selection.on); openNote(selection.id); }} onInput={write(selection)} onRemove={() => remove(selection.id)} state={forWhom(selection) ?? (lastSent() || offersLive ? { label: "Not sent" } : undefined)} />
            </>}>{(n) => <MarkupNote ref={(element) => { noteField = element; }} open={replyTo() === n()} tag={tagOf(selection)} name={titleOf(selection)} picture={selection.preview} words={selection.comment} said={saidOf(n())} by={thread()?.by ?? undefined} state={stateOf(n())} placeholder="Write back"
              value={reply()} onOpen={() => startReply(n())} onInput={setReply} resolved={resolvedOf(n())} onSay={() => void answer()} onResolve={(resolved) => settle(n(), resolved)} />}</Show>
          </Show>}</For></MarkupNotes>
        </Show>
        <MarkupBar thin={can.thin} ribbon={can.bar === "ribbon"} own={host.tools?.()} onOwn={() => setMarkedLast(false)} onAsk={host.asking && offered("quote") ? () => { const range = host.asking!(); if (range) addQuote(range); } : undefined} view={props.mode === "use" ? "use" : view()} screenshots={screenshots} onView={look} tools={can.tools} tool={pointerTool()} onTool={(tool) => { if (props.mode === "use") look("page"); setCursor(null); setStroke(null); setQuoting(null); setPointerTool(tool); }} onNote={() => { if (props.mode === "use") look("page"); note(); }}
          status={status()} compact={touchOnly} onRetake={() => { openNote(null); void take(true); }} ink={ink()} onInk={can.inks ? setInk : undefined} weight={weight()} onWeight={can.inks ? setWeight : undefined} shape={shape()} onShape={setShape} onUndo={undoable() || surface?.canUndo() ? undoAny : undefined} onRedo={redoable() || surface?.canRedo() ? redoAny : undefined}
          replies={unread().reduce((sum, item) => sum + item.unread, 0)} sent={thread() ? 0 : earlier.latest?.length} onReplies={sentBefore}
          outstanding={unsent().filter((selection) => selection.comment.trim()).length} standing={thread() ? standing() : undefined}
          hand={hand()} onHand={can.listeners ? keepHand : undefined} agent={agent()?.name} heard={waiters.latest !== undefined} onNextAgent={(waiters.latest?.length ?? 0) > 1 ? nextAgent : undefined}
          canSend={canSend()} sending={sending()} onSend={() => void send()} onClose={props.onClose} />
      </Show>
    </MarkupLayer>
  </Portal>;
}
