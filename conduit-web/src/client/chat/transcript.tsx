import { createEffect, createMemo, createRenderEffect, createSignal, For, lazy, on, onCleanup, onMount, Show, Suspense } from "solid-js";
import { ArrowDownIcon, CheckIcon, ChevronDownIcon, CopyIcon, PencilIcon, PlayIcon, RefreshCwIcon, ScissorsIcon, TriangleAlertIcon } from "lucide-solid";
import { Button, Spinner } from "@/components/primitives";
import type { BooleanCapability, Message } from "../api/contracts";
import { isChatContentActivity, type TranscriptSource } from "./transcript-source";
import type { TurnArtifactSummary } from "../api/live-events";
import { AttachmentCards } from "./attachments";
import { ReviewCommentCards } from "./review-comment-cards";
import { parseReviewComments } from "./review-comments";
import { TurnTrace } from "./turn-trace";
import { createTimelineStore } from "../state/timeline-store";
import type { MarkdownRendererId } from "./markdown-settings";
import { COMPOSER_SURFACE_CHANGE_EVENT, COMPOSER_SURFACE_OPTIONS, saveComposerSurface, selectedComposerSurface, type ComposerSurfaceMode } from "./composer-surface";
import { isIncremarkRenderer, MARKDOWN_RENDERER_OPTIONS, saveMarkdownRenderer, selectedMarkdownRenderer } from "./markdown-settings";
import "./transcript-renderer.css";
import { INCREMARK_PACING_OPTIONS, saveIncremarkPacing, selectedIncremarkPacing, type IncremarkPacingMode } from "./incremark-pacing";
import { PANEL_MOTION_OPTIONS, savePanelMotion, selectedPanelMotion, type PanelMotionMode } from "./transcript-appearance";
import { UI_PREFERENCE_CHANGE_EVENT } from "../preferences/ui-preferences";
import { copyWithFeedback } from "./markdown-actions";
import { CODE_BLOCK_TOGGLE_EVENT, publishCodeBlockToggle, syncCodeBlockCollapse } from "./code-block";
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
import { isMobileLayout } from "../navigation/mobile-layout";
import { getHarnessRecorder, recordHarnessMetric } from "../harness-metrics";
import {
  advanceTailFollow,
  createTailFollowState,
  decideTailScroll,
  rebaseTailFollowState,
  shouldFollowAfterHistoryRestore,
  shouldLoadEarlierHistory,
  shouldRestoreHistoryAnchor,
  usedMaxScrollTop,
  type TailFollowOwner,
  type TailFollowState,
} from "./transcript-tail-follow";
import { captureTranscriptAnchor, restoreTranscriptAnchor } from "./transcript-anchor";
import { api } from "../api/client";
import { requestTurnArtifactNavigation } from "./turn-artifact-navigation";

const ChatMarkdown = lazy(() => import("./markdown").then((module) => ({ default: module.ChatMarkdown })));
const fullDateTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(date);
};

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
function UserMessageText(props: { text: string }) {
  let text!: HTMLSpanElement;
  const preference = useUserMessageCollapse();
  const lines = () => userMessageCollapseLines(preference.mode());
  // Starts false so the first paint is already folded: measuring an unfolded
  // box would compare the content against itself and always report a fit.
  const [fits, setFits] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  // Pessimistic: assume a line holds only 24 characters. A message under that
  // budget cannot fill the fold at any column width, so it never gets measured.
  const mayOverflow = () => {
    const limit = lines();
    if (!limit) return false;
    let breaks = 1;
    for (let index = 0; index < props.text.length; index += 1) {
      if (props.text[index] === "\n") breaks += 1;
    }
    return breaks > limit || props.text.length > limit * 24;
  };
  const foldable = () => mayOverflow() && !fits();
  const collapsed = () => foldable() && !expanded();
  const measure = () => {
    // Valid only while the clamp is applied, which is what collapsed() gates.
    if (!collapsed()) return;
    setFits(text.scrollHeight - text.clientHeight <= 1);
  };

  onMount(measure);
  createEffect(() => {
    // The fold moved or the column resized, so the previous verdict is stale.
    // Re-fold first, then measure on the next frame once that has committed --
    // reading in this tick would measure the box as it still is.
    lines();
    preference.readingWidthVersion();
    if (!mayOverflow() || expanded()) return;
    setFits(false);
    requestAnimationFrame(measure);
  });

  const toggle = (event: MouseEvent) => {
    const row = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-slot="message-scroller-item"]');
    const previousTop = row?.getBoundingClientRect().top;
    setExpanded((value) => !value);
    // Unfolding a long message adds real height above everything below it.
    // Reuse the code card's hold-and-re-measure path rather than leaving the
    // reading position to browser scroll anchoring.
    if (row && previousTop != null) publishCodeBlockToggle(row, previousTop);
  };

  return <>
    <span ref={text} class="user-message-text" data-collapsed={collapsed() ? "true" : undefined}>{props.text}</span>
    <Show when={foldable()}>
      <button type="button" class="user-message-expand" aria-expanded={expanded()} onClick={toggle}>
        {expanded() ? "Show less" : "Show more"}
      </button>
    </Show>
  </>;
}

function TurnArtifactButton(props: { artifact: TurnArtifactSummary; chatId: string }) {
  const range = () => `Turn ${props.artifact.sequence} → ${props.artifact.targetSequence === null ? "Working copy" : `Turn ${props.artifact.targetSequence}`}`;
  return <button type="button" class="turn-change-summary" title={range()} aria-label={`Open ${range()} in Agent changes: ${props.artifact.summary!.added} additions and ${props.artifact.summary!.removed} removals`} onClick={() => requestTurnArtifactNavigation({ chatId: props.chatId, checkpointId: props.artifact.id, path: props.artifact.summary!.preferredPath })}><span data-change="added">+{props.artifact.summary!.added}</span><span data-change="removed">−{props.artifact.summary!.removed}</span></button>;
}

