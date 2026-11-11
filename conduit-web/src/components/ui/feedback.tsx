import { createUniqueId, For, Show, type JSX } from "solid-js";
// Through the barrel, so the tool's chunk takes these from the app's own and the build splits nothing new out of it.
import { Button, Card, CardPreview, CloseButton, Frost, IconButton, Icons, Segmented, Spinner, Swatch, TextArea } from "./index";
import "./styles/feedback.css";

/* Not in the library's barrel: the tool imports this file when it is opened, so the app's first load does not carry it
   (its stylesheet comes with it). */

export type FeedbackBox = { left: number; top: number; width: number; height: number };
/** Under this much room above a mark (px), its tag sits inside its corner; within eight times it of the right edge, the tag ends on the mark's right. */
const TAG_ROOM = 20;
const place = (box: FeedbackBox): JSX.CSSProperties => ({ left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });

/** `frozen`: a screenshot of the page, shown over the page (which goes on changing under it). */
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
/** What a drawing is drawn in. The first is the layer's own line. */
export const FEEDBACK_INKS = { plain: { label: "Plain", colour: "var(--primary)" }, red: { label: "Red", colour: "var(--destructive)" }, amber: { label: "Amber", colour: "var(--status-warn)" }, green: { label: "Green", colour: "var(--status-success)" }, blue: { label: "Blue", colour: "var(--status-unread)" } } as const;
export type FeedbackInk = keyof typeof FEEDBACK_INKS;
const inked = (ink?: FeedbackInk): JSX.CSSProperties => ({ "--feedback-ink": FEEDBACK_INKS[ink ?? "plain"].colour });
export type FeedbackDrawingKind = "pen" | "arrow" | "box";
export const drawingBox = (points: readonly FeedbackPoint[]): FeedbackBox => {
  const xs = points.map((point) => point[0]), ys = points.map((point) => point[1]);
  const left = Math.min(...xs), top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
};
const line = (points: readonly FeedbackPoint[]) => points.map((point, index) => `${index ? "L" : "M"}${point[0]} ${point[1]}`).join("");

export function FeedbackDrawing(props: { kind: FeedbackDrawingKind; points: readonly FeedbackPoint[]; ink?: FeedbackInk; shift?: { x: number; y: number }; current?: boolean }) {
  const head = createUniqueId();
  const ends = () => [props.points[0]!, props.points[props.points.length - 1]!] as const;
  const path = () => {
    if (props.kind === "pen") return line(props.points);
    if (props.kind === "arrow") return line(ends());
    const box = drawingBox(ends());
    return `M${box.left} ${box.top}h${box.width}v${box.height}h${-box.width}z`;
  };
  return <svg class="ui-feedback-drawing" data-kind={props.kind} data-current={props.current ? "" : undefined} style={{ ...inked(props.ink), translate: props.shift ? `${props.shift.x}px ${props.shift.y}px` : undefined }} aria-hidden="true">
    {/* The head is sized in line widths (markerUnits is strokeWidth), so it follows the line's token. */}
    <Show when={props.kind === "arrow"}><defs><marker id={head} viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L6 3L0 6z" /></marker></defs></Show>
    <Show when={props.points.length}><path d={path()} marker-end={props.kind === "arrow" ? `url(#${head})` : undefined} /></Show>
  </svg>;
}

/** Words written on the page, as a drawing: a field where they are, the size of what it holds; `editable` while its comment is being written. */
export const FeedbackText = (props: { ref?: (element: HTMLInputElement) => void; at: FeedbackPoint; ink?: FeedbackInk; shift?: { x: number; y: number }; value: string; editable?: boolean; onInput: (value: string, element: HTMLInputElement) => void; onDone: () => void }) =>
  <input ref={props.ref} class="ui-feedback-text" data-editable={props.editable ? "" : undefined} readOnly={!props.editable} aria-label="Text on the page" placeholder="Text" value={props.value}
    style={{ ...inked(props.ink), left: `${props.at[0]}px`, top: `${props.at[1]}px`, translate: props.shift ? `${props.shift.x}px ${props.shift.y}px` : undefined }} onInput={(event) => props.onInput(event.currentTarget.value, event.currentTarget)} onBlur={props.onDone} />;

