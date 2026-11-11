import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { Portal } from "solid-js/web";
import { drawingBox, FeedbackBar, FeedbackDrawing, FeedbackLayer, FeedbackMark, FeedbackNote, FeedbackNotes, FeedbackText, FEEDBACK_INKS, type FeedbackBox, type FeedbackDrawingKind, type FeedbackInk, type FeedbackPoint, type FeedbackToolKind } from "@/components/ui/feedback";
import { captureHeld, captureScreen, cropAreas, previewOf, type Capture } from "./capture";
import type { FeedbackHost, FeedbackListener } from "./host";
import { createPieces } from "./pieces";

/** What a comment was made on: a screenshot of the page, or the live page. Its marks show on that one. */
type View = "screenshot" | "page";
/** `text`: words put on the page at its one point; `size`: what they measure, once written. */
type Drawing = { kind: FeedbackDrawingKind | "text"; points: FeedbackPoint[]; ink: FeedbackInk; text?: string; size?: { width: number; height: number } };
/**
 * One comment. `reach`: how far a drag went past what it locked onto, each side (px); the dragged area is the pieces' box grown by it.
 * `drawings`: what was drawn for it, any number; `from`: where its pieces' box was when the last was drawn, so they follow the pieces on the live page.
 * `general`: about nothing on the page in particular. `whole`: the page's picture itself. Neither has elements or a mark.
 * `preview`: the picture a note shows of it.
 */
type Selection = { id: number; elements: Element[]; comment: string; on: View; reach?: FeedbackBox; drawings?: Drawing[]; from?: { left: number; top: number }; general?: true; whole?: true; preview?: string };
const GENERAL = "General note";
const WHOLE = "Screenshot";
type Tool = FeedbackToolKind;
const DRAW_KEYS: Record<string, Tool> = { v: "select", p: "pen", a: "arrow", b: "box", t: "text", e: "erase" };
const INKS = Object.keys(FEEDBACK_INKS) as FeedbackInk[];
/** The eraser takes a drawing it comes this near (px). */
const ERASE_REACH = 8;
const DRAWN: Record<Drawing["kind"], string> = { pen: "Pen", arrow: "Arrow", box: "Box", text: "Text" };
/** A pen's line keeps a point each time the pointer has gone this far (px); an item is sent at most this many. */
const PEN_STEP = 2;
const SENT_POINTS = 64;
const WAITING_EVERY_MS = 3000;
/** A shell that does not answer with its picture in this long is not waited for. */
const PICTURE_WAIT_MS = 2000;
const HAND_KEY = "ui-feedback.hand";
type Waiter = FeedbackListener;
/** Whether the tool's layer has the pointer, or the app under it. */
export type FeedbackMode = "select" | "use";
type Mode = FeedbackMode;
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
const around = (boxes: FeedbackBox[]): FeedbackBox => {
  const left = Math.min(...boxes.map((box) => box.left)), top = Math.min(...boxes.map((box) => box.top));
  return { left, top, width: Math.max(...boxes.map((box) => box.left + box.width)) - left, height: Math.max(...boxes.map((box) => box.top + box.height)) - top };
};
const boxOf = (elements: Element[]): FeedbackBox => around(elements.map(rectOf));
const sameBox = (a: FeedbackBox | null, b: FeedbackBox | null) => a === b || Boolean(a && b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);
const ends = (drawing: Drawing) => [drawing.points[0]!, drawing.points[drawing.points.length - 1]!] as const;
const drawnBox = (drawing: Drawing): FeedbackBox => drawing.kind === "text" ? { left: drawing.points[0]![0], top: drawing.points[0]![1], width: drawing.size?.width ?? 0, height: drawing.size?.height ?? 0 }
  : drawingBox(drawing.kind === "pen" ? drawing.points : ends(drawing));
