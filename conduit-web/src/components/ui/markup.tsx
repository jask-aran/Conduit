import { createSignal, createUniqueId, For, onCleanup, onMount, Show, type JSX } from "solid-js";
// Through the barrel, so the tool's chunk takes these from the app's own and the build splits nothing new out of it.
import { Button, Card, ColourPicker, CardPreview, CloseButton, Dot, Frost, IconButton, Icons, Segmented, Spinner, Stepper, Swatch, Switch, TextArea } from "./index";
import { DropdownMenu, MenuContent, MenuControl, MenuRow, MenuSection } from "./menus";
import { clockTime } from "./time";
import "./styles/markup.css";

/* Not in the library's barrel: the tool imports this file when it is opened, so the app's first load does not carry it
   (its stylesheet comes with it). */

export type MarkupBox = { left: number; top: number; width: number; height: number };
/** Under this much room above a mark (px), its tag sits inside its corner; within eight times it of the right edge, the tag ends on the mark's right. */
const TAG_ROOM = 20;
const place = (box: MarkupBox): JSX.CSSProperties => ({ left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });

/** `frozen`: a screenshot of the page, shown over the page (which goes on changing under it). `text`: the pointer selects text.
 *  `grounded`: what the layer is over may be light (a site), where frost alone is white on white: its bar and cards then have the frost's own dark ground. */
export const MarkupLayer = (props: { select: boolean; text?: boolean; frozen?: string; hidden?: boolean; grounded?: boolean; ref?: (element: HTMLDivElement) => void; children: JSX.Element }) =>
  // data-mobile-swipe-ignore: a finger's drag on the layer gathers or draws; the drawers do not answer it (edge-swipe.ts).
  <div ref={props.ref} class="ui-markup-layer" data-select={props.select ? "" : undefined} data-text={props.text ? "" : undefined} data-hidden={props.hidden ? "" : undefined} data-grounded={props.grounded ? "" : undefined} data-mobile-swipe-ignore={props.select ? "" : undefined}>
    <Show when={props.frozen}><img class="ui-markup-frozen" src={props.frozen} alt="" /></Show>{props.children}
  </div>;

/** `quote`: one line of a run of text the person selected. */
export const MarkupMark = (props: { box: MarkupBox; kind: "cursor" | "chosen" | "member" | "marquee" | "drawn" | "quote" | "asked"; tag?: string; name?: string; current?: boolean; onOpen?: () => void }) =>
  <div class="ui-markup-mark" data-kind={props.kind} data-current={props.current ? "" : undefined} style={place(props.box)}>
    <Show when={props.tag || props.name}><span class="ui-markup-tag" data-press={props.onOpen ? "" : undefined} onClick={() => props.onOpen?.()} data-inside={props.box.top < TAG_ROOM ? "" : undefined} data-end={props.box.left + TAG_ROOM * 8 > window.innerWidth ? "" : undefined}><Show when={props.tag}><b>{props.tag}</b></Show><Show when={props.name}><span>{props.name}</span></Show></span></Show>
  </div>;

export type MarkupPoint = readonly [x: number, y: number];
/** What a drawing is drawn in. The first is the layer's own line. */
export const MARKUP_INKS = { plain: { label: "Plain", colour: "var(--primary)" }, red: { label: "Red", colour: "var(--destructive)" }, amber: { label: "Amber", colour: "var(--status-warn)" }, green: { label: "Green", colour: "var(--status-success)" }, blue: { label: "Blue", colour: "var(--status-unread)" } } as const;
/** One of those, or a colour of the person's own choosing. */
export type MarkupInk = keyof typeof MARKUP_INKS | `#${string}`;
export const markupInkColour = (ink: MarkupInk = "plain") => ink in MARKUP_INKS ? MARKUP_INKS[ink as keyof typeof MARKUP_INKS].colour : ink;
const inked = (ink?: MarkupInk): JSX.CSSProperties => ({ "--markup-ink": markupInkColour(ink) });
/** How thick a drawing's line is; a highlighter's is wider on its own scale. */
export const MARKUP_WEIGHTS = { thin: { label: "Thin" }, medium: { label: "Medium" }, thick: { label: "Thick" } } as const;
export type MarkupWeight = keyof typeof MARKUP_WEIGHTS;
/** How large the words written on the page are, in px. */
export const MARKUP_TEXT = { min: 10, max: 64, rest: 16 } as const;
/** `highlight`: a wide see-through line, drawn as the pen's is. */
export type MarkupDrawingKind = "pen" | "highlight" | MarkupShape;
/** What the Shape tool draws from the press to the release. */
export type MarkupShape = "line" | "arrow" | "box";
export const drawingBox = (points: readonly MarkupPoint[]): MarkupBox => {
  const xs = points.map((point) => point[0]), ys = points.map((point) => point[1]);
  const left = Math.min(...xs), top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
};
const line = (points: readonly MarkupPoint[]) => points.map((point, index) => `${index ? "L" : "M"}${point[0]} ${point[1]}`).join("");