/** Every comment of the item, the newest at the foot, in the corner; `lift` is the bar's height when the stack has to stand over it. */
export const FeedbackNotes = (props: { lift?: number; children: JSX.Element }) =>
  <div class="ui-feedback-notes" data-lifted={props.lift ? "" : undefined} style={{ "--feedback-bar-height": `${props.lift ?? 0}px` }}>{props.children}</div>;

/** One comment. `float`: where it sits beside what it is about while it is written, with Done to send it to the stack. In the stack, shut, it shows
 *  its words on a line and its `picture`, and a press opens it. Once sent it is a thread: `said` is what the person and the agent have written about
 *  it, the field is the person's answer (`placeholder`), and it is not removed. */
export function FeedbackNote(props: { ref?: (element: HTMLTextAreaElement) => void; float?: JSX.CSSProperties; open: boolean; tag: string; name: string; source?: string; value: string; picture?: string; said?: { from: "agent" | "person"; text: string }[]; placeholder?: string;
  onOpen: () => void; onInput: (value: string) => void; onDone?: () => void; onRemove?: () => void }) {
  return <div class="ui-feedback-note" style={props.float} data-float={props.float ? "" : undefined} data-open={props.open ? "" : undefined} onClick={(event) => { if (!props.open && !(event.target as Element).closest("button")) props.onOpen(); }}>
    <Card size="compact" role="group" label={props.tag ? `Comment ${props.tag}` : props.name} title={<><Show when={props.tag}><b class="ui-feedback-number">{props.tag}</b></Show>{props.name}</>} detail={props.said ? undefined : props.open ? props.source : props.value.trim() || (props.picture ? undefined : "No comment yet")}
      close={props.float ? props.onDone : props.onRemove} closeLabel={props.float ? "Done" : "Remove"}
      actions={props.float ? <><Button variant="ghost" size="sm" onClick={props.onRemove}>Remove</Button><Button variant="primary" outline size="sm" onClick={props.onDone}>Done</Button></> : undefined}>
      <Show when={props.picture && !props.float}><CardPreview><img src={props.picture} alt="" /></CardPreview></Show>
      <For each={props.said}>{(line) => <p class="ui-feedback-said" data-from={line.from}>{line.text}</p>}</For>
      <Show when={props.open}><TextArea ref={props.ref} rows={2} placeholder={props.placeholder ?? "What should change?"} value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} /></Show>
    </Card>
  </div>;
}

export type FeedbackToolKind = "select" | FeedbackDrawingKind | "text" | "erase";
const TOOLS: ReadonlyArray<{ value: FeedbackToolKind | "note"; label: string; icon: () => JSX.Element }> = [
  { value: "select", label: "Select (V)", icon: () => <Icons.Pointer /> }, { value: "pen", label: "Pen (P)", icon: () => <Icons.Edit /> },
  { value: "arrow", label: "Arrow (A)", icon: () => <Icons.DrawArrow /> }, { value: "box", label: "Box (B)", icon: () => <Icons.DrawBox /> }, { value: "text", label: "Text (T)", icon: () => <Icons.DrawText /> },
  { value: "erase", label: "Eraser (E)", icon: () => <Icons.Erase /> }, { value: "note", label: "General note (N)", icon: () => <Icons.Note /> },
];
/** Use the app, or annotate: the live page, or a screenshot of it. */
export type FeedbackView = "use" | "page" | "screenshot";

/** The tool's bar, at the foot: its mode (`view`; `keys` is the chord that goes to the app and back; Screenshot only where the client can take one);
 *  the annotating tools, with a general note among them and no Select on a screenshot, which has nothing under it to select; the ink the next
 *  drawing is in (a press takes the next) and Undo, both left to the keyboard and the eraser on a phone; a new screenshot while
 *  one is looked at; the listening session the item is handed to (`agent`, none when no session listens); Send and close. `compact`: icons alone,
 *  for a phone's width. `thread`: the item is sent and its thread is followed, so the bar is only what was said of it (`status`) and close.
 *  `replies`: answers unread on an item sent earlier, and the way to them. */
