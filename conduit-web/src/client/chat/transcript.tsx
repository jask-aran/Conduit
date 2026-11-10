import { AgentRows, clockTime, createTranscriptFollow, Icons, onScrollRest, rideBottom, RoutineIcon, RunLine } from "@/components/ui";
import { dropLatestScroller, setLatestScroller, tellLatestAway } from "./latest-away";
import { COPY_FEEDBACK_MS } from "@/components/ui/motion";
import { createComputed, createEffect, createMemo, createRenderEffect, createSignal, For, on, onCleanup, onMount, Show, Suspense, untrack, type JSX } from "solid-js";

import type { BooleanCapability, Message, ToolItem } from "../api/contracts";
import { isChatContentActivity, type TranscriptSource } from "./transcript-source";
import type { TurnArtifactSummary } from "../api/live-events";
import { clearDock } from "@/components/ui/dock-inset";
import { AttachmentCards } from "./attachments";
import { ReviewCommentCards } from "./review-comment-cards";
import { parseReviewComments } from "./review-comments";
import { type ContextText, TraceStarting, TurnTrace } from "./turn-trace";
import { jumpToSpawn, openAgentChat, TurnReports } from "./agents";
import { createTimelineStore } from "../state/timeline-store";
import { createLeavingRows } from "./composer-cards";
import { isAgentReport, isRun, type TurnRow, type TurnTraceData } from "../turn-rows";
import { runForm } from "../preferences/run-form";
import { motionOf } from "@/components/ui/shared";
import { UI_PREFERENCE_CHANGE_EVENT } from "../preferences/ui-preferences";
import { copyWithFeedback } from "./markdown-actions";
import { CODE_BLOCK_TOGGLE_EVENT, publishCodeBlockToggle } from "./code-block";
import { highlightCodeBlocks } from "./code-highlight";
import {
  selectedCodeBlockCollapse,
  selectedCodeBlockCollapseLines,
  isCodeBlockCollapseMode,
  isCodeBlockCollapseLines,
  useUserMessageCollapse,
  userMessageCollapseLines,
} from "./transcript-appearance";
import { mountTranscriptPanelMotion } from "./transcript-motion";
import { mountTranscriptVisibility } from "./transcript-visibility";
import { isMobileLayout, MOBILE_LAYOUT_QUERY } from "../navigation/mobile-layout";
import {
  HISTORY_LOAD_TOP_PX,
  TAIL_NEAR_LATEST_PX,
  shouldFollowAfterHistoryRestore,
  shouldLoadEarlierHistory,
  shouldRestoreHistoryAnchor,
} from "@/components/ui/tail-follow";
import { captureTranscriptAnchor, restoreTranscriptAnchor } from "./transcript-anchor";
import { api } from "../api/client";
import { requestTurnArtifactNavigation } from "./turn-artifact-navigation";
import { ApprovalCard, haptic, type ApprovalChoice, type ApprovalLine, type ApprovalState, ChatEmpty, ChatScroller, Welcome, Answer, Button as LibraryButton, Changes, CopyButton, ConduitAdded, Failure, HarnessPrompt, Inbound, LoadingEarlier, Message as LibraryMessage, MessageFoot, Outbound, RiderButton, StopLine, TranscriptList, TranscriptRow, type TranscriptFlow, Turn } from "@/components/ui";
import { ChatMarkdown } from "./lazy-markdown";
import { DropdownMenu, MenuContent, MenuControl, MenuRow } from "@/components/ui/menus";
import { FindBar } from "@/components/ui/find";
import { mountTranscriptCursor, visibleBand } from "./transcript-cursor";
import { createTranscriptFind, type FindMatch } from "./transcript-find";
import { fullDateTime } from "./full-date-time";
import { elapsed } from "./tool-card";


/**
 * A user message, folded when it is long enough to push the answer off screen.
 *
 * The fold is a line clamp rather than a character budget, because what costs
 * the reader is screen height, not text length -- one pasted 300-character
 * paragraph is two lines, and twelve short lines is twelve. Whether a message
 * actually exceeds the fold is therefore a measured fact.
 *
 * Measuring every bubble on load would be a forced layout per message, so the
 * cheap arithmetic test runs first: a message that cannot reach the fold even
 * at a pessimistic 24 characters per line is never measured at all, which is
 * almost every message anyone sends.
 */
/** A message the user sent: the library's Message, given the fold preference, the edit state and its foot. */
function UserMessage(props: { latest?: boolean; message: Message; text: string; editing: boolean; editable: boolean; since?: number; under: JSX.Element; onEdit: () => void; onCancelSend?: () => void }) {
  const preference = useUserMessageCollapse();
  const [open, setOpen] = createSignal(false);
  // Pessimistic: a line holds at least 24 characters. Under that budget a message cannot fill the fold at any
  // column width, so it is not given one and never measured.
  const fold = () => {
    const limit = userMessageCollapseLines(preference.mode());
    if (!limit) return undefined;
    let breaks = 1;
    for (let index = 0; index < props.text.length; index += 1) if (props.text[index] === "\n") breaks += 1;
    return breaks > limit || props.text.length > limit * 24 ? limit : undefined;
  };
  const toggle = (event: MouseEvent) => {
    const row = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-slot="message-scroller-item"]');
    const previousTop = row?.getBoundingClientRect().top;
    setOpen((value) => !value);
    // Opening a long message adds real height above everything below it: the code card's hold-and-re-measure path,
    // rather than leaving the reading position to browser scroll anchoring.
    if (row && previousTop != null) publishCodeBlockToggle(row, previousTop);
  };
  const timestamp = () => props.message.timestamp || undefined;
  return <LibraryMessage motion={props.since != null ? "entering" : undefined} since={props.since} editing={props.editing} fold={fold()} open={open()} onToggle={toggle}
    at={timestamp()} eager={props.latest}
    status={props.message.outbox ? "Waiting to send" : undefined}
    before={props.message.notes ? <ConduitAdded before text={props.message.notes} /> : undefined}
    under={props.under}
    actions={<>
      <Show when={props.editable}><LibraryButton variant="ghost" size="icon-xs" aria-label={props.editing ? "Cancel editing" : "Edit from here"} onClick={props.onEdit}><Icons.Edit /></LibraryButton></Show>
      <Show when={props.message.outbox && props.onCancelSend}><LibraryButton variant="ghost" size="icon-xs" aria-label="Don't send" title="Don't send: back into the composer" onClick={() => props.onCancelSend!()}><Icons.Close /></LibraryButton></Show>
    </>}>
    {props.text || undefined}
  </LibraryMessage>;
}

/** A turn's changes, opening them in Agent changes. */
function TurnChanges(props: { artifact: TurnArtifactSummary; chatId: string }) {
  // A settled turn's changes are its own; an open one's run to the working copy (an older chat's, to the next turn).
  const range = () => props.artifact.targetSequence === props.artifact.sequence ? `Turn ${props.artifact.sequence}`
    : `Turn ${props.artifact.sequence} → ${props.artifact.targetSequence === null ? "Working copy" : `Turn ${props.artifact.targetSequence}`}`;
  return <Changes added={props.artifact.summary!.added} removed={props.artifact.summary!.removed} title={range()}
    label={`Open ${range()} in Agent changes: ${props.artifact.summary!.added} additions and ${props.artifact.summary!.removed} removals`}
    onOpen={() => requestTurnArtifactNavigation({ chatId: props.chatId, checkpointId: props.artifact.id, path: props.artifact.summary!.preferredPath })} />;
}

/** A guess at a row's height (px) from its text, for how many rows a chat opens on (createTailWindow's estimate):
 *  a line of text a column's characters wide, and a row's own furniture (its foot, a bubble's padding). */
function estimateRowHeight(row: TurnRow, columnChars: number) {
  if (row.type !== "message") return 32;
  const text = row.value.content?.length || 0;
  const lines = Math.ceil(text / columnChars) + (row.value.content?.split("\n").length || 1) / 2;
  return 56 + lines * 24 + (row.value.attachments?.length ? 160 : 0);
}

/* A message's time leads its foot, muted -- not a line of its own above it. */
// The library's, made once (time.ts).
const clock = clockTime;

/** An answer's foot: its time, how it ended if it did not finish, then Copy, Regenerate and its changes. */
function AnswerFoot(props: { latest?: boolean; message: Message; precedingUserId?: string; chat: TranscriptSource; supports: (capability: BooleanCapability) => boolean; artifact?: TurnArtifactSummary; traced?: boolean; reveal?: boolean; copied: boolean; onCopy: () => void }) {
  /* A stopped turn says "Interrupted" once, on its first row. A trace above
     says it for the turn; a discarded or unwritten answer says it on its stop
     row; a kept answer with nothing above it says it here. */
  const status = () => {
    if (!props.message.stopped) return undefined;
    if (props.message.status === "stopping") return "Stopping…";
    return props.message.content && !props.message.discarded && !props.traced ? "Interrupted" : undefined;
  };
  /* Nothing to copy from an answer that was never written, or one the agent
     was not given back. */
  const copyable = () => !props.message.discarded && Boolean(props.message.content || props.message.errorMessage);
  return <MessageFoot motion={props.reveal ? "entering" : undefined} at={props.message.timestamp} eager={props.latest} status={status()}>
      <Show when={copyable()}><CopyButton copied={props.copied} label="Copy Markdown" onCopy={props.onCopy} /></Show>
      <Show when={props.supports("regenerate") && props.precedingUserId}><LibraryButton variant="ghost" size="icon-xs" aria-label="Regenerate response" onClick={() => void props.chat.regenerate(props.precedingUserId!)}><Icons.Refresh /></LibraryButton></Show>
      <Show when={props.artifact}>{(entry) => <TurnChanges artifact={entry()} chatId={props.chat.loadedId()!} />}</Show>
  </MessageFoot>;
}