export function MarkupDrawing(props: { kind: MarkupDrawingKind; points: readonly MarkupPoint[]; ink?: MarkupInk; weight?: MarkupWeight; shift?: { x: number; y: number }; current?: boolean }) {
  const head = createUniqueId();
  const ends = () => [props.points[0]!, props.points[props.points.length - 1]!] as const;
  const path = () => {
    if (props.kind === "pen" || props.kind === "highlight") return line(props.points);
    if (props.kind === "arrow" || props.kind === "line") return line(ends());
    const box = drawingBox(ends());
    return `M${box.left} ${box.top}h${box.width}v${box.height}h${-box.width}z`;
  };
  return <svg class="ui-markup-drawing" data-kind={props.kind} data-weight={props.weight ?? "medium"} data-current={props.current ? "" : undefined} style={{ ...inked(props.ink), translate: props.shift ? `${props.shift.x}px ${props.shift.y}px` : undefined }} aria-hidden="true">
    {/* The head is sized in line widths (markerUnits is strokeWidth), so it follows the line's token. */}
    <Show when={props.kind === "arrow"}><defs><marker id={head} viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L6 3L0 6z" /></marker></defs></Show>
    <Show when={props.points.length}><path d={path()} marker-end={props.kind === "arrow" ? `url(#${head})` : undefined} /></Show>
  </svg>;
}

/** Words written on the page, as a drawing: a field where they are, the size of what it holds; `editable` while its comment is being written. */
export const MarkupText = (props: { ref?: (element: HTMLInputElement) => void; at: MarkupPoint; ink?: MarkupInk; size?: number; shift?: { x: number; y: number }; value: string; editable?: boolean; onInput: (value: string, element: HTMLInputElement) => void; onDone: () => void }) =>
  <input ref={props.ref} class="ui-markup-text" data-editable={props.editable ? "" : undefined} readOnly={!props.editable} aria-label="Text on the page" placeholder="Text" value={props.value}
    style={{ ...inked(props.ink), "font-size": `${props.size ?? MARKUP_TEXT.rest}px`, left: `${props.at[0]}px`, top: `${props.at[1]}px`, translate: props.shift ? `${props.shift.x}px ${props.shift.y}px` : undefined }} onInput={(event) => props.onInput(event.currentTarget.value, event.currentTarget)} onBlur={props.onDone} />;

/** Every comment of the item, the newest at the foot, in the corner; `lift` is the bar's height when the stack has to stand over it. */
/** The room an artifact's pane keeps at its head for the ribbon, which stands over it: the host's `frame`. */
export const MarkupRibbonRoom = (props: { ref?: (element: HTMLDivElement) => void }) => <div ref={props.ref} class="ui-markup-room" />;
export const MarkupNotes = (props: { lift?: number; children: JSX.Element }) =>
  <div class="ui-markup-notes" data-lifted={props.lift ? "" : undefined} style={{ "--markup-bar-height": `${props.lift ?? 0}px` }}>{props.children}</div>;

/** A surface's margin (margin.tsx): every open comment's card. `beside`: each stands at the height of what it is about, where the margin is beside that (its `top` is set by who lays them out); else they are a list. */
export const MarkupMarginNotes = (props: { ref?: (element: HTMLDivElement) => void; beside: boolean; children: JSX.Element }) =>
  <div ref={props.ref} class="ui-markup-margin" data-beside={props.beside ? "" : undefined}>{props.children}</div>;

/** When a line of a thread was said, in as few words as place it: the minutes since, then the time today, then the day. */
const saidWhen = (at: string) => {
  const then = new Date(at), minutes = Math.floor((Date.now() - then.getTime()) / 60_000);
  if (!(minutes >= 1)) return "now";
  if (minutes < 60) return `${minutes} min`;
  return then.toDateString() === new Date().toDateString() ? clockTime(then) : then.toLocaleDateString([], { day: "numeric", month: "short" });
};

type Said = { from: "agent" | "person"; text: string; at?: string };

