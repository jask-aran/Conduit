import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import { ChatBeside, ChatScroller, ChatView, ComposerDock, SheetFill } from "@/components/ui";
import { clearDock } from "@/components/ui/dock-inset";
import type { MarkdownRendererId } from "../chat/markdown-settings";
import { agentView, refreshAgent } from "../state/agent";
import { JbotMessages, useJbotMessages } from "./jbot-messages";
import { JbotPanelControl } from "./jbot-status";
import { JBOT_TABS, type JbotTab } from "./agent-page";
import { isMobileLayout } from "../navigation/mobile-layout";
import { SplitEmpty } from "./primitives/split";

/**
 * jbot's room: laid out as a thread is (its scroller, its composer floating over the foot), because it is one: what
 * the person says is the home thread's own message, one for one. Only jbot's side reads differently, as the
 * projection of the thread it is (reports, rooms, messages). jbot's panel (jbot-status.tsx) is beside it or over it.
 */
export function JbotRoom(props: {
  header: (title: string) => JSX.Element;
  /** jbot's panel (JbotPanel), beside the chat, over it (a phone) or in its place (a desktop). */
  panel: (state: { tab: JbotTab; onTab: (tab: JbotTab) => void; tabs: boolean; done: () => void }) => JSX.Element;
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
  // Beside the chat it stays as the person left it (shown at first); over the chat it opens only when asked.
  const besideKey = "conduit.jbot.panel-beside";
  const [wide, setWide] = createSignal(false);
  const [beside, setBeside] = createSignal((() => { try { return localStorage.getItem(besideKey) !== "0"; } catch { return true; } })());
  const [over, setOver] = createSignal(false);
  const open = () => wide() ? beside() : over();
  const tabKey = "conduit.jbot.panel-tab";
  const [tab, setTabShown] = createSignal<JbotTab>((() => { try { const saved = localStorage.getItem(tabKey); return JBOT_TABS.some((item) => item.value === saved) ? saved as JbotTab : "now"; } catch { return "now"; } })());
  const setTab = (next: JbotTab) => { setTabShown(next); try { localStorage.setItem(tabKey, next); } catch { /* a per-viewer convenience */ } };
  // A desktop never raises a sheet: without room beside, the panel takes the chat's place, switched from the header.
  const desktop = !isMobileLayout();
  const switched = () => desktop && !wide();
  const view = () => switched() && over() ? tab() : "chat";
  const setView = (next: "chat" | JbotTab) => { if (next === "chat") return void setOver(false); setTab(next); setOver(true); };
  const toggle = () => {
    if (!wide()) return void setOver(!over());
    const next = !beside();
    setBeside(next);
    try { localStorage.setItem(besideKey, next ? "1" : "0"); } catch { /* a per-viewer convenience */ }
  };
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

  return <JbotPanelControl.Provider value={{ open, toggle, view, setView, switched }}><SheetFill data-jbot-room="">
    {props.header(name())}
    <Show when={agentView()} fallback={<SplitEmpty>Loading…</SplitEmpty>}>
      <Show when={agentView()?.enabled} fallback={<SplitEmpty>This hub has no agent yet.</SplitEmpty>}>
        <ChatBeside label={`${name()}'s panel`} open={open()} swap={desktop} onClose={() => setOver(false)} onWide={setWide}
          panel={props.panel({ get tab() { return tab(); }, onTab: setTab, get tabs() { return !switched(); }, done: () => setOver(false) })}>
        <ChatView aria-label={`Messages with ${name()}`}>
          <ChatScroller ref={(element) => { root = element; }} viewportRef={follow}>
            <JbotMessages bare messages={log.messages()} renderer={props.markdownRenderer} name={name()} working={props.working} />
          </ChatScroller>
          <Show when={props.composer}><ComposerDock ref={(element) => { dock = element; }}>{props.composer}</ComposerDock></Show>
        </ChatView>
        </ChatBeside>
      </Show>
    </Show>
  </SheetFill></JbotPanelControl.Provider>;
}
