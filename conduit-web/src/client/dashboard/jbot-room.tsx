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
  /** jbot's panel (JbotPanel): beside the chat, risen over it (a phone) or dropped from its pill (a desktop). */
  panel: (state: { tab: JbotTab; onTab: (tab: JbotTab) => void; tabs: boolean; done: () => void }) => JSX.Element;
  markdownRenderer: MarkdownRendererId;
  composer?: JSX.Element;
  working?: boolean;
  threadChanged?: unknown;
  /** On a desktop: "phone", a phone's header (its pill, its actions frost over the chat) and column; "narrow", the
   *  column alone (jbot's dock tool, under the tool's header). */
  presentation?: "phone" | "narrow";
  /** The panel's control, for a header outside the room (the dock tool's). */
  onControl?: (control: { open: () => boolean; toggle: () => void } | null) => void;
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
  // A desktop never raises a sheet (a thumb's): without room beside, the panel drops from jbot's pill, as a menu.
  const desktop = !isMobileLayout();
  // The panel is built after the dock's slide (or when it is first asked for), not with the chat: the jbot chat opens
  // in the dock as it slides open, and the hidden panel's groups cost the slide its frames.
  const [built, setBuilt] = createSignal(false);
  onMount(() => {
    const handle = window.setTimeout(() => setBuilt(true), 1500);
    onCleanup(() => window.clearTimeout(handle));
  });
  onMount(() => { props.onControl?.({ open, toggle }); onCleanup(() => props.onControl?.(null)); });
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
    // The viewport and its reading column: every change to what it holds changes the column's size, so nothing watches
    // the DOM itself (a mutation observer over the transcript re-observed every row on every change).
    const sizes = new ResizeObserver(toLatest);
    sizes.observe(element);
    if (element.firstElementChild) sizes.observe(element.firstElementChild);
    let stopClearing: (() => void) | null = null;
    const frame = requestAnimationFrame(() => { if (root && dock) stopClearing = clearDock(root, dock, toLatest); });
    onCleanup(() => { cancelAnimationFrame(frame); sizes.disconnect(); stopClearing?.(); element.removeEventListener("scroll", scrolled); });
  };

  return <JbotPanelControl.Provider value={{ open, toggle }}><SheetFill data-jbot-room="" data-presentation={props.presentation}>
    {props.header(name())}
    <Show when={agentView()} fallback={<SplitEmpty>Loading…</SplitEmpty>}>
      <Show when={agentView()?.enabled} fallback={<SplitEmpty>This hub has no agent yet.</SplitEmpty>}>
        <ChatBeside label={`${name()}'s panel`} open={open()} drop={desktop} onClose={() => setOver(false)} onWide={setWide}
          panel={<Show when={built() || open()}>{props.panel({ get tab() { return tab(); }, onTab: setTab, tabs: true, done: () => setOver(false) })}</Show>}>
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