/** One comment, read as a short conversation: what it is about (`quote`, in the text's own face, a line or two), the person's words, then what was said since, each under who said it, and where it stands on one quiet line.
 *  `float`: where it sits beside what it is about; open, it is written there, with Done (and a quiet Remove); shut, a press opens it again. `sendNow` is whether Done also
 *  sends it (`onSendNow` changes that; none: it cannot be, as with no session listening). In the stack, shut, it shows its words and its
 *  `picture`, and a press opens it. `tag` and `name` head it where it is about a piece of the interface (its number, the piece's name); `source` is where that piece is written.
 *  `state` says where it stands (not sent, sent, being worked on, answered, resolved), `unread` an answer not yet opened. Once sent it is a thread:
 *  `words` is the comment and `said` what the agent (`by`) and the person have written about it since, each with when. Shut, it shows the comment and the latest of those,
 *  each cut short; open, all of it, the field is the person's answer (`placeholder`, sent by Reply: `onSay`), and Resolve stands with Reply. Shut, its corner resolves it (`onResolve`);
 *  `resolved` it folds to the comment until it is opened and reopened. `onRevert`: an agent changed something to answer it, which this takes back.
 *  `onAccept` and `onReject`: it is a proposed change, which is taken or declined, with no field. `key`: what a margin knows it by. */
export function MarkupNote(props: { ref?: (element: HTMLTextAreaElement) => void; key?: string; float?: JSX.CSSProperties; open: boolean; tag: string; name: string; quote?: string; source?: string; value: string; picture?: string; words?: string; said?: Said[]; by?: string; state?: { label: string; busy?: boolean }; unread?: boolean;
  placeholder?: string; resolved?: boolean; sendNow?: boolean; onSendNow?: (on: boolean) => void; onOpen: () => void; onInput: (value: string) => void; onDone?: () => void; onRemove?: () => void; onSay?: () => void; onResolve?: (resolved: boolean) => void; onRevert?: () => void; onAccept?: () => void; onReject?: () => void }) {
  const thread = () => props.said !== undefined;
  const head = () => Boolean(props.tag || props.name);
  const proposed = () => Boolean(props.onAccept || props.onReject);
  const latest = () => props.resolved ? undefined : props.said?.[props.said.length - 1];
  const words = () => thread() || proposed() ? props.words : props.open ? undefined : props.value.trim() || (props.picture ? undefined : "No comment yet");
  const corner = () => props.float || proposed() ? undefined : thread() ? (!props.open && props.onResolve && !props.resolved ? () => props.onResolve!(true) : undefined) : props.onRemove;
  const entry = (line: Said) => <div class="ui-markup-said" data-from={line.from}><span class="ui-markup-who">{line.from === "agent" ? props.by ?? "Agent" : "You"}<Show when={line.at}>{(at) => <time dateTime={at()}>{saidWhen(at())}</time>}</Show></span><p>{line.text}</p></div>;
  const actions = () => {
    if (proposed()) return <><Show when={props.onReject}><Button variant="ghost" size="sm" onClick={props.onReject}>Reject</Button></Show><Show when={props.onAccept}><Button variant="primary" outline size="sm" onClick={props.onAccept}>Accept</Button></Show></>;
    if (props.float && props.open) return <><Show when={props.sendNow !== undefined}><label class="ui-markup-now" title={props.onSendNow ? undefined : "Needs a session listening"}>Send now<Switch label="Send this comment as it is Done" checked={Boolean(props.sendNow)} disabled={!props.onSendNow} onChange={props.onSendNow} /></label></Show><Button variant="ghost" size="sm" onClick={props.onRemove}>Remove</Button><Button variant="primary" outline size="sm" onClick={props.onDone}>Done</Button></>;
    if (props.open && props.onSay) return <>
      <Show when={props.onRevert}><Button variant="ghost" size="sm" title="Put back what the agent changed for this comment" onClick={props.onRevert}>Revert</Button></Show>
      <Show when={props.resolved && props.onResolve}><Button variant="ghost" size="sm" onClick={() => props.onResolve!(false)}>Reopen</Button></Show>
      <span class="ui-markup-gap" />
      <Show when={!props.resolved && props.onResolve}><Button variant="ghost" size="sm" aria-label="Resolve" onClick={() => props.onResolve!(true)}><Icons.Check />Resolve</Button></Show>
      <Button variant="primary" outline size="sm" title="Reply (Ctrl Enter)" disabled={!props.value.trim()} onClick={props.onSay}>Reply</Button>
    </>;
    return undefined;
  };
  return <div class="ui-markup-note" data-key={props.key} style={props.float} data-float={props.float ? "" : undefined} data-open={props.open ? "" : undefined} data-head={head() ? "" : undefined} data-proposed={proposed() ? "" : undefined} onClick={(event) => { if (!props.open && !(event.target as Element).closest("button")) props.onOpen(); }}>
    <Card size="compact" role="group" label={props.tag ? `Comment ${props.tag}` : props.name || props.quote || (proposed() ? "Suggestion" : "Comment")}
      title={head() ? <><Show when={props.tag}><b class="ui-markup-number">{props.tag}</b></Show><span class="ui-markup-name">{props.name}</span></> : undefined}
      close={corner()} closeLabel={thread() ? "Resolve" : "Remove"} closeIcon={thread() ? <Icons.Check /> : undefined} actions={actions()}>
      <div class="ui-markup-talk">
        <Show when={props.quote}><p class="ui-markup-quote">{props.quote}</p></Show>
        <Show when={!props.quote && !thread() && props.open && props.source}><p class="ui-markup-source">{props.source}</p></Show>
        <Show when={props.picture && !props.float && (!thread() || props.open)}><CardPreview><img src={props.picture} alt="" /></CardPreview></Show>
        <Show when={words()}><Show when={thread()} fallback={<p class="ui-markup-words">{words()}</p>}><div class="ui-markup-said" data-from="person"><span class="ui-markup-who">You</span><p>{words()}</p></div></Show></Show>
        <Show when={thread()}><Show when={props.open} fallback={<Show when={latest()} keyed>{entry}</Show>}><For each={props.said}>{entry}</For></Show></Show>
        <Show when={props.state || props.unread}><p class="ui-markup-state"><Show when={props.unread}><Dot tone="unread" aria-label="Unread" /></Show><Show when={props.state?.busy}><Spinner /></Show>{props.state?.label ?? "Unread"}</p></Show>
      </div>
      <Show when={props.open}><TextArea ref={props.ref} rows={1} placeholder={props.placeholder ?? "What should change?"} value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} /></Show>
    </Card>
  </div>;
}

