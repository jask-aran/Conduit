import { createSignal, createUniqueId, For, Show, type JSX } from "solid-js";
// Through the barrel, so the tool's chunk takes these from the app's own and the build splits nothing new out of it.
import { Button, Card, ColourPicker, CardPreview, CloseButton, Frost, IconButton, Icons, Segmented, Spinner, Swatch, Switch, TextArea } from "./index";
import { clockTime } from "./time";
import "./styles/feedback.css";

/* Not in the library's barrel: the tool imports this file when it is opened, so the app's first load does not carry it
   (its stylesheet comes with it). */

export type FeedbackBox = { left: number; top: number; width: number; height: number };
/** Under this much room above a mark (px), its tag sits inside its corner; within eight times it of the right edge, the tag ends on the mark's right. */
const TAG_ROOM = 20;
const place = (box: FeedbackBox): JSX.CSSProperties => ({ left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });

/** `frozen`: a screenshot of the page, shown over the page (which goes on changing under it). `text`: the pointer selects text. */
export const FeedbackLayer = (props: { select: boolean; text?: boolean; frozen?: string; hidden?: boolean; ref?: (element: HTMLDivElement) => void; children: JSX.Element }) =>
  // data-mobile-swipe-ignore: a finger's drag on the layer gathers or draws; the drawers do not answer it (edge-swipe.ts).
  <div ref={props.ref} class="ui-feedback-layer" data-select={props.select ? "" : undefined} data-text={props.text ? "" : undefined} data-hidden={props.hidden ? "" : undefined} data-mobile-swipe-ignore={props.select ? "" : undefined}>
    <Show when={props.frozen}><img class="ui-feedback-frozen" src={props.frozen} alt="" /></Show>{props.children}
  </div>;

/** `quote`: one line of a run of text the person selected. */
export const FeedbackMark = (props: { box: FeedbackBox; kind: "cursor" | "chosen" | "member" | "marquee" | "drawn" | "quote"; tag?: string; name?: string; current?: boolean; onOpen?: () => void }) =>
  <div class="ui-feedback-mark" data-kind={props.kind} data-current={props.current ? "" : undefined} style={place(props.box)}>
    <Show when={props.tag || props.name}><span class="ui-feedback-tag" data-press={props.onOpen ? "" : undefined} onClick={() => props.onOpen?.()} data-inside={props.box.top < TAG_ROOM ? "" : undefined} data-end={props.box.left + TAG_ROOM * 8 > window.innerWidth ? "" : undefined}><Show when={props.tag}><b>{props.tag}</b></Show><Show when={props.name}><span>{props.name}</span></Show></span></Show>
  </div>;

export type FeedbackPoint = readonly [x: number, y: number];
/** What a drawing is drawn in. The first is the layer's own line. */
export const FEEDBACK_INKS = { plain: { label: "Plain", colour: "var(--primary)" }, red: { label: "Red", colour: "var(--destructive)" }, amber: { label: "Amber", colour: "var(--status-warn)" }, green: { label: "Green", colour: "var(--status-success)" }, blue: { label: "Blue", colour: "var(--status-unread)" } } as const;
/** One of those, or a colour of the person's own choosing. */
export type FeedbackInk = keyof typeof FEEDBACK_INKS | `#${string}`;
export const feedbackInkColour = (ink: FeedbackInk = "plain") => ink in FEEDBACK_INKS ? FEEDBACK_INKS[ink as keyof typeof FEEDBACK_INKS].colour : ink;
const inked = (ink?: FeedbackInk): JSX.CSSProperties => ({ "--feedback-ink": feedbackInkColour(ink) });
/** How thick a drawing's line is; a highlighter's is wider on its own scale. */
export const FEEDBACK_WEIGHTS = { thin: { label: "Thin" }, medium: { label: "Medium" }, thick: { label: "Thick" } } as const;
export type FeedbackWeight = keyof typeof FEEDBACK_WEIGHTS;
/** `highlight`: a wide see-through line, drawn as the pen's is. */
export type FeedbackDrawingKind = "pen" | "highlight" | FeedbackShape;
/** What the Shape tool draws from the press to the release. */
export type FeedbackShape = "line" | "arrow" | "box";
export const drawingBox = (points: readonly FeedbackPoint[]): FeedbackBox => {
  const xs = points.map((point) => point[0]), ys = points.map((point) => point[1]);
  const left = Math.min(...xs), top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
};
const line = (points: readonly FeedbackPoint[]) => points.map((point, index) => `${index ? "L" : "M"}${point[0]} ${point[1]}`).join("");