/* The composer is where an edit happens, so starting or leaving one puts the
   caret there once the draft has been swapped in. */
const focusComposerSoon = () => requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("textarea[data-composer-input]:not([disabled])")?.focus({ preventScroll: true }));

/** One of a row's actions as its menu lists them (the transcript cursor's Menu key): what its foot offers. */
type TurnAction = { label: string; icon: JSX.Element; run: () => void };

/** An approval as the thread draws it (GET /v0/agent `asks`). */
export type TranscriptAsk = { id: string; toolCallId: string; parentCallId: string | null; run?: string | null; always?: string | null; choices?: ApprovalChoice[]; title: string; service: string | null; lines: ApprovalLine[]; expiresAt: string; status: ApprovalState };
const APPROVAL_NOTE = "[Approval] ";
// How long a message in or out reads before it folds ("Show all"): a heartbeat's report is often a page.
const ENVELOPE_FOLD = 8;
const approvalMeta = (text: string) => {
  const body = text.slice(APPROVAL_NOTE.length);
  const ask = /\(ask ([^)]+)\)/.exec(body)?.[1];
  return [body.startsWith("Allowed") ? "an approval allowed" : body.startsWith("Not allowed") ? "an approval declined" : "an approval", ask].filter(Boolean).join(" · ");
};
/** Text in a message in or out: the answer's Markdown, settled (it arrives whole). */
function ChatText(props: { text: string }) {
  return <Answer><Suspense fallback={<div class="markdown-skeleton" />}><ChatMarkdown streaming={false}>{props.text}</ChatMarkdown></Suspense></Answer>;
}
/** What the turn sent the person (a `message` tool): a notification as it reached their devices. */
function SentRow(props: { tool: ToolItem }) {
  const input = () => (props.tool.input && typeof props.tool.input === "object" ? props.tool.input : {}) as { title?: unknown; text?: unknown; urgent?: unknown; notify?: unknown };
  // `message` writes to the message log (the app room), reaching the phone only when it asks; `notify` is the phone.
  const message = () => props.tool.name === "message";
  const pushed = () => message() ? input().notify === "push" || input().notify === "urgent" : true;
  const state = () => props.tool.done === false ? "sending" : props.tool.isError || props.tool.cancelled ? "not sent"
    : message() ? (pushed() ? "in the app and to your devices" : "in the app") : "to your devices";
  const urgent = () => input().urgent === true || input().notify === "urgent";
  return <Outbound shut icon={message() && !pushed() ? <Icons.Chat aria-hidden="true" /> : <Icons.Notification aria-hidden="true" />}
    from={message() ? (typeof input().title === "string" ? "Report" : "Message") : "Notification"} meta={[state(), urgent() && "urgent"].filter(Boolean).join(" · ")}
    time={clock(props.tool.completedAt || props.tool.timestamp)} dateTime={props.tool.completedAt || props.tool.timestamp} title={props.tool.timestamp ? fullDateTime(props.tool.timestamp) : undefined}>
    <ChatText text={[typeof input().title === "string" && `**${input().title}**`, typeof input().text === "string" && input().text].filter(Boolean).join("\n\n")} />
  </Outbound>;
}
/* Waits for how long, as the card's meta: "23 h", "40 min". */
const waitsFor = (expiresAt: string) => { const minutes = Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 60_000)); return minutes >= 90 ? `${Math.round(minutes / 60)} h left` : `${minutes} min left`; };
function AskCard(props: { ask: TranscriptAsk; answer: (id: string, choice: ApprovalChoice) => Promise<void> }) {
  const [busy, setBusy] = createSignal(false);
  return <ApprovalCard title={props.ask.title} service={props.ask.service} lines={props.ask.lines} state={props.ask.status} busy={busy()} always={props.ask.always ?? null} choices={props.ask.choices}
    meta={props.ask.status === "pending" ? waitsFor(props.ask.expiresAt) : undefined}
    onChoose={(choice) => { setBusy(true); void props.answer(props.ask.id, choice).finally(() => setBusy(false)); }} />;
}

