import { createUniqueId, Show, type JSX } from "solid-js";
// Through the barrel, so the tool's chunk takes these from the app's own and the build splits nothing new out of it.
import { Button, Card, CloseButton, Frost, Keycap, Segmented, Spinner, Switch, TextArea } from "./index";
import "./styles/feedback.css";

/* Not in the library's barrel: the tool imports this file when it is opened, so the app's first load does not carry it
   (its stylesheet comes with it). */

export type FeedbackBox = { left: number; top: number; width: number; height: number };
/** Under this much room above a mark (px), its tag sits inside its corner; within eight times it of the right edge, the tag ends on the mark's right. */
const TAG_ROOM = 20;
const place = (box: FeedbackBox): JSX.CSSProperties => ({ left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });

export const FeedbackLayer = (props: { select: boolean; ref?: (element: HTMLDivElement) => void; children: JSX.Element }) =>
  <div ref={props.ref} class="ui-feedback-layer" data-select={props.select ? "" : undefined}>{props.children}</div>;

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
const POINTERS: ReadonlyArray<{ value: FeedbackPointer; label: string }> = [{ value: "select", label: "Select" }, { value: "pen", label: "Pen" }, { value: "arrow", label: "Arrow" }, { value: "box", label: "Box" }, { value: "use", label: "Use app" }];

export function FeedbackBar(props: { mode: FeedbackPointer; onMode: (mode: FeedbackPointer) => void; status: string; hand?: boolean; onHand?: (on: boolean) => void; agent?: string; onNextAgent?: () => void; keys?: string[]; screenshot: boolean; onScreenshot: (on: boolean) => void;
  canSend: boolean; sending?: boolean; onSend: () => void; onClose: () => void }) {
  return <Frost lift="raised" class="ui-feedback-bar" role="toolbar" aria-label="UI feedback">
    <Segmented label="Pointer" value={props.mode} onChange={props.onMode} options={POINTERS} />
    <span class="ui-feedback-status">{props.status}<Show when={props.keys?.length}><Keycap>{props.keys!.join(" ")}</Keycap></Show></span>
    <label class="ui-feedback-switch"><span>Screenshot</span><Switch label="Include screenshot" checked={props.screenshot} onChange={props.onScreenshot} /></label>
    <Show when={props.onHand}><span class="ui-feedback-switch">
      <Show when={props.onNextAgent} fallback={<span>{props.agent ? `Hand to ${props.agent}` : "Hand to a session"}</span>}><span>Hand to</span><Button variant="ghost" size="sm" title="The next waiting session" onClick={props.onNextAgent}>{props.agent}</Button></Show>
      <Switch label="Hand to a waiting agent session" checked={Boolean(props.hand)} onChange={props.onHand!} />
    </span></Show>
    <Button variant="primary" outline size="sm" disabled={!props.canSend || props.sending} onClick={props.onSend}><Show when={props.sending} fallback="Send"><Spinner /></Show></Button>
    <CloseButton size="sm" label="Close feedback" onClick={props.onClose} />
  </Frost>;
}
