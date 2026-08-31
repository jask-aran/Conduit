import { createEffect, createMemo, createRenderEffect, createSignal, For, lazy, onCleanup, onMount, Show, Suspense } from "solid-js";
import { ArrowDownIcon, CheckIcon, CopyIcon, PencilIcon, PlayIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-solid";
import { Button, Spinner } from "@/components/primitives";
import type { Message, RuntimeActivity, ToolItem } from "../api/contracts";
import type { ActiveChatStore } from "../state/active-chat";
import { AttachmentCards } from "./attachments";
import { TurnTrace } from "./turn-trace";
import { createTimelineStore } from "../state/timeline-store";
import type { MarkdownRendererId } from "./markdown-settings";
import { COMPOSER_SURFACE_CHANGE_EVENT, COMPOSER_SURFACE_OPTIONS, saveComposerSurface, selectedComposerSurface, type ComposerSurfaceMode } from "./composer-surface";
import { saveTranscriptRenderer, selectedTranscriptRenderer, TRANSCRIPT_RENDERER_OPTIONS, type TranscriptRendererMode } from "./transcript-renderer";
import { INCREMARK_PACING_OPTIONS, saveIncremarkPacing, selectedIncremarkPacing, type IncremarkPacingMode } from "./incremark-pacing";
import { UI_PREFERENCE_CHANGE_EVENT } from "../preferences/ui-preferences";
import { copyWithFeedback } from "./markdown-actions";
import { CODE_BLOCK_TOGGLE_EVENT, syncCodeBlockCollapse } from "./code-block";
import { highlightCodeBlocks } from "./code-highlight";
import {
  selectedCodeBlockCollapse,
  selectedCodeBlockCollapseLines,
  isCodeBlockCollapseMode,
  isCodeBlockCollapseLines,
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

const ChatMarkdown = lazy(() => import("./markdown").then((module) => ({ default: module.ChatMarkdown })));
const IncremarkAdvancedMarkdown = lazy(() => import("./incremark-advanced").then((module) => ({ default: module.IncremarkAdvancedMarkdown })));
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

function Actions(props: { message: Message; precedingUserId?: string; chat: ActiveChatStore; partialContinue: boolean }) {
  const [copied, setCopied] = createSignal(false);
  let copyButton: HTMLButtonElement | undefined;
  const assistant = () => props.message.role !== "user";
  return <div class="response-actions">
    <Show when={!assistant() && !props.message.id.startsWith("user_")}>
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
      <Show when={props.precedingUserId}><Button variant="ghost" size="icon-sm" aria-label="Regenerate response" onClick={() => void props.chat.regenerate(props.precedingUserId!)}><RefreshCwIcon /></Button></Show>
      <Show when={props.partialContinue && props.message.stopped}><Button variant="ghost" size="icon-sm" aria-label="Continue stopped response" onClick={() => void props.chat.continueResponse()}><PlayIcon /></Button></Show>
    </Show>
  </div>;
}

export function Transcript(props: { chat: ActiveChatStore; partialContinue: boolean; markdownRenderer: MarkdownRendererId; rendererControlsVisible: boolean; profileLabel?: string }) {
  let transcriptRoot!: HTMLDivElement;
  let motionShell!: HTMLDivElement;
  let viewport!: HTMLDivElement;
  let thread!: HTMLDivElement;
  let latestButton: HTMLButtonElement | undefined;
  let scheduleLatestButtonAnchor = () => {};
  let panelMotion: ReturnType<typeof mountTranscriptPanelMotion> | null = null;
  let transcriptVisibility: ReturnType<typeof mountTranscriptVisibility> | null = null;
  let previousLoaded: string | null = null;
  let historyLoad: Promise<void> | null = null;
  let layoutEpoch = 0;
  let previousMarkdownRenderer = props.markdownRenderer;
  const [following, setFollowing] = createSignal(true);
  const [composerSurface, setComposerSurface] = createSignal<ComposerSurfaceMode>(selectedComposerSurface());
  const [transcriptRenderer, setTranscriptRenderer] = createSignal<TranscriptRendererMode>(selectedTranscriptRenderer(props.markdownRenderer));
  const [incremarkPacing, setIncremarkPacing] = createSignal<IncremarkPacingMode>(selectedIncremarkPacing());
  const markdownRenderer = (): MarkdownRendererId => transcriptRenderer() === "incremark-advanced"
    ? "incremark-synthetic"
    : transcriptRenderer() as MarkdownRendererId;
  const switchComposerSurface = (next: ComposerSurfaceMode) => setComposerSurface(saveComposerSurface(next));
  // A reset relays out every managed block, so hold the reading position across
  // it rather than letting the height changes settle wherever they land.
  const resetVisibilityPreservingPosition = () => {
    if (!transcriptVisibility || !viewport || !thread) return;
    const anchor = captureTranscriptAnchor(viewport, thread);
    transcriptVisibility.reset();
    requestAnimationFrame(() => restoreTranscriptAnchor(viewport, anchor, setViewportScrollTop));
  };
  const switchTranscriptRenderer = (next: TranscriptRendererMode) => {
    const crossesAdvancedBoundary = transcriptRenderer() === "incremark-advanced" || next === "incremark-advanced";
    setTranscriptRenderer(saveTranscriptRenderer(next));
    if (crossesAdvancedBoundary) queueMicrotask(resetVisibilityPreservingPosition);
  };
  const switchIncremarkPacing = (next: IncremarkPacingMode) => setIncremarkPacing(saveIncremarkPacing(next));
  const advancedTranscript = () => transcriptRenderer() === "incremark-advanced";
  const rendererUsesTypewriter = () => markdownRenderer() === "incremark-typewriter" || markdownRenderer() === "incremark-synthetic";
  const rendererUsesInertialTailFollow = () => rendererUsesTypewriter();
  const rendererMetric = () => advancedTranscript() ? "incremark-advanced" : markdownRenderer();
  const timeline = createTimelineStore(
    props.chat.messages,
    props.chat.tools,
    props.chat.activeGeneration,
    props.chat.activeGenerationChange,
  );
  const empty = createMemo(() => !timeline.length && !props.chat.activity()?.label);

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
  let previousUserMessageId: string | null = null;
  let previousRenderer: TranscriptRendererMode | null = null;
  const currentViewportScrollTop = () => viewport?.scrollTop ?? 0;
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
  const setViewportScrollTop = (next: number) => {
    viewport.scrollTop = Math.round(next);
    programmaticScrollTop = viewport.scrollTop;
    previousScrollTop = viewport.scrollTop;
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
  let highlightIdle: number | null = null;
  const scheduleHighlight = () => {
    if (highlightIdle != null || !thread) return;
    highlightIdle = requestIdleCallback(() => {
      highlightIdle = null;
      void highlightCodeBlocks(thread);
    }, { timeout: 600 });
  };
  let displayScrollQueued = false;
  const settleAfterMarkdown = () => {
    scheduleHighlight();
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
    const trailingUserId = trailingUser ? trailingUser.key || trailingUser.id : null;
    if (loaded !== previousLoaded) {
      previousLoaded = loaded;
      previousUserMessageId = trailingUserId;
      const epoch = layoutEpoch;
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
  createEffect(() => {
    const next = props.markdownRenderer;
    if (next === previousMarkdownRenderer) return;
    previousMarkdownRenderer = next;
    if (advancedTranscript()) return;
    setTranscriptRenderer(saveTranscriptRenderer(next));
  });
  createEffect(() => {
    const renderer = transcriptRenderer();
    const previous = previousRenderer;
    if (previous == null) {
      previousRenderer = renderer;
      return;
    }
    if (renderer === previous) return;
    previousRenderer = renderer;
    if (renderer === "incremark-advanced" || previous === "incremark-advanced") resetVisibilityPreservingPosition();
    if (rendererUsesInertialTailFollow()) resumeTypewriterTailFollow("renderer-switch");
    else {
      cancelTypewriterTailRejoin();
      cancelTypewriterTailFrame();
      typewriterTailReasons.clear();
      setTypewriterTailOwner("app", true);
    }
  });

  onMount(() => {
    const syncComposerSurface = () => setComposerSurface(selectedComposerSurface());
    const syncUiPreference = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; value?: unknown }>).detail;
      const params = new URLSearchParams(location.search);
      if (detail?.key === "composerSurface") setComposerSurface(selectedComposerSurface());
      else if (detail?.key === "transcriptRenderer" && typeof detail.value === "string"
        && !params.has("transcriptRenderer") && !params.has("markdownRenderer")) {
        setTranscriptRenderer(detail.value as TranscriptRendererMode);
      } else if (detail?.key === "incremarkPacing" && typeof detail.value === "string"
        && !params.has("incremarkPacing") && !params.has("adaptivePacing")) {
        setIncremarkPacing(detail.value as IncremarkPacingMode);
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
    const composerResizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      const blockSize = entry?.borderBoxSize[0]?.blockSize ?? entry?.contentRect.height ?? 0;
      if (Math.abs(blockSize - composerBlockSize) < 0.5) return;
      composerBlockSize = blockSize;
      scheduleLatestButtonAnchor();
    });
    if (composerStack) composerResizeObserver.observe(composerStack);
    const visualViewport = window.visualViewport;
    window.addEventListener("resize", scheduleLatestButtonAnchor);
    visualViewport?.addEventListener("resize", scheduleLatestButtonAnchor);
    scheduleLatestButtonAnchor();
    panelMotion = mountTranscriptPanelMotion(transcriptRoot, motionShell);
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
      if (empty()) {
        setFollowing(true);
        previousScrollTop = viewport.scrollTop;
        return;
      }
      if (programmaticScrollTop != null && Math.abs(viewport.scrollTop - programmaticScrollTop) < 1) {
        programmaticScrollTop = null;
        previousScrollTop = viewport.scrollTop;
        return;
      }
      const wasProgrammatic = programmaticScrollTop != null;
      programmaticScrollTop = null;
      const decision = decideTailScroll({
        scrollTop: viewport.scrollTop,
        previousScrollTop,
        maxScrollTop: viewportMaxScrollTop(),
        userOwned: typewriterTailState.owner === "user",
        following: following(),
      });
      previousScrollTop = viewport.scrollTop;
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
      if (transcriptVisibility?.refreshing()) return;
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
      visualViewport?.removeEventListener("resize", scheduleLatestButtonAnchor);
      if (latestButtonAnchorFrame != null) cancelAnimationFrame(latestButtonAnchorFrame);
      latestButton?.style.removeProperty("--message-scroller-button-bottom");
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

  return <div ref={transcriptRoot} class="transcript" data-slot="message-scroller" data-markdown-renderer={markdownRenderer()} data-transcript-renderer={transcriptRenderer()} data-markdown-typewriter={rendererUsesTypewriter() ? "true" : undefined} data-incremark-pacing={rendererUsesTypewriter() ? incremarkPacing() : undefined} data-markdown-synthetic-math={markdownRenderer() === "incremark-synthetic" ? "true" : undefined}>
    <Show when={props.rendererControlsVisible}>
      <div class="composer-renderer-switch">
        <label>Composer renderer<select aria-label="Composer renderer" title="Composer renderer" value={composerSurface()} onChange={(event) => switchComposerSurface(event.currentTarget.value as ComposerSurfaceMode)}>
          <For each={COMPOSER_SURFACE_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
        </select></label>
        <label>Transcript renderer<select aria-label="Transcript renderer" title="Transcript renderer" value={transcriptRenderer()} onChange={(event) => switchTranscriptRenderer(event.currentTarget.value as TranscriptRendererMode)}>
          <For each={TRANSCRIPT_RENDERER_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
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
          if (item.type === "trace") return <div data-slot="message-scroller-item"><TurnTrace trace={item.value} sessionId={props.chat.loadedId()} renderer={markdownRenderer()} pacing={incremarkPacing()} profileLabel={props.profileLabel} /></div>;
          const message = createMemo(() => item.value);
          const user = createMemo(() => message().role === "user");
          const failed = createMemo(() => !user() && message().stopReason === "error");
          const live = createMemo(() => {
            if (item.live != null) return item.live;
            const last = props.chat.messages().at(-1);
            return props.chat.streaming() && !user() && Boolean(last && (message().key || message().id) === (last.key || last.id));
          });
          const preceding = createMemo(() => !user() ? props.chat.messages().slice(0, item.index).findLast((candidate) => candidate.role === "user") : undefined);
          return <div data-slot="message-scroller-item" data-message-id={message().id}>
            <article data-slot="message" data-align={user() ? "end" : "start"} class={user() ? "message-user" : "message-assistant"}>
              <div data-slot="message-content">
                <Show when={message().timestamp}><time>{new Date(message().timestamp!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></Show>
                <div data-slot="bubble" data-align={user() ? "end" : "start"} data-error={failed() ? "true" : undefined} data-editing={props.chat.editingEntryId() === message().id ? "true" : "false"} class={user() ? "bubble bubble-user" : "bubble bubble-assistant"}>
                  <div data-slot="bubble-content">
                    <Show when={user()} fallback={<>
                      <Show when={message().content}><Suspense fallback={<div class="markdown-skeleton" />}>
                        <Show when={advancedTranscript()} fallback={<ChatMarkdown renderer={markdownRenderer()} typewriter={rendererUsesTypewriter()} syntheticMath={markdownRenderer() === "incremark-synthetic"} pacing={incremarkPacing()} displayKey={item.displayKey} streaming={live()} streamVersion={item.streamVersion} onRendered={settleAfterMarkdown}>{message().content || ""}</ChatMarkdown>}>
                          <IncremarkAdvancedMarkdown renderer="incremark-synthetic" pacing={incremarkPacing()} displayKey={item.displayKey} streaming={live()} streamVersion={item.streamVersion} onRendered={settleAfterMarkdown}>{message().content || ""}</IncremarkAdvancedMarkdown>
                        </Show>
                      </Suspense></Show>
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
                    </>}><span class="user-message-text">{message().content || ""}</span></Show>
                  </div>
                </div>
                <Show when={user() && message().pending}><div class="marker">{message().queueMode === "steer" ? "Queued · steer (after tools)" : "Queued · follow-up (after turn)"}</div></Show>
                <Show when={user() && message().attachments?.length}><AttachmentCards items={message().attachments!} chatId={props.chat.loadedId()} label="Message attachments" /></Show>
                <Show when={message().stopped}><div class="marker">{message().status === "stopping" ? "Stopping…" : "Stopped"}</div></Show>
                <Actions message={message()} precedingUserId={preceding()?.id} chat={props.chat} partialContinue={props.partialContinue} />
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