export function Transcript(props: { /** Nothing here is the person's to change (a subagent's thread). */ readOnly?: boolean; chat: TranscriptSource; supports: (capability: BooleanCapability) => boolean; profileLabel?: string; projectId?: string;
  /** One of jbot's threads: always there, so an empty one is said to be empty, never welcomed as a new chat. */
  agentThread?: boolean;
  /** The thread's approvals waiting on the person or lately answered (async: the agent carried on): each drawn under
   *  the work that asked (its call, or the script it was called from), one not found there at the thread's foot. */
  approvals?: { asks: () => TranscriptAsk[]; answer: (id: string, choice: ApprovalChoice) => Promise<void>; refresh: () => void } }) {
  // The keyboard (transcript-cursor.ts, transcript-find.ts): each row's actions for its menu, the menu open on a row,
  // and the find. readerScroll moves the view as the reader's own scroll (set once the scroll handling is mounted).
  const turnActions = new WeakMap<HTMLElement, () => TurnAction[]>();
  // The turn menu's hidden anchor (the menu positions from the row's foot, not from it).
  let anchor: HTMLElement | undefined;
  const [turnMenu, setTurnMenu] = createSignal<{ row: HTMLElement; actions: TurnAction[] } | null>(null);
  let turnCursor: ReturnType<typeof mountTranscriptCursor> | null = null;
  let readerScroll = (top: number) => { viewport.scrollTop = top; };
  // A match brought to the middle of what is seen. Its text may be in a block the visibility pass hides (skipped, or
  // out of layout far above): the block, or its row, is brought on screen first and the match measured once shown.
  const revealMatch = (match: FindMatch) => {
    let tries = 0;
    const centre = (rect: DOMRect) => {
      const band = visibleBand(viewport, thread);
      if (rect.top >= band.top && rect.bottom <= band.bottom) return;
      readerScroll(viewport.scrollTop + rect.top + rect.height / 2 - (band.top + band.bottom) / 2);
    };
    const attempt = () => {
      if (!match.range.startContainer.isConnected) return;
      const hidden = match.range.startContainer.parentElement?.closest<HTMLElement>("[data-transcript-visibility]");
      const rect = match.range.getBoundingClientRect();
      if (!hidden && (rect.width || rect.height)) { centre(rect); return; }
      if (tries++ >= 4) return;
      centre((hidden?.getAttribute("data-transcript-visibility") === "hidden" ? hidden : match.row).getBoundingClientRect());
      requestAnimationFrame(() => requestAnimationFrame(attempt));
    };
    attempt();
  };
  const find = createTranscriptFind({ viewport: () => viewport, thread: () => thread, reveal: revealMatch });
  const openTurnMenu = (row: HTMLElement) => {
    const actions = turnActions.get(row)?.() ?? [];
    if (!actions.length) return false;
    setTurnMenu({ row, actions });
    return true;
  };
  let transcriptRoot!: HTMLDivElement;
  let motionShell!: HTMLDivElement;
  let viewport!: HTMLDivElement;
  let thread!: HTMLDivElement;
  let latestButton: HTMLButtonElement | undefined;
  let cancelEditButton: HTMLButtonElement | undefined;
  let scheduleLatestButtonAnchor = () => {};
  let panelMotion: ReturnType<typeof mountTranscriptPanelMotion> | null = null;
  let transcriptVisibility: ReturnType<typeof mountTranscriptVisibility> | null = null;
  let previousLoaded: string | null = null;
  const scrollPositions = new Map<string, {
    following: boolean;
    scrollTop: number;
    anchorMessageId: string | null;
    anchorOffset: number;
  }>();
  const expandedItems = new Map<string, Set<string>>();
  const itemExpanded = (chatId: string | null, key: string) => Boolean(chatId && expandedItems.get(chatId)?.has(key));
  const setItemExpanded = (chatId: string | null, key: string, open: boolean) => {
    if (!chatId) return;
    const items = expandedItems.get(chatId) || new Set<string>();
    if (open) items.add(key); else items.delete(key);
    expandedItems.delete(chatId);
    expandedItems.set(chatId, items);
    while (expandedItems.size > 10) expandedItems.delete(expandedItems.keys().next().value!);
  };
  /* How a run is drawn, as Settings says (runForm): its steps, its run header, or not at all (the turn header alone).
     A turn's one run, as a line, would say what its turn header says: the turn header stands for it. */
  const formOf = (row: TurnRow): "steps" | "header" | "hidden" => {
    const form = runForm();
    if (form === "steps") return "steps";
    if (form === "turn") return "hidden";
    return "precedingUserId" in row && row.precedingUserId && runsIn().get(row.precedingUserId) === 1 ? "hidden" : "header";
  };
  const [artifactSummaries, setArtifactSummaries] = createSignal(new Map<string, TurnArtifactSummary>());
  createEffect(() => {
    if (!props.chat.streaming()) return;
    const userId = props.chat.messages().findLast((message) => message.role === "user")?.id;
    if (!userId) return;
    setArtifactSummaries((current) => {
      if (!current.has(userId)) return current;
      const next = new Map(current);
      next.delete(userId);
      return next;
    });
  });
  createEffect(on(
    () => [props.projectId ?? null, props.chat.loadedId(), props.chat.turnArtifacts()] as const,
    ([projectId, chatId, artifacts]) => {
      if (!projectId || !chatId) return;
      if (artifacts?.chatId === chatId) {
        setArtifactSummaries(new Map(artifacts.items.filter((item) => item.messageId && item.summary).map((item) => [item.messageId!, item])));
        return;
      }
      const controller = new AbortController();
      const request = props.chat.turnArtifactTimeline?.(projectId, chatId)
        ?? api<TurnArtifactSummary[]>(`/v0/projects/${encodeURIComponent(projectId)}/turn-artifact?${new URLSearchParams({ chatId, timeline: "1" })}`, { signal: controller.signal, cache: "no-store" });
      void request
        .then((items) => { if (!controller.signal.aborted) setArtifactSummaries(new Map(items.filter((item) => item.messageId && item.summary).map((item) => [item.messageId!, item]))); })
        .catch((error) => { if (error?.name !== "AbortError" && !controller.signal.aborted) setArtifactSummaries(new Map()); });
      onCleanup(() => controller.abort());
    },
  ));
  let historyLoad: Promise<void> | null = null;
  let layoutEpoch = 0;
  // The follow (the library's createTranscriptFollow): held at the latest while the reader is there, the typewriter's
  // spring carrying it down with live output; the transcript adds its history paging (onStep) and holds it while its
  // virtualizer or a panel reflow moves the content.
  const follow = createTranscriptFollow({
    viewport: () => viewport,
    spring: () => true,
    live: () => liveTail(),
    empty: () => empty(),
    holding: () => Boolean(transcriptVisibility?.refreshing() || transcriptVisibility?.moving()),
    onStep: () => loadEarlier(),
  });
  const { following, setFollowing, latestDistance, latestAway } = follow;
  // A phone's composer has Scroll to latest in its own row, so the transcript's stays hidden there.
  const [phoneLayout, setPhoneLayout] = createSignal(isMobileLayout());
  onMount(() => { const media = matchMedia(MOBILE_LAYOUT_QUERY), sync = () => setPhoneLayout(media.matches); media.addEventListener("change", sync); onCleanup(() => media.removeEventListener("change", sync)); });
  /* The phone's voice composer carries its own scroll-to-latest in its row
     and hides the floating one: tell it when the latest is out of view, and
     take its press. */
  // A reset relays out every managed block, so hold the reading position across
  // it rather than letting the height changes settle wherever they land.
  const resetVisibilityPreservingPosition = () => {
    if (!transcriptVisibility || !viewport || !thread) return;
    const anchor = captureTranscriptAnchor(viewport, thread);
    transcriptVisibility.reset();
    requestAnimationFrame(() => restoreTranscriptAnchor(viewport, anchor, setViewportScrollTop));
  };
  // A queued message lives in the composer bubble until the model takes it, so
  // the transcript does not also show it as a sent turn. An answer still
  // arriving keeps its row here: the projection below skips drawing it, but
  // needs to see where it sits to place the live overlay.
  const settledMessages = createMemo(() => props.chat.messages().filter((message) => !message.pending));
  /* A message sent from this view fades in as the composer's text pill fades
     out; everything drawn when the chat opens is simply there. */
  // When each message we sent first showed here: its fade runs from then,
  // and a row rebuilt for it (the server's copy, a new chat's id) carries on
  // from the same point instead of starting again.
  // The library's entrance (Foundations · Motion, gentle).
  const ARRIVE_MS = 250;
  const arrivedAt = new Map<string, number>();
  let lastArrivedId: string | null = null;
  const arrival = (message: Message): number | undefined => {
    if (message.local && !arrivedAt.has(message.id)) { arrivedAt.set(message.id, performance.now()); lastArrivedId = message.id; }
    return arrivalOf(message.id);
  };
  // The turn under a message just sent fades with it, from the same moment.
  // How far into its entrance it is (the pieces' `since`), or undefined once it is in.
  const arrivalOf = (id: string | null): number | undefined => {
    const at = id ? arrivedAt.get(id) : undefined;
    if (at == null) return undefined;
    const ago = performance.now() - at;
    return ago < ARRIVE_MS ? ago : undefined;
  };
  const timeline = createTimelineStore(
    settledMessages,
    props.chat.tools,
    props.chat.activeGeneration,
    props.chat.activeGenerationChange,
    () => "show",
  );
  // Back to where it was read, above its foot: drawn whole (TranscriptList whole), so that place is there to scroll to.
  const reopensAbove = () => { const id = props.chat.loadedId(); const saved = id ? scrollPositions.get(id) : undefined; return Boolean(saved && !saved.following); };
  // Declared before the memo below, which runs as it is made.
  // Rhythm (DESIGN Transcript › Rhythm): how a row relates to the row above it. A message -- the person's, or one the
  // harness sent on its own -- starts an exchange; the first row of the reply to it is the exchange's; anything after
  // that is the next step of the same reply.
  // Reports start no exchange of the person's: they sit a step from what is around them.
  const fromPerson = (row: TurnRow | undefined) => row?.type === "message" && row.value.role === "user" && row.value.run?.woke !== false && !isAgentReport(row.value);
  // Work is a trace that did something, or reports that landed: lines of work in rows of their own keep the trail's
  // gap (`work`), and the answer under work stands clear of it (`answer`, twice a step).
  // How many runs each turn has, from its turn header (read off the turn rows alone, so a streamed word reads none).
  const runsIn = createMemo(() => {
    const counts = new Map<string, number>();
    for (const row of timeline) if (row.type === "turn" && row.precedingUserId) counts.set(row.precedingUserId, row.value.runs);
    return counts;
  });
  /*
   * Provisional rows making way (DESIGN.md, Turns: they never fade between their own states, only out and in as they
   * make way). A turn header moving on: when a new run starts under the text the header sat over, the header there
   * fades out in place (removing, --duration-quick) and only then does what came after it show (the new run, the
   * header under it, text that arrived with them), from where the header was; until it has gone they are held. The
   * turn's starting row ("Waiting for model") does the same when the turn's first rows take its place. The rows drawn
   * are the timeline's with those leaving rows put back where they were. A header new in a turn fades in (entering).
   */
  const leaving = createLeavingRows<{ row: TurnRow; after: string; turn: string; shown: Set<string> }>((a, b) => a.row.key === b.row.key);
  let headers = new Map<string, { row: TurnRow; after?: string }>();
  let shownKeys = new Set<string>();
  // The keys drawn before this timeline, and whether there was one: a header new since then fades in; on opening a
  // chat, nothing does.
  let priorKeys = new Set<string>();
  let drawnOnce = false;
  let drawnChat: string | null | undefined;
  let pendings = new Map<string, { row: TurnRow; after?: string }>();
  const leave = (ghost: TurnRow, after: string, turn: string) => leaving.leave({ row: ghost, after, turn, shown: shownKeys });
  createComputed(() => {
    const next = new Map<string, { row: TurnRow; after?: string }>();
    const nextPending = new Map<string, { row: TurnRow; after?: string }>();
    timeline.forEach((row, index) => {
      if (row.type === "turn" && row.precedingUserId) next.set(row.precedingUserId, { row, after: timeline[index - 1]?.key });
      if (row.type === "pending") nextPending.set(row.key, { row, after: timeline[index - 1]?.key });
    });
    untrack(() => {
      for (const [turn, was] of headers) {
        const now = next.get(turn);
        if (!now || now.row.key === was.row.key || !was.after || !timeline.some((row) => row.key === was.after)) continue;
        leave({ key: `${was.row.key}:leaving`, type: "turn", value: { runs: (was.row.value as { runs: number }).runs }, precedingUserId: turn, leaving: true }, was.after, turn);
      }
      // The starting row gone because the turn's rows came: it fades out where it was, and they wait for it.
      for (const [key, was] of pendings) {
        if (nextPending.has(key) || !was.after || !timeline.some((row) => row.key === was.after) || was.row.type !== "pending") continue;
        const turn = was.row.precedingUserId;
        if (!turn || !timeline.some((row) => "precedingUserId" in row && row.precedingUserId === turn && !shownKeys.has(row.key))) continue;
        leave({ ...was.row, key: `${key}:leaving`, leaving: true }, was.after, turn);
      }
    });
    headers = next;
    pendings = nextPending;
    // Another chat's rows are not this one's: switched to, it is opened, nothing in it new.
    const chat = untrack(() => props.chat.loadedId());
    if (chat !== drawnChat) { drawnChat = chat; shownKeys = new Set(); }
    drawnOnce = shownKeys.size > 0;
    priorKeys = shownKeys;
    shownKeys = new Set(timeline.map((row) => row.key));
  });
  const rows = createMemo((): TurnRow[] => {
    const list = leaving.list();
    if (!list.length) return timeline;
    const out = [...timeline];
    for (const item of list) { const at = out.findIndex((row) => row.key === item.after); if (at >= 0) out.splice(at + 1, 0, item.row); }
    return out;
  });
  // What arrived in a turn after its leaving header (not shown before it left), held until it has gone.
  const held = createMemo(() => {
    const keys = new Set<string>();
    for (const item of leaving.list()) {
      const at = rows().indexOf(item.row);
      for (let index = at + 1; at >= 0 && index < rows().length; index += 1) {
        const row = rows()[index]!;
        if (!("precedingUserId" in row) || row.precedingUserId !== item.turn) break;
        if (!item.shown.has(row.key)) keys.add(row.key);
      }
    }
    return keys;
  });
  const isWork = (row: TurnRow | undefined) => row?.type === "reports" || row?.type === "turn" || (row?.type === "trace" && row.value.segments.length > 0);
  const flowAt = (index: number): TranscriptFlow | undefined => {
    if (index <= 0) return undefined;
    const row = rows()[index], above = rows()[index - 1];
    // A quiet run arrives on its own, without starting an exchange.
    if (row?.type === "message" && row.value.run?.woke === false) return "step";
    if (fromPerson(row)) return "turn";
    if (fromPerson(above)) return "exchange";
    // The turn header belongs to the text under it, apart from the work above: the gap an answer keeps from its work
    // goes over the header, and the text sits close under it.
    if (row?.type === "turn") return "answer";
    if (above?.type === "turn" && row?.type === "message") return "attached";
    // Commentary sits close to the runs either side of it: one stretch of work, talked through.
    const commentary = (item: TurnRow | undefined) => item?.type === "message" && item.value.role === "assistant" && item.value.interim === true;
    if ((commentary(row) && isWork(above)) || (row?.type === "trace" && commentary(above))) return "attached";
    if (row?.type === "reports" && isWork(above)) return "work";
    if (row?.type === "message" && row.value.role !== "user" && row.value.interim !== true && isWork(above)) return "answer";
    return "step";
  };
  // The latest exchange -- the person's last message and the last answer -- keeps its message foot shown; older ones
  // show theirs on hover (transcript.css).
  const latestExchange = createMemo(() => {
    let answer: string | undefined, person: string | undefined;
    for (let index = timeline.length - 1; index >= 0 && !(answer && person); index -= 1) {
      const row = timeline[index]!;
      if (row.type !== "message") continue;
      // A run's report or Conduit's note is not the person's message: it has no foot of its own.
      if (row.value.role === "user") person ??= row.value.origin === "harness" ? undefined : row.value.id;
      else answer ??= row.value.id;
    }
    return new Set([answer, person].filter((id): id is string => Boolean(id)));
  });
  // On touch there is no hover: a tap on an older message's bubble or plain text shows its message foot (one at a time);
  // a tap on a link, code, a control or a selection keeps its own meaning.
  const [revealed, setRevealed] = createSignal<string | null>(null);
  const revealFoot = (id: string) => (event: MouseEvent) => {
    if (!matchMedia("(hover: none)").matches || latestExchange().has(id)) return;
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input, textarea, select, pre, code, summary, [role='button'], .ui-message-foot") || getSelection()?.toString()) return;
    haptic("select");
    setRevealed((current) => current === id ? null : id);
  };
  const placeAsks = (asks: TranscriptAsk[], placed: Map<string, TranscriptAsk[]>) => {
    const rowOf = new Map<string, string>();
    for (const row of timeline) if (row.type === "trace") for (const segment of row.value.segments) if (segment.kind === "tool") rowOf.set(segment.tool.toolCallId, row.key);
    const unplaced: TranscriptAsk[] = [];
    // A run's asks: under the agent's reply to its report (which says what waits), or the report until it replies;
    // nowhere before the report is in (Needs you on the page has them).
    let report: string | null = null;
    for (const row of timeline) {
      if (row.type !== "message") continue;
      const agent = row.value.origin === "harness" ? row.value.agent : undefined;
      if (agent?.conversationId != null) { report = `run:${agent.conversationId}`; rowOf.set(report, report); }
      else if (row.value.role === "user") report = null;
      // The reply that answers it: its turn's messages up to the one with the orb (the turn's last).
      else if (report) { rowOf.set(report, row.key); if (row.orb) report = null; }
    }
    for (const ask of [...asks].reverse()) {
      if (ask.run) { const key = rowOf.get(`run:${ask.run}`); if (key) placed.set(key, [...(placed.get(key) ?? []), ask]); continue; }
      const key = rowOf.get(ask.toolCallId) ?? (ask.parentCallId ? rowOf.get(ask.parentCallId) : undefined);
      if (key) placed.set(key, [...(placed.get(key) ?? []), ask]);
      else if (ask.status === "pending") unplaced.push(ask);
    }
    return { placed, unplaced };
  };
  // Approvals by the row whose work asked: the call's own id, or the script it was called from.
  const askRows = createMemo(() => {
    const asks = props.approvals?.asks() ?? [];
    const placed = new Map<string, TranscriptAsk[]>();
    if (!asks.length) return { placed, unplaced: [] as TranscriptAsk[] };
    // Placed again as asks or rows come and go, not on every streamed change to a row: an ask's call is in its row
    // well before the ask is read (asks are read again as calls appear).
    timeline.length;
    return untrack(() => placeAsks(asks, placed));
  });
  const asksAt = (key: string) => askRows().placed.get(key) ?? [];
  // A new call may have asked, or a run's report come in with its asks: the list is read again as the thread grows.
  // Asks come from a connector's calls, which run in a script: a chat with none has nothing to look up.
  const asking = () => props.chat.tools().some((tool) => tool.kind === "script") || (props.approvals?.asks().length ?? 0) > 0;
  createEffect(on(() => props.approvals && asking() ? props.chat.tools().length + props.chat.messages().length : 0, (count) => { if (count) props.approvals?.refresh(); }, { defer: true }));
  const unplacedAsks = () => askRows().unplaced;
  const empty = createMemo(() => !timeline.length && !isChatContentActivity(props.chat.activity()));
  // A message of ours the server has not answered with any row of its turn.
  const awaitingTurn = createMemo(() => {
    const last = props.chat.messages().at(-1);
    // Sent from here: the server's copy replacing ours keeps it waiting.
    // Waiting to send: there is no turn to start until it goes.
    if (!last || last.role !== "user" || last.outbox || !(last.local || arrivedAt.has(last.id))) return false;
    return timeline.at(-1)?.type === "message";
  });

  // The tail's rows are swapped whole -- the starting row for the turn's,
  // the pending row for its trace -- and a layout read partway through saw
  // the thread without either, so the browser clamped the scroll up for a
  // frame. Before any such change reaches the page, the thread keeps at
  // least the height it had until the frame is laid out.
  createComputed(on(() => [timeline.length, timeline.at(-1)?.key, awaitingTurn()], () => {
    if (!thread) return;
    thread.style.minHeight = `${thread.offsetHeight}px`;
    requestAnimationFrame(() => { thread.style.minHeight = ""; });
  }, { defer: true }));

  let previousUserMessageId: string | null = null;
  const rememberScrollPosition = (chatId: string) => {
    // At the foot there is nothing to find: it comes back to its foot (and leaving reads no layout, ~5ms of an open).
    if (following()) {
      scrollPositions.delete(chatId);
      scrollPositions.set(chatId, { following: true, scrollTop: 0, anchorMessageId: null, anchorOffset: 0 });
      while (scrollPositions.size > 10) scrollPositions.delete(scrollPositions.keys().next().value!);
      return;
    }
    const viewportTop = viewport.getBoundingClientRect().top;
    const anchor = [...thread.querySelectorAll<HTMLElement>("[data-message-id]")]
      .find((element) => element.getBoundingClientRect().bottom > viewportTop);
    scrollPositions.delete(chatId);
    scrollPositions.set(chatId, {
      following: following(),
      scrollTop: viewport.scrollTop,
      anchorMessageId: anchor?.dataset.messageId || null,
      anchorOffset: anchor ? anchor.getBoundingClientRect().top - viewportTop : 0,
    });
    while (scrollPositions.size > 10) scrollPositions.delete(scrollPositions.keys().next().value!);
  };
  const restoreScrollPosition = (chatId: string, epoch: number) => {
    const saved = scrollPositions.get(chatId);
    if (!saved || saved.following) return false;
    setFollowing(false);
    setTypewriterTailOwner("user", true);
    // Apply the numeric position in the same reactive commit as the chat
    // switch. Waiting for the anchor pass lets the browser paint a clamped
    // position inherited from the previous transcript for one or two frames.
    setViewportScrollTop(saved.scrollTop);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (epoch !== layoutEpoch || props.chat.loadedId() !== chatId) return;
      if (!saved.anchorMessageId) return;
      const viewportTop = viewport.getBoundingClientRect().top;
      const anchor = [...thread.querySelectorAll<HTMLElement>("[data-message-id]")]
        .find((element) => element.dataset.messageId === saved.anchorMessageId);
      if (!anchor) return;
      setViewportScrollTop(viewport.scrollTop + anchor.getBoundingClientRect().top - viewportTop - saved.anchorOffset);
    }));
    return true;
  };
  const cancelTypewriterTailFrame = follow.cancelSpringFrame;
  const cancelTypewriterTailRejoin = follow.cancelRejoin;
  const setTypewriterTailOwner = follow.setOwner;
  const setViewportScrollTop = follow.setScrollTop;
  const viewportMaxScrollTop = follow.maxScrollTop;
  const syncLatestDistance = follow.syncLatestDistance;
  const scrollBottomNow = follow.scrollBottomNow;
  // A turn that has just ended is still the live tail for a moment: its foot and last rows arrive as it settles, and
  // the spring takes the view down to them. Snapped -- as a chat opened finished is -- they landed in one frame (48px).
  let liveTailUntil = 0;
  const liveTail = () => Boolean(props.chat.activeGeneration()) || performance.now() < liveTailUntil;
  createEffect(on(() => Boolean(props.chat.activeGeneration()), (live, was) => { if (was && !live) liveTailUntil = performance.now() + 1500; }, { defer: true }));
  const resumeTypewriterTailFollow = follow.resume;
  const followLatest = follow.followLatest;
  const requestTypewriterTailFollow = follow.request;
  const settleInitialLayout = (epoch: number) => { if (epoch === layoutEpoch) follow.settle(); };
  // Highlighting is a settled-content concern, so it runs off the idle queue and
  // only ever touches cards it has not already done. Coalesced because
  // onRendered fires on every streaming frame.
  //
  // Scoped to the messages that actually re-rendered. Sweeping the whole thread
  // meant every settle walked every code card in the chat to ask whether it had
  // already been highlighted -- work proportional to the transcript, repeated
  // for a change confined to the message at the bottom of it.
  let highlightIdle: number | null = null;
  const highlightPending = new Set<HTMLElement>();
  const scheduleHighlight = (root?: HTMLElement) => {
    if (!thread) return;
    // A caller with no root (a preference change) means the
    // whole thread is suspect and the sweep has to be broad.
    if (root && root.isConnected) highlightPending.add(root);
    else highlightPending.clear();
    if (highlightIdle != null) return;
    highlightIdle = requestIdleCallback(() => {
      highlightIdle = null;
      const roots = highlightPending.size
        ? [...highlightPending].filter((element) => element.isConnected)
        : [thread];
      highlightPending.clear();
      for (const element of roots) void highlightCodeBlocks(element);
    }, { timeout: 600 });
  };
  const settleAfterMarkdown = (root?: HTMLElement) => {
    scheduleHighlight(root);
    requestTypewriterTailFollow();
  };
  const loadEarlier = () => {
    const maxScrollTop = viewportMaxScrollTop();
    // Only a page too short to scroll up asks whether it has laid out. This
    // runs on every tail-follow frame, and a query that finds nothing walks
    // the whole thread, so a long answer paid for its own length each frame.
    const settled = maxScrollTop < HISTORY_LOAD_TOP_PX && !thread?.querySelector(".markdown-skeleton");
    if (!shouldLoadEarlierHistory({
      following: following(),
      maxScrollTop,
      scrollTop: viewport.scrollTop,
      settled,
    })) return;
    // Filling a short page is not the reader scrolling up: it stays on the
    // latest, and the turns above arrive out of sight.
    const filling = settled && maxScrollTop < HISTORY_LOAD_TOP_PX;
    if (!filling) {
      setTypewriterTailOwner("user", true);
      setFollowing(false);
    }
    if (historyLoad || !props.chat.pageBefore() || props.chat.loadingOlder()) return;
    const anchor = captureTranscriptAnchor(viewport, thread);
    const previousOverflowAnchor = viewport.style.overflowAnchor;
    viewport.style.overflowAnchor = "none";
    const restoreAnchor = () => {
      if (!shouldRestoreHistoryAnchor(following())) return;
      restoreTranscriptAnchor(viewport, anchor, setViewportScrollTop);
      const distanceFromBottom = Math.max(0, viewportMaxScrollTop() - viewport.scrollTop);
      if (!shouldFollowAfterHistoryRestore(distanceFromBottom)) {
        setFollowing(false);
        setTypewriterTailOwner("user", true);
      }
    };
    let loadedMore = false;
    historyLoad = props.chat.loadOlder().then((loaded) => {
      if (!loaded) return;
      loadedMore = true;
      queueMicrotask(restoreAnchor);
      return new Promise<void>((resolve) => requestAnimationFrame(() => {
        restoreAnchor();
        requestAnimationFrame(() => {
          restoreAnchor();
          resolve();
        });
      }));
    }).finally(() => {
      viewport.style.overflowAnchor = previousOverflowAnchor;
      historyLoad = null;
      // Still short after this page, it asks for the next.
      if (filling && loadedMore) requestAnimationFrame(loadEarlier);
    });
  };
  createRenderEffect(() => {
    props.chat.loadedId();
    layoutEpoch += 1;
  });
  createEffect(() => {
    props.chat.loadedId();
    panelMotion?.reset();
    transcriptVisibility?.reset();
  });
  createEffect(() => {
    const loaded = props.chat.loadedId();
    props.chat.messages().length;
    props.chat.activeGeneration();
    props.chat.tools();
    const messages = props.chat.messages();
    const trailingUser = messages.at(-1)?.role === "user" ? messages.at(-1)! : null;
    const trailingUserId = trailingUser?.id || null;
    if (loaded !== previousLoaded) {
      liveTailUntil = 0;
      // Remembered as the reader leaves it at rest (rememberAtRest), not here: by now the next chat is drawn.
      if (previousLoaded && following()) rememberScrollPosition(previousLoaded);
      previousLoaded = loaded;
      requestAnimationFrame(syncLatestDistance);
      previousUserMessageId = trailingUserId;
      const epoch = layoutEpoch;
      if (loaded && restoreScrollPosition(loaded, epoch)) return;
      resumeTypewriterTailFollow();
      void document.fonts.ready.then(() => settleInitialLayout(epoch));
      return;
    }
    // Sending is an unambiguous request to watch the answer arrive, so a new
    // trailing user message always retakes the tail -- previously only a chat
    // switch did, and sending while scrolled up left the view where it was.
    if (trailingUserId && trailingUserId !== previousUserMessageId) {
      previousUserMessageId = trailingUserId;
      followLatest();
      return;
    }
    previousUserMessageId = trailingUserId;
  });

  onMount(() => {
    const syncUiPreference = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; value?: unknown }>).detail;
      if (isCodeBlockCollapseMode(detail?.value) && detail?.key === "codeBlockCollapse") {
        resetVisibilityPreservingPosition();
      } else if (isCodeBlockCollapseLines(detail?.value) && detail?.key === "codeBlockCollapseLines") {
        resetVisibilityPreservingPosition();
      } else if (detail?.key === "transcriptWidth" || detail?.key === "transcriptWideBlocks") {
        // A width preset relays out every block, so the cached intrinsic sizes
        // the virtualizer is holding are all stale. Re-measure from scratch and
        // keep the reader where they were.
        resetVisibilityPreservingPosition();
      }
    };
    // Collapsing a long block can remove a thousand pixels from the thread.
    // Keep the card the user acted on exactly where it is and re-measure the
    // virtualizer in the same frame, so the transcript never shows the stale
    // placeholders that used to appear as blank space for several seconds.
    const onCodeBlockToggle = (event: Event) => {
      const detail = (event as CustomEvent<{ card?: HTMLElement; previousTop?: number }>).detail;
      const card = detail?.card;
      if (!card?.isConnected || !thread.contains(card) || detail?.previousTop == null) return;
      const cardTop = detail.previousTop;
      // Folding shortens the content; stop following so the tail spring does
      // not read the shrink as a reason to chase the bottom.
      if (following()) setTypewriterTailOwner("user", true);
      const previousOverflowAnchor = viewport.style.overflowAnchor;
      viewport.style.overflowAnchor = "none";
      requestAnimationFrame(() => {
        transcriptVisibility?.refreshNow();
        const delta = card.getBoundingClientRect().top - cardTop;
        if (Math.abs(delta) > 0.5) setViewportScrollTop(viewport.scrollTop + delta);
        viewport.style.overflowAnchor = previousOverflowAnchor;
      });
    };
    // A disclosure opened at the tail would otherwise be chased: each frame of
    // its unfold read as new content, the thread pushed up under the pointer.
    // Let go of the tail instead, so it opens downward from where it was
    // clicked, as if the reader had scrolled up to it already open.
    const onDisclosureToggle = () => {
      if (!following()) return;
      cancelTypewriterTailRejoin(); setTypewriterTailOwner("user", true);
      setFollowing(false);
    };
    // Opening or closing anything in the transcript (a trace, a step, a fold) is reading, not following: the click
    // reaches the thread before the piece's own handler (Solid's are delegated to the document) changes its height.
    const onExpanderClick = (event: MouseEvent) => { if ((event.target as Element).closest("[aria-expanded]")) onDisclosureToggle(); };
    thread.addEventListener("click", onExpanderClick);
    window.addEventListener(CODE_BLOCK_TOGGLE_EVENT, onCodeBlockToggle);
    window.addEventListener(UI_PREFERENCE_CHANGE_EVENT, syncUiPreference);
    let latestButtonAnchorFrame: number | null = null;
    const syncLatestButtonAnchor = () => {
      latestButtonAnchorFrame = null;
      // The horizontal anchor follows the centred composer through CSS. Only
      // its dynamic height needs measurement, and that style belongs on the
      // button rather than the inherited transcript root.
      const anchored = [latestButton, cancelEditButton].filter((button): button is HTMLButtonElement => Boolean(button?.isConnected));
      if (!anchored.length) return;
      const conversation = transcriptRoot.closest<HTMLElement>(".ui-chat");
      // A question stands in for the composer, which has slid out of the pane; otherwise the composer and its riders.
      const composerShell = conversation?.querySelector<HTMLElement>(".ui-composer-slot[data-taken] > :not(.ui-composer-stack)")
        || conversation?.querySelector<HTMLElement>(".ui-composer-slot > .ui-composer-stack, .ui-phone-composer");
      if (!conversation || !composerShell) return;
      const shellRect = motionShell.getBoundingClientRect();
      const composerRect = composerShell.getBoundingClientRect();
      // Dictation captions float above the composer; the button clears them too.
      const captions = conversation.querySelector<HTMLElement>(".ui-voice-captions > *");
      const captionsTop = captions?.getBoundingClientRect().top ?? Infinity;
      // So do the text pill's edit actions while they show.
      const editActions = conversation.querySelector<HTMLElement>(".ui-phone-composer[data-show~=\"edit\"] > .ui-phone-edit");
      const editTop = editActions?.getBoundingClientRect().top ?? Infinity;
      if (shellRect.width <= 0 || shellRect.height <= 0 || composerRect.width <= 0 || composerRect.height <= 0) return;
      const bottom = `${rideBottom(shellRect.bottom, Math.min(composerRect.top, captionsTop, editTop))}px`;
      for (const button of anchored) {
        if (button.style.getPropertyValue("--ride-bottom") !== bottom) button.style.setProperty("--ride-bottom", bottom);
      }
    };
    scheduleLatestButtonAnchor = () => {
      if (latestButtonAnchorFrame != null) return;
      latestButtonAnchorFrame = requestAnimationFrame(syncLatestButtonAnchor);
    };
    setLatestScroller(followLatest);
    createEffect(() => tellLatestAway(followLatest, latestAway()));
    onCleanup(() => dropLatestScroller(followLatest));
    window.addEventListener("conduit:voice-captions", scheduleLatestButtonAnchor);
    onCleanup(() => window.removeEventListener("conduit:voice-captions", scheduleLatestButtonAnchor));
    const composerStack = transcriptRoot.closest<HTMLElement>(".ui-chat")?.querySelector<HTMLElement>(".ui-composer-dock");
    // The thread reserves the composer's measured height (components/ui/dock-inset.ts, as a room's messages do).
    const stopClearingDock = composerStack ? clearDock(transcriptRoot, composerStack, () => {
      // Reserve and follow in the same resize delivery, before paint, through the field's room glide.
      if (following()) setViewportScrollTop(viewportMaxScrollTop(), false);
      scheduleLatestButtonAnchor();
    }) : null;
    // The composer slides back in as a transform, which no size change reports,
    // and it is measured with that transform applied -- so again once it lands.
    const composerLanded = (event: TransitionEvent) => {
      if (event.propertyName === "transform" && (event.target as HTMLElement).classList.contains("ui-composer-stack")) scheduleLatestButtonAnchor();
    };
    composerStack?.addEventListener("transitionend", composerLanded);
    const visualViewport = window.visualViewport;
    // The follow's own listeners: who moved the view, the keyboard's travel, what it holds growing (createTranscriptFollow).
    follow.attach({ viewport, thread });
    window.addEventListener("resize", scheduleLatestButtonAnchor);
    visualViewport?.addEventListener("resize", scheduleLatestButtonAnchor);
    scheduleLatestButtonAnchor();
    panelMotion = mountTranscriptPanelMotion(
      transcriptRoot,
      motionShell,
      (next) => setViewportScrollTop(next, false),
    );
    transcriptVisibility = mountTranscriptVisibility(viewport, thread, (delta) => setViewportScrollTop(viewport.scrollTop + delta, false));
    turnCursor = mountTranscriptCursor({ viewport, thread, scrollTo: (top) => readerScroll(top), openMenu: openTurnMenu });
    find.register(viewport);
    readerScroll = follow.readerScroll;
    // Where the reader is, kept as they stop scrolling: leaving a chat then reads nothing (once the next is drawn,
    // its rows are the ones on screen).
    onScrollRest(viewport, () => { const id = props.chat.loadedId(); if (id) rememberScrollPosition(id); });
    onCleanup(() => {
      window.removeEventListener(CODE_BLOCK_TOGGLE_EVENT, onCodeBlockToggle);
      thread.removeEventListener("click", onExpanderClick);
      window.removeEventListener(UI_PREFERENCE_CHANGE_EVENT, syncUiPreference);
      layoutEpoch += 1;
      stopClearingDock?.();
      composerStack?.removeEventListener("transitionend", composerLanded);
      window.removeEventListener("resize", scheduleLatestButtonAnchor);
      visualViewport?.removeEventListener("resize", scheduleLatestButtonAnchor);
      if (latestButtonAnchorFrame != null) cancelAnimationFrame(latestButtonAnchorFrame);
      latestButton?.style.removeProperty("--ride-bottom");
      transcriptRoot.style.removeProperty("--transcript-composer-inset");
      scheduleLatestButtonAnchor = () => {};
      if (highlightIdle != null) cancelIdleCallback(highlightIdle);
      cancelTypewriterTailFrame();
      cancelTypewriterTailRejoin();
      transcriptVisibility?.destroy();
      transcriptVisibility = null;
      turnCursor?.destroy();
      turnCursor = null;
      panelMotion?.destroy();
      panelMotion = null;
    });
  });

  return <ChatScroller ref={(element) => { transcriptRoot = element; }} motionRef={(element) => { motionShell = element; }} viewportRef={(element) => { viewport = element; }} data-part="transcript" data-slot="message-scroller" over={<>
      {/*
        * `mousedown` is cancelled so pressing this does not take focus off the
        * composer: on a phone that closes the keyboard, and jumping to the
        * latest message is exactly what somebody does mid-sentence to check
        * what they are replying to. The click still lands -- only the focus
        * change is refused.
        */}
      {/* Always mounted, so it fades out as well as in: when pressed, and when
           somebody scrolls back down themselves. */}
      <RiderButton ref={(element: HTMLButtonElement) => { latestButton = element; scheduleLatestButtonAnchor(); }} ride="centre" icon={<Icons.ArrowDown />} label="Scroll to latest"
        hidden={phoneLayout() || following() || latestDistance() < TAIL_NEAR_LATEST_PX} onMouseDown={(event) => event.preventDefault()} onClick={() => followLatest()} />
      {/* Find in chat (Ctrl+F in the pane): its bar over the transcript's top. */}
      <Show when={find.open()}>
        <FindBar query={find.query()} count={find.count()} inputRef={find.setInput} onQuery={find.setQuery} onNext={find.next} onPrevious={find.previous} onEscape={find.escape} onClose={find.close} />
      </Show>
      {/* The cursor's row's menu (Menu key, Shift+F10): its foot's actions, at its foot. The trigger is only the
          menu's anchor; the row is where it opens. */}
      <DropdownMenu open={Boolean(turnMenu())} onOpenChange={(open) => {
        if (open) return;
        setTurnMenu(null);
      }} placement="bottom-start"
        getAnchorRect={() => { const row = turnMenu()?.row; const rect = (row?.querySelector(".ui-message-foot") ?? row)?.getBoundingClientRect(); return rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : undefined; }}>
        <MenuControl as="span" ref={(element: HTMLElement) => { anchor = element; }}
          // The menu library hands focus back to its trigger, this hidden anchor, after closing: the transcript takes
          // it, so the keyboard is never stranded on an invisible element.
          onFocus={() => { if (!turnMenu()) queueMicrotask(() => { if (document.activeElement === anchor) viewport.focus({ preventScroll: true }); }); }} aria-hidden="true" tabIndex={-1} style={{ position: "absolute", top: 0, left: 0, width: 0, height: 0 }} />
        <MenuContent onCloseAutoFocus={(event) => {
          event.preventDefault();
          // Back to the transcript, unless a press outside the menu put focus somewhere of its own.
          const active = document.activeElement;
          // The invisible anchor counts as nowhere: focus handed back to it would strand the keyboard.
          if (!active || active === document.body || active.closest('[data-slot="ui-menu-content"]') || active.getAttribute("aria-hidden") === "true") viewport.focus({ preventScroll: true });
          else turnCursor?.menuClosed();
        }}>
          <For each={turnMenu()?.actions ?? []}>{(action) => <MenuRow icon={action.icon} onSelect={action.run}>{action.label}</MenuRow>}</For>
        </MenuContent>
      </DropdownMenu>
      {/* Editing an earlier message: a way out that is always there, floating
          over the composer where the edit happens, as the pencil would. */}
      <Show when={props.chat.editingEntryId()}><RiderButton ref={(element: HTMLButtonElement) => { cancelEditButton = element; scheduleLatestButtonAnchor(); }} icon={<Icons.Close />} label="Cancel editing" show="label"
        ride={!following() && latestDistance() >= TAIL_NEAR_LATEST_PX ? "beside" : "centre"} onMouseDown={(event) => event.preventDefault()} onClick={() => { props.chat.cancelEdit(); focusComposerSoon(); }} /></Show>
    </>}>
        <Show when={empty()}><ChatEmpty><Welcome title={props.agentThread ? "Nothing has happened in this thread yet" : "How can I help you today?"} /></ChatEmpty></Show>
        {/* Its newest rows first, the older ones above in idle time (TranscriptList); it holds its own foot. */}
        <TranscriptList ref={(element) => { thread = element; }} data-slot="message-scroller-content" data-narration="show"
          each={rows()} of={props.chat.loadedId()} whole={reopensAbove} holdsFoot={false}
          estimate={(row, width) => estimateRowHeight(row, Math.max(20, (width || 400) / 8.5))}
          before={<Show when={props.chat.loadingOlder()}><TranscriptRow data-slot="message-scroller-item" data-cursor-skip><LoadingEarlier /></TranscriptRow></Show>}
          after={<Show when={unplacedAsks().length}><TranscriptRow data-slot="message-scroller-item" flow="step"><Turn><For each={unplacedAsks()}>{(ask) => <AskCard ask={ask} answer={props.approvals!.answer} />}</For></Turn></TranscriptRow></Show>}>
        {(item, index) => {
          const flow = () => flowAt(index());
          if (item.type === "turn") {
            // The turn's runs above it, read as they change: its work, timed from the person's message.
            const work = createMemo((): TurnTraceData => {
              const runs: Extract<TurnRow, { type: "trace" }>[] = [];
              let startedAt: string | undefined;
              for (let at = index() - 1; at >= 0; at -= 1) {
                const row = rows()[at];
                if (!row) break;
                if (row.type === "message" && row.value.id === item.precedingUserId) { startedAt = row.value.timestamp; break; }
                if (!("precedingUserId" in row) || row.precedingUserId !== item.precedingUserId) break;
                if (isRun(row)) runs.unshift(row);
              }
              const last = runs.at(-1), active = runs.some((run) => run.value.active);
              return { active, status: last?.value.status ?? "complete", segments: runs.flatMap((run) => run.value.segments),
                ...(startedAt ?? runs[0]?.value.startedAt ? { startedAt: startedAt ?? runs[0]?.value.startedAt } : {}),
                ...(!active && (last?.timestamp ?? last?.value.endedAt) ? { endedAt: last?.timestamp ?? last?.value.endedAt } : {}) };
            });
            // Only in a turn running now: a header that came with opening or switching to a chat is already there.
            const enters = untrack(() => drawnOnce && !priorKeys.has(item.key) && props.chat.streaming());
            return <TranscriptRow data-slot="message-scroller-item" data-cursor-skip data-turn-header="" data-held={held().has(item.key) ? "" : undefined}
              {...motionOf(item.leaving ? "removing" : enters ? "entering" : undefined)} flow={flow()}><Turn><TurnTrace since={arrivalOf(lastArrivedId)} trace={work()} narrated turn form="header"
              opens={runForm() === "turn"} initialOpen={itemExpanded(props.chat.loadedId(), `turn:${item.precedingUserId}`)} onOpenChange={(open) => setItemExpanded(props.chat.loadedId(), `turn:${item.precedingUserId}`, open)}
              loadContext={(entryId) => api<ContextText>(`/v0/sessions/${encodeURIComponent(props.chat.loadedId() ?? "")}/context/${entryId}`)}
              toolOpen={(id) => itemExpanded(props.chat.loadedId(), `tool:${id}`)} onToolOpenChange={(id, open) => setItemExpanded(props.chat.loadedId(), `tool:${id}`, open)}
              profileLabel={props.profileLabel} /></Turn></TranscriptRow>;
          }
          if (item.type === "trace") {
            let traceRow!: HTMLDivElement;
            const chatId = () => props.chat.loadedId();
            const artifact = () => item.answerless && item.precedingUserId ? artifactSummaries().get(item.precedingUserId) : undefined;
            const arrive = arrivalOf(lastArrivedId);
            // Its menu: what the foot under an answerless turn offers.
            const traceActions = (): TurnAction[] => {
              if (!(item.answerless && !item.goesOn && !item.value.active && !item.afterAnswer && item.value.segments.some((segment) => segment.kind !== "context"))) return [];
              const actions: TurnAction[] = [];
              if (props.supports("regenerate") && item.precedingUserId) actions.push({ label: "Regenerate response", icon: <Icons.Refresh />, run: () => void props.chat.regenerate(item.precedingUserId!) });
              const entry = artifact();
              if (entry?.summary) actions.push({ label: "Open in Agent changes", icon: <Icons.GitCompareArrows />, run: () => requestTurnArtifactNavigation({ chatId: chatId()!, checkpointId: entry.id, path: entry.summary!.preferredPath }) });
              return actions;
            };
            return <TranscriptRow ref={(element: HTMLDivElement) => { traceRow = element; turnActions.set(element, traceActions); }} data-slot="message-scroller-item" data-held={held().has(item.key) ? "" : undefined} flow={flow()}><Turn><TurnTrace since={arrive} trace={item.value} loadContext={(entryId) => api<ContextText>(`/v0/sessions/${encodeURIComponent(chatId() ?? "")}/context/${entryId}`)} narrated form={isRun(item) ? formOf(item) : undefined} agents={props.chat.agents?.()} onStopAgent={props.chat.stopAgent ? (id) => void props.chat.stopAgent!(id) : undefined} writing={item.answerless === false} profileLabel={props.profileLabel} initialOpen={itemExpanded(chatId(), item.key)} onOpenChange={(open) => setItemExpanded(chatId(), item.key, open)} toolOpen={(id) => itemExpanded(chatId(), `tool:${id}`)} onToolOpenChange={(id, open) => setItemExpanded(chatId(), `tool:${id}`, open)} onRendered={() => settleAfterMarkdown(traceRow)} />
              <For each={asksAt(item.key)}>{(ask) => <AskCard ask={ask} answer={props.approvals!.answer} />}</For>
              {/* A turn that ended without an answer -- stopped under a tool, or
                  one that only ran commands -- still offers to try again. */}
              <Show when={item.answerless && !item.goesOn && !item.value.active && !item.afterAnswer && item.value.segments.some((segment) => segment.kind !== "context")}>
                <MessageFoot at={item.timestamp} eager={index() >= rows().length - 1}>
                  <Show when={props.supports("regenerate") && item.precedingUserId}><LibraryButton variant="ghost" size="icon-xs" aria-label="Regenerate response" onClick={() => void props.chat.regenerate(item.precedingUserId!)}><Icons.Refresh /></LibraryButton></Show>
                  <Show when={artifact()}>{(entry) => <TurnChanges artifact={entry()} chatId={chatId()!} />}</Show>
                </MessageFoot>
              </Show></Turn></TranscriptRow>;
          }
          if (item.type === "reports") return <TranscriptRow data-slot="message-scroller-item" data-message-id={item.value[0]!.id} data-report={item.value.map((message) => message.agent?.conversationId ?? message.agent?.id).join(" ")} flow={flow()}>
            <Turn><TurnReports reports={item.value} agents={props.chat.agents?.() || []} text={(message) => <ChatText text={message.content || ""} />} /></Turn>
          </TranscriptRow>;
          if (item.type === "message" && item.value.run) {
            const run = () => item.value.run!;
            const time = () => {
              const start = run().startedAt ? Date.parse(run().startedAt!) : NaN;
              const end = run().endedAt ? Date.parse(run().endedAt!) : NaN;
              return Number.isFinite(start) && Number.isFinite(end) && end >= start ? elapsed(end - start) : undefined;
            };
            const child = () => props.chat.agents?.().find((agent) => run().conversationId != null && String(agent.conversationId) === String(run().conversationId))?.chatId;
            return <TranscriptRow data-slot="message-scroller-item" data-message-id={item.value.id} flow={flow()}><Turn><AgentRows>
              <RunLine icon={<RoutineIcon routine={run().routine} />} label={run().label} number={run().number} id={item.value.agent?.id || undefined} trigger={run().trigger || undefined} time={time()} woke={run().woke}
                outcome={props.profileLabel ? `Woke ${props.profileLabel}` : undefined} status={run().status === "finished" ? undefined : run().status[0]!.toUpperCase() + run().status.slice(1)}
                summary={run().summary ?? item.value.content} onOpen={child() ? () => openAgentChat(child()!) : undefined}>
                {/* What the agent was given, all of it: the report, then what Conduit added to it (nothing hidden). */}
                {run().woke ? <><ChatText text={item.value.content || ""} /><Show when={item.value.appended}><ConduitAdded text={item.value.appended!} /></Show></> : undefined}
              </RunLine>
            </AgentRows>
              <Show when={item.value.agent?.conversationId != null && asksAt(`run:${item.value.agent!.conversationId}`).length}>
                <For each={asksAt(`run:${item.value.agent!.conversationId}`)}>{(ask) => <AskCard ask={ask} answer={props.approvals!.answer} />}</For>
              </Show>
            </Turn></TranscriptRow>;
          }
          if (item.type === "sent") return <TranscriptRow data-slot="message-scroller-item" flow={flow()}><SentRow tool={item.value} /></TranscriptRow>;
          if (item.type === "pending") {
            // A turn before anything of it shows is the header its trace will
            // be, starting -- replaced in place when the first step arrives.
            // Only a booting agent is Conduit's wait; after that it is the model's.
            return <TranscriptRow data-slot="message-scroller-item" data-cursor-skip {...motionOf(item.leaving ? "removing" : undefined)} flow={flow()}><Turn><TraceStarting narrated startedAt={item.startedAt} label={props.chat.activity()?.kind === "starting" ? "Starting agent" : "Waiting for model"} /></Turn></TranscriptRow>;
          }
          const message = createMemo(() => item.value);
          const user = createMemo(() => message().role === "user");
          const review = createMemo(() => user() ? parseReviewComments(message().content || "") : { text: message().content || "", comments: [] });
          const failed = createMemo(() => !user() && message().stopReason === "error");
          // Once its own generation has said it finished, the row is not live again: the saved message takes it over
          // before the turn settles, and read from the chat's streaming flag it was live once more for a frame -- an
          // answer ending in an open formula then lost the closing the finish gave it, and was parsed again whole.
          let finished = false;
          const live = createMemo(() => {
            if (item.live != null) return !(finished = !item.live);
            if (finished) return false;
            const last = props.chat.messages().at(-1);
            return props.chat.streaming() && !user() && Boolean(last && message().id === last.id);
          });
          // An answer that streamed here offers its actions, and shows its
          // time, only once it has finished appearing, and fades them in:
          // at the tail of a bursty answer the row jumped with every delivery.
          // One loaded finished shows them at once.
          const [streamed, setStreamed] = createSignal(live());
          const [settled, setSettled] = createSignal(false);
          createEffect(() => { if (live()) { setStreamed(true); setSettled(false); } });
          const actionsShown = () => user() || !streamed()
            || (!live() && (settled() || !message().content));
          const precedingUserId = () => user() ? undefined : item.precedingUserId;
          const artifact = createMemo(() => {
            const userId = precedingUserId();
            return userId ? artifactSummaries().get(userId) : undefined;
          });
          let row!: HTMLDivElement;
          // Read once: the fade is timed from when the row was built, and a
          // later update must not shift it.
          const arrive = untrack(() => user() ? arrival(message()) : undefined);
          if (user() && message().origin === "harness") {
            // A subagent's report opens its transcript, once the chat's agents say which chat that is.
            const child = () => { const ref = message().agent; return ref ? props.chat.agents?.().find((agent) => ref.id ? agent.id === ref.id : String(agent.conversationId) === String(ref.conversationId))?.chatId : null; };
            const open = () => child() ? () => openAgentChat(child()!) : undefined;
            // A run's report, as the agent was given it; a heartbeat's quiet line (display only, never sent) stays a line.
            return <TranscriptRow ref={row} data-slot="message-scroller-item" data-held={held().has(item.key) ? "" : undefined} data-message-id={message().id} data-report={message().agent?.conversationId ?? message().agent?.id ?? undefined} data-latest={latestExchange().has(message().id) ? "" : undefined} data-revealed={revealed() === message().id ? "" : undefined} onClick={revealFoot(message().id)} flow={flow()}>
              <Show when={message().agent && !message().id.startsWith("beat:")} fallback={<HarnessPrompt onOpen={open()} unseen={message().unseen ? "never sent to the agent" : undefined} icon={message().id.startsWith("beat:") ? <Icons.Heartbeat aria-hidden="true" /> : undefined}>{message().content}</HarnessPrompt>}>
                <Inbound shut icon={<RoutineIcon routine={message().sender?.routine} />} from={message().sender?.name || message().agent?.id || "Background agent"}
                  meta={[message().agent?.id, message().sender?.status].filter(Boolean).join(" · ")} time={clock(message().timestamp)} dateTime={message().timestamp || undefined}
                  title={message().timestamp ? fullDateTime(message().timestamp) : undefined} onOpen={open()} openLabel="Open run" fold={ENVELOPE_FOLD}
                  onBack={message().agent?.id && !message().sender?.routine ? () => jumpToSpawn(String(message().agent!.conversationId ?? message().agent!.id)) : undefined} backLabel="Started"
                  noted={message().notes} appended={message().appended}>
                  <ChatText text={message().content || ""} />
                </Inbound>
              </Show>
              <Show when={message().agent?.conversationId != null && asksAt(`run:${message().agent!.conversationId}`).length}>
                <Turn><For each={asksAt(`run:${message().agent!.conversationId}`)}>{(ask) => <AskCard ask={ask} answer={props.approvals!.answer} />}</For></Turn>
              </Show></TranscriptRow>;
          }
          // Copied: Copy turns to a check, and the answer takes the copied wash, for a moment.
          const [copied, setCopied] = createSignal(false);
          const copy = async () => {
            if (!await copyWithFeedback(message().content || message().errorMessage || "")) return;
            setCopied(true);
            setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
          };
          // Its menu: what its foot offers -- an answer's Copy, Regenerate and changes, the person's Edit from here.
          const rowActions = (): TurnAction[] => {
            const actions: TurnAction[] = [];
            if (user()) {
              if (!(message().content || "").startsWith(APPROVAL_NOTE) && !message().pending && !message().outbox && props.supports("fork"))
                actions.push({ label: props.chat.editingEntryId() === message().id ? "Cancel editing" : "Edit from here", icon: <Icons.Edit />, run: () => { props.chat.edit(message()); focusComposerSoon(); } });
              if (message().outbox && props.chat.cancelOutbox) actions.push({ label: "Don't send", icon: <Icons.Close />, run: () => { props.chat.cancelOutbox!(message().id); focusComposerSoon(); } });
              return actions;
            }
            if (!item.orb || !actionsShown()) return actions;
            if (!message().discarded && (message().content || message().errorMessage)) actions.push({ label: "Copy Markdown", icon: <Icons.Copy />, run: () => void copy() });
            if (props.supports("regenerate") && precedingUserId()) actions.push({ label: "Regenerate response", icon: <Icons.Refresh />, run: () => void props.chat.regenerate(precedingUserId()!) });
            const entry = artifact();
            if (entry?.summary) actions.push({ label: "Open in Agent changes", icon: <Icons.GitCompareArrows />, run: () => requestTurnArtifactNavigation({ chatId: props.chat.loadedId()!, checkpointId: entry.id, path: entry.summary!.preferredPath }) });
            return actions;
          };
          return <TranscriptRow ref={(element: HTMLDivElement) => { row = element; turnActions.set(element, rowActions); }} data-slot="message-scroller-item" data-held={held().has(item.key) ? "" : undefined} data-message-id={message().id} data-latest={latestExchange().has(message().id) ? "" : undefined} data-revealed={revealed() === message().id ? "" : undefined} onClick={revealFoot(message().id)} flow={flow()}>
            <Show when={user()} fallback={<Turn>
              <Show when={message().content || (message().stopped && !item.traced && !failed())}>
                <Answer copied={copied()}>
                  <Show when={message().content} fallback={<StopLine detail="before answering" />}>
                    <Suspense fallback={<div class="markdown-skeleton" />}>
                      <ChatMarkdown streaming={live()} streamVersion={item.streamVersion} onRendered={() => settleAfterMarkdown(row)} onSettled={() => setSettled(true)}>{message().content || ""}</ChatMarkdown>
                    </Suspense>
                  </Show>
                </Answer>
              </Show>
              <Show when={failed()}>
                <Failure time={message().timestamp ? fullDateTime(message().timestamp) : undefined} dateTime={message().timestamp || undefined} message={message().errorMessage || "The model request failed."}
                  facts={[message().model && `Model: ${message().model}`, message().provider && `Provider: ${message().provider}`, props.profileLabel && `Profile: ${props.profileLabel}`].filter(Boolean) as string[]} />
              </Show>
              <For each={asksAt(item.key)}>{(ask) => <AskCard ask={ask} answer={props.approvals!.answer} />}</For>
              {/* A turn that speaks more than once has one foot, under the message that carries its orb. */}
              <Show when={item.orb}>
                {/* The orb's row changes as the turn works: an empty foot held under it would leave each row it
                    leaves, pulling a transcript that follows the bottom down. The foot comes when it settles. */}
                <Show when={actionsShown()}><AnswerFoot latest={latestExchange().has(message().id)} message={message()} precedingUserId={precedingUserId()} chat={props.chat} supports={props.supports} artifact={artifact()} traced={item.traced} reveal={streamed()} copied={copied()} onCopy={() => void copy()} /></Show>
              </Show>
            </Turn>}>
              {/* The hub telling the agent how an approval was answered: a quiet line, as a report is, not the person's
                  bubble. Read as the text arrives: a row is built before its message has any. */}
              <Show when={(message().content || "").startsWith(APPROVAL_NOTE)} fallback={<UserMessage latest={latestExchange().has(message().id)} message={message()} text={review().text} editing={props.chat.editingEntryId() === message().id}
                editable={!message().pending && !message().outbox && !props.readOnly && props.supports("fork")} since={arrive} onEdit={() => { props.chat.edit(message()); focusComposerSoon(); }}
                onCancelSend={props.chat.cancelOutbox ? () => { props.chat.cancelOutbox!(message().id); focusComposerSoon(); } : undefined}
                under={<>
                  <Show when={message().attachments?.length}><AttachmentCards items={message().attachments!} chatId={props.chat.loadedId()} label="Message attachments" /></Show>
                  <Show when={review().comments.length}><ReviewCommentCards items={review().comments} chatId={props.chat.loadedId() ?? ""} label="Code references" /></Show>
                </>} />}>
                <Inbound icon={<Icons.Permissions aria-hidden="true" />} from="Conduit" meta={approvalMeta(message().content || "")} time={clock(message().timestamp)} noted={message().notes}
                  dateTime={message().timestamp || undefined} title={message().timestamp ? fullDateTime(message().timestamp) : undefined}>
                  <ChatText text={(message().content || "").slice(APPROVAL_NOTE.length)} />
                </Inbound>
              </Show>
            </Show>
          </TranscriptRow>;
        }}
        </TranscriptList>
  </ChatScroller>;
}
