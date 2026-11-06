import { onCleanup, onMount, Show, type JSX } from "solid-js";
import { ChatScroller, ChatView, ComposerDock, SheetFill } from "@/components/ui";
import { clearDock } from "@/components/ui/dock-inset";
import type { MarkdownRendererId } from "../chat/markdown-settings";
import { agentView, refreshAgent } from "../state/agent";
import { JbotMessages, useJbotMessages } from "./jbot-messages";
import { SplitEmpty } from "./primitives/split";

/**
 * jbot's room: laid out as a thread is (its scroller, its composer floating over the foot), because it is one: what
 * the person says is the home thread's own message, one for one. Only jbot's side reads differently, as the
 * projection of the thread it is (reports, rooms, messages). Its particulars are in jbot's panel (jbot-status.tsx).
 */
export function JbotRoom(props: {
  header: (title: string) => JSX.Element;
  onOpenPage: () => void;
  onOpenThread?: () => void;
  markdownRenderer: MarkdownRendererId;
  composer?: JSX.Element;
  working?: boolean;
  threadChanged?: unknown;
}) {
  const log = useJbotMessages(() => props.threadChanged);
  const name = () => agentView()?.settings?.name || "Agent";
  let root: HTMLDivElement | undefined;
  let viewport: HTMLDivElement | undefined;
  let dock: HTMLDivElement | undefined;
  onMount(() => {
    void refreshAgent();
    const tick = window.setInterval(() => { if (document.visibilityState === "visible") void refreshAgent(); }, 10_000);
    onCleanup(() => window.clearInterval(tick));
  });
  // As a thread's transcript: held at the latest while the person is there, left where they scrolled to otherwise,
  // and clear of the composer by its measured height (dock-inset.ts).
  const follow = (element: HTMLDivElement) => {
    viewport = element;
    let pinned = true;
    const toLatest = () => { if (pinned && viewport) viewport.scrollTop = viewport.scrollHeight; };
    const scrolled = () => { if (viewport) pinned = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 48; };
    element.addEventListener("scroll", scrolled, { passive: true });
    const sizes = new ResizeObserver(toLatest);
    const watch = () => { sizes.disconnect(); sizes.observe(element); for (const child of element.children) sizes.observe(child); toLatest(); };
    const tree = new MutationObserver(watch);
    tree.observe(element, { childList: true, subtree: true, characterData: true });
    queueMicrotask(watch);
    let stopClearing: (() => void) | null = null;
    const frame = requestAnimationFrame(() => { if (root && dock) stopClearing = clearDock(root, dock, toLatest); });
    onCleanup(() => { cancelAnimationFrame(frame); sizes.disconnect(); tree.disconnect(); stopClearing?.(); element.removeEventListener("scroll", scrolled); });
  };

  return <SheetFill data-jbot-room="">
    {props.header(name())}
    <Show when={agentView()} fallback={<SplitEmpty>Loading…</SplitEmpty>}>
      <Show when={agentView()?.enabled} fallback={<SplitEmpty>This hub has no agent yet.</SplitEmpty>}>
        <ChatView aria-label={`Messages with ${name()}`}>
          <ChatScroller ref={(element) => { root = element; }} viewportRef={follow}>
            <JbotMessages bare messages={log.messages()} renderer={props.markdownRenderer} name={name()} working={props.working} />
          </ChatScroller>
          <Show when={props.composer}><ComposerDock ref={(element) => { dock = element; }}>{props.composer}</ComposerDock></Show>
        </ChatView>
      </Show>
    </Show>
  </SheetFill>;
}
