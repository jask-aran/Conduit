import { createEffect, createMemo, createRenderEffect, createSignal, For, lazy, onCleanup, onMount, Show, Suspense } from "solid-js";
import { CopyIcon, PencilIcon, PlayIcon, RefreshCwIcon } from "lucide-solid";
import { Button, Spinner } from "@/components/primitives";
import type { Message, RuntimeActivity, ToolItem } from "../api/contracts";
import type { ActiveChatStore } from "../state/active-chat";
import { AttachmentCards } from "./attachments";
import { TurnTrace } from "./turn-trace";
import { createTimelineStore } from "../state/timeline-store";
import type { MarkdownRendererId } from "./markdown-settings";
import { mountTranscriptPanelMotion } from "./transcript-motion";
import { mountTranscriptVisibility } from "./transcript-visibility";

const ChatMarkdown = lazy(() => import("./markdown").then((module) => ({ default: module.ChatMarkdown })));
function Actions(props: { message: Message; precedingUserId?: string; chat: ActiveChatStore; partialContinue: boolean }) {
  const [copied, setCopied] = createSignal(false);
  const assistant = () => props.message.role !== "user";
  return <div class="response-actions">
    <Show when={!assistant() && !props.message.id.startsWith("user_")}>
      <Button variant="ghost" size="icon-sm" aria-label={props.chat.editingEntryId() === props.message.id ? "Cancel editing" : "Edit from here"} onClick={() => props.chat.edit(props.message)}><PencilIcon /></Button>
    </Show>
    <Show when={assistant()}>
      <Button variant="ghost" size="icon-sm" aria-label={copied() ? "Copied" : "Copy Markdown"} onClick={async () => { await navigator.clipboard.writeText(props.message.content || ""); setCopied(true); setTimeout(() => setCopied(false), 1600); }}><CopyIcon /></Button>
      <Show when={props.precedingUserId}><Button variant="ghost" size="icon-sm" aria-label="Regenerate response" onClick={() => void props.chat.regenerate(props.precedingUserId!)}><RefreshCwIcon /></Button></Show>
      <Show when={props.partialContinue && props.message.stopped}><Button variant="ghost" size="icon-sm" aria-label="Continue stopped response" onClick={() => void props.chat.continueResponse()}><PlayIcon /></Button></Show>
    </Show>
  </div>;
}

export function Transcript(props: { chat: ActiveChatStore; partialContinue: boolean; markdownRenderer: MarkdownRendererId }) {
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
  const timeline = createTimelineStore(
    props.chat.messages,
    props.chat.tools,
    props.chat.activeGeneration,
    props.chat.activeGenerationChange,
  );
  const empty = createMemo(() => !timeline.length && !props.chat.activity()?.label);

  let scrollFrame: number | null = null;
  let programmaticScrollTop: number | null = null;
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
  const settleInitialLayout = (epoch: number) => {
    if (epoch !== layoutEpoch || !following()) return;
    scrollBottomNow();
  };
  let displayScrollQueued = false;
  const settleAfterMarkdown = () => {
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
    if (historyLoad || !props.chat.pageBefore() || props.chat.loadingOlder()) return;
    const previousHeight = viewport.scrollHeight;
    const previousTop = viewport.scrollTop;
    const restoreAnchor = () => {
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
    }).finally(() => { historyLoad = null; });
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
      setFollowing(true);
      scrollBottom();
      void document.fonts.ready.then(() => settleInitialLayout(epoch));
    }
    else if (following() && !rendererUsesTypewriter()) scrollBottom();
  });

  const [pullDistance, setPullDistance] = createSignal(0);
  const [pullArmed, setPullArmed] = createSignal(false);
  let pullStartY = 0;
  let pulling = false;

  onMount(() => {
    panelMotion = mountTranscriptPanelMotion(transcriptRoot, motionShell);
    transcriptVisibility = mountTranscriptVisibility(transcriptRoot, viewport, thread);
    const onScroll = () => {
      if (programmaticScrollTop != null && Math.abs(viewport.scrollTop - programmaticScrollTop) < 1) {
        programmaticScrollTop = null;
        return;
      }
      programmaticScrollTop = null;
      setFollowing(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80);
      if (viewport.scrollTop < 240) loadEarlier();
    };
    // Empty-state pull-to-refresh: hard reload so a stuck PWA shell or live
    // socket can recover without hunting browser menus.
    const onTouchStart = (event: TouchEvent) => {
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
    viewport.addEventListener("touchstart", onTouchStart, { passive: true });
    viewport.addEventListener("touchmove", onTouchMove, { passive: false });
    viewport.addEventListener("touchend", onTouchEnd);
    viewport.addEventListener("touchcancel", onTouchEnd);
    const resizeObserver = new ResizeObserver(() => {
      if (following()) scrollBottom();
    });
    resizeObserver.observe(thread);
    onCleanup(() => {
      layoutEpoch += 1;
      resizeObserver.disconnect();
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("touchstart", onTouchStart);
      viewport.removeEventListener("touchmove", onTouchMove);
      viewport.removeEventListener("touchend", onTouchEnd);
      viewport.removeEventListener("touchcancel", onTouchEnd);
      if (scrollFrame != null) cancelAnimationFrame(scrollFrame);
      transcriptVisibility?.destroy();
      transcriptVisibility = null;
      panelMotion?.destroy();
      panelMotion = null;
    });
  });

  return <div ref={transcriptRoot} class="transcript" data-slot="message-scroller" data-markdown-renderer={markdownRenderer()} data-markdown-typewriter={rendererUsesTypewriter() ? "true" : undefined} data-markdown-synthetic-math={markdownRenderer() === "incremark-synthetic" ? "true" : undefined}>
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
          if (item.type === "trace") return <div data-slot="message-scroller-item"><TurnTrace trace={item.value} sessionId={props.chat.loadedId()} renderer={markdownRenderer()} /></div>;
          const message = createMemo(() => item.value);
          const user = createMemo(() => message().role === "user");
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
                <div data-slot="bubble" data-align={user() ? "end" : "start"} data-editing={props.chat.editingEntryId() === message().id ? "true" : "false"} class={user() ? "bubble bubble-user" : "bubble bubble-assistant"}>
                  <div data-slot="bubble-content">
                    <Show when={user()} fallback={<Suspense fallback={<div class="markdown-skeleton" />}><ChatMarkdown renderer={markdownRenderer()} typewriter={rendererUsesTypewriter()} syntheticMath={markdownRenderer() === "incremark-synthetic"} displayKey={item.displayKey} streaming={live()} streamVersion={item.streamVersion} onRendered={settleAfterMarkdown}>{message().content || ""}</ChatMarkdown></Suspense>}><span class="user-message-text">{message().content || ""}</span></Show>
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
      <Show when={!following()}><Button class="message-scroller-button" aria-label="Scroll to latest" onClick={() => { setFollowing(true); scrollBottom(); }}>↓</Button></Show>
    </div>
  </div>;
}
