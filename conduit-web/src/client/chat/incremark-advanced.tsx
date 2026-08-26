import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { ChatMarkdownProps } from "./markdown";
import { IncremarkMarkdown } from "./incremark-markdown";
import "./incremark-advanced.css";

const SETTLE_ATTRIBUTE = "data-incremark-advanced-state";
const SETTLE_DELAY_FRAMES = 2;

export function IncremarkAdvancedMarkdown(props: ChatMarkdownProps) {
  let shell!: HTMLDivElement;
  const [frozenSource, setFrozenSource] = createSignal<string | null>(null);
  const [settled, setSettled] = createSignal(false);
  let observer: MutationObserver | null = null;
  let settleFrame: number | null = null;
  let settleFramesRemaining = 0;

  // Both memos deliberately preserve value equality across settlement. When
  // frozenSource changes from null to the already-rendered final string, and
  // settled changes while streaming is already false, downstream Incremark
  // computations see no value change and therefore receive no terminal render
  // pulse. The memo also drops its live props.children dependency once frozen.
  const source = createMemo(() => frozenSource() ?? String(props.children || ""));
  const streaming = createMemo(() => settled() ? false : Boolean(props.streaming));
  const cancelSettlement = () => {
    if (settleFrame != null) cancelAnimationFrame(settleFrame);
    settleFrame = null;
    settleFramesRemaining = 0;
  };
  const rendererRoot = () => shell?.querySelector<HTMLElement>(".chat-markdown") || null;
  const rendererIsQuiet = () => {
    const root = rendererRoot();
    if (!root || props.streaming) return false;
    if (root.hasAttribute("data-streaming")) return false;
    if (root.getAttribute("data-display-busy") === "true") return false;
    if (root.hasAttribute("data-pending-math-renders")) return false;
    if (root.querySelector("[data-streaming-pending]")) return false;
    return true;
  };
  const commitSettlement = () => {
    settleFrame = null;
    if (settled() || !rendererIsQuiet()) return;
    const snapshot = String(props.children || "");
    // The source branch becomes permanently local after this write. The
    // already-mounted Incremark DOM is not cloned, serialized, replaced, or
    // reparsed. Because source() and streaming() retain equal output values,
    // the underlying renderer is not notified of a terminal representation
    // change either.
    setFrozenSource(snapshot);
    setSettled(true);
    shell.setAttribute(SETTLE_ATTRIBUTE, "settled");
    observer?.disconnect();
    observer = null;
  };
  const advanceSettlement = () => {
    settleFrame = null;
    if (settled() || !rendererIsQuiet()) {
      settleFramesRemaining = 0;
      return;
    }
    if (settleFramesRemaining > 1) {
      settleFramesRemaining -= 1;
      settleFrame = requestAnimationFrame(advanceSettlement);
      return;
    }
    commitSettlement();
  };
  const scheduleSettlement = () => {
    if (settled() || props.streaming || settleFrame != null) return;
    settleFramesRemaining = SETTLE_DELAY_FRAMES;
    settleFrame = requestAnimationFrame(advanceSettlement);
  };
  const rendered = () => {
    props.onRendered?.();
    scheduleSettlement();
  };

  createEffect(() => {
    // Keep the upstream source dependency only while this message is live.
    // Once frozenSource is set, source() no longer reads props.children.
    source();
    if (settled()) return;
    if (props.streaming) {
      cancelSettlement();
      shell?.setAttribute(SETTLE_ATTRIBUTE, "streaming");
      return;
    }
    scheduleSettlement();
  });

  onMount(() => {
    shell.setAttribute(SETTLE_ATTRIBUTE, props.streaming ? "streaming" : "settling");
    observer = new MutationObserver(() => {
      if (!settled()) scheduleSettlement();
    });
    observer.observe(shell, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-streaming", "data-display-busy", "data-pending-math-renders", "data-streaming-pending"],
    });
    scheduleSettlement();
  });

  onCleanup(() => {
    cancelSettlement();
    observer?.disconnect();
    observer = null;
  });

  return <div ref={shell} class="incremark-advanced-shell">
    <IncremarkMarkdown
      {...props}
      typewriter
      syntheticMath
      streaming={streaming()}
      onRendered={rendered}
    >{source()}</IncremarkMarkdown>
  </div>;
}
