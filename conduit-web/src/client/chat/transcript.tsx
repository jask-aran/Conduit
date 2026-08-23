import { createEffect, createMemo, createRenderEffect, createSignal, For, lazy, onCleanup, onMount, Show, Suspense, type JSX } from "solid-js";
import { CopyIcon, PencilIcon, PlayIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-solid";
import { Button, Spinner } from "@/components/primitives";
import type { Message, RuntimeActivity, ToolItem } from "../api/contracts";
import type { ActiveChatStore } from "../state/active-chat";
import { AttachmentCards } from "./attachments";
import { TurnTrace } from "./turn-trace";
import { createTimelineStore } from "../state/timeline-store";
import type { MarkdownRendererId } from "./markdown-settings";
import { mountTranscriptPanelMotion } from "./transcript-motion";
import { mountTranscriptVisibility } from "./transcript-visibility";
import { getHarnessRecorder, recordHarnessMetric } from "../harness-metrics";
import {
  advanceTailFollow,
  createTailFollowState,
  rebaseTailFollowState,
  type TailFollowOwner,
  type TailFollowState,
} from "./transcript-tail-follow";

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

function Actions(props: { message: Message; precedingUserId?: string; chat: ActiveChatStore; partialContinue: boolean }) {
  const [copied, setCopied] = createSignal(false);
  const assistant = () => props.message.role !== "user";
  return <div class="response-actions">
    <Show when={!assistant() && !props.message.id.startsWith("user_")}>
      <Button variant="ghost" size="icon-sm" aria-label={props.chat.editingEntryId() === props.message.id ? "Cancel editing" : "Edit from here"} onClick={() => props.chat.edit(props.message)}><PencilIcon /></Button>
    </Show>
    <Show when={assistant()}>
      <Button variant="ghost" size="icon-sm" aria-label={copied() ? "Copied" : "Copy Markdown"} onClick={async () => { await navigator.clipboard.writeText(props.message.content || props.message.errorMessage || ""); setCopied(true); setTimeout(() => setCopied(false), 1600); }}><CopyIcon /></Button>
      <Show when={props.precedingUserId}><Button variant="ghost" size="icon-sm" aria-label="Regenerate response" onClick={() => void props.chat.regenerate(props.precedingUserId!)}><RefreshCwIcon /></Button></Show>
      <Show when={props.partialContinue && props.message.stopped}><Button variant="ghost" size="icon-sm" aria-label="Continue stopped response" onClick={() => void props.chat.continueResponse()}><PlayIcon /></Button></Show>
    </Show>
  </div>;
}

export function Transcript(props: { chat: ActiveChatStore; partialContinue: boolean; markdownRenderer: MarkdownRendererId; profileLabel?: string; stickyFooter?: JSX.Element; composerRendererSwitch?: JSX.Element }) {
  let transcriptRoot!: HTMLDivElement;
  let motionShell!: HTMLDivElement;
  let viewport!: HTMLDivElement;
  let thread!: HTMLDivElement;
  let panelMotion: ReturnType<typeof mountTranscriptPanelMotion> | null = null;
  let transcriptVisibility: ReturnType<typeof mountTranscriptVisibility> | null = null;
  let previousLoaded: string | null = null;
  let historyLoad: Promise<void> | null = null;
  let layoutEpoch = 0;
  const [following, setFollowing] = createSignal(true);
  const markdownRenderer = () => props.markdownRenderer;
  const rendererUsesTypewriter = () => markdownRenderer() === "incremark-typewriter" || markdownRenderer() === "incremark-synthetic";
  const rendererUsesInertialTailFollow = () => markdownRenderer() === "incremark-typewriter" || markdownRenderer() === "incremark-synthetic";
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
  let previousRenderer: MarkdownRendererId | null = null;
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
    programmaticScrollTop = next;
    viewport.scrollTop = next;
    programmaticScrollTop = viewport.scrollTop;
  };
  const scrollBottomNow = () => {
    if (scrollFrame != null) {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = null;
    }
    setViewportScrollTop(viewport.scrollHeight);
    if (viewport.scrollTop < 240) loadEarlier();
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
      const targetScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
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
      const maxScrollTop = Math.max(0, scrollHeight - viewport.clientHeight);
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
          renderer: markdownRenderer(),
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
      if (viewport.scrollTop < 240) loadEarlier(scrollHeight, viewport.scrollTop);

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
  let displayScrollQueued = false;
  const settleAfterMarkdown = () => {
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
  const loadEarlier = (knownHeight?: number, knownTop?: number) => {
    const userRequested = knownHeight == null && knownTop == null;
    if (userRequested && rendererUsesInertialTailFollow()) {
      cancelTypewriterTailRejoin();
      setTypewriterTailOwner("user", true);
      setFollowing(false);
    }
    if (historyLoad || !props.chat.pageBefore() || props.chat.loadingOlder()) return;
    const previousHeight = knownHeight ?? viewport.scrollHeight;
    const previousTop = knownTop ?? viewport.scrollTop;
    const anchor = thread.querySelector<HTMLElement>('[data-message-id]');
    const anchorTop = anchor?.getBoundingClientRect().top ?? null;
    const previousOverflowAnchor = viewport.style.overflowAnchor;
    viewport.style.overflowAnchor = "none";
    const restoreAnchor = () => {
      if (anchor?.isConnected && anchorTop != null) {
        const delta = anchor.getBoundingClientRect().top - anchorTop;
        if (Math.abs(delta) > 0.05) setViewportScrollTop(viewport.scrollTop + delta);
        return;
      }
      setViewportScrollTop(previousTop + viewport.scrollHeight - previousHeight);
    };
    historyLoad = props.chat.loadOlder().then((loaded) => {
      if (!loaded) return;
      // Solid commits the prepended rows before the microtask queue drains,
      // while lazy Markdown can finish one frame later. Restore at both points
      // so the new rows never expose an uncorrected anchor to the browser.
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
    if (loaded !== previousLoaded) {
      previousLoaded = loaded;
      const epoch = layoutEpoch;
      if (rendererUsesInertialTailFollow()) resumeTypewriterTailFollow("loaded");
      else {
        setFollowing(true);
        scrollBottom();
      }
      void document.fonts.ready.then(() => settleInitialLayout(epoch));
    }
    else if (following() && !rendererUsesTypewriter()) scrollBottom();
  });
  createEffect(() => {
    const renderer = markdownRenderer();
    if (previousRenderer == null) {
      previousRenderer = renderer;
      return;
    }
    if (renderer === previousRenderer) return;
    previousRenderer = renderer;
    if (rendererUsesInertialTailFollow()) resumeTypewriterTailFollow("renderer-switch");
    else {
      cancelTypewriterTailRejoin();
      cancelTypewriterTailFrame();
      typewriterTailReasons.clear();
      setTypewriterTailOwner("app", true);
    }
  });

  const [pullDistance, setPullDistance] = createSignal(0);
  const [pullArmed, setPullArmed] = createSignal(false);
  let pullStartY = 0;
  let pulling = false;

  onMount(() => {
    panelMotion = mountTranscriptPanelMotion(transcriptRoot, motionShell);
    transcriptVisibility = mountTranscriptVisibility(transcriptRoot, viewport, thread);
    const claimUserScroll = () => {
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
            renderer: markdownRenderer(),
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
      if (programmaticScrollTop != null && Math.abs(viewport.scrollTop - programmaticScrollTop) < 1) {
        programmaticScrollTop = null;
        return;
      }
      programmaticScrollTop = null;
      const nearLatest = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80;
      if (!rendererUsesInertialTailFollow() || typewriterTailState.owner === "user" || !following()) {
        setFollowing(nearLatest);
      }
      if (rendererUsesInertialTailFollow() && typewriterTailState.owner === "user" && nearLatest) {
        scheduleTypewriterTailRejoin();
      }
      if (viewport.scrollTop < 240) loadEarlier();
    };
    // Empty-state pull-to-refresh: hard reload so a stuck PWA shell or live
    // socket can recover without hunting browser menus.
    const onTouchStart = (event: TouchEvent) => {
      claimUserScroll();
      if (!empty() || event.touches.length !== 1) return;
      pullStartY = event.touches[0]!.clientY;
      pulling = true;
      setPullArmed(false);
      setPullDistance(0);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!pulling || !empty() || event.touches.length !== 1) return;
      const delta = event.touches[0]!.clientY - pullStartY;
      if (delta <= 0) {
        setPullDistance(0);
        setPullArmed(false);
        return;
      }
      // Resist the drag so the welcome card barely moves.
      const resisted = Math.min(96, delta * 0.35);
      setPullDistance(resisted);
      setPullArmed(resisted >= 56);
      if (delta > 8) event.preventDefault();
    };
    const onTouchEnd = () => {
      if (!pulling) return;
      pulling = false;
      const shouldReload = pullArmed();
      setPullDistance(0);
      setPullArmed(false);
      if (shouldReload) location.reload();
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.addEventListener("wheel", claimUserScroll, { passive: true });
    viewport.addEventListener("touchstart", onTouchStart, { passive: true });
    viewport.addEventListener("touchmove", onTouchMove, { passive: false });
    viewport.addEventListener("touchend", onTouchEnd);
    viewport.addEventListener("touchcancel", onTouchEnd);
    const resizeObserver = new ResizeObserver(() => {
      if (!following()) return;
      if (rendererUsesInertialTailFollow()) requestTypewriterTailFollow("resize");
      else scrollBottom();
    });
    resizeObserver.observe(thread);
    onCleanup(() => {
      layoutEpoch += 1;
      resizeObserver.disconnect();
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("wheel", claimUserScroll);
      viewport.removeEventListener("touchstart", onTouchStart);
      viewport.removeEventListener("touchmove", onTouchMove);
      viewport.removeEventListener("touchend", onTouchEnd);
      viewport.removeEventListener("touchcancel", onTouchEnd);
      if (scrollFrame != null) cancelAnimationFrame(scrollFrame);
      cancelTypewriterTailFrame();
      cancelTypewriterTailRejoin();
      typewriterTailReasons.clear();
      transcriptVisibility?.destroy();
      transcriptVisibility = null;
      panelMotion?.destroy();
      panelMotion = null;
    });
  });

  return <div ref={transcriptRoot} class="transcript" data-slot="message-scroller" data-markdown-renderer={markdownRenderer()} data-markdown-typewriter={rendererUsesTypewriter() ? "true" : undefined} data-markdown-synthetic-math={markdownRenderer() === "incremark-synthetic" ? "true" : undefined}>
    {props.composerRendererSwitch}
    <Show when={empty() && pullDistance() > 8}>
      <div class="empty-pull-hint" data-visible="true" data-armed={pullArmed() ? "true" : "false"} aria-hidden="true">
        {pullArmed() ? "Release to refresh" : "Pull to refresh"}
      </div>
    </Show>
    <div ref={motionShell} class="transcript-motion-shell">
      <div ref={viewport} class="message-scroller-viewport" data-slot="message-scroller-viewport">
        <div ref={thread} class="thread" data-slot="message-scroller-content" style={empty() && pullDistance() > 0 ? { transform: `translateY(${pullDistance()}px)` } : undefined}>
        <Show when={props.chat.loadingOlder()}>
          <div data-slot="message-scroller-item" class="flex justify-center" role="status" aria-label="Loading earlier messages"><Spinner /></div>
        </Show>
        <Show when={empty()}><div class="empty-thread" data-slot="message-scroller-item"><div class="welcome"><h1>How can I help you today?</h1></div></div></Show>
        <For each={timeline}>{(item) => {
          if (item.type === "trace") return <div data-slot="message-scroller-item"><TurnTrace trace={item.value} sessionId={props.chat.loadedId()} renderer={markdownRenderer()} profileLabel={props.profileLabel} /></div>;
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
                      <Show when={message().content}><Suspense fallback={<div class="markdown-skeleton" />}><ChatMarkdown renderer={markdownRenderer()} typewriter={rendererUsesTypewriter()} syntheticMath={markdownRenderer() === "incremark-synthetic"} displayKey={item.displayKey} streaming={live()} streamVersion={item.streamVersion} onRendered={settleAfterMarkdown}>{message().content || ""}</ChatMarkdown></Suspense></Show>
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
        {props.stickyFooter}
      </div>
      <Show when={!following()}><Button class="message-scroller-button" aria-label="Scroll to latest" onClick={() => { if (rendererUsesInertialTailFollow()) resumeTypewriterTailFollow("user-scroll-to-latest"); else { setFollowing(true); scrollBottom(); } }}>↓</Button></Show>
    </div>
  </div>;
}
