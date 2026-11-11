import { createUniqueId, Show, type JSX } from "solid-js";
// Through the barrel, so the tool's chunk takes these from the app's own and the build splits nothing new out of it.
import { Button, Card, CloseButton, Frost, IconButton, Icons, Segmented, Spinner, TextArea } from "./index";
import "./styles/feedback.css";

/* Not in the library's barrel: the tool imports this file when it is opened, so the app's first load does not carry it
   (its stylesheet comes with it). */

export type FeedbackBox = { left: number; top: number; width: number; height: number };
/** Under this much room above a mark (px), its tag sits inside its corner; within eight times it of the right edge, the tag ends on the mark's right. */
const TAG_ROOM = 20;
const place = (box: FeedbackBox): JSX.CSSProperties => ({ left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });

/** `frozen`: a picture of the page as it was when the tool took the pointer, shown over the page (which goes on changing under it). */
export const FeedbackLayer = (props: { select: boolean; frozen?: string; hidden?: boolean; ref?: (element: HTMLDivElement) => void; children: JSX.Element }) =>
  // data-mobile-swipe-ignore: a finger's drag on the layer gathers or draws; the drawers do not answer it (edge-swipe.ts).
  <div ref={props.ref} class="ui-feedback-layer" data-select={props.select ? "" : undefined} data-hidden={props.hidden ? "" : undefined} data-mobile-swipe-ignore={props.select ? "" : undefined}>
    <Show when={props.frozen}><img class="ui-feedback-frozen" src={props.frozen} alt="" /></Show>{props.children}
  </div>;

export const FeedbackMark = (props: { box: FeedbackBox; kind: "cursor" | "chosen" | "member" | "marquee" | "drawn"; tag?: string; name?: string; current?: boolean; onOpen?: () => void }) =>
  <div class="ui-feedback-mark" data-kind={props.kind} data-current={props.current ? "" : undefined} style={place(props.box)}>
    <Show when={props.tag || props.name}><span class="ui-feedback-tag" data-press={props.onOpen ? "" : undefined} onClick={() => props.onOpen?.()} data-inside={props.box.top < TAG_ROOM ? "" : undefined} data-end={props.box.left + TAG_ROOM * 8 > window.innerWidth ? "" : undefined}><Show when={props.tag}><b>{props.tag}</b></Show><Show when={props.name}><span>{props.name}</span></Show></span></Show>
  </div>;

export type FeedbackPoint = readonly [x: number, y: number];
export type FeedbackDrawingKind = "pen" | "arrow" | "box";
export const drawingBox = (points: readonly FeedbackPoint[]): FeedbackBox => {
  const xs = points.map((point) => point[0]), ys = points.map((point) => point[1]);
  const left = Math.min(...xs), top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
};
const line = (points: readonly FeedbackPoint[]) => points.map((point, index) => `${index ? "L" : "M"}${point[0]} ${point[1]}`).join("");

export function FeedbackDrawing(props: { kind: FeedbackDrawingKind; points: readonly FeedbackPoint[]; shift?: { x: number; y: number }; current?: boolean }) {
  const head = createUniqueId();
  const ends = () => [props.points[0]!, props.points[props.points.length - 1]!] as const;
  const path = () => {
    if (props.kind === "pen") return line(props.points);
    if (props.kind === "arrow") return line(ends());
    const box = drawingBox(ends());
    return `M${box.left} ${box.top}h${box.width}v${box.height}h${-box.width}z`;
  };
  return <svg class="ui-feedback-drawing" data-kind={props.kind} data-current={props.current ? "" : undefined} style={props.shift ? { translate: `${props.shift.x}px ${props.shift.y}px` } : undefined} aria-hidden="true">
    {/* The head is sized in line widths (markerUnits is strokeWidth), so it follows the line's token. */}
    <Show when={props.kind === "arrow"}><defs><marker id={head} viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L6 3L0 6z" /></marker></defs></Show>
    <Show when={props.points.length}><path d={path()} marker-end={props.kind === "arrow" ? `url(#${head})` : undefined} /></Show>
  </svg>;
}

/** Every comment of the item, the newest at the foot, in the corner; `lift` is the bar's height when the stack has to stand over it. */
export const FeedbackNotes = (props: { lift?: number; children: JSX.Element }) =>
  <div class="ui-feedback-notes" data-lifted={props.lift ? "" : undefined} style={{ "--feedback-bar-height": `${props.lift ?? 0}px` }}>{props.children}</div>;