/** `quote`: a run of text on the live page, chosen as text is selected. */
export type MarkupToolKind = "select" | "quote" | "pen" | "highlight" | "shape" | "text" | "erase";
/** `wide`: left off the compact bar, which has no room for it (its key still works). */
const OPTIONED: readonly string[] = ["pen", "highlight", "shape", "text"];
const SHAPES: Array<{ value: MarkupShape; label: string; icon: JSX.Element }> = [{ value: "line", label: "Line (L)", icon: <Icons.DrawLine /> }, { value: "arrow", label: "Arrow (A)", icon: <Icons.DrawArrow /> }, { value: "box", label: "Box (B)", icon: <Icons.DrawBox /> }];
const PRESETS = Object.keys(MARKUP_INKS) as Array<keyof typeof MARKUP_INKS>;
const TOOLS: ReadonlyArray<{ value: MarkupToolKind | "note"; label: string; icon: () => JSX.Element; wide?: true }> = [
  { value: "select", label: "Select (V)", icon: () => <Icons.Pointer /> }, { value: "quote", label: "Select text (Q)", icon: () => <Icons.SelectText />, wide: true },
  { value: "pen", label: "Pen (P)", icon: () => <Icons.Edit /> }, { value: "highlight", label: "Highlighter (H)", icon: () => <Icons.Highlight /> },
  { value: "shape", label: "Shape: line, arrow or box (S)", icon: () => <Icons.Shapes /> }, { value: "text", label: "Text (T)", icon: () => <Icons.DrawText /> },
  { value: "erase", label: "Eraser (E)", icon: () => <Icons.Erase /> }, { value: "note", label: "General note (N)", icon: () => <Icons.Note /> },
];
/** Use the app (no tool held), or annotate: the live page, or a screenshot of it. */
export type MarkupView = "use" | "page" | "screenshot";
const VIEWS: ReadonlyArray<{ value: MarkupView; label: string; icon: () => JSX.Element }> = [
  { value: "page", label: "Annotate the live page", icon: () => <Icons.Feedback /> }, { value: "screenshot", label: "Annotate a screenshot", icon: () => <Icons.Image /> },
];

/** A host's own tool in the bar, read where it is drawn (so a getter follows). `menu`: on the ribbon, those of one menu stand as one control under that name, `active` the one
 *  that is so now. A tool of no menu is a toggle, `pressed` while it is on (a mark the selection wears; unsaid, `active`). `disabled`: not to be done here.
 *  `keys`: its shortcut, as its tooltip says it. */
