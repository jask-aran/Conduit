import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { Portal } from "solid-js/web";
import { drawingBox, FeedbackBar, FeedbackDrawing, FeedbackLayer, FeedbackMark, FeedbackNote, type FeedbackBox, type FeedbackDrawingKind, type FeedbackPoint, type FeedbackPointer } from "@/components/ui/feedback";
import { toast } from "@/components/ui/notifications";
import { api } from "../api/client";
import { clientBuild, shellVersion } from "../platform/build-info";
import { installedClientKind } from "../platform/installed-client";
import { selectedUiScale } from "../preferences/ui-scale";
import { captureScreen, cropAreas, endCapture, type Capture } from "./capture";
import { describe, nameOf, pieceRoot, piecesWithin, sourceOf, under } from "./pieces";

/** `reach`: how far a drag went past what it locked onto, each side (px); the dragged area is the pieces' box grown by it. */
type Selection = { id: number; elements: Element[]; comment: string; reach?: FeedbackBox; drawing?: Drawing };
/** `from`: where its pieces' box was when it was drawn, so it can follow them. */
type Drawing = { kind: FeedbackDrawingKind; points: FeedbackPoint[]; from: { left: number; top: number } };
const DRAW_KEYS: Record<string, "select" | FeedbackDrawingKind> = { v: "select", p: "pen", a: "arrow", b: "box" };
const DRAWN: Record<FeedbackDrawingKind, string> = { pen: "Pen", arrow: "Arrow", box: "Box" };
/** A pen's line keeps a point each time the pointer has gone this far (px); an item is sent at most this many. */
const PEN_STEP = 2;
const SENT_POINTS = 64;
const WAITING_EVERY_MS = 3000;
const HAND_KEY = "conduit.feedback.hand";
type Waiter = { id: string; name: string };
type Mode = "select" | "use";
const DRAG_SLOP = 5;
const CROP_MARGIN = 24;
const NOTE_GAP = 10;

