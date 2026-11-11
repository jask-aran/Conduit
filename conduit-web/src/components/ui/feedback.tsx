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

export const FeedbackLayer = (props: { select: boolean; ref?: (element: HTMLDivElement) => void; children: JSX.Element }) =>
  // data-mobile-swipe-ignore: a finger's drag on the layer gathers or draws; the drawers do not answer it (edge-swipe.ts).
  <div ref={props.ref} class="ui-feedback-layer" data-select={props.select ? "" : undefined} data-mobile-swipe-ignore={props.select ? "" : undefined}>{props.children}</div>;

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

export function FeedbackNote(props: { ref?: (element: HTMLTextAreaElement) => void; style?: JSX.CSSProperties; tag: string; name: string; source?: string; value: string;
  onInput: (value: string) => void; onDone: () => void; onRemove: () => void; onKeyDown?: (event: KeyboardEvent) => void }) {
  return <div class="ui-feedback-note" style={props.style}>
    <Card size="compact" label={`Comment ${props.tag}`} title={<><b class="ui-feedback-number">{props.tag}</b>{props.name}</>} detail={props.source} close={props.onDone} closeLabel="Done"
      actions={<><Button variant="ghost" size="sm" onClick={props.onRemove}>Remove</Button><Button variant="primary" outline size="sm" onClick={props.onDone}>Done</Button></>}>
      <TextArea ref={props.ref} rows={2} placeholder="What should change?" value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} onKeyDown={props.onKeyDown} />
    </Card>
  </div>;
}

export type FeedbackPointer = "select" | FeedbackDrawingKind | "use";
type FeedbackToolKind = Exclude<FeedbackPointer, "use">;
const TOOLS: ReadonlyArray<{ value: FeedbackToolKind; label: string; icon: () => JSX.Element }> = [
  { value: "select", label: "Select (V)", icon: () => <Icons.Pointer /> }, { value: "pen", label: "Pen (P)", icon: () => <Icons.Edit /> },
  { value: "arrow", label: "Arrow (A)", icon: () => <Icons.DrawArrow /> }, { value: "box", label: "Box (B)", icon: () => <Icons.DrawBox /> },
];

/** The tool's bar, at the foot, in four groups: what the pointer marks with (`tool`: the one kept while the app is in
 *  use); who has the pointer (Use app; `keys` is the chord that switches); what goes with the item (a general note,
 *  the screenshot where the client can take one, the listening session it is handed to); Send and close. */
export function FeedbackBar(props: { mode: FeedbackPointer; tool?: FeedbackToolKind; onMode: (mode: FeedbackPointer) => void; status?: string; hand?: boolean; onHand?: (on: boolean) => void; agent?: string; onNextAgent?: () => void; keys?: string[]; screenshot?: boolean; onScreenshot?: (on: boolean) => void; onNote?: () => void; noted?: boolean;
  canSend: boolean; sending?: boolean; onSend: () => void; onClose: () => void }) {
  const using = () => props.mode === "use";
  const tool = (): FeedbackToolKind => props.mode === "use" ? props.tool ?? "select" : props.mode;
  return <Frost lift="raised" class="ui-feedback-bar" role="toolbar" aria-label="UI feedback">
    <Segmented label="Mark with" icons size="sm" value={tool()} onChange={props.onMode} disabled={using()} options={TOOLS.map((option) => ({ value: option.value, label: option.label, icon: option.icon() }))} />
    <IconButton label={`Use the app${props.keys?.length ? ` (${props.keys.join(" ")})` : ""}`} aria-pressed={using()} onClick={() => props.onMode(using() ? tool() : "use")}><Icons.UseApp /></IconButton>
    <Show when={props.status}><span class="ui-feedback-status">{props.status}</span></Show>
    <span class="ui-feedback-with">
      <Show when={props.onNote}><IconButton label="General note (N)" aria-pressed={Boolean(props.noted)} onClick={props.onNote}><Icons.Note /></IconButton></Show>
      <Show when={props.onScreenshot}><IconButton label="Include a screenshot" aria-pressed={Boolean(props.screenshot)} onClick={() => props.onScreenshot!(!props.screenshot)}><Icons.Camera /></IconButton></Show>
      <Show when={props.onHand && props.agent}>
        <IconButton label={`Hand to ${props.agent}`} aria-pressed={Boolean(props.hand)} onClick={() => props.onHand!(!props.hand)}><Icons.Agent /></IconButton>
        <Show when={props.hand}><Show when={props.onNextAgent} fallback={<span class="ui-feedback-status">{props.agent}</span>}><Button variant="ghost" size="sm" title="The next waiting session" onClick={props.onNextAgent}>{props.agent}</Button></Show></Show>
      </Show>
    </span>
    <Button variant="primary" outline size="sm" disabled={!props.canSend || props.sending} onClick={props.onSend}><Show when={props.sending} fallback="Send"><Spinner /></Show></Button>
    <CloseButton size="sm" label="Close feedback" onClick={props.onClose} />
  </Frost>;
}