export type MarkupOwnTool = { name: string; label: string; icon: () => JSX.Element; active?: boolean; pressed?: boolean; disabled?: boolean; keys?: string[]; menu?: string; /** Its menu's control shows the icon alone (a swatch says its colour). */ compact?: boolean; run: () => void };

const named = (label: string, keys?: readonly string[]) => keys?.length ? `${label} (${keys.join(" ")})` : label;
/** How far the ribbon has folded to fit its frame: 1 drops the captions, 2 makes the edit set one Format menu, 3 Markup's tools one Annotate menu too. */
const FOLDS = 3;

/** The tool's bar, at the foot: what is annotated (`view`: the live page or a screenshot, offered only where the client can take one);
 *  the annotating tools, with a general note among them and neither Select on a screenshot, which has nothing under it to select; beside them
 *  the ink and thickness the next drawing is in (`picking`: their popover is open), and Undo, both left to the keyboard and the eraser on a phone; a new screenshot while
 *  one is looked at; the listening session the item is handed to (`agent`, none when no session listens; `heard` false until the receiver has said who listens); Send and close. `compact`: icons alone,
 *  for a phone's width. `tools`: the ones this host offers (all, unsaid). `thread`: the item is sent and its thread is followed, so the bar is only what was said of it (`status`) and close.
 *  `onBack` then leaves it for marking up again. `replies`: answers unread on what was sent before, and `sent` how many of those there are to come back to (`onReplies`).
 *  `thin` (unsaid: so): its surface is thinner than the library's frost, to sit over an interface being looked at. A tool pressed while the app is in use goes back to annotating with it.
 *  `outstanding`: how many comments Send would deliver; `standing`: where the item they have gone to stands, once some have.
 *  `ribbon`: it stands at the head of the frame and is always there: the host's tools (its edit set) are a bar of their own beside Markup's, each captioned, whatever the mode (one pressed while annotating goes back to using the app), what a tool draws with stands under it, and it has no close.
 *  The two stay on one line: where the frame is narrower than they need (measured), the captions go, then the edit set folds into one Format menu, then Markup's tools into one Annotate menu; the agent and Send stay.
 *  Neither form has a "Use the app": the app is in use while no tool is held, a tool pressed is held, and pressed again is let go (on the foot, a view pressed again too). The ribbon has no "Ask the agent" either: on a paper `@`, the tools over a selection and a block's menu each start that comment.
 *  On the ribbon what is sent is always handed on, so who it goes to is said and not a choice to turn off; Undo and Redo work while the app is in use (the tool decides whose history they step).
 *  `own`: the host's own tools (a document's block kinds), `onOwn` told as one is pressed, and `onAsk` a comment about where the surface's selection or caret is: a rail above the bar while the app is in use. */