function Actions(props: { message: Message; precedingUserId?: string; chat: TranscriptSource; supports: (capability: BooleanCapability) => boolean; partialContinue: boolean; artifact?: TurnArtifactSummary }) {
  const [copied, setCopied] = createSignal(false);
  let copyButton: HTMLButtonElement | undefined;
  const assistant = () => props.message.role !== "user";
  return <div class="response-actions">
    {/* A prompt offers editing. Regenerating it is the same act as regenerating
        the answer below, which already has a button, so there is one way to ask
        for it rather than two that look like different things. */}
    <Show when={!assistant() && !props.message.pending && props.supports("fork")}>
      <Button variant="ghost" size="icon-sm" aria-label={props.chat.editingEntryId() === props.message.id ? "Cancel editing" : "Edit from here"} onClick={() => props.chat.edit(props.message)}><PencilIcon /></Button>
    </Show>
    <Show when={assistant()}>
      <Button
        ref={(element: HTMLButtonElement) => { copyButton = element; }}
        variant="ghost"
        size="icon-sm"
        aria-label={copied() ? "Copied" : "Copy Markdown"}
        data-copied={copied() ? "true" : undefined}
        onClick={async () => {
          const region = copyButton?.closest<HTMLElement>('[data-slot="message-content"]')
            ?.querySelector<HTMLElement>('[data-slot="bubble-content"]');
          if (!await copyWithFeedback(props.message.content || props.message.errorMessage || "", null, region)) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
      >{copied() ? <CheckIcon /> : <CopyIcon />}</Button>
      <Show when={props.supports("regenerate") && props.precedingUserId}><Button variant="ghost" size="icon-sm" aria-label="Regenerate response" onClick={() => void props.chat.regenerate(props.precedingUserId!)}><RefreshCwIcon /></Button></Show>
      <Show when={props.partialContinue && props.message.stopped}><Button variant="ghost" size="icon-sm" aria-label="Continue stopped response" onClick={() => void props.chat.continueResponse()}><PlayIcon /></Button></Show>
      <Show when={props.artifact}>{(entry) => <TurnArtifactButton artifact={entry()} chatId={props.chat.loadedId()!} />}</Show>
    </Show>
  </div>;
}

/**
 * An answer the agent was interrupted writing, which it is not being given back.
 *
 * The text is real and the reader watched it arrive, so it is not taken away.
 * But the conversation does not contain it -- ask a follow-up about it and the
 * model has no idea what you mean -- so it is folded down to a line and says
 * why. Opening it is for reading what was lost, not for carrying on from it.
 */
function DiscardedAnswer(props: { message: Message; renderer?: MarkdownRendererId; pacing?: IncremarkPacingMode }) {
  const [open, setOpen] = createSignal(false);
  const preview = () => {
    const text = String(props.message.content || "").replace(/\s+/g, " ").trim();
    return text.length > 110 ? `${text.slice(0, 110)}…` : text;
  };
  return <div class="discarded-answer" data-open={open() ? "true" : "false"}>
    <button type="button" class="discarded-answer-header" aria-expanded={open()}
      title="Interrupted before it finished. The agent kept no record of this, so it cannot be referred to."
      onClick={() => setOpen(!open())}>
      <ScissorsIcon aria-hidden="true" />
      <span class="discarded-answer-preview">{preview()}</span>
      <span class="discarded-answer-status"> · Interrupted, not kept</span>
      <ChevronDownIcon class="discarded-answer-chevron" data-open={open() ? "true" : "false"} />
    </button>
    <Show when={open()}>
      <div class="discarded-answer-body">
        <Suspense fallback={<div class="markdown-skeleton" />}>
          <ChatMarkdown renderer={props.renderer} pacing={props.pacing}>{props.message.content || ""}</ChatMarkdown>
        </Suspense>
      </div>
    </Show>
  </div>;
}

export function Transcript(props: { chat: TranscriptSource; supports: (capability: BooleanCapability) => boolean; partialContinue: boolean; markdownRenderer: MarkdownRendererId; rendererControlsVisible: boolean; profileLabel?: string; projectId?: string }) {
  let transcriptRoot!: HTMLDivElement;
  let motionShell!: HTMLDivElement;
  let viewport!: HTMLDivElement;
  let thread!: HTMLDivElement;
  let latestButton: HTMLButtonElement | undefined;
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
      void api<TurnArtifactSummary[]>(`/v0/projects/${encodeURIComponent(projectId)}/turn-artifact?${new URLSearchParams({ chatId, timeline: "1" })}`, { signal: controller.signal, cache: "no-store" })
        .then((items) => setArtifactSummaries(new Map(items.filter((item) => item.messageId && item.summary).map((item) => [item.messageId!, item]))))
        .catch((error) => { if (error?.name !== "AbortError") setArtifactSummaries(new Map()); });
      onCleanup(() => controller.abort());
    },
  ));
  let historyLoad: Promise<void> | null = null;
  let layoutEpoch = 0;
  let previousMarkdownRenderer = props.markdownRenderer;
  const [following, setFollowing] = createSignal(true);
  const [composerSurface, setComposerSurface] = createSignal<ComposerSurfaceMode>(selectedComposerSurface());
  const [markdownRenderer, setMarkdownRenderer] = createSignal<MarkdownRendererId>(selectedMarkdownRenderer());
  const [incremarkPacing, setIncremarkPacing] = createSignal<IncremarkPacingMode>(selectedIncremarkPacing());
  const [panelDrag, setPanelDrag] = createSignal<PanelMotionMode>(selectedPanelMotion());
  const switchComposerSurface = (next: ComposerSurfaceMode) => setComposerSurface(saveComposerSurface(next));
  // A reset relays out every managed block, so hold the reading position across
  // it rather than letting the height changes settle wherever they land.
  const resetVisibilityPreservingPosition = () => {
    if (!transcriptVisibility || !viewport || !thread) return;
    const anchor = captureTranscriptAnchor(viewport, thread);
    transcriptVisibility.reset();
    requestAnimationFrame(() => restoreTranscriptAnchor(viewport, anchor, setViewportScrollTop));
  };
  const switchMarkdownRenderer = (next: MarkdownRendererId) => setMarkdownRenderer(saveMarkdownRenderer(next));
  const switchIncremarkPacing = (next: IncremarkPacingMode) => setIncremarkPacing(saveIncremarkPacing(next));
  const switchPanelDrag = (next: PanelMotionMode) => setPanelDrag(savePanelMotion(next));
  // Only Incremark reveals a message block by block, and only that reveal needs
  // the tail to be followed by a spring rather than pinned to the bottom.
  const rendererUsesTypewriter = () => isIncremarkRenderer(markdownRenderer());
  const rendererUsesInertialTailFollow = () => rendererUsesTypewriter();
  const rendererMetric = () => markdownRenderer();
  // A queued message lives in the composer bubble until the model takes it, so
  // the transcript does not also show it as a sent turn. An answer still
  // arriving keeps its row here: the projection below skips drawing it, but
  // needs to see where it sits to place the live overlay.
  const settledMessages = createMemo(() => props.chat.messages().filter((message) => !message.pending));
  const timeline = createTimelineStore(
    settledMessages,
    props.chat.tools,
    props.chat.activeGeneration,
    props.chat.activeGenerationChange,
  );
  const empty = createMemo(() => !timeline.length && !isChatContentActivity(props.chat.activity()));

  let scrollFrame: number | null = null;
  let typewriterTailFrame: number | null = null;
  const typewriterTailReasons = new Set<string>();
  let typewriterTailState: TailFollowState = createTailFollowState();
  let typewriterTailRejoinTimer: number | null = null;
  let typewriterTailLastHeight: number | null = null;
  let typewriterTailLastTarget: number | null = null;
  let typewriterTailLastExpected: number | null = null;
  let typewriterTailTargetDeltaEma = 0;
  let programmaticScrollTop: number | null = null;
  let previousScrollTop: number | null = null;
  // Paired with previousScrollTop: an upward move is only a reader if the
  // scrollable distance did not shrink out from under it.
  let previousMaxScrollTop: number | null = null;
  let previousUserMessageId: string | null = null;
  let previousRenderer: MarkdownRendererId | null = null;
  const currentViewportScrollTop = () => viewport?.scrollTop ?? 0;
  const rememberScrollPosition = (chatId: string) => {
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
  const cancelTypewriterTailFrame = () => {
    if (typewriterTailFrame == null) return;
    cancelAnimationFrame(typewriterTailFrame);
    typewriterTailFrame = null;
  };
  const cancelTypewriterTailRejoin = () => {
    if (typewriterTailRejoinTimer == null) return;
    clearTimeout(typewriterTailRejoinTimer);
    typewriterTailRejoinTimer = null;
  };
  const setTypewriterTailOwner = (owner: TailFollowOwner, rebase = false) => {
    typewriterTailState = rebase
      ? rebaseTailFollowState(typewriterTailState, currentViewportScrollTop(), owner)
      : { ...typewriterTailState, owner, velocity: owner === "user" ? 0 : typewriterTailState.velocity };
    if (owner === "user") {
      cancelTypewriterTailFrame();
      typewriterTailReasons.clear();
    }
  };
  // Handing the tail back is only ever allowed after a downward scroll that
  // actually reached the bottom. decideTailScroll gates the call site; this
  // timer just waits for the gesture to go quiet before the spring resumes.
  const scheduleTypewriterTailRejoin = () => {
    cancelTypewriterTailRejoin();
    if (!rendererUsesInertialTailFollow() || !following()) return;
    typewriterTailRejoinTimer = window.setTimeout(() => {
      typewriterTailRejoinTimer = null;
      if (!rendererUsesInertialTailFollow() || !following()) return;
      setTypewriterTailOwner("app", true);
      requestTypewriterTailFollow("user-idle");
    }, 120);
  };
  // Normal tail movement uses whole pixels. Panel reflow anchoring must retain
  // fractional scroll positions or each resize frame accumulates visible drift.
  const setViewportScrollTop = (next: number, round = true) => {
    viewport.scrollTop = round ? Math.round(next) : next;
    programmaticScrollTop = viewport.scrollTop;
    previousScrollTop = viewport.scrollTop;
    previousMaxScrollTop = viewportMaxScrollTop();
  };
  const viewportMaxScrollTop = () => usedMaxScrollTop({
    scrollHeight: viewport.scrollHeight,
    clientHeight: viewport.clientHeight,
    scrollTop: viewport.scrollTop,
  });
  const scrollBottomNow = () => {
    if (scrollFrame != null) {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = null;
    }
    setViewportScrollTop(viewport.scrollHeight);
    loadEarlier();
  };
  const scrollBottom = () => {
    if (scrollFrame != null) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      if (following()) scrollBottomNow();
    });
  };
  const resumeTypewriterTailFollow = (reason: string) => {
    if (!rendererUsesInertialTailFollow()) return;
    cancelTypewriterTailRejoin();
    setFollowing(true);
    setTypewriterTailOwner("app", true);
    typewriterTailLastHeight = null;
    typewriterTailLastTarget = null;
    typewriterTailLastExpected = null;
    typewriterTailTargetDeltaEma = 0;
    requestTypewriterTailFollow(reason);
  };
  const requestTypewriterTailFollow = (reason: string) => {
    if (!rendererUsesInertialTailFollow() || !following() || typewriterTailState.owner !== "app") return;
    if (!props.chat.activeGeneration()) {
      const targetScrollTop = viewportMaxScrollTop();
      setViewportScrollTop(targetScrollTop);
      typewriterTailState = rebaseTailFollowState(typewriterTailState, targetScrollTop, "app");
    }
    typewriterTailReasons.add(reason);
    if (typewriterTailFrame != null) return;
    if (scrollFrame != null) {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = null;
    }
    typewriterTailFrame = requestAnimationFrame((now) => {
      typewriterTailFrame = null;
      const reasons = [...typewriterTailReasons];
      typewriterTailReasons.clear();
      if (!rendererUsesInertialTailFollow() || !following() || typewriterTailState.owner !== "app") return;

      const scrollHeight = viewport.scrollHeight;
      const maxScrollTop = usedMaxScrollTop({
        scrollHeight,
        clientHeight: viewport.clientHeight,
        scrollTop: viewport.scrollTop,
      });
      const overflow = maxScrollTop > 0;
      const targetScrollTop = maxScrollTop;
      // A persisted transcript is already complete. Keep its tail pinned while
      // lazy Markdown resolves; the spring is for live output, where the target
      // moves continuously and a snap would fight the display cadence.
      if (!props.chat.activeGeneration()) {
        setViewportScrollTop(targetScrollTop);
        typewriterTailState = rebaseTailFollowState(typewriterTailState, targetScrollTop, "app");
      }
      const currentScrollTop = viewport.scrollTop;
      const previousHeight = typewriterTailLastHeight;
      const previousTarget = typewriterTailLastTarget;
      const scrollHeightDelta = previousHeight == null ? 0 : scrollHeight - previousHeight;
      const targetDeltaPx = previousTarget == null ? 0 : targetScrollTop - previousTarget;
      const browserCompensationPx = typewriterTailLastExpected == null
        ? 0
        : currentScrollTop - typewriterTailLastExpected;
      const uncompensatedTargetDeltaPx = targetDeltaPx - browserCompensationPx;
      const previousTargetDeltaEma = typewriterTailTargetDeltaEma;
      const targetDeltaMagnitude = Math.abs(uncompensatedTargetDeltaPx);
      const feedForwardTargetDeltaPx = previousTargetDeltaEma > 0
        ? Math.sign(uncompensatedTargetDeltaPx) * Math.min(targetDeltaMagnitude, previousTargetDeltaEma * 2)
        : 0;
      if (targetDeltaMagnitude > 0) {
        typewriterTailTargetDeltaEma = previousTargetDeltaEma > 0
          ? previousTargetDeltaEma * 0.75 + targetDeltaMagnitude * 0.25
          : targetDeltaMagnitude;
      }
      const distanceFromBottom = Math.max(0, maxScrollTop - currentScrollTop);
      const frame = advanceTailFollow(typewriterTailState, targetScrollTop, now, currentScrollTop, feedForwardTargetDeltaPx);
      typewriterTailState = frame.state;
      const nextScrollTop = frame.nextScrollTop;
      const distanceToTarget = targetScrollTop - currentScrollTop;
      const shouldWrite = !frame.rebased && Math.abs(nextScrollTop - currentScrollTop) > 0.05;
      if (shouldWrite) setViewportScrollTop(nextScrollTop);
      const distanceAfterBottom = Math.max(0, maxScrollTop - viewport.scrollTop);
      const recorder = getHarnessRecorder();
      if (recorder) {
        recordHarnessMetric(recorder, {
          stage: "transcript-scroll",
          renderer: rendererMetric(),
          owner: "typewriter-tail-inertial",
          ownership: typewriterTailState.owner,
          reasons,
          mode: frame.mode,
          rebased: frame.rebased,
          overflow,
          scrollHeightReadCount: 1,
          scrollTopWriteCount: shouldWrite ? 1 : 0,
          frameIntervalMs: frame.frameIntervalMs,
          scrollHeightDelta,
          targetDeltaPx,
          browserCompensationPx,
          uncompensatedTargetDeltaPx,
          feedForwardTargetDeltaPx,
          targetDeltaEmaPx: typewriterTailTargetDeltaEma,
          feedForwardVelocityPxPerSecond: frame.feedForwardVelocityPxPerSecond,
          movementPx: shouldWrite ? nextScrollTop - currentScrollTop : 0,
          velocityPxPerSecond: typewriterTailState.velocity,
          distanceBeforeBottom: distanceFromBottom,
          distanceAfterBottom,
          distanceToTarget,
          targetScrollTop,
          currentScrollTop,
          nextScrollTop,
        });
      }
      loadEarlier();

      typewriterTailLastHeight = scrollHeight;
      typewriterTailLastTarget = targetScrollTop;
      typewriterTailLastExpected = nextScrollTop;
      const stillMoving = Math.abs(targetScrollTop - nextScrollTop) > 0.25 || Math.abs(typewriterTailState.velocity) > 1;
      if (following() && rendererUsesInertialTailFollow() && typewriterTailState.owner === "app" && stillMoving) {
        requestTypewriterTailFollow("inertia");
      }
    });
  };
  const settleInitialLayout = (epoch: number) => {
    if (epoch !== layoutEpoch || !following()) return;
    if (rendererUsesInertialTailFollow()) requestTypewriterTailFollow("initial-layout");
    else scrollBottomNow();
  };
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
    // A caller with no root (a preference change, a renderer switch) means the
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
  let displayScrollQueued = false;
  const settleAfterMarkdown = (root?: HTMLElement) => {
    scheduleHighlight(root);
    if (rendererUsesInertialTailFollow()) {
      requestTypewriterTailFollow("markdown-render");
      return;
    }
    if (!following() || displayScrollQueued) return;
    displayScrollQueued = true;
    queueMicrotask(() => {
      displayScrollQueued = false;
      if (!following()) return;
      const epoch = layoutEpoch;
      settleInitialLayout(epoch);
    });
  };
  const loadEarlier = () => {
    const maxScrollTop = viewportMaxScrollTop();
    if (!shouldLoadEarlierHistory({
      following: following(),
      maxScrollTop,
      scrollTop: viewport.scrollTop,
    })) return;
    if (rendererUsesInertialTailFollow()) {
      cancelTypewriterTailRejoin();
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
    historyLoad = props.chat.loadOlder().then((loaded) => {
      if (!loaded) return;
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
      if (previousLoaded) rememberScrollPosition(previousLoaded);
      previousLoaded = loaded;
      previousUserMessageId = trailingUserId;
      const epoch = layoutEpoch;
      if (loaded && restoreScrollPosition(loaded, epoch)) return;
      if (rendererUsesInertialTailFollow()) resumeTypewriterTailFollow("loaded");
      else {
        setFollowing(true);
        scrollBottom();
      }
      void document.fonts.ready.then(() => settleInitialLayout(epoch));
      return;
    }
    // Sending is an unambiguous request to watch the answer arrive, so a new
    // trailing user message always retakes the tail -- previously only a chat
    // switch did, and sending while scrolled up left the view where it was.
    if (trailingUserId && trailingUserId !== previousUserMessageId) {
      previousUserMessageId = trailingUserId;
      if (rendererUsesInertialTailFollow()) resumeTypewriterTailFollow("user-send");
      else {
        setFollowing(true);
        scrollBottom();
      }
      return;
    }
    previousUserMessageId = trailingUserId;
    if (following() && !rendererUsesTypewriter()) scrollBottom();
  });
  // main owns the preference; the transcript mirrors it so a change made in
  // Settings and one made in the picker above the transcript take the same path.
  createEffect(() => {
    const next = props.markdownRenderer;
    if (next === previousMarkdownRenderer) return;
    previousMarkdownRenderer = next;
    setMarkdownRenderer(next);
  });
  createEffect(() => {
    const renderer = markdownRenderer();
    const previous = previousRenderer;
    if (previous == null) {
      previousRenderer = renderer;
      return;
    }
    if (renderer === previous) return;
    previousRenderer = renderer;
    // The two renderers lay a message out differently, so every cached block
    // size the virtualizer is holding is stale.
    resetVisibilityPreservingPosition();
    if (rendererUsesInertialTailFollow()) resumeTypewriterTailFollow("renderer-switch");
    else {
      cancelTypewriterTailRejoin();
      cancelTypewriterTailFrame();
      typewriterTailReasons.clear();
      scrollPositions.clear();
      expandedItems.clear();
      setTypewriterTailOwner("app", true);
    }
  });

  onMount(() => {
    const syncComposerSurface = () => setComposerSurface(selectedComposerSurface());
    const syncUiPreference = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; value?: unknown }>).detail;
      const params = new URLSearchParams(location.search);
      if (detail?.key === "composerSurface") setComposerSurface(selectedComposerSurface());
      else if (detail?.key === "markdownRenderer" && typeof detail.value === "string"
        && !params.has("markdownRenderer")) {
        setMarkdownRenderer(detail.value as MarkdownRendererId);
      } else if (detail?.key === "incremarkPacing" && typeof detail.value === "string"
        && !params.has("incremarkPacing") && !params.has("adaptivePacing")) {
        setIncremarkPacing(detail.value as IncremarkPacingMode);
      } else if (detail?.key === "panelMotion" && typeof detail.value === "string"
        && !params.has("panelMotion")) {
        setPanelDrag(detail.value as PanelMotionMode);
      } else if (isCodeBlockCollapseMode(detail?.value) && detail?.key === "codeBlockCollapse") {
        resyncCodeBlocks();
        resetVisibilityPreservingPosition();
      } else if (isCodeBlockCollapseLines(detail?.value) && detail?.key === "codeBlockCollapseLines") {
        resyncCodeBlocks();
        resetVisibilityPreservingPosition();
      } else if (detail?.key === "transcriptWidth" || detail?.key === "transcriptWideBlocks") {
        // A width preset relays out every block, so the cached intrinsic sizes
        // the virtualizer is holding are all stale. Re-measure from scratch and
        // keep the reader where they were.
        resetVisibilityPreservingPosition();
      }
    };
    // The marked renderers bake collapse state into emitted HTML, so a
    // preference change needs one restamping pass over what is already on
    // screen. It runs only on an explicit settings change, never while
    // streaming, and Incremark cards ignore it because they track the
    // preference reactively.
    const resyncCodeBlocks = () => {
      syncCodeBlockCollapse(thread, selectedCodeBlockCollapse(), selectedCodeBlockCollapseLines());
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
      if (following() && rendererUsesInertialTailFollow()) setTypewriterTailOwner("user", true);
      const previousOverflowAnchor = viewport.style.overflowAnchor;
      viewport.style.overflowAnchor = "none";
      requestAnimationFrame(() => {
        transcriptVisibility?.refreshNow();
        const delta = card.getBoundingClientRect().top - cardTop;
        if (Math.abs(delta) > 0.5) setViewportScrollTop(viewport.scrollTop + delta);
        viewport.style.overflowAnchor = previousOverflowAnchor;
      });
    };
    window.addEventListener(CODE_BLOCK_TOGGLE_EVENT, onCodeBlockToggle);
    window.addEventListener(UI_PREFERENCE_CHANGE_EVENT, syncUiPreference);
    let latestButtonAnchorFrame: number | null = null;
    let composerBlockSize = -1;
    const syncLatestButtonAnchor = () => {
      latestButtonAnchorFrame = null;
      // The horizontal anchor follows the centred composer through CSS. Only
      // its dynamic height needs measurement, and that style belongs on the
      // button rather than the inherited transcript root.
      if (!latestButton?.isConnected) return;
      const conversation = transcriptRoot.closest<HTMLElement>(".work-area-conversation");
      const composerShell = conversation?.querySelector<HTMLElement>(".composer-surface-shell");
      if (!conversation || !composerShell) return;
      const shellRect = motionShell.getBoundingClientRect();
      const composerRect = composerShell.getBoundingClientRect();
      if (shellRect.width <= 0 || shellRect.height <= 0 || composerRect.width <= 0 || composerRect.height <= 0) return;
      const bottom = `${Math.max(isMobileLayout() ? 8 : 6.4, shellRect.bottom - composerRect.top + (isMobileLayout() ? 10 : 8))}px`;
      if (latestButton.style.getPropertyValue("--message-scroller-button-bottom") !== bottom) {
        latestButton.style.setProperty("--message-scroller-button-bottom", bottom);
      }
    };
    scheduleLatestButtonAnchor = () => {
      if (latestButtonAnchorFrame != null) return;
      latestButtonAnchorFrame = requestAnimationFrame(syncLatestButtonAnchor);
    };
    const composerStack = transcriptRoot.closest<HTMLElement>(".work-area-conversation")?.querySelector<HTMLElement>(".composer-stack");
    // The composer floats over the bottom of the transcript, so the thread has
    // to reserve its height itself. A fixed reservation only ever matched the
    // resting composer: a multi-line draft, attachments, or the queued-message
    // card each grew the stack over the newest output and left it covered.
    // Reserving the measured height instead makes the thread taller, which the
    // tail spring reads as the bottom moving and follows -- so the output steps
    // up out of the way while the card is there, and back down when it goes.
    const COMPOSER_CLEARANCE_PX = 40;
    const syncComposerInset = (blockSize: number) => {
      const inset = `${Math.round(blockSize + COMPOSER_CLEARANCE_PX)}px`;
      if (transcriptRoot.style.getPropertyValue("--transcript-composer-inset") === inset) return;
      transcriptRoot.style.setProperty("--transcript-composer-inset", inset);
    };
    const composerResizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      const blockSize = entry?.borderBoxSize[0]?.blockSize ?? entry?.contentRect.height ?? 0;
      if (Math.abs(blockSize - composerBlockSize) < 0.5) return;
      composerBlockSize = blockSize;
      syncComposerInset(blockSize);
      scheduleLatestButtonAnchor();
    });
    if (composerStack) composerResizeObserver.observe(composerStack);
    const visualViewport = window.visualViewport;
    /*
     * The keyboard takes height from the bottom, so the transcript gives it
     * back from the top.
     *
     * The shell already shrinks to the visual viewport, which moves the
     * composer up but leaves the thread's scroll position where it was --
     * so the lines somebody was reading went behind the keyboard and the
     * window onto the transcript slid backwards through the conversation.
     * Shifting the scroll by exactly what the viewport lost keeps the same
     * text against the composer, which is what "the keyboard pushed it up"
     * means. A thread that is following its tail needs none of this: it is
     * already pinned to the bottom, wherever the bottom now is.
     */
    let lastViewportHeight = visualViewport?.height ?? 0;
    const holdAgainstKeyboard = () => {
      const height = visualViewport?.height ?? 0;
      const lost = lastViewportHeight - height;
      lastViewportHeight = height;
      if (!Number.isFinite(lost) || Math.abs(lost) < 1) return;
      if (following()) return;
      setViewportScrollTop(Math.max(0, Math.min(viewportMaxScrollTop(), viewport.scrollTop + lost)), false);
    };
    window.addEventListener("resize", scheduleLatestButtonAnchor);
    visualViewport?.addEventListener("resize", holdAgainstKeyboard);
    visualViewport?.addEventListener("resize", scheduleLatestButtonAnchor);
    scheduleLatestButtonAnchor();
    panelMotion = mountTranscriptPanelMotion(
      transcriptRoot,
      motionShell,
      (next) => setViewportScrollTop(next, false),
    );
    transcriptVisibility = mountTranscriptVisibility(transcriptRoot, viewport, thread);
    const claimUserScroll = () => {
      if (empty()) return;
      if (!rendererUsesInertialTailFollow()) return;
      const changedOwner = typewriterTailState.owner !== "user";
      programmaticScrollTop = null;
      cancelTypewriterTailRejoin();
      setTypewriterTailOwner("user", true);
      if (changedOwner) {
        const recorder = getHarnessRecorder();
        if (recorder) {
          recordHarnessMetric(recorder, {
            stage: "transcript-scroll",
            renderer: rendererMetric(),
            owner: "typewriter-tail-inertial",
            ownership: "user",
            reasons: ["user-input"],
            mode: "user",
            scrollHeightReadCount: 0,
            scrollTopWriteCount: 0,
            movementPx: 0,
            velocityPxPerSecond: 0,
          });
        }
      }
    };
    const onScroll = () => {
      const maxScrollTop = viewportMaxScrollTop();
      if (empty()) {
        setFollowing(true);
        previousScrollTop = viewport.scrollTop;
        previousMaxScrollTop = maxScrollTop;
        return;
      }
      if (programmaticScrollTop != null && Math.abs(viewport.scrollTop - programmaticScrollTop) < 1) {
        programmaticScrollTop = null;
        previousScrollTop = viewport.scrollTop;
        previousMaxScrollTop = maxScrollTop;
        return;
      }
      const wasProgrammatic = programmaticScrollTop != null;
      programmaticScrollTop = null;
      const decision = decideTailScroll({
        scrollTop: viewport.scrollTop,
        previousScrollTop,
        maxScrollTop,
        previousMaxScrollTop,
        userOwned: typewriterTailState.owner === "user",
        following: following(),
      });
      previousScrollTop = viewport.scrollTop;
      previousMaxScrollTop = maxScrollTop;
      // An unrequested upward move is always a user: the spring only ever
      // travels toward the bottom, and browser scroll anchoring only pushes the
      // position down as content grows above. wheel and touchstart catch just
      // two ways a user produces one -- scrollbar drags, PageUp/Home, and
      // trackpad momentum arriving after wheel-end land here instead, and used
      // to leave the spring believing it still owned the viewport.
      if (decision.direction === "up") {
        cancelTypewriterTailRejoin();
        if (!wasProgrammatic) claimUserScroll();
      }
      if (!rendererUsesInertialTailFollow() || typewriterTailState.owner === "user" || !following()) {
        setFollowing(decision.following);
      } else if (decision.direction === "up") {
        setFollowing(false);
      }
      if (rendererUsesInertialTailFollow() && decision.rejoin) scheduleTypewriterTailRejoin();
      loadEarlier();
    };
    const onTouchStart = () => claimUserScroll();
    const onPointerDown = (event: PointerEvent) => {
      // A scrollbar drag lands on the viewport itself, outside any content box.
      if (event.target === viewport) claimUserScroll();
    };
    const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
    const onKeyDown = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) claimUserScroll();
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.addEventListener("wheel", claimUserScroll, { passive: true });
    viewport.addEventListener("touchstart", onTouchStart, { passive: true });
    viewport.addEventListener("pointerdown", onPointerDown, { passive: true });
    viewport.addEventListener("keydown", onKeyDown, { passive: true });
    window.addEventListener(COMPOSER_SURFACE_CHANGE_EVENT, syncComposerSurface);
    const resizeObserver = new ResizeObserver(() => {
      if (!following()) return;
      // Hiding and showing blocks resizes the thread. Chasing the tail on those
      // is a feedback loop: the scroll write changes what is in the overscan
      // band, which toggles more blocks, which resizes the thread again.
      // Panel reflow can resize the thread on every pointer frame. The motion
      // layer already preserves a visible anchor; tail-following the same
      // resize would move scrollTop a second time and make blocks jump.
      if (transcriptVisibility?.refreshing() || transcriptVisibility?.moving()) return;
      if (rendererUsesInertialTailFollow()) requestTypewriterTailFollow("resize");
      else scrollBottom();
    });
    resizeObserver.observe(thread);
    onCleanup(() => {
      window.removeEventListener(CODE_BLOCK_TOGGLE_EVENT, onCodeBlockToggle);
      window.removeEventListener(UI_PREFERENCE_CHANGE_EVENT, syncUiPreference);
      layoutEpoch += 1;
      resizeObserver.disconnect();
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("wheel", claimUserScroll);
      viewport.removeEventListener("touchstart", onTouchStart);
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(COMPOSER_SURFACE_CHANGE_EVENT, syncComposerSurface);
      composerResizeObserver.disconnect();
      window.removeEventListener("resize", scheduleLatestButtonAnchor);
      visualViewport?.removeEventListener("resize", holdAgainstKeyboard);
      visualViewport?.removeEventListener("resize", scheduleLatestButtonAnchor);
      if (latestButtonAnchorFrame != null) cancelAnimationFrame(latestButtonAnchorFrame);
      latestButton?.style.removeProperty("--message-scroller-button-bottom");
      transcriptRoot.style.removeProperty("--transcript-composer-inset");
      scheduleLatestButtonAnchor = () => {};
      if (scrollFrame != null) cancelAnimationFrame(scrollFrame);
      if (highlightIdle != null) cancelIdleCallback(highlightIdle);
      cancelTypewriterTailFrame();
      cancelTypewriterTailRejoin();
      typewriterTailReasons.clear();
      transcriptVisibility?.destroy();
      transcriptVisibility = null;
      panelMotion?.destroy();
      panelMotion = null;
    });
  });

  return <div ref={transcriptRoot} class="transcript" data-slot="message-scroller" data-markdown-renderer={markdownRenderer()} data-markdown-typewriter={rendererUsesTypewriter() ? "true" : undefined} data-incremark-pacing={rendererUsesTypewriter() ? incremarkPacing() : undefined}>
    <Show when={props.rendererControlsVisible}>
      <div class="composer-renderer-switch">
        <label>Composer renderer<select aria-label="Composer renderer" title="Composer renderer" value={composerSurface()} onChange={(event) => switchComposerSurface(event.currentTarget.value as ComposerSurfaceMode)}>
          <For each={COMPOSER_SURFACE_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
        </select></label>
        <label>Transcript renderer<select aria-label="Transcript renderer" title="Transcript renderer" value={markdownRenderer()} onChange={(event) => switchMarkdownRenderer(event.currentTarget.value as MarkdownRendererId)}>
          <For each={MARKDOWN_RENDERER_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
        </select></label>
        <label>Panel drag<select aria-label="Panel drag" title="Panel drag" value={panelDrag()} onChange={(event) => switchPanelDrag(event.currentTarget.value as PanelMotionMode)}>
          <For each={PANEL_MOTION_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
        </select></label>
        <Show when={rendererUsesTypewriter()}>
          <label>Typewriter pacing<select aria-label="Typewriter pacing" title="Typewriter pacing" value={incremarkPacing()} onChange={(event) => switchIncremarkPacing(event.currentTarget.value as IncremarkPacingMode)}>
            <For each={INCREMARK_PACING_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
          </select></label>
        </Show>
      </div>
    </Show>
    <div ref={motionShell} class="transcript-motion-shell">
      <div ref={viewport} class="message-scroller-viewport" data-slot="message-scroller-viewport">
        <div ref={thread} class="thread" data-slot="message-scroller-content">
        <Show when={props.chat.loadingOlder()}>
          <div data-slot="message-scroller-item" class="flex justify-center" role="status" aria-label="Loading earlier messages"><Spinner /></div>
        </Show>
        <Show when={empty()}><div class="empty-thread" data-slot="message-scroller-item"><div class="welcome"><h1>How can I help you today?</h1></div></div></Show>
        <For each={timeline}>{(item) => {
          if (item.type === "trace") {
            let traceRow!: HTMLDivElement;
            const chatId = () => props.chat.loadedId();
            const artifact = () => item.answerless && item.precedingUserId ? artifactSummaries().get(item.precedingUserId) : undefined;
            return <div ref={traceRow} data-slot="message-scroller-item"><TurnTrace trace={item.value} sessionId={chatId()} renderer={markdownRenderer()} pacing={incremarkPacing()} profileLabel={props.profileLabel} initialOpen={itemExpanded(chatId(), item.key)} onOpenChange={(open) => setItemExpanded(chatId(), item.key, open)} toolOpen={(id) => itemExpanded(chatId(), `tool:${id}`)} onToolOpenChange={(id, open) => setItemExpanded(chatId(), `tool:${id}`, open)} onRendered={() => settleAfterMarkdown(traceRow)} /><Show when={artifact()}>{(entry) => <div class="response-actions"><TurnArtifactButton artifact={entry()} chatId={chatId()!} /></div>}</Show></div>;
          }
          const message = createMemo(() => item.value);
          const user = createMemo(() => message().role === "user");
          const review = createMemo(() => user() ? parseReviewComments(message().content || "") : { text: message().content || "", comments: [] });
          const failed = createMemo(() => !user() && message().stopReason === "error");
          const live = createMemo(() => {
            if (item.live != null) return item.live;
            const last = props.chat.messages().at(-1);
            return props.chat.streaming() && !user() && Boolean(last && message().id === last.id);
          });
          const precedingUserId = () => user() ? undefined : item.precedingUserId;
          const artifact = createMemo(() => {
            const userId = precedingUserId();
            return userId ? artifactSummaries().get(userId) : undefined;
          });
          let row!: HTMLDivElement;
          return <div ref={row} data-slot="message-scroller-item" data-message-id={message().id}>
            <article data-slot="message" data-align={user() ? "end" : "start"} class={user() ? "message-user" : "message-assistant"}>
              <div data-slot="message-content">
                <Show when={message().timestamp}><time>{new Date(message().timestamp!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></Show>
                <Show when={!user() || review().text}><div data-slot="bubble" data-align={user() ? "end" : "start"} data-error={failed() ? "true" : undefined} data-editing={props.chat.editingEntryId() === message().id ? "true" : "false"} data-composer-surface={user() ? composerSurface() : undefined} class={user() ? "bubble bubble-user composer-surface-material" : "bubble bubble-assistant"}>
                  <div data-slot="bubble-content">
                    <Show when={user()} fallback={<>
                      <Show when={message().content}>
                        <Show when={message().discarded} fallback={<Suspense fallback={<div class="markdown-skeleton" />}>
                          <ChatMarkdown renderer={markdownRenderer()} pacing={incremarkPacing()} displayKey={item.displayKey} streaming={live()} streamVersion={item.streamVersion} onRendered={() => settleAfterMarkdown(row)}>{message().content || ""}</ChatMarkdown>
                        </Suspense>}>
                          <DiscardedAnswer message={message()} renderer={markdownRenderer()} pacing={incremarkPacing()} />
                        </Show>
                      </Show>
                      <Show when={failed()}>
                        <details class="assistant-error" open role="alert">
                          <summary><TriangleAlertIcon aria-hidden="true" /><strong>Request failed</strong></summary>
                          <dl class="assistant-error-meta">
                            <Show when={message().model}><div><dt>Model</dt><dd>{message().model}</dd></div></Show>
                            <Show when={message().provider}><div><dt>Provider</dt><dd>{message().provider}</dd></div></Show>
                            <Show when={props.profileLabel}><div><dt>Profile</dt><dd>{props.profileLabel}</dd></div></Show>
                            <Show when={message().timestamp}><div><dt>Time</dt><dd><time dateTime={message().timestamp}>{fullDateTime(message().timestamp)}</time></dd></div></Show>
                          </dl>
                          <pre>{message().errorMessage || "The model request failed."}</pre>
                        </details>
                      </Show>
                    </>}><UserMessageText text={review().text} /></Show>
                  </div>
                </div></Show>

                <Show when={user() && message().attachments?.length}><AttachmentCards items={message().attachments!} chatId={props.chat.loadedId()} label="Message attachments" /></Show>
                <Show when={user() && review().comments.length}><ReviewCommentCards items={review().comments} chatId={props.chat.loadedId() ?? ""} label="Code references" /></Show>
                <Show when={message().stopped}><div class="marker">{message().status === "stopping" ? "Stopping…" : "Stopped"}</div></Show>
                <Actions message={message()} precedingUserId={precedingUserId()} chat={props.chat} supports={props.supports} partialContinue={props.partialContinue} artifact={artifact()} />
              </div>
            </article>
          </div>;
        }}</For>
        </div>
      </div>
      <Show when={!following()}><Button ref={(element) => { latestButton = element; scheduleLatestButtonAnchor(); }} variant="ghost" size="icon-sm" class="message-scroller-button composer-surface-material" data-composer-surface={composerSurface()} aria-label="Scroll to latest" title="Scroll to latest" onClick={() => { if (rendererUsesInertialTailFollow()) resumeTypewriterTailFollow("user-scroll-to-latest"); else { setFollowing(true); scrollBottom(); } }}><ArrowDownIcon /></Button></Show>
    </div>
  </div>;
}