export function FeedbackBar(props: { view: FeedbackView; screenshots?: boolean; onView: (view: FeedbackView) => void; tool: FeedbackToolKind; onTool: (tool: FeedbackToolKind) => void; onNote: () => void; thread?: boolean; replies?: number; onReplies?: () => void; ink?: FeedbackInk; onInk?: (ink: FeedbackInk) => void; onUndo?: () => void; status?: string; compact?: boolean; hand?: boolean; onHand?: (on: boolean) => void; agent?: string; onNextAgent?: () => void; keys?: string[]; onRetake?: () => void;
  canSend: boolean; sending?: boolean; onSend: () => void; onClose: () => void }) {
  const using = () => props.view === "use";
  const views = (): Array<{ value: FeedbackView; label: string; icon: JSX.Element }> => [
    { value: "use", label: `Use the app${props.keys?.length ? ` (${props.keys.join(" ")})` : ""}`, icon: <Icons.UseApp /> }, { value: "page", label: "Annotate the live page", icon: <Icons.Feedback /> },
    ...(props.screenshots ? [{ value: "screenshot" as const, label: "Annotate a screenshot", icon: <Icons.Image /> }] : []),
  ];
  return <Frost lift="raised" class="ui-feedback-bar" data-compact={props.compact ? "" : undefined} role="toolbar" aria-label="UI feedback">
    <Show when={!props.thread}>
      {/* With no screenshot to be had there are two modes, and one control says which. */}
      <Show when={props.screenshots} fallback={<IconButton label={views()[0]!.label} aria-pressed={using()} onClick={() => props.onView(using() ? "page" : "use")}><Icons.UseApp /></IconButton>}>
        <Segmented label="Mode" icons size="sm" value={props.view} onChange={props.onView} options={views()} />
      </Show>
      <Segmented label="Annotate with" icons size="sm" value={props.tool} onChange={(tool) => tool === "note" ? props.onNote() : props.onTool(tool)} disabled={using()}
        options={TOOLS.filter((option) => option.value !== "select" || props.view !== "screenshot").map((option) => ({ value: option.value, label: option.label, icon: option.icon() }))} />
      <Show when={!props.compact}><span class="ui-feedback-with">
        <Show when={props.onInk}>{(onInk) => { const inks = Object.keys(FEEDBACK_INKS) as FeedbackInk[], now = () => props.ink ?? "plain";
          return <IconButton label={`Ink: ${FEEDBACK_INKS[now()].label} (C)`} disabled={using()} onClick={() => onInk()(inks[(inks.indexOf(now()) + 1) % inks.length]!)}><Swatch colour={FEEDBACK_INKS[now()].colour} /></IconButton>; }}</Show>
        <IconButton label="Undo (Ctrl Z)" disabled={!props.onUndo || using()} onClick={() => props.onUndo?.()}><Icons.Undo /></IconButton>
      </span></Show>
    </Show>
    <Show when={props.status && (props.thread || !props.compact)}><span class="ui-feedback-status">{props.status}</span></Show>
    <Show when={props.replies && !props.thread}><IconButton label={`${props.replies} unread from the agent, on what was sent before`} count={props.replies} onClick={props.onReplies}><Icons.Inbox /></IconButton></Show>
    <Show when={!props.thread}>
    <span class="ui-feedback-with">
      <Show when={props.onRetake && props.view === "screenshot"}><IconButton label="Take the screenshot again" onClick={props.onRetake}><Icons.Camera /></IconButton></Show>
      <Show when={props.onHand}>
        <IconButton label={props.agent ? `Hand to ${props.agent}` : "No session is listening"} disabled={!props.agent} aria-pressed={Boolean(props.agent && props.hand)} onClick={() => props.onHand!(!props.hand)}><Icons.Agent /></IconButton>
        <Show when={props.agent} fallback={<Show when={!props.compact}><span class="ui-feedback-status">No listener</span></Show>}>
          <Show when={props.hand}><Show when={props.onNextAgent} fallback={<span class="ui-feedback-status">{props.agent}</span>}><Button variant="ghost" size="sm" title="The next waiting session" onClick={props.onNextAgent}>{props.agent}</Button></Show></Show>
        </Show>
      </Show>
    </span>
    <Show when={props.compact} fallback={<Button variant="primary" outline size="sm" disabled={!props.canSend || props.sending} onClick={props.onSend}><Show when={props.sending} fallback="Send"><Spinner /></Show></Button>}>
      <IconButton label="Send" disabled={!props.canSend || props.sending} onClick={props.onSend}><Show when={props.sending} fallback={<Icons.Send />}><Spinner /></Show></IconButton>
    </Show>
    </Show>
    <CloseButton size="sm" label="Close feedback" onClick={props.onClose} />
  </Frost>;
}