export function MarkupBar(props: { view: MarkupView; own?: readonly MarkupOwnTool[]; onOwn?: () => void; onAsk?: () => void; ribbon?: boolean; screenshots?: boolean; onView: (view: MarkupView) => void; tools?: readonly (MarkupToolKind | "note")[]; tool: MarkupToolKind; onTool: (tool: MarkupToolKind) => void; onNote: () => void; outstanding?: number; standing?: string; thin?: boolean; thread?: boolean; onBack?: () => void; replies?: number; sent?: number; onReplies?: () => void; ink?: MarkupInk; onInk?: (ink: MarkupInk) => void; weight?: MarkupWeight; onWeight?: (weight: MarkupWeight) => void; size?: number; onSize?: (size: number) => void; shape?: MarkupShape; onShape?: (shape: MarkupShape) => void; onUndo?: () => void; onRedo?: () => void; status?: string; compact?: boolean; hand?: boolean; onHand?: (on: boolean) => void; agent?: string; heard?: boolean; onNextAgent?: () => void; onRetake?: () => void;
  canSend: boolean; sending?: boolean; onSend: () => void; onClose: () => void }) {
  const using = () => props.view === "use";
  // What the chosen tool draws with stands over the bar while that tool is held, so the bar itself stays the tools.
  const inks = () => OPTIONED.includes(props.tool) ? props.onInk : undefined, lined = () => props.tool !== "text" && inks() ? props.onWeight : undefined;
  const [own, setOwn] = createSignal<MarkupInk>(props.ink?.startsWith("#") ? props.ink : "#ff3b9a");
  const [picking, setPicking] = createSignal(false);
  const offered = () => TOOLS.filter((option) => (!props.tools || props.tools.includes(option.value)) && !(props.compact && option.wide) && (props.view !== "screenshot" || !(option.value === "select" || option.value === "quote"))).map((option) => ({ value: option.value, label: option.label, icon: option.icon() }));
  const options = () => !props.thread && !using() && (OPTIONED.includes(props.tool) || props.tool === "erase") && (inks() || props.compact);
  const press = (tool: MarkupOwnTool) => { if (!using()) props.onView("use"); props.onOwn?.(); tool.run(); };
  // On the ribbon the tools of one `menu` are one control, which shows the one that is so now.
  const menus = () => props.ribbon ? [...new Set((props.own ?? []).flatMap((tool) => tool.menu ? [tool.menu] : []))] : [];
  const of = (menu: string) => props.own!.filter((tool) => tool.menu === menu);
  const toggles = () => props.own?.filter((tool) => !menus().includes(tool.menu ?? "")) ?? [];
  const pressed = (tool: MarkupOwnTool) => tool.pressed ?? tool.active;
  const choice = (tool: MarkupOwnTool, on = tool.active) => <MenuRow icon={tool.icon()} checked={on || undefined} disabled={tool.disabled} keys={tool.keys} onSelect={() => press(tool)}>{tool.label}</MenuRow>;
  // One control a menu, as wide as any other tool of the bar and showing the one that is so now by its icon: the bars hold still as the caret moves.
  const kinds = (menu: string) => { const now = () => of(menu).find((tool) => tool.active) ?? of(menu)[0]!; return <DropdownMenu modal={false} placement="bottom-start">
    <MenuControl as={IconButton} label={`${menu}: ${now().label}`}>{now().icon()}</MenuControl>
    <MenuContent width="sm"><MenuSection title={menu}><For each={of(menu)}>{(tool) => choice(tool)}</For></MenuSection></MenuContent>
  </DropdownMenu>; };
  const owned = () => <>
    <For each={menus()}>{kinds}</For>
    <For each={toggles()}>{(tool) => <IconButton label={named(tool.label, tool.keys)} aria-pressed={Boolean(pressed(tool))} disabled={tool.disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => press(tool)}>{tool.icon()}</IconButton>}</For>
    <Show when={props.onAsk && !props.ribbon}><Button variant="ghost" size="sm" onClick={props.onAsk}><Icons.Agent />Ask the agent</Button></Show>
  </>;
  const format = () => <DropdownMenu modal={false} placement="bottom-start">
    <MenuControl as={Button} variant="ghost" size="sm" aria-label="Format" title="Format">Format<Icons.ChevronDown /></MenuControl>
    <MenuContent width="sm">
      <For each={menus()}>{(menu) => <MenuSection title={menu}><For each={of(menu)}>{(tool) => choice(tool)}</For></MenuSection>}</For>
      <Show when={toggles().length}><MenuSection><For each={toggles()}>{(tool) => choice(tool, pressed(tool))}</For></MenuSection></Show>
    </MenuContent>
  </DropdownMenu>;
  const pick = (option: { value: MarkupToolKind | "note" }) => !using() && option.value === props.tool ? props.onView("use") : option.value === "note" ? props.onNote() : props.onTool(option.value);
  const keep = (event: MouseEvent) => { if (props.ribbon) event.preventDefault(); };
  const undo = () => <IconButton label="Undo (Ctrl Z)" disabled={!props.onUndo || (using() && !props.ribbon)} onMouseDown={keep} onClick={() => props.onUndo?.()}><Icons.Undo /></IconButton>;
  const redo = () => <IconButton label="Redo (Ctrl Shift Z)" disabled={!props.onRedo || (using() && !props.ribbon)} onMouseDown={keep} onClick={() => props.onRedo?.()}><Icons.Redo /></IconButton>;
  const annotate = () => <DropdownMenu modal={false} placement="bottom-start">
    <MenuControl as={Button} variant="ghost" size="sm" aria-label="Annotate" title="Annotate"><Icons.Feedback />Annotate<Icons.ChevronDown /></MenuControl>
    <MenuContent width="sm">
      <MenuSection title="Annotate with"><For each={offered()}>{(option) => <MenuRow icon={option.icon} checked={(!using() && option.value === props.tool) || undefined} onSelect={() => pick(option)}>{option.label}</MenuRow>}</For></MenuSection>
      <MenuSection><MenuRow icon={<Icons.Undo />} keys={["Ctrl", "Z"]} disabled={!props.onUndo} onSelect={() => props.onUndo?.()}>Undo</MenuRow><MenuRow icon={<Icons.Redo />} keys={["Ctrl", "Shift", "Z"]} disabled={!props.onRedo} onSelect={() => props.onRedo?.()}>Redo</MenuRow></MenuSection>
    </MenuContent>
  </DropdownMenu>;

  // The ribbon's fold, from what its bars need (measured as they are drawn at each fold) against the room its frame gives.
  const [fold, setFold] = createSignal(0);
  const needs: number[] = [];
  let rails: HTMLDivElement | undefined;
  const fit = () => {
    for (let tries = 0; rails && tries <= 2 * FOLDS; tries++) {
      const sets = [...rails.querySelectorAll<HTMLElement>(":scope > [data-set]")], gap = parseFloat(getComputedStyle(rails).columnGap) || 0, at = fold();
      for (const set of sets) sizes.observe(set);
      needs[at] = sets.reduce((sum, set) => sum + set.offsetWidth + gap, -gap);
      const next = needs[at]! > rails.clientWidth && at < FOLDS ? at + 1 : at > 0 && (needs[at - 1] ?? Infinity) <= rails.clientWidth ? at - 1 : at;
      if (next === at) return;
      setFold(next);
    }
  };
  // A set that comes later (the host's tools, once its editor is made) is measured as it comes.
  const sizes = new ResizeObserver(fit), sets = new MutationObserver(fit);
  onMount(() => { if (props.ribbon && rails) { sizes.observe(rails); sets.observe(rails, { childList: true }); } });
  onCleanup(() => { sizes.disconnect(); sets.disconnect(); });
  const caption = (words: string) => <Show when={props.ribbon && fold() < 1}><span class="ui-title-text ui-markup-caption">{words}</span></Show>;

  return <div ref={rails} class="ui-markup-rails" data-ribbon={props.ribbon ? "" : undefined} data-compact={props.compact ? "" : undefined} data-thin={props.thin === false ? undefined : ""}>
  <Show when={picking() && options() && props.ink?.startsWith("#") && inks()}><Frost lift="raised" class="ui-markup-bar ui-markup-picker">
    <ColourPicker label="Any colour" value={own()} onChange={(hex) => { setOwn(hex as MarkupInk); props.onInk?.(own()); }} />
  </Frost></Show>
  <Show when={options()}><Frost lift="raised" class="ui-markup-bar" role="toolbar" aria-label="Tool options">
    <Show when={props.tool === "shape" && props.onShape}>{(onShape) => <Segmented label="Shape" icons size="sm" value={props.shape ?? "arrow"} onChange={onShape()} options={SHAPES} />}</Show>
    <Show when={inks()}>{(onInk) => <>
      <Segmented label="Ink (C)" icons size="sm" value={props.ink ?? "plain"} onChange={onInk()} options={PRESETS.map((value) => ({ value, label: MARKUP_INKS[value].label, icon: <Swatch colour={MARKUP_INKS[value].colour} /> }))} />
      {/* Any other colour; the last one chosen is kept to come back to. */}
      <IconButton data-any="" label="Any colour" aria-pressed={own() === props.ink} aria-expanded={picking()} onClick={() => { setPicking(own() !== props.ink || !picking()); onInk()(own()); }}><Swatch colour={own() === props.ink ? own() : undefined} /></IconButton>
    </>}</Show>
    <Show when={lined()}>{(onWeight) => <Segmented label="Line" icons size="sm" value={props.weight ?? "medium"} onChange={onWeight()} options={(Object.keys(MARKUP_WEIGHTS) as MarkupWeight[]).map((value) => ({ value, label: MARKUP_WEIGHTS[value].label,
      icon: <span class="ui-markup-weight" data-weight={value} data-kind={props.tool === "highlight" ? "highlight" : undefined} style={inked(props.ink)} /> }))} />}</Show>
    {/* Written words have a size where a line has a thickness. */}
    <Show when={props.tool === "text" && props.onSize}>{(onSize) => <Stepper label="Text size" unit="px" min={MARKUP_TEXT.min} max={MARKUP_TEXT.max} value={props.size ?? MARKUP_TEXT.rest} onChange={onSize()} />}</Show>
    <Show when={props.compact}><IconButton label="Undo" disabled={!props.onUndo} onClick={() => props.onUndo?.()}><Icons.Undo /></IconButton></Show>
  </Frost></Show>
  {/* Only while the app is in use, as the options are only while annotating: the two never stand together. */}
  <Show when={(props.ribbon || using()) && !props.thread && (props.own?.length || (props.onAsk && !props.ribbon))}><Frost lift="raised" class="ui-markup-bar" data-set="edit" role="toolbar" aria-label="Document tools">
    {caption("Edit")}<Show when={fold() < 2} fallback={format()}>{owned()}</Show>
  </Frost></Show>
  <Show when={props.ribbon}><span class="ui-markup-break" /></Show>
  <Frost lift="raised" class="ui-markup-bar" data-set="markup" role="toolbar" aria-label="UI markup">
    <Show when={props.thread && props.onBack}><IconButton label="Back to marking up" onClick={props.onBack}><Icons.Back /></IconButton></Show>
    <Show when={!props.thread}>
      {caption("Mark up")}
      {/* With no screenshot to be had, a tool is all it takes to annotate the live page. */}
      <Show when={!props.ribbon && props.screenshots}><span class="ui-markup-with" role="group" aria-label="Mode"><For each={VIEWS}>{(option) =>
        <IconButton label={option.label} aria-pressed={props.view === option.value} onClick={() => props.onView(props.view === option.value ? "use" : option.value)}>{option.icon()}</IconButton>}</For></span></Show>
      <Show when={fold() < FOLDS} fallback={annotate()}>
        <span class="ui-markup-with" role="group" aria-label="Annotate with"><For each={offered()}>{(option) => <IconButton label={option.label} aria-pressed={!using() && option.value === props.tool} onClick={() => pick(option)}>{option.icon}</IconButton>}</For></span>
      </Show>
    </Show>
    <Show when={!props.thread && !props.compact && !(props.ribbon && fold() >= FOLDS)}><span class="ui-markup-with">{undo()}{redo()}</span></Show>
    <Show when={props.status && (props.thread || !(props.compact || props.ribbon))}><span class="ui-markup-status">{props.status}</span></Show>
    <Show when={(props.replies || props.sent) && !props.thread}><IconButton label={props.replies ? `${props.replies} unread from the agent, on what was sent before` : "What was sent before"} count={props.replies || undefined} onClick={props.onReplies}><Icons.Inbox /></IconButton></Show>
    <Show when={!props.thread}>
    <span class="ui-markup-with">
      <Show when={props.onRetake && props.view === "screenshot"}><IconButton label="Take the screenshot again" onClick={props.onRetake}><Icons.Camera /></IconButton></Show>
      {/* Until the receiver has said who listens, nothing is said of it: "No listener" is only ever what it answered. */}
      {/* On an artifact's ribbon the bar is only the tools: who listens is its pane's to say, and Send stands with its comments there. */}
      <Show when={props.onHand && props.heard !== false && !props.ribbon}>
        <Show when={!props.ribbon} fallback={<IconButton label={props.agent ? `Handed to ${props.agent}` : "No session is listening"} disabled={!props.onNextAgent} aria-pressed={Boolean(props.agent)} onClick={() => props.onNextAgent?.()}><Icons.Agent /></IconButton>}><IconButton label={props.agent ? `Hand to ${props.agent}` : "No session is listening"} disabled={!props.agent} aria-pressed={Boolean(props.agent && props.hand)} onClick={() => props.onHand!(!props.hand)}><Icons.Agent /></IconButton></Show>
        <Show when={props.agent} fallback={<Show when={!props.compact}><span class="ui-markup-status">No listener</span></Show>}>
          <Show when={props.hand}><Show when={props.onNextAgent} fallback={<span class="ui-markup-status">{props.agent}</span>}><Button variant="ghost" size="sm" title="The next waiting session" onClick={props.onNextAgent}>{props.agent}</Button></Show></Show>
        </Show>
      </Show>
    </span>
    <Show when={props.standing && !props.compact}><span class="ui-markup-status">{props.standing}</span></Show>
    <Show when={!props.ribbon}><Show when={props.compact} fallback={<Button variant="primary" outline size="sm" title="Send (Ctrl Enter)" disabled={!props.canSend || props.sending} onClick={props.onSend}><Show when={props.sending} fallback={(props.outstanding ?? 0) > 1 ? `Send ${props.outstanding}` : "Send"}><Spinner /></Show></Button>}>
      <IconButton label="Send" count={(props.outstanding ?? 0) > 1 ? props.outstanding : undefined} disabled={!props.canSend || props.sending} onClick={props.onSend}><Show when={props.sending} fallback={<Icons.Send />}><Spinner /></Show></IconButton>
    </Show></Show>
    </Show>
    <Show when={!props.ribbon}><CloseButton size="sm" label="Close markup" onClick={props.onClose} /></Show>
  </Frost>
  </div>;
}