export function FeedbackDrawing(props: { kind: FeedbackDrawingKind; points: readonly FeedbackPoint[]; ink?: FeedbackInk; weight?: FeedbackWeight; shift?: { x: number; y: number }; current?: boolean }) {
  const head = createUniqueId();
  const ends = () => [props.points[0]!, props.points[props.points.length - 1]!] as const;
  const path = () => {
    if (props.kind === "pen" || props.kind === "highlight") return line(props.points);
    if (props.kind === "arrow" || props.kind === "line") return line(ends());
    const box = drawingBox(ends());
    return `M${box.left} ${box.top}h${box.width}v${box.height}h${-box.width}z`;
  };
  return <svg class="ui-feedback-drawing" data-kind={props.kind} data-weight={props.weight ?? "medium"} data-current={props.current ? "" : undefined} style={{ ...inked(props.ink), translate: props.shift ? `${props.shift.x}px ${props.shift.y}px` : undefined }} aria-hidden="true">
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

/** When a line of a thread was said, in as few words as place it: the minutes since, then the time today, then the day. */
const saidWhen = (at: string) => {
  const then = new Date(at), minutes = Math.floor((Date.now() - then.getTime()) / 60_000);
  if (!(minutes >= 1)) return "now";
  if (minutes < 60) return `${minutes} min`;
  return then.toDateString() === new Date().toDateString() ? clockTime(then) : then.toLocaleDateString([], { day: "numeric", month: "short" });
};

type Said = { from: "agent" | "person"; text: string; at?: string };
const said = (line: Said) => <p class="ui-feedback-said" data-from={line.from}><Show when={line.at}>{(at) => <time dateTime={at()}>{saidWhen(at())}</time>}</Show>{line.text}</p>;

/** One comment. `float`: where it sits beside what it is about while it is written, with Done to send it to the stack; `sendNow` is whether Done also
 *  sends it (`onSendNow` changes that; none: it cannot be, as with no session listening). In the stack, shut, it shows its words on a line and its
 *  `picture`, and a press opens it. `state` says where it stands (not sent, sent, being worked on, answered, resolved). Once sent it is a thread:
 *  `words` is the comment and `said` what the agent and the person have written about it since, each with when. Shut, it shows the comment on a line
 *  and the latest of those; open, all of it, and the field is the person's answer (`placeholder`, sent by Reply: `onSay`). It is not removed: its
 *  corner settles it (`onResolve`), and `resolved` it folds to the comment's line until it is opened and reopened. */
export function FeedbackNote(props: { ref?: (element: HTMLTextAreaElement) => void; float?: JSX.CSSProperties; open: boolean; tag: string; name: string; source?: string; value: string; picture?: string; words?: string; said?: Said[]; state?: { label: string; busy?: boolean };
  placeholder?: string; resolved?: boolean; sendNow?: boolean; onSendNow?: (on: boolean) => void; onOpen: () => void; onInput: (value: string) => void; onDone?: () => void; onRemove?: () => void; onSay?: () => void; onResolve?: (resolved: boolean) => void }) {
  const thread = () => props.said !== undefined;
  const settle = () => props.onResolve && !props.resolved ? () => props.onResolve!(true) : undefined;
  return <div class="ui-feedback-note" style={props.float} data-float={props.float ? "" : undefined} data-open={props.open ? "" : undefined} onClick={(event) => { if (!props.open && !(event.target as Element).closest("button")) props.onOpen(); }}>
    <Card size="compact" role="group" label={props.tag ? `Comment ${props.tag}` : props.name}
      title={<><Show when={props.tag}><b class="ui-feedback-number">{props.tag}</b></Show><span class="ui-feedback-name">{props.name}</span><Show when={props.state}>{(state) => <span class="ui-feedback-state"><Show when={state().busy}><Spinner /></Show>{state().label}</span>}</Show></>}
      detail={thread() ? (props.open ? undefined : props.words) : props.open ? props.source : props.value.trim() || (props.picture ? undefined : "No comment yet")}
      close={props.float ? props.onDone : thread() ? settle() : props.onRemove} closeLabel={props.float ? "Done" : thread() ? "Resolve" : "Remove"}
      actions={props.float ? <><Show when={props.sendNow !== undefined}><label class="ui-feedback-now" title={props.onSendNow ? undefined : "Needs a session listening"}>Send now<Switch label="Send this comment as it is Done" checked={Boolean(props.sendNow)} disabled={!props.onSendNow} onChange={props.onSendNow} /></label></Show><Button variant="ghost" size="sm" onClick={props.onRemove}>Remove</Button><Button variant="primary" outline size="sm" onClick={props.onDone}>Done</Button></>
        : props.open && props.onSay ? <><Show when={props.resolved && props.onResolve}><Button variant="ghost" size="sm" onClick={() => props.onResolve!(false)}>Reopen</Button></Show><Button variant="primary" outline size="sm" disabled={!props.value.trim()} onClick={props.onSay}>Reply</Button></> : undefined}>
      <Show when={props.picture && !props.float && !thread()}><CardPreview><img src={props.picture} alt="" /></CardPreview></Show>
      <Show when={thread()}>
        <Show when={props.open} fallback={<Show when={!props.resolved && props.said![props.said!.length - 1]} keyed>{(latest) => <div class="ui-feedback-latest">{said(latest)}</div>}</Show>}>
          <Show when={props.picture}><CardPreview><img src={props.picture} alt="" /></CardPreview></Show>
          <Show when={props.words}><p class="ui-feedback-said" data-from="person">{props.words}</p></Show>
          <For each={props.said}>{said}</For>
        </Show>
      </Show>
      <Show when={props.open}><TextArea ref={props.ref} rows={2} placeholder={props.placeholder ?? "What should change?"} value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} /></Show>
    </Card>
  </div>;
}