/** One comment: open, its words are written; shut, it shows them on a line and a press opens it. */
export function FeedbackNote(props: { ref?: (element: HTMLTextAreaElement) => void; open: boolean; tag: string; name: string; source?: string; value: string;
  onOpen: () => void; onInput: (value: string) => void; onRemove: () => void }) {
  return <div class="ui-feedback-note" data-open={props.open ? "" : undefined} onClick={(event) => { if (!props.open && !(event.target as Element).closest("button")) props.onOpen(); }}>
    <Card size="compact" role="group" label={`Comment ${props.tag}`} title={<><b class="ui-feedback-number">{props.tag}</b>{props.name}</>} detail={props.open ? props.source : props.value.trim() || "No comment yet"} close={props.onRemove} closeLabel="Remove">
      <Show when={props.open}><TextArea ref={props.ref} rows={2} placeholder="What should change?" value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} /></Show>
    </Card>
  </div>;
}

export type FeedbackPointer = "select" | FeedbackDrawingKind | "use";
type FeedbackToolKind = Exclude<FeedbackPointer, "use">;
const TOOLS: ReadonlyArray<{ value: FeedbackToolKind; label: string; icon: () => JSX.Element }> = [
  { value: "select", label: "Select (V)", icon: () => <Icons.Pointer /> }, { value: "pen", label: "Pen (P)", icon: () => <Icons.Edit /> },
  { value: "arrow", label: "Arrow (A)", icon: () => <Icons.DrawArrow /> }, { value: "box", label: "Box (B)", icon: () => <Icons.DrawBox /> },
];

/** The tool's bar, at the foot, in four groups: who has the pointer (Use app; `keys` is the chord that switches); what
 *  it marks with (`tool`: the one kept while the app is in use); what goes with the item (a general note, the screenshot
 *  where the client can take one, the listening session it is handed to: `agent`, none when no session listens); Send
 *  and close. `compact`: icons alone, for a phone's width. */
export function FeedbackBar(props: { mode: FeedbackPointer; tool?: FeedbackToolKind; onMode: (mode: FeedbackPointer) => void; status?: string; compact?: boolean; hand?: boolean; onHand?: (on: boolean) => void; agent?: string; onNextAgent?: () => void; keys?: string[]; screenshot?: boolean; onScreenshot?: (on: boolean) => void; onNote?: () => void;
  canSend: boolean; sending?: boolean; onSend: () => void; onClose: () => void }) {
  const using = () => props.mode === "use";
  const tool = (): FeedbackToolKind => props.mode === "use" ? props.tool ?? "select" : props.mode;
  return <Frost lift="raised" class="ui-feedback-bar" role="toolbar" aria-label="UI feedback">
    <IconButton label={`Use the app${props.keys?.length ? ` (${props.keys.join(" ")})` : ""}`} aria-pressed={using()} onClick={() => props.onMode(using() ? tool() : "use")}><Icons.UseApp /></IconButton>
    <Segmented label="Mark with" icons size="sm" value={tool()} onChange={props.onMode} disabled={using()} options={TOOLS.map((option) => ({ value: option.value, label: option.label, icon: option.icon() }))} />
    <Show when={props.status && !props.compact}><span class="ui-feedback-status">{props.status}</span></Show>
    <span class="ui-feedback-with">
      <Show when={props.onNote}><IconButton label="Add a general note (N)" onClick={props.onNote}><Icons.Note /></IconButton></Show>
      <Show when={props.onScreenshot}><IconButton label="Include a screenshot" aria-pressed={Boolean(props.screenshot)} onClick={() => props.onScreenshot!(!props.screenshot)}><Icons.Camera /></IconButton></Show>
      <Show when={props.onHand}>
        <IconButton label={props.agent ? `Hand to ${props.agent}` : "No session is listening"} disabled={!props.agent} aria-pressed={Boolean(props.agent && props.hand)} onClick={() => props.onHand!(!props.hand)}><Icons.Agent /></IconButton>
        <Show when={props.agent} fallback={<Show when={!props.compact}><span class="ui-feedback-status">No listener</span></Show>}>
          <Show when={props.hand}><Show when={props.onNextAgent} fallback={<span class="ui-feedback-status">{props.agent}</span>}><Button variant="ghost" size="sm" title="The next waiting session" onClick={props.onNextAgent}>{props.agent}</Button></Show></Show>
        </Show>
      </Show>
    </span>
    <Button variant="primary" outline size="sm" disabled={!props.canSend || props.sending} onClick={props.onSend}><Show when={props.sending} fallback="Send"><Spinner /></Show></Button>
    <CloseButton size="sm" label="Close feedback" onClick={props.onClose} />
  </Frost>;
}