const boxOf = (elements: Element[]): FeedbackBox => {
  const rects = elements.map((element) => element.getBoundingClientRect());
  const left = Math.min(...rects.map((rect) => rect.left)), top = Math.min(...rects.map((rect) => rect.top));
  return { left, top, width: Math.max(...rects.map((rect) => rect.right)) - left, height: Math.max(...rects.map((rect) => rect.bottom)) - top };
};
const sameBox = (a: FeedbackBox | null, b: FeedbackBox | null) => a === b || Boolean(a && b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

export default function FeedbackTool(props: { mode: Mode; onMode: (mode: Mode) => void; onClose: () => void; client: () => string; keys: () => string[] }) {
  const [selections, setSelections] = createStore<Selection[]>([]);
  const [openId, setOpenId] = createSignal<number | null>(null);
  const [cursor, setCursor] = createSignal<Element | null>(null);
  const [marquee, setMarquee] = createSignal<FeedbackBox | null>(null);
  const [pointerTool, setPointerTool] = createSignal<"select" | FeedbackDrawingKind>("select");
  const [stroke, setStroke] = createSignal<{ kind: FeedbackDrawingKind; points: FeedbackPoint[] } | null>(null);
  const aimed = createMemo(() => { const drag = marquee(); return drag ? piecesWithin(drag) : []; });
  const [screenshot, setScreenshot] = createSignal(true);
  const [hand, setHand] = createSignal((() => { try { return localStorage.getItem(HAND_KEY) !== "off"; } catch { return true; } })());
  const keepHand = (on: boolean) => { setHand(on); try { localStorage.setItem(HAND_KEY, on ? "on" : "off"); } catch { /* this session only */ } };
  const [waiters, { refetch: askWaiters }] = createResource(() => api<{ waiting: Waiter[] }>("/v0/feedback/waiting").then((answer) => answer.waiting, () => [] as Waiter[]));
  const [agentId, setAgentId] = createSignal<string | null>(null);
  const agent = () => waiters.latest?.find((waiter) => waiter.id === agentId()) ?? waiters.latest?.[0] ?? null;
  const nextAgent = () => { const all = waiters.latest ?? []; setAgentId(all[(all.findIndex((waiter) => waiter.id === agent()?.id) + 1) % all.length]?.id ?? null); };
  const [sending, setSending] = createSignal(false);
  const [capturing, setCapturing] = createSignal(false);
  // Boxes are read once a frame: what is marked scrolls, resizes and animates under the marks.
  const [frame, setFrame] = createSignal(0);
  const [noteAt, setNoteAt] = createSignal<{ left: number; top: number } | null>(null);
  let layer: HTMLDivElement | undefined;
  let noteField: HTMLTextAreaElement | undefined;
  let nextId = 1;
  let press: { x: number; y: number; shift: boolean } | null = null;
  let pointer = { x: -1, y: -1 };
  let widen = 0;

  // The mark: the hub keeps what it knows now, under an id the item is sent to.
  const marked = api<{ id: string }>("/v0/feedback/marks", { method: "POST", body: JSON.stringify({ client: props.client() }) }).catch(() => null);

  const select = () => props.mode === "select" && !sending();
  const open = () => selections.find((selection) => selection.id === openId()) ?? null;
  const own = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest(".ui-feedback-note, .ui-feedback-bar, .ui-feedback-tag[data-press]"));
  const chosenBy = (element: Element) => selections.find((selection) => !selection.drawing && selection.elements.includes(element)) ?? null;
  const box = (elements: Element[]) => { frame(); return boxOf(elements); };
  const shiftOf = (selection: Selection) => {
    frame();
    if (!selection.drawing || !selection.elements.every((element) => element.isConnected)) return { x: 0, y: 0 };
    const now = boxOf(selection.elements);
    return { x: now.left - selection.drawing.from.left, y: now.top - selection.drawing.from.top };
  };
  const extent = (selection: Selection): FeedbackBox => {
    if (!selection.drawing) return boxOf(selection.elements);
    const drawn = drawingBox(selection.drawing.kind === "pen" ? selection.drawing.points : [selection.drawing.points[0]!, selection.drawing.points[selection.drawing.points.length - 1]!]), shift = shiftOf(selection);
    return { ...drawn, left: drawn.left + shift.x, top: drawn.top + shift.y };
  };
  const titleOf = (selection: Selection) => selection.drawing ? `${DRAWN[selection.drawing.kind]} over ${nameOf(selection.elements)}` : nameOf(selection.elements);

  const aim = () => {
    let target = pieceRoot(under(pointer.x, pointer.y));
    for (let step = 0; target && step < widen; step++) {
      const outer = pieceRoot(target.parentElement);
      if (!outer) { widen = step; break; }
      target = outer;
    }
    setCursor(target);
  };

  const openNote = (id: number | null) => { setOpenId(id); if (id !== null) queueMicrotask(() => noteField?.focus({ preventScroll: true })); };
  const add = (elements: Element[], drag?: FeedbackBox) => {
    const id = nextId++;
    const around = boxOf(elements);
    const reach = drag && { left: around.left - drag.left, top: around.top - drag.top, width: drag.width - around.width, height: drag.height - around.height };
    setSelections(selections.length, { id, elements, comment: "", reach });
    openNote(id);
  };
  /** A drawing too small to see is a slip of the hand. */
  const draw = (kind: FeedbackDrawingKind, points: FeedbackPoint[]) => {
    const around = drawingBox(points);
    if (Math.hypot(around.width, around.height) <= DRAG_SLOP) return;
    const head = points[points.length - 1]!;
    const over = kind === "arrow" ? [pieceRoot(under(head[0], head[1]))] : kind === "pen" ? points.map((point) => pieceRoot(under(point[0], point[1]))) : piecesWithin(around);
    // A piece that holds another of them (the list a line's rows are in) is only where the line passed between them.
    const found = [...new Set(over.filter((element): element is Element => Boolean(element)))].filter((element, _, all) => !all.some((other) => other !== element && element.contains(other)));
    const elements = found.length ? found : [under(around.left + around.width / 2, around.top + around.height / 2) ?? document.body];
    const from = boxOf(elements), id = nextId++;
    setSelections(selections.length, { id, elements, comment: "", drawing: { kind, points, from: { left: from.left, top: from.top } } });
    openNote(id);
  };
  const remove = (id: number) => { setSelections((all) => all.filter((selection) => selection.id !== id)); if (openId() === id) setOpenId(null); };
  const toggleIn = (selection: Selection, element: Element) => setSelections((candidate) => candidate.id === selection.id, "elements", (elements) =>
    elements.includes(element) ? (elements.length > 1 ? elements.filter((kept) => kept !== element) : elements) : [...elements, element]);

  const choose = (shift: boolean) => {
    const target = cursor();
    if (!target) return openNote(null);
    const current = open();
    if (shift && current) return toggleIn(current, target);
    const existing = chosenBy(target);
    if (existing) return openNote(existing.id);
    add([target]);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!select() || own(event.target)) return;
    if (pointer.x !== event.clientX || pointer.y !== event.clientY) { if (under(event.clientX, event.clientY) !== under(pointer.x, pointer.y)) widen = 0; pointer = { x: event.clientX, y: event.clientY }; }
    const drawn = stroke();
    if (drawn) {
      const last = drawn.points[drawn.points.length - 1]!, here: FeedbackPoint = [event.clientX, event.clientY];
      if (drawn.kind !== "pen") setStroke({ kind: drawn.kind, points: [drawn.points[0]!, here] });
      else if (Math.hypot(here[0] - last[0], here[1] - last[1]) >= PEN_STEP) setStroke({ kind: "pen", points: [...drawn.points, here] });
    } else if (pointerTool() !== "select") setCursor(null);
    else if (press && (marquee() || Math.hypot(event.clientX - press.x, event.clientY - press.y) > DRAG_SLOP)) {
      setCursor(null);
      setMarquee({ left: Math.min(press.x, event.clientX), top: Math.min(press.y, event.clientY), width: Math.abs(event.clientX - press.x), height: Math.abs(event.clientY - press.y) });
    } else aim();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!select() || own(event.target) || event.button !== 0) return;
    press = { x: event.clientX, y: event.clientY, shift: event.shiftKey };
    const tool = pointerTool();
    if (tool !== "select") { setCursor(null); setStroke({ kind: tool, points: [[event.clientX, event.clientY]] }); }
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!press || !select()) return;
    const drawn = stroke();
    if (drawn) { press = null; setStroke(null); return draw(drawn.kind, drawn.points); }
    const drag = marquee();
    const shift = press.shift;
    const gathered = aimed();
    press = null;
    setMarquee(null);
    if (!drag) return choose(shift);
    const current = open();
    if (!gathered.length) return;
    if (shift && current) setSelections((candidate) => candidate.id === current.id, "elements", (elements) => [...new Set([...elements, ...gathered])]);
    else add(gathered, drag);
    void event;
  };
  // Nothing under the layer is pressed, and nothing that listens for a press outside itself (a menu, a dialog) hears one.
  const swallow = (event: Event) => {
    if (!select() || own(event.target)) return;
    event.stopImmediatePropagation();
    if (event.type !== "pointermove" && event.type !== "wheel") event.preventDefault();
    if (event.type === "pointermove") onPointerMove(event as PointerEvent);
    else if (event.type === "pointerdown") onPointerDown(event as PointerEvent);
    else if (event.type === "pointerup") onPointerUp(event as PointerEvent);
    else if (event.type === "wheel") scrollUnder(event as WheelEvent);
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
    const typing = own(event.target) && event.target instanceof HTMLTextAreaElement;
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && canSend()) { event.preventDefault(); event.stopImmediatePropagation(); return void send(); }
    if (typing) {
      // The note's keys are its own; the app's shortcuts do not run on them.
      event.stopImmediatePropagation();
      if (event.key === "Escape" || (event.key === "Enter" && !event.shiftKey)) { event.preventDefault(); openNote(null); }
      return;
    }
    const handled = () => { event.preventDefault(); event.stopImmediatePropagation(); };
    if (select() && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z" && selections.length) { handled(); return remove(selections[selections.length - 1]!.id); }
    if (!select() || event.ctrlKey || event.metaKey || event.altKey) return;
    const picked = DRAW_KEYS[event.key.toLowerCase()];
    if (picked) { handled(); setCursor(null); return void setPointerTool(picked); }
    if (event.key === "Escape") { handled(); if (openId() !== null) openNote(null); else props.onClose(); }
    else if (event.key === "ArrowUp") { handled(); widen += 1; aim(); }
    else if (event.key === "ArrowDown") { handled(); widen = Math.max(0, widen - 1); aim(); }
    else if (event.key === "Enter") { handled(); choose(event.shiftKey); }
    else if ((event.key === "Backspace" || event.key === "Delete") && openId() !== null) { handled(); remove(openId()!); }
  };

  const POINTER_EVENTS = ["pointermove", "pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "wheel"] as const;
  onMount(() => {
    for (const type of POINTER_EVENTS) window.addEventListener(type, swallow, { capture: true, passive: false });
    window.addEventListener("keydown", onKeyDown, { capture: true });
    for (const type of ["focusin", "focusout"] as const) window.addEventListener(type, quietFocus, { capture: true });
    let handle = requestAnimationFrame(function tick() {
      setFrame((value) => value + 1);
      const selection = open(), note = layer?.querySelector<HTMLElement>(".ui-feedback-note");
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
    endCapture();
    if (!sent) void marked.then((mark) => mark && api(`/v0/feedback/marks/${mark.id}`, { method: "DELETE" }).catch(() => {}));
  });
  let sent = false;

  const canSend = () => selections.some((selection) => selection.comment.trim());
  const status = createMemo(() => {
    if (props.mode === "use") return "Using the app.";
    if (!selections.length) return pointerTool() === "select" ? "Press a piece, or drag across several." : "Drag to draw on the page.";
    return `${selections.length} ${selections.length === 1 ? "selection" : "selections"}`;
  });

  async function send() {
    if (sending() || !canSend()) return;
    setSending(true);
    setOpenId(null);
    setCursor(null);
    try {
      const mark = await marked ?? await api<{ id: string }>("/v0/feedback/marks", { method: "POST", body: JSON.stringify({ client: props.client() }) });
      // What each selection is, read before the capture so the boxes are the ones in the picture.
      const comments = selections.map((selection, index) => {
        const members = selection.elements.map(describe);
        const around = extent(selection), drawing = selection.drawing, shift = shiftOf(selection);
        const reach = selection.reach ?? { left: CROP_MARGIN, top: CROP_MARGIN, width: 2 * CROP_MARGIN, height: 2 * CROP_MARGIN };
        const left = Math.max(0, Math.min(around.left, around.left - reach.left)), top = Math.max(0, Math.min(around.top, around.top - reach.top));
        const right = Math.min(innerWidth, Math.max(around.left + around.width, around.left - reach.left + around.width + reach.width)), bottom = Math.min(innerHeight, Math.max(around.top + around.height, around.top - reach.top + around.height + reach.height));
        const every = drawing ? Math.max(1, Math.ceil(drawing.points.length / SENT_POINTS)) : 1;
        const sent = drawing && { kind: drawing.kind, points: drawing.points.filter((_, at) => at % every === 0 || at === drawing.points.length - 1).map((point) => [Math.round(point[0] + shift.x), Math.round(point[1] + shift.y)]) };
        return { n: index + 1, ...(sent ? { drawing: sent } : {}), dragged: Boolean(selection.reach), area: { left: Math.round(left), top: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) }, comment: selection.comment.trim(), kind: members.length > 1 ? "group" as const : "component" as const, name: titleOf(selection),
          rect: { left: Math.round(around.left), top: Math.round(around.top), width: Math.round(around.width), height: Math.round(around.height) },
          ...(members.length > 1 ? { members } : members[0]) };
      });
      let capture: Capture | null = null, captureError: string | null = null;
      if (screenshot()) {
        setCapturing(true);
        try { capture = await captureScreen(); } catch (error) { captureError = error instanceof Error ? error.message : String(error); }
        setCapturing(false);
        if (capture) {
          const png = { method: "PUT", headers: { "content-type": "image/png" } };
          await api(`/v0/feedback/marks/${mark.id}/screenshot`, { ...png, body: capture.blob });
          for (const [index, blob] of (await cropAreas(capture, comments.map((entry) => entry.area))).entries()) if (blob) await api(`/v0/feedback/marks/${mark.id}/areas/${index + 1}`, { ...png, body: blob });
        }
      }
      const result = await api<{ id: string; path: string; handed: { held: boolean; to: Waiter | null } }>(`/v0/feedback/marks/${mark.id}/send`, { method: "POST", body: JSON.stringify({
        comments, hand: hand(), to: agent()?.id ?? null,
        screenshot: capture ? { width: capture.width, height: capture.height, surface: capture.surface, outlined: true } : { missing: screenshot() ? captureError ?? "capture failed" : "switched off" },
        client: {
          id: props.client(), kind: installedClientKind, build: clientBuild, shell: await shellVersion(), userAgent: navigator.userAgent,
          url: location.pathname + location.search, viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }, interfaceSize: selectedUiScale(),
        },
      }) });
      sent = true;
      const where = result.handed.to ? `Feedback sent to ${result.handed.to.name}` : result.handed.held ? "Feedback sent and held" : "Feedback sent: no session is waiting, the next to wait takes it";
      toast.success(captureError ? `${where}, without a screenshot: ${captureError}` : where);
      props.onClose();
    } catch (error) {
      toast.error(`Feedback was not sent: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setCapturing(false);
      setSending(false);
    }
  }

  return <Portal>
    <FeedbackLayer ref={(element) => { layer = element; }} select={select()}>
      <For each={selections}>{(selection, index) => <>
        <Show when={selection.drawing} fallback={<FeedbackMark kind="chosen" box={box(selection.elements)} tag={String(index() + 1)} current={openId() === selection.id} onOpen={() => openNote(selection.id)} />}>{(drawing) => <>
          <FeedbackDrawing kind={drawing().kind} points={drawing().points} shift={shiftOf(selection)} current={openId() === selection.id} />
          <FeedbackMark kind="drawn" box={extent(selection)} tag={String(index() + 1)} onOpen={() => openNote(selection.id)} />
        </>}</Show>
        <Show when={!selection.drawing && selection.elements.length > 1}><For each={selection.elements}>{(element) => <FeedbackMark kind="member" box={box([element])} />}</For></Show>
      </>}</For>
      <Show when={select() && cursor()} keyed>{(element) => <Show when={!sameBox(box([element]), open() ? box(open()!.elements) : null)}><FeedbackMark kind="cursor" box={box([element])} name={nameOf([element])} /></Show>}</Show>
      <Show when={stroke()}>{(drawn) => <FeedbackDrawing kind={drawn().kind} points={drawn().points} current />}</Show>
      <Show when={marquee()}>{(drag) => <>
        <FeedbackMark kind="marquee" box={drag()} />
        <Show when={aimed().length > 1}><For each={aimed()}>{(element) => <FeedbackMark kind="member" box={box([element])} />}</For></Show>
        <Show when={aimed().length}><FeedbackMark kind="cursor" box={box(aimed())} name={nameOf(aimed())} /></Show>
      </>}</Show>
      <Show when={!capturing() && open()} keyed>{(selection) =>
        <FeedbackNote ref={(element) => { noteField = element; }} style={noteAt() ? { left: `${noteAt()!.left}px`, top: `${noteAt()!.top}px` } : { opacity: 0 }}
          tag={String(selections.indexOf(selection) + 1)} name={titleOf(selection)} source={selection.elements.length === 1 ? sourceOf(selection.elements[0]!) : undefined}
          value={selection.comment} onInput={(value) => setSelections((candidate) => candidate.id === selection.id, produce((draft) => { draft.comment = value; }))}
          onDone={() => openNote(null)} onRemove={() => remove(selection.id)} />}
      </Show>
      <Show when={!capturing()}>
        <FeedbackBar mode={props.mode === "use" ? "use" : pointerTool()} onMode={(mode: FeedbackPointer) => { setCursor(null); setStroke(null); if (mode !== "use") setPointerTool(mode); props.onMode(mode === "use" ? "use" : "select"); }} status={status()} keys={props.keys()} screenshot={screenshot()} onScreenshot={setScreenshot} hand={hand()} onHand={keepHand} agent={agent()?.name} onNextAgent={(waiters.latest?.length ?? 0) > 1 ? nextAgent : undefined}
          canSend={canSend()} sending={sending()} onSend={() => void send()} onClose={props.onClose} />
      </Show>
    </FeedbackLayer>
  </Portal>;
}