/** `quote`: a run of text on the live page, chosen as text is selected. */
export type FeedbackToolKind = "select" | "quote" | "pen" | "highlight" | "shape" | "text" | "erase";
/** `wide`: left off the compact bar, which has no room for it (its key still works). */
const OPTIONED: readonly string[] = ["pen", "highlight", "shape", "text"];
const SHAPES: Array<{ value: FeedbackShape; label: string; icon: JSX.Element }> = [{ value: "line", label: "Line (L)", icon: <Icons.DrawLine /> }, { value: "arrow", label: "Arrow (A)", icon: <Icons.DrawArrow /> }, { value: "box", label: "Box (B)", icon: <Icons.DrawBox /> }];
const PRESETS = Object.keys(FEEDBACK_INKS) as Array<keyof typeof FEEDBACK_INKS>;
const TOOLS: ReadonlyArray<{ value: FeedbackToolKind | "note"; label: string; icon: () => JSX.Element; wide?: true }> = [
  { value: "select", label: "Select (V)", icon: () => <Icons.Pointer /> }, { value: "quote", label: "Select text (Q)", icon: () => <Icons.SelectText />, wide: true },
  { value: "pen", label: "Pen (P)", icon: () => <Icons.Edit /> }, { value: "highlight", label: "Highlighter (H)", icon: () => <Icons.Highlight /> },
  { value: "shape", label: "Shape: line, arrow or box (S)", icon: () => <Icons.Shapes /> }, { value: "text", label: "Text (T)", icon: () => <Icons.DrawText /> },
  { value: "erase", label: "Eraser (E)", icon: () => <Icons.Erase /> }, { value: "note", label: "General note (N)", icon: () => <Icons.Note /> },
];
/** Use the app, or annotate: the live page, or a screenshot of it. */
export type FeedbackView = "use" | "page" | "screenshot";

