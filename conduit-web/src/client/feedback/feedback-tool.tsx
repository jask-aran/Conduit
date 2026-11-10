import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { Portal } from "solid-js/web";
import { FeedbackBar, FeedbackLayer, FeedbackMark, FeedbackNote, type FeedbackBox } from "@/components/ui/feedback";
import { toast } from "@/components/ui/notifications";
import { api } from "../api/client";
import { clientBuild, shellVersion } from "../platform/build-info";
import { installedClientKind } from "../platform/installed-client";
import { selectedUiScale } from "../preferences/ui-scale";
import { captureScreen, cropAreas, endCapture, type Capture } from "./capture";
import { describe, nameOf, pieceRoot, piecesWithin, sourceOf, under } from "./pieces";

/*
 * The UI feedback tool (development clients): mark up Conduit's own interface and send it to whoever works on it.
 * Opening it tells the hub "this moment" (the mark), so the hub keeps what it knew then; each selection locks onto a
 * library piece (or several, as a group) and takes a comment; Send writes one item on the hub
 * (<data>/feedback/<id>, server/feedback.js) that `node scripts/conduit-feedback.mjs wait` hands to an agent.
 *
 * Select: a press chooses the piece under the pointer; a drag gathers every piece inside it as one group; Shift and a
 * press adds a piece to the open selection or takes it out; Up and Down widen to the piece around and back.
 */
