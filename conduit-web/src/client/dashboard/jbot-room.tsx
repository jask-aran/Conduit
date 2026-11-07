import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import { ChatBeside, ChatScroller, ChatView, ComposerDock, Icons, RiderButton, Segmented, SheetFill } from "@/components/ui";
import { unitPx } from "@/components/ui/layout";
import { clearDock } from "@/components/ui/dock-inset";
import type { MarkdownRendererId } from "../chat/markdown-settings";
import { agentView, refreshAgent } from "../state/agent";
import { JbotMessages, useJbotMessages } from "./jbot-messages";
import { JbotDial, JbotPanelControl } from "./jbot-status";
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
  /** jbot's panel (JbotPanel): beside the chat where there is room; else on a phone a sheet risen over the chat, on a
   *  desktop faded in just above the composer, the transcript left where it is. */
  panel: (state: { tab: JbotTab; onTab: (tab: JbotTab) => void; done: () => void }) => JSX.Element;
  /** The panel's ways on (JbotWays), in its head; done: the panel put away first, where it is over the chat. */
  panelActions?: (done: () => void) => JSX.Element;
  markdownRenderer: MarkdownRendererId;
  composer?: JSX.Element;
  working?: boolean;
  threadChanged?: unknown;
  /** On a desktop: "phone", a phone's header (its pill, its actions frost over the chat) and column; "narrow", the
   *  column alone (jbot's dock tool, under the tool's header). */
  presentation?: "phone" | "narrow";
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
  // A desktop never raises a sheet (a thumb's): without room beside, the panel fades in just above the composer.
  const desktop = !isMobileLayout();
  // The tabs fold to their marks when the panel's head has no room for their words (its close and Settings never
  // overflow): measured, the width they needed is kept, and the words come back once the head has it again.
  const [marks, setMarks] = createSignal(false);
  let wordsNeed = 0;
  const fitLead = (lead: HTMLElement) => {
    const head = () => lead.closest<HTMLElement>(".ui-chat-beside-head, .ui-tray-head");
    const fit = () => {
      const box = head();
      if (!box || !box.clientWidth) return;
      if (!marks() && box.scrollWidth > box.clientWidth) { wordsNeed = box.scrollWidth; setMarks(true); }
      else if (marks() && box.clientWidth >= wordsNeed) setMarks(false);
    };
    const sizes = new ResizeObserver(fit);
    requestAnimationFrame(() => { const box = head(); if (box) sizes.observe(box); });
    onCleanup(() => sizes.disconnect());
  };
  // How far above the chat's foot the composer's top is: where the panel (and Scroll to latest) sit.
  const [above, setAbove] = createSignal<number>();
  // The panel is built after the dock's slide (or when it is first asked for), not with the chat: the jbot chat opens
  // in the dock as it slides open, and the hidden panel's groups cost the slide its frames.
  const [built, setBuilt] = createSignal(false);
  onMount(() => {
    const handle = window.setTimeout(() => setBuilt(true), 1500);
    onCleanup(() => window.clearTimeout(handle));
  });
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
  // Scrolled back from the latest: the transcript's own Scroll to latest, riding just above the composer.
  const [away, setAway] = createSignal(false);
  let latest: HTMLButtonElement | undefined;
  const anchorLatest = () => {
    const composer = dock?.firstElementChild?.getBoundingClientRect();
    const shell = root?.getBoundingClientRect();
    if (!latest || !composer || !shell || composer.height <= 0) return;
    const bottom = Math.max(unitPx(0.5), shell.bottom - composer.top + unitPx(0.625));
    latest.style.setProperty("--ride-bottom", `${bottom}px`);
    if (bottom !== above()) setAbove(bottom);
  };
  const jumpToLatest = () => { if (viewport) viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" }); };
  const follow = (element: HTMLDivElement) => {
    viewport = element;
    let pinned = true;
    const toLatest = () => { if (pinned && viewport) viewport.scrollTop = viewport.scrollHeight; };
    const scrolled = () => { if (!viewport) return; pinned = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 48; setAway(!pinned); };
    element.addEventListener("scroll", scrolled, { passive: true });
    // The viewport and its reading column: every change to what it holds changes the column's size, so nothing watches
    // the DOM itself (a mutation observer over the transcript re-observed every row on every change).
    const sizes = new ResizeObserver(toLatest);
    sizes.observe(element);
    if (element.firstElementChild) sizes.observe(element.firstElementChild);
    let stopClearing: (() => void) | null = null;
    const frame = requestAnimationFrame(() => { if (root && dock) stopClearing = clearDock(root, dock, () => { toLatest(); anchorLatest(); }); anchorLatest(); });
    onCleanup(() => { cancelAnimationFrame(frame); sizes.disconnect(); stopClearing?.(); element.removeEventListener("scroll", scrolled); });
  };

  return <JbotPanelControl.Provider value={{ open, toggle }}><SheetFill data-jbot-room="" data-presentation={props.presentation}>
    {props.header(name())}
    <Show when={agentView()} fallback={<SplitEmpty>Loading…</SplitEmpty>}>
      <Show when={agentView()?.enabled} fallback={<SplitEmpty>This hub has no agent yet.</SplitEmpty>}>
        <ChatBeside label={`${name()}'s panel`} title={name()} open={open()} above={desktop ? above() ?? 0 : undefined} beside={props.presentation !== "narrow"} onClose={() => setOver(false)} onWide={setWide} actions={props.panelActions?.(() => setOver(false))}
          lead={<span ref={fitLead} class="jbot-panel-lead"><Segmented size="sm" icons={marks()} label={`${name()}'s panel`} value={tab()} onChange={setTab}
            options={JBOT_TABS.map((item) => ({ value: item.value, label: item.label, title: item.label, icon: marks() ? item.icon() : undefined }))} /><JbotDial /></span>}
          panel={<Show when={built() || open()}>{props.panel({ get tab() { return tab(); }, onTab: setTab, done: () => setOver(false) })}</Show>}>
        <ChatView aria-label={`Messages with ${name()}`}>
          <ChatScroller ref={(element) => { root = element; }} viewportRef={follow}
            over={<RiderButton ref={(element: HTMLButtonElement) => { latest = element; }} ride="centre" icon={<Icons.ArrowDown />} label="Scroll to latest"
              hidden={!away() || (!wide() && over())} onMouseDown={(event) => event.preventDefault()} onClick={jumpToLatest} />}>
            <JbotMessages bare messages={log.messages()} renderer={props.markdownRenderer} name={name()} working={props.working} />
          </ChatScroller>
          <Show when={props.composer}><ComposerDock ref={(element) => { dock = element; }}>{props.composer}</ComposerDock></Show>
        </ChatView>
        </ChatBeside>
      </Show>
    </Show>
  </SheetFill></JbotPanelControl.Provider>;
}