/** The tool's bar, at the foot: its mode (`view`; `keys` is the chord that goes to the app and back; Screenshot only where the client can take one);
 *  the annotating tools, with a general note among them and neither Select on a screenshot, which has nothing under it to select; beside them
 *  the ink and thickness the next drawing is in (`picking`: their popover is open), and Undo, both left to the keyboard and the eraser on a phone; a new screenshot while
 *  one is looked at; the listening session the item is handed to (`agent`, none when no session listens); Send and close. `compact`: icons alone,
 *  for a phone's width. `tools`: the ones this host offers (all, unsaid). `thread`: the item is sent and its thread is followed, so the bar is only what was said of it (`status`) and close.
 *  `onBack` then leaves it for marking up again. `replies`: answers unread on what was sent before, and `sent` how many of those there are to come back to (`onReplies`).
 *  `outstanding`: how many comments Send would deliver; `standing`: where the item they have gone to stands, once some have. */
export function FeedbackBar(props: { view: FeedbackView; screenshots?: boolean; onView: (view: FeedbackView) => void; tools?: readonly (FeedbackToolKind | "note")[]; tool: FeedbackToolKind; onTool: (tool: FeedbackToolKind) => void; onNote: () => void; outstanding?: number; standing?: string; thread?: boolean; onBack?: () => void; replies?: number; sent?: number; onReplies?: () => void; ink?: FeedbackInk; onInk?: (ink: FeedbackInk) => void; weight?: FeedbackWeight; onWeight?: (weight: FeedbackWeight) => void; shape?: FeedbackShape; onShape?: (shape: FeedbackShape) => void; onUndo?: () => void; onRedo?: () => void; status?: string; compact?: boolean; hand?: boolean; onHand?: (on: boolean) => void; agent?: string; onNextAgent?: () => void; keys?: string[]; onRetake?: () => void;
  canSend: boolean; sending?: boolean; onSend: () => void; onClose: () => void }) {
  const using = () => props.view === "use";
  const views = (): Array<{ value: FeedbackView; label: string; icon: JSX.Element }> => [
    { value: "use", label: `Use the app${props.keys?.length ? ` (${props.keys.join(" ")})` : ""}`, icon: <Icons.UseApp /> }, { value: "page", label: "Annotate the live page", icon: <Icons.Feedback /> },
    ...(props.screenshots ? [{ value: "screenshot" as const, label: "Annotate a screenshot", icon: <Icons.Image /> }] : []),
  ];
  // What the chosen tool draws with stands over the bar while that tool is held, so the bar itself stays the tools.
  const inks = () => OPTIONED.includes(props.tool) ? props.onInk : undefined, lined = () => props.tool !== "text" && inks() ? props.onWeight : undefined;
  const [own, setOwn] = createSignal<FeedbackInk>(props.ink?.startsWith("#") ? props.ink : "#ff3b9a");
  const [picking, setPicking] = createSignal(false);
  const options = () => !props.thread && !using() && (OPTIONED.includes(props.tool) || props.tool === "erase") && (inks() || props.compact);
  return <div class="ui-feedback-rails" data-compact={props.compact ? "" : undefined}>
  <Show when={picking() && options() && props.ink?.startsWith("#") && inks()}><Frost lift="raised" class="ui-feedback-bar ui-feedback-picker">
    <ColourPicker label="Any colour" value={own()} onChange={(hex) => { setOwn(hex as FeedbackInk); props.onInk?.(own()); }} />
  </Frost></Show>
  <Show when={options()}><Frost lift="raised" class="ui-feedback-bar" role="toolbar" aria-label="Tool options">
    <Show when={props.tool === "shape" && props.onShape}>{(onShape) => <Segmented label="Shape" icons size="sm" value={props.shape ?? "arrow"} onChange={onShape()} options={SHAPES} />}</Show>
    <Show when={inks()}>{(onInk) => <>
      <Segmented label="Ink (C)" icons size="sm" value={props.ink ?? "plain"} onChange={onInk()} options={PRESETS.map((value) => ({ value, label: FEEDBACK_INKS[value].label, icon: <Swatch colour={FEEDBACK_INKS[value].colour} /> }))} />
      {/* Any other colour; the last one chosen is kept to come back to. */}
      <IconButton data-any="" label="Any colour" aria-pressed={own() === props.ink} aria-expanded={picking()} onClick={() => { setPicking(own() !== props.ink || !picking()); onInk()(own()); }}><Swatch colour={own() === props.ink ? own() : undefined} /></IconButton>
    </>}</Show>
    <Show when={lined()}>{(onWeight) => <Segmented label="Line" icons size="sm" value={props.weight ?? "medium"} onChange={onWeight()} options={(Object.keys(FEEDBACK_WEIGHTS) as FeedbackWeight[]).map((value) => ({ value, label: FEEDBACK_WEIGHTS[value].label,
      icon: <span class="ui-feedback-weight" data-weight={value} data-kind={props.tool === "highlight" ? "highlight" : undefined} style={inked(props.ink)} /> }))} />}</Show>
    <Show when={props.compact}><IconButton label="Undo" disabled={!props.onUndo} onClick={() => props.onUndo?.()}><Icons.Undo /></IconButton></Show>
  </Frost></Show>
  <Frost lift="raised" class="ui-feedback-bar" role="toolbar" aria-label="UI feedback">
    <Show when={props.thread && props.onBack}><IconButton label="Back to marking up" onClick={props.onBack}><Icons.Back /></IconButton></Show>
    <Show when={!props.thread}>
      {/* With no screenshot to be had there are two modes, and one control says which. */}
      <Show when={props.screenshots} fallback={<IconButton label={views()[0]!.label} aria-pressed={using()} onClick={() => props.onView(using() ? "page" : "use")}><Icons.UseApp /></IconButton>}>
        <Segmented label="Mode" icons size="sm" value={props.view} onChange={props.onView} options={views()} />
      </Show>
      <Segmented label="Annotate with" icons size="sm" value={props.tool} onChange={(tool) => tool === "note" ? props.onNote() : props.onTool(tool)} disabled={using()}
        options={TOOLS.filter((option) => (!props.tools || props.tools.includes(option.value)) && !(props.compact && option.wide) && (props.view !== "screenshot" || (option.value !== "select" && option.value !== "quote"))).map((option) => ({ value: option.value, label: option.label, icon: option.icon() }))} />
    </Show>
    <Show when={!props.thread && !props.compact}><span class="ui-feedback-with">
      <IconButton label="Undo (Ctrl Z)" disabled={!props.onUndo || using()} onClick={() => props.onUndo?.()}><Icons.Undo /></IconButton>
      <IconButton label="Redo (Ctrl Shift Z)" disabled={!props.onRedo || using()} onClick={() => props.onRedo?.()}><Icons.Redo /></IconButton>
    </span></Show>
    <Show when={props.status && (props.thread || !props.compact)}><span class="ui-feedback-status">{props.status}</span></Show>
    <Show when={(props.replies || props.sent) && !props.thread}><IconButton label={props.replies ? `${props.replies} unread from the agent, on what was sent before` : "What was sent before"} count={props.replies || undefined} onClick={props.onReplies}><Icons.Inbox /></IconButton></Show>
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
    <Show when={props.standing && !props.compact}><span class="ui-feedback-status">{props.standing}</span></Show>
    <Show when={props.compact} fallback={<Button variant="primary" outline size="sm" disabled={!props.canSend || props.sending} onClick={props.onSend}><Show when={props.sending} fallback={(props.outstanding ?? 0) > 1 ? `Send ${props.outstanding}` : "Send"}><Spinner /></Show></Button>}>
      <IconButton label="Send" count={(props.outstanding ?? 0) > 1 ? props.outstanding : undefined} disabled={!props.canSend || props.sending} onClick={props.onSend}><Show when={props.sending} fallback={<Icons.Send />}><Spinner /></Show></IconButton>
    </Show>
    </Show>
    <CloseButton size="sm" label="Close feedback" onClick={props.onClose} />
  </Frost>
  </div>;
}