const nearLine = (x: number, y: number, from: FeedbackPoint, to: FeedbackPoint) => {
  const dx = to[0] - from[0], dy = to[1] - from[1], along = dx || dy ? Math.max(0, Math.min(1, ((x - from[0]) * dx + (y - from[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(x - from[0] - along * dx, y - from[1] - along * dy) <= ERASE_REACH;
};
/** Whether a point is on a drawing: on a line, or in a box or in words. */
const touches = (drawing: Drawing, x: number, y: number) => {
  if (drawing.kind === "pen" || drawing.kind === "arrow") { const line = drawing.kind === "pen" ? drawing.points : ends(drawing); return line.some((point, at) => nearLine(x, y, line[Math.max(0, at - 1)]!, point)); }
  const box = drawnBox(drawing);
  return x >= box.left - ERASE_REACH && x <= box.left + box.width + ERASE_REACH && y >= box.top - ERASE_REACH && y <= box.top + box.height + ERASE_REACH;
};
const frames = (count: number) => new Promise<void>((resolve) => { const next = (left: number) => left ? requestAnimationFrame(() => next(left - 1)) : resolve(); next(count); });

/** `keys`: the chord that opens the tool, as the bar shows it. */
export function FeedbackTool(props: { host: FeedbackHost; mode: Mode; onMode: (mode: Mode) => void; onClose: () => void; keys?: () => string[] }) {
  const host = props.host, transport = host.transport;
  const { again, describe, nameOf, pieceRoot, piecesWithin, placeOf, sourceOf, under } = createPieces(host.names, host.anchors);
  const places = new WeakMap<Element, ReturnType<typeof placeOf>>();
  const placed = (elements: Element[]) => { for (const element of elements) if (!places.has(element)) places.set(element, placeOf(element)); return elements; };
  const [selections, setSelections] = createStore<Selection[]>([]);
  const [openId, setOpenId] = createSignal<number | null>(null);
  const [cursor, setCursor] = createSignal<Element | null>(null);
  const [marquee, setMarquee] = createSignal<FeedbackBox | null>(null);
  const [pointerTool, setPointerTool] = createSignal<Tool>("select");
  const [stroke, setStroke] = createSignal<{ kind: FeedbackDrawingKind; points: FeedbackPoint[] } | null>(null);
  const [ink, setInk] = createSignal<FeedbackInk>("plain");
  // An ink as the page resolves it, for a note's picture.
  const colours = new Map<FeedbackInk, string>();
  const colourOf = (name: FeedbackInk) => {
    if (!colours.has(name) && layer) { const probe = document.createElement("i"); probe.style.color = FEEDBACK_INKS[name].colour; layer.append(probe); colours.set(name, getComputedStyle(probe).color); probe.remove(); }
    return colours.get(name) ?? "";
  };
  const aimed = createMemo(() => { const drag = marquee(); return drag ? piecesWithin(drag) : []; });
  // A screen with no keyboard is not shown the chord.
  const touchOnly = matchMedia("(hover: none) and (pointer: coarse)").matches;
  // A phone's webview and browser have no display capture: there the item goes without a picture.
  const canCapture = Boolean(host.capturePage || navigator.mediaDevices?.getDisplayMedia);
  const capturePage = host.capturePage && (() => Promise.race([host.capturePage!(), new Promise<null>((resolve) => setTimeout(resolve, PICTURE_WAIT_MS, null))]));
  const [hand, setHand] = createSignal((() => { try { return localStorage.getItem(HAND_KEY) !== "off"; } catch { return true; } })());
  const keepHand = (on: boolean) => { setHand(on); try { localStorage.setItem(HAND_KEY, on ? "on" : "off"); } catch { /* this session only */ } };
  const [waiters, { refetch: askWaiters }] = createResource(() => transport.listening().catch(() => [] as Waiter[]));
  const [agentName, setAgentName] = createSignal<string | null>(null);
  const agent = () => waiters.latest?.find((waiter) => waiter.name === agentName()) ?? waiters.latest?.[0] ?? null;
  const nextAgent = () => { const all = waiters.latest ?? []; setAgentName(all[(all.findIndex((waiter) => waiter.name === agent()?.name) + 1) % all.length]?.name ?? null); };
  const [sending, setSending] = createSignal(false);
  const [capturing, setCapturing] = createSignal(false);
  // The screenshot. Where taking one asks nothing (a shell that takes its own; a browser that was already asked on this page) it is taken
  // as the tool opens, so what does not last (a toast, an answer mid-stream) stays to be marked; elsewhere when Screenshot is first chosen.
  const [picture, setPicture] = createSignal<{ url: string; capture: Capture } | null>(null);
  const atOpen = Boolean(host.capturePage) || captureHeld();
  const [taking, setTaking] = createSignal(atOpen);
  /** Why there is no picture to be had, when there is none. */
  const [noPicture, setNoPicture] = createSignal<string | null>(canCapture ? null : "this client cannot capture its display");
  const [view, setView] = createSignal<View>("page");
  const [shooting, setShooting] = createSignal<View | null>(null);
  /** What is looked at: while the app is in use, the app. */
  const showing = (): View => shooting() ?? (props.mode === "use" ? "page" : view());
  const [barLift, setBarLift] = createSignal(0);
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
  const marked = transport.mark(host.clientId()).catch(() => null);

  /** A screenshot has nothing under it to select: it is drawn and written on. */
  const show = (next: View) => { setView(next); if (next === "screenshot" && pointerTool() === "select") setPointerTool("pen"); };
  /** The bar's three: the app has the pointer, or the live page is annotated, or the screenshot is (taken now if there is none). */
  const look = (next: "use" | View) => {
    setCursor(null);
    setStroke(null);
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

  const select = () => props.mode === "select" && !sending() && !taking();
  const open = () => selections.find((selection) => selection.id === openId()) ?? null;
  /** A comment about a place has its note beside the place while it is written; the others are written in the stack. */
  const floats = (selection: Selection | null) => Boolean(selection && !selection.general && !selection.whole);
  const numbered = () => selections.filter((selection) => !selection.whole);
  const tagOf = (selection: Selection) => selection.whole ? "" : String(numbered().indexOf(selection) + 1);
  const own = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest(".ui-feedback-note, .ui-feedback-bar, .ui-feedback-tag[data-press], .ui-feedback-text[data-editable]"));
  const chosenBy = (element: Element) => selections.find((selection) => !selection.drawings && selection.on === showing() && selection.elements.includes(element)) ?? null;
  const box = (elements: Element[]) => { frame(); return boxOf(elements); };
  /** How far a comment's pieces have gone since it was drawn on the live page; a picture's do not move. */
  const shiftOf = (selection: Selection) => {
    frame();
    if (!selection.from || selection.on === "screenshot" || !selection.elements.every((element) => element.isConnected)) return { x: 0, y: 0 };
    const now = boxOf(selection.elements);
    return { x: now.left - selection.from.left, y: now.top - selection.from.top };
  };
  const extent = (selection: Selection): FeedbackBox => {
    if (!selection.drawings?.length) return boxOf(selection.elements);
    const drawn = around(selection.drawings.map(drawnBox)), shift = shiftOf(selection);
    return { ...drawn, left: drawn.left + shift.x, top: drawn.top + shift.y };
  };
  /** The part of the page a comment's own picture shows: its marks, what a drag went round, and a margin. */
  const areaOf = (selection: Selection): FeedbackBox => {
    const marks = extent(selection), reach = selection.reach ?? { left: 0, top: 0, width: 0, height: 0 };
    const left = Math.max(0, Math.min(marks.left, marks.left - reach.left) - CROP_MARGIN), top = Math.max(0, Math.min(marks.top, marks.top - reach.top) - CROP_MARGIN);
    const right = Math.min(innerWidth, Math.max(marks.left + marks.width, marks.left - reach.left + marks.width + reach.width) + CROP_MARGIN), bottom = Math.min(innerHeight, Math.max(marks.top + marks.height, marks.top - reach.top + marks.height + reach.height) + CROP_MARGIN);
    return { left: Math.round(left), top: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
  };
  const titleOf = (selection: Selection) => selection.whole ? WHOLE : selection.general ? GENERAL
    : selection.drawings ? (selection.drawings.length > 1 ? `${selection.drawings.length} drawings` : `${DRAWN[selection.drawings[0]!.kind]} over ${nameOf(selection.elements)}`) : nameOf(selection.elements);

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
    const line = getComputedStyle(layer), type = getComputedStyle(layer.querySelector(".ui-feedback-text") ?? layer);
    const blob = await previewOf(shot.capture, areaOf(selection), { outline: selection.drawings ? undefined : extent(selection), drawings: (selection.drawings ?? []).map((drawing) => ({ ...drawing, colour: colourOf(drawing.ink) })) },
      { stroke: colourOf("plain"), width: parseFloat(line.strokeWidth) || 1, font: `${type.fontWeight} ${type.fontSize} ${type.fontFamily}` }).catch(() => null);
    if (blob) setSelections((candidate) => candidate.id === id, "preview", (old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
  };
  /** Opening another note, or none, is Done for the one that was open. */
  const openNote = (id: number | null) => {
    const was = openId();
    setNoteAt(null);
    setOpenId(id);
    if (was !== null && was !== id) void preview(was);
    if (id !== null) queueMicrotask(() => noteField?.focus({ preventScroll: true }));
  };
  const add = (elements: Element[], drag?: FeedbackBox) => {
    const id = nextId++;
    const held = boxOf(elements);
    const reach = drag && { left: held.left - drag.left, top: held.top - drag.top, width: drag.width - held.width, height: drag.height - held.height };
    setSelections(selections.length, { id, elements: placed(elements), comment: "", on: showing(), reach });
    openNote(id);
  };
  const piecesUnder = (drawing: Drawing): Element[] => {
    const head = ends(drawing)[1];
    const over = drawing.kind === "pen" ? drawing.points.map((point) => pieceRoot(under(point[0], point[1]))) : drawing.kind === "box" ? piecesWithin(drawnBox(drawing)) : [pieceRoot(under(head[0], head[1]))];
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
    setSelections(selections.length, { id, elements, comment: "", on: showing(), drawings: [drawing], from: { left: from.left, top: from.top } });
    return id;
  };
  const remove = (id: number) => {
    const preview = selections.find((selection) => selection.id === id)?.preview;
    if (preview) URL.revokeObjectURL(preview);
    setSelections((all) => all.filter((selection) => selection.id !== id));
    if (openId() === id) setOpenId(null);
  };
  // By its place: what the store hands back is not the same object it was given.
  const erase = (selection: Selection, at: number) => selection.drawings!.length === 1 ? remove(selection.id) : setSelections((candidate) => candidate.id === selection.id, "drawings", (all) => all!.filter((_, kept) => kept !== at));
  /** The eraser takes what it touches of what is drawn on what is looked at; a comment with nothing left drawn goes with it. */
  const eraseAt = (x: number, y: number) => {
    for (const selection of [...selections]) {
      if (!selection.drawings || selection.on !== showing()) continue;
      const shift = shiftOf(selection), hit = selection.drawings.findIndex((drawing) => touches(drawing, x - shift.x, y - shift.y));
      if (hit >= 0) erase(selection, hit);
    }
  };
  /** The last thing drawn for the comment being written, else the last comment. */
  const undo = () => {
    const current = open(), last = numbered()[numbered().length - 1];
    if (current?.drawings) erase(current, current.drawings.length - 1);
    else if (last) remove(last.id);
  };
  /** Words left empty are not a drawing; a comment of nothing is not a comment. */
  const textDone = (id: number, at: number) => {
    const selection = selections.find((candidate) => candidate.id === id), drawing = selection?.drawings?.[at];
    if (!selection || !drawing || drawing.kind !== "text" || drawing.text?.trim()) return;
    erase(selection, at);
  };
  const toggleIn = (selection: Selection, element: Element) => setSelections((candidate) => candidate.id === selection.id, "elements", (elements) =>
    elements.includes(element) ? (elements.length > 1 ? elements.filter((kept) => kept !== element) : elements) : placed([...elements, element]));

  const choose = (shift: boolean) => {
    const target = cursor();
    if (!target) return openNote(null);
    const current = open();
    if (shift && current && !current.drawings && floats(current)) return toggleIn(current, target);
    const existing = chosenBy(target);
    if (existing) return openNote(existing.id);
    add([target]);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!select() || (own(event.target) && !press)) return;
    if (pointer.x !== event.clientX || pointer.y !== event.clientY) { if (under(event.clientX, event.clientY) !== under(pointer.x, pointer.y)) widen = 0; pointer = { x: event.clientX, y: event.clientY }; }
    const drawn = stroke();
    if (pointerTool() === "erase") { setCursor(null); if (press) eraseAt(event.clientX, event.clientY); }
    else if (drawn) {
      const last = drawn.points[drawn.points.length - 1]!, here: FeedbackPoint = [event.clientX, event.clientY];
      if (drawn.kind !== "pen") setStroke({ kind: drawn.kind, points: [drawn.points[0]!, here] });
      else if (Math.hypot(here[0] - last[0], here[1] - last[1]) >= PEN_STEP) setStroke({ kind: "pen", points: [...drawn.points, here] });
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
    setSelections(selections.length, { id, elements: [], comment: "", on: "page", general: true });
    openNote(id);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!select() || own(event.target) || event.button !== 0) return;
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
    if (tool === "select") aim();
    press = { x: event.clientX, y: event.clientY, shift: event.shiftKey };
    if (tool !== "select") { setCursor(null); setStroke({ kind: tool, points: [[event.clientX, event.clientY]] }); }
  };
  const onPointerUp = () => {
    if (!press || !select()) return;
    if (pointerTool() === "erase") { press = null; return; }
    const drawn = stroke();
    if (drawn) {
      press = null;
      setStroke(null);
      const id = draw({ ...drawn, ink: ink() });
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
    if (shift && current && !current.drawings && floats(current)) setSelections((candidate) => candidate.id === current.id, "elements", (elements) => placed([...new Set([...elements, ...gathered])]));
    else add(gathered, drag);
  };
  /** A finger leaves no pointer behind to mark, and a press the system took over (a scroll, a call) chose nothing. */
  const onPointerGone = (event: PointerEvent) => {
    if (event.type === "pointercancel") { press = null; setMarquee(null); setStroke(null); }
    if (event.pointerType !== "mouse") setCursor(null);
  };
  // Nothing under the layer is pressed, and nothing that listens for a press outside itself (a menu, a dialog) hears one.
  const swallow = (event: Event) => {
    // A drag that began on the page is the layer's to its end, over the tool's own note or bar too.
    if (!select() || (own(event.target) && !press)) return;
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
  const quietFocus = (event: FocusEvent) => { if (own(event.type === "focusout" ? event.relatedTarget : event.target)) event.stopImmediatePropagation(); };

  const onKeyDown = (event: KeyboardEvent) => {
    if (sending()) return;
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && canSend()) { event.preventDefault(); event.stopImmediatePropagation(); return void send(); }
    if (own(event.target) && (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)) {
      // The tool's own fields keep their keys; the app's shortcuts do not run on them.
      event.stopImmediatePropagation();
      if (event.key !== "Escape" && (event.key !== "Enter" || event.shiftKey)) return;
      event.preventDefault();
      // Words on the page are followed by the comment about them; the comment's Enter is Done.
      if (event.target instanceof HTMLInputElement) noteField?.focus({ preventScroll: true }); else openNote(null);
      return;
    }
    const handled = () => { event.preventDefault(); event.stopImmediatePropagation(); };
    if (select() && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z" && numbered().length) { handled(); return undo(); }
    if (!select() || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.toLowerCase() === "n") { handled(); return note(); }
    if (event.key.toLowerCase() === "c") { handled(); return void setInk(INKS[(INKS.indexOf(ink()) + 1) % INKS.length]!); }
    const picked = DRAW_KEYS[event.key.toLowerCase()];
    if (picked) { handled(); setCursor(null); if (picked !== "select" || view() === "page") setPointerTool(picked); return; }
    if (event.key === "Escape") { handled(); if (openId() !== null) openNote(null); else props.onClose(); }
    else if (event.key === "ArrowUp") { handled(); widen += 1; aim(); }
    else if (event.key === "ArrowDown") { handled(); widen = Math.max(0, widen - 1); aim(); }
    else if (event.key === "Enter") { handled(); choose(event.shiftKey); }
  };

  const POINTER_EVENTS = ["pointermove", "pointerdown", "pointerup", "pointercancel", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "wheel", "touchstart", "touchmove", "touchend", "touchcancel"] as const;
  onMount(() => {
    // The moment is kept in case it is wanted; the tool opens on the live page all the same.
    if (atOpen) void take(false);
    for (const type of POINTER_EVENTS) window.addEventListener(type, swallow, { capture: true, passive: false });
    window.addEventListener("keydown", onKeyDown, { capture: true });
    for (const type of ["focusin", "focusout"] as const) window.addEventListener(type, quietFocus, { capture: true });
    let handle = requestAnimationFrame(function tick() {
      setFrame((value) => value + 1);
      // What the app redrew is found again where it was.
      for (const selection of selections) selection.elements.forEach((element, at) => {
        if (element.isConnected) return;
        const place = places.get(element), found = place && again(place);
        if (!found || selection.elements.includes(found)) return;
        places.set(found, place);
        setSelections((candidate) => candidate.id === selection.id, "elements", at, found);
      });
      // The notes stand over the bar where the window has no room for both side by side.
      const bar = layer?.querySelector(".ui-feedback-bar")?.getBoundingClientRect(), notes = layer?.querySelector(".ui-feedback-notes")?.getBoundingClientRect();
      const lift = bar && notes && bar.right > notes.left ? bar.height : 0;
      if (lift !== barLift()) setBarLift(lift);
      // The note being written sits beside what it is about: to its right, else its left, else under or over it.
      const selection = open(), note = layer?.querySelector<HTMLElement>(".ui-feedback-note[data-float]");
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
    const asking = setInterval(() => void askWaiters(), WAITING_EVERY_MS);
    onCleanup(() => clearInterval(asking));
  });
  onCleanup(() => {
    for (const type of POINTER_EVENTS) window.removeEventListener(type, swallow, { capture: true });
    window.removeEventListener("keydown", onKeyDown, { capture: true });
    for (const type of ["focusin", "focusout"] as const) window.removeEventListener(type, quietFocus, { capture: true });
    for (const url of [picture()?.url, ...selections.map((selection) => selection.preview)]) if (url) URL.revokeObjectURL(url);
    if (!sent) void marked.then((mark) => mark && transport.drop(mark.id).catch(() => {}));
  });
  let sent = false;

  const canSend = () => selections.some((selection) => selection.comment.trim());
  const status = createMemo(() => {
    if (props.mode === "use") return "Using the app";
    const does = pointerTool() === "select" ? "press or drag" : pointerTool() === "text" ? "press to write" : pointerTool() === "erase" ? "rub a drawing out" : "drag to draw";
    return does[0]!.toUpperCase() + does.slice(1);
  });

  async function send() {
    if (sending() || !canSend()) return;
    setSending(true);
    openNote(null);
    setCursor(null);
    try {
      const mark = await marked ?? await transport.mark(host.clientId());
      const listed = numbered(), whole = selections.find((selection) => selection.whole);
      // What each comment is, read before any capture so the boxes are the ones in the pictures.
      const comments: Array<Record<string, unknown> & { area: FeedbackBox | null; on?: View }> = listed.map((selection, index) => {
        if (selection.general) return { n: index + 1, comment: selection.comment.trim(), kind: "note" as const, name: GENERAL, area: null };
        const members = selection.elements.map(describe);
        const marks = extent(selection), shift = shiftOf(selection);
        const drawings = selection.drawings?.map((drawing) => {
          const every = Math.max(1, Math.ceil(drawing.points.length / SENT_POINTS));
          return { kind: drawing.kind, colour: drawing.ink, ...(drawing.kind === "text" ? { text: drawing.text ?? "" } : {}), points: drawing.points.filter((_, at) => at % every === 0 || at === drawing.points.length - 1).map((point) => [Math.round(point[0] + shift.x), Math.round(point[1] + shift.y)]) };
        });
        // The comment's own box is the last word on where it is: a piece the app took off the page measures as nothing.
        return { ...(members.length > 1 ? { members } : members[0]), n: index + 1, on: selection.on, ...(drawings ? { drawings } : {}), dragged: Boolean(selection.reach), area: areaOf(selection), comment: selection.comment.trim(), kind: members.length > 1 ? "group" as const : "component" as const, name: titleOf(selection),
          rect: { left: Math.round(marks.left), top: Math.round(marks.top), width: Math.round(marks.width), height: Math.round(marks.height) } };
      });
      if (whole?.comment.trim()) comments.push({ n: comments.length + 1, comment: whole.comment.trim(), kind: "note", name: WHOLE, area: null });
      // A picture of each thing looked at that has marks on it: the page as it was, the page as it is. The first is the item's screenshot;
      // each comment's own picture is cut from the one it was made on. Words alone need none.
      const marksOn = (on: View) => comments.some((entry) => entry.on === on);
      const shot = picture();
      const views = ([shot && (marksOn("screenshot") || whole) ? "screenshot" : null, marksOn("page") && !noPicture() ? "page" : null] as const).filter((on): on is View => on !== null);
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
        if (!first) { first = { capture, of }; await transport.picture(mark.id, capture.blob); }
        for (const [index, blob] of (await cropAreas(capture, comments.map((entry) => entry.on === of ? entry.area : null))).entries()) if (blob) await transport.picture(mark.id, blob, index + 1);
      }
      const result = await transport.send(mark.id, {
        comments, to: hand() ? agent()?.name ?? null : null,
        screenshot: first ? { width: first.capture.width, height: first.capture.height, surface: first.capture.surface, outlined: true, of: first.of } : { missing: views.length ? captureError ?? "capture failed" : marksOn("page") ? noPicture() ?? "capture failed" : "text only" },
        client: { id: host.clientId(), userAgent: navigator.userAgent, url: location.pathname + location.search, viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }, ...await host.client?.() },
      });
      sent = true;
      const where = result.handed.to ? `Feedback saved and handed to ${result.handed.to.name}` : "Feedback saved";
      host.notify("sent", captureError ? `${where}, without a screenshot: ${captureError}` : where);
      props.onClose();
    } catch (error) {
      host.notify("failed", `Feedback was not sent: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setCapturing(false);
      setShooting(null);
      setSending(false);
    }
  }

  const write = (selection: Selection) => (value: string) => setSelections((candidate) => candidate.id === selection.id, produce((draft) => { draft.comment = value; }));
  const sourceLine = (selection: Selection) => selection.whole ? "The whole page, as it was when this was taken." : selection.general ? "About nothing on the page in particular." : selection.elements.length === 1 ? sourceOf(selection.elements[0]!) : undefined;

  return <Portal>
    <FeedbackLayer ref={(element) => { layer = element; }} select={select()} frozen={showing() === "screenshot" ? picture()?.url : undefined} hidden={taking()}>
      <For each={selections}>{(selection) => <Show when={floats(selection) && selection.on === showing()}>
        <Show when={selection.drawings} fallback={<FeedbackMark kind="chosen" box={box(selection.elements)} tag={tagOf(selection)} current={openId() === selection.id} onOpen={() => openNote(selection.id)} />}>{(drawings) => <>
          <For each={drawings()}>{(drawing, at) => drawing.kind === "text"
            ? <FeedbackText ref={(element) => { textField = element; }} at={drawing.points[0]!} ink={drawing.ink} shift={shiftOf(selection)} value={drawing.text ?? ""} editable={openId() === selection.id}
                onInput={(value, element) => setSelections((candidate) => candidate.id === selection.id, "drawings", at(), produce((draft) => { draft.text = value; draft.size = { width: element.offsetWidth, height: element.offsetHeight }; }))} onDone={() => textDone(selection.id, at())} />
            : <FeedbackDrawing kind={drawing.kind} points={drawing.points} ink={drawing.ink} shift={shiftOf(selection)} current={openId() === selection.id} />}</For>
          <FeedbackMark kind="drawn" box={extent(selection)} tag={tagOf(selection)} onOpen={() => openNote(selection.id)} />
        </>}</Show>
        <Show when={!selection.drawings && selection.elements.length > 1}><For each={selection.elements}>{(element) => <FeedbackMark kind="member" box={box([element])} />}</For></Show>
      </Show>}</For>
      <Show when={select() && cursor()} keyed>{(element) => <Show when={!sameBox(box([element]), open() && floats(open()) ? box(open()!.elements) : null)}><FeedbackMark kind="cursor" box={box([element])} name={nameOf([element])} /></Show>}</Show>
      <Show when={stroke()}>{(drawn) => <FeedbackDrawing kind={drawn().kind} points={drawn().points} ink={ink()} current />}</Show>
      <Show when={marquee()}>{(drag) => <>
        <FeedbackMark kind="marquee" box={drag()} />
        <Show when={aimed().length > 1}><For each={aimed()}>{(element) => <FeedbackMark kind="member" box={box([element])} />}</For></Show>
        <Show when={aimed().length}><FeedbackMark kind="cursor" box={box(aimed())} name={nameOf(aimed())} /></Show>
      </>}</Show>
      <Show when={!capturing()}>
        <Show when={floats(open()) && open()} keyed>{(selection) =>
          <FeedbackNote ref={(element) => { noteField = element; }} float={noteAt() ? { left: `${noteAt()!.left}px`, top: `${noteAt()!.top}px` } : { opacity: 0 }} open tag={tagOf(selection)} name={titleOf(selection)} source={sourceLine(selection)}
            value={selection.comment} onOpen={() => {}} onInput={write(selection)} onDone={() => openNote(null)} onRemove={() => remove(selection.id)} />}
        </Show>
        <Show when={selections.some((selection) => !floats(selection) || selection.id !== openId())}>
          <FeedbackNotes lift={barLift()}><For each={selections}>{(selection) => <Show when={!floats(selection) || selection.id !== openId()}>
            <FeedbackNote ref={(element) => { noteField = element; }} open={openId() === selection.id} tag={tagOf(selection)} name={titleOf(selection)} source={sourceLine(selection)} picture={selection.whole ? picture()?.url : selection.preview}
              value={selection.comment} onOpen={() => { if (floats(selection) && props.mode === "select") show(selection.on); openNote(selection.id); }} onInput={write(selection)} onRemove={() => remove(selection.id)} />
          </Show>}</For></FeedbackNotes>
        </Show>
        <FeedbackBar view={props.mode === "use" ? "use" : view()} screenshots={canCapture} onView={look} tool={pointerTool()} onTool={(tool) => { setCursor(null); setStroke(null); setPointerTool(tool); }} onNote={note}
          status={status()} compact={touchOnly} keys={touchOnly ? undefined : props.keys?.()} onRetake={() => { openNote(null); void take(true); }} ink={ink()} onInk={setInk} onUndo={numbered().length ? undo : undefined}
          hand={hand()} onHand={keepHand} agent={agent()?.name} onNextAgent={(waiters.latest?.length ?? 0) > 1 ? nextAgent : undefined}
          canSend={canSend()} sending={sending()} onSend={() => void send()} onClose={props.onClose} />
      </Show>
    </FeedbackLayer>
  </Portal>;
}