/** `reach`: how far a drag went past what it locked onto, each side (px); the dragged area is the pieces' box grown by it. */
type Selection = { id: number; elements: Element[]; comment: string; reach?: FeedbackBox };
type Mode = "select" | "use";
/** A press that moves further than this (px) is a drag. */
const DRAG_SLOP = 5;
/** A selection's own picture shows this much (px) around it. */
const CROP_MARGIN = 24;
/** The note sits this far (px) from what it marks, and from the window's edge. */
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
  // What the drag would lock onto if let go now, shown as it is dragged.
  const aimed = createMemo(() => { const drag = marquee(); return drag ? piecesWithin(drag) : []; });
  const [screenshot, setScreenshot] = createSignal(true);
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
  // How many pieces outward from the one under the pointer the cursor sits (Up and Down).
  let widen = 0;

  // The mark: the hub keeps what it knows now, under an id the item is sent to.
  const marked = api<{ id: string }>("/v0/feedback/marks", { method: "POST", body: JSON.stringify({ client: props.client() }) }).catch(() => null);

  const select = () => props.mode === "select" && !sending();
  const open = () => selections.find((selection) => selection.id === openId()) ?? null;
  const own = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest(".ui-feedback-note, .ui-feedback-bar"));
  const chosenBy = (element: Element) => selections.find((selection) => selection.elements.includes(element)) ?? null;
  const box = (elements: Element[]) => { frame(); return boxOf(elements); };

  /** The piece under the pointer, `widen` pieces outward. */
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
  const remove = (id: number) => { setSelections((all) => all.filter((selection) => selection.id !== id)); if (openId() === id) setOpenId(null); };
  /** Shift: a piece joins the open selection, or leaves it (the last one never does). */
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
    if (press && (marquee() || Math.hypot(event.clientX - press.x, event.clientY - press.y) > DRAG_SLOP)) {
      setCursor(null);
      setMarquee({ left: Math.min(press.x, event.clientX), top: Math.min(press.y, event.clientY), width: Math.abs(event.clientX - press.x), height: Math.abs(event.clientY - press.y) });
    } else aim();
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!select() || own(event.target) || event.button !== 0) return;
    press = { x: event.clientX, y: event.clientY, shift: event.shiftKey };
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!press || !select()) return;
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
  /** The wheel still scrolls what is under the layer. */
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
    if (!select() || event.ctrlKey || event.metaKey || event.altKey) return;
    const handled = () => { event.preventDefault(); event.stopImmediatePropagation(); };
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
        // Beside what it marks: right of it, else left, else under or over it, kept inside the window.
        const marks = boxOf(selection.elements), width = note.offsetWidth, height = note.offsetHeight;
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
  });
  onCleanup(() => {
    for (const type of POINTER_EVENTS) window.removeEventListener(type, swallow, { capture: true });
    window.removeEventListener("keydown", onKeyDown, { capture: true });
    for (const type of ["focusin", "focusout"] as const) window.removeEventListener(type, quietFocus, { capture: true });
    endCapture();
    // A mark nothing was sent to is let go.
    if (!sent) void marked.then((mark) => mark && api(`/v0/feedback/marks/${mark.id}`, { method: "DELETE" }).catch(() => {}));
  });
  let sent = false;

  const canSend = () => selections.some((selection) => selection.comment.trim());
  const status = createMemo(() => {
    if (props.mode === "use") return "Using the app.";
    if (!selections.length) return "Press a piece, or drag across several.";
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
        const around = boxOf(selection.elements);
        // The area its own picture shows: what was dragged round, or the piece with a margin; never less than the pieces.
        const reach = selection.reach ?? { left: CROP_MARGIN, top: CROP_MARGIN, width: 2 * CROP_MARGIN, height: 2 * CROP_MARGIN };
        const left = Math.max(0, Math.min(around.left, around.left - reach.left)), top = Math.max(0, Math.min(around.top, around.top - reach.top));
        const right = Math.min(innerWidth, Math.max(around.left + around.width, around.left - reach.left + around.width + reach.width)), bottom = Math.min(innerHeight, Math.max(around.top + around.height, around.top - reach.top + around.height + reach.height));
        return { n: index + 1, dragged: Boolean(selection.reach), area: { left: Math.round(left), top: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) }, comment: selection.comment.trim(), kind: members.length > 1 ? "group" as const : "component" as const, name: nameOf(selection.elements),
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
      const result = await api<{ id: string; path: string }>(`/v0/feedback/marks/${mark.id}/send`, { method: "POST", body: JSON.stringify({
        comments,
        screenshot: capture ? { width: capture.width, height: capture.height, surface: capture.surface, outlined: true } : { missing: screenshot() ? captureError ?? "capture failed" : "switched off" },
        client: {
          id: props.client(), kind: installedClientKind, build: clientBuild, shell: await shellVersion(), userAgent: navigator.userAgent,
          url: location.pathname + location.search, viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }, interfaceSize: selectedUiScale(),
        },
      }) });
      sent = true;
      toast.success(captureError ? `Feedback sent without a screenshot: ${captureError}` : "Feedback sent");
      void result;
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
        <FeedbackMark kind="chosen" box={box(selection.elements)} tag={String(index() + 1)} current={openId() === selection.id} />
        <Show when={selection.elements.length > 1}><For each={selection.elements}>{(element) => <FeedbackMark kind="member" box={box([element])} />}</For></Show>
      </>}</For>
      <Show when={select() && cursor()} keyed>{(element) => <Show when={!sameBox(box([element]), open() ? box(open()!.elements) : null)}><FeedbackMark kind="cursor" box={box([element])} name={nameOf([element])} /></Show>}</Show>
      <Show when={marquee()}>{(drag) => <>
        <FeedbackMark kind="marquee" box={drag()} />
        <Show when={aimed().length > 1}><For each={aimed()}>{(element) => <FeedbackMark kind="member" box={box([element])} />}</For></Show>
        <Show when={aimed().length}><FeedbackMark kind="cursor" box={box(aimed())} name={nameOf(aimed())} /></Show>
      </>}</Show>
      <Show when={!capturing() && open()} keyed>{(selection) =>
        <FeedbackNote ref={(element) => { noteField = element; }} style={noteAt() ? { left: `${noteAt()!.left}px`, top: `${noteAt()!.top}px` } : { opacity: 0 }}
          tag={String(selections.indexOf(selection) + 1)} name={nameOf(selection.elements)} source={selection.elements.length === 1 ? sourceOf(selection.elements[0]!) : undefined}
          value={selection.comment} onInput={(value) => setSelections((candidate) => candidate.id === selection.id, produce((draft) => { draft.comment = value; }))}
          onDone={() => openNote(null)} onRemove={() => remove(selection.id)} />}
      </Show>
      <Show when={!capturing()}>
        <FeedbackBar mode={props.mode} onMode={(mode) => { setCursor(null); props.onMode(mode); }} status={status()} keys={props.keys()} screenshot={screenshot()} onScreenshot={setScreenshot}
          canSend={canSend()} sending={sending()} onSend={() => void send()} onClose={props.onClose} />
      </Show>
    </FeedbackLayer>
  </Portal>;
}
