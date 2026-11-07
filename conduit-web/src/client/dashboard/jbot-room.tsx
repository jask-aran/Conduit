import { createSignal, getOwner, onCleanup, onMount, runWithOwner, Show, type JSX } from "solid-js";
import { ChatBeside, ChatScroller, ChatView, ComposerDock, createTranscriptFollow, Icons, RiderButton, rideBottom, Segmented, SheetFill } from "@/components/ui";
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
  /** false while its composer is still coming (its home thread loading): the chat is held unseen until it is there. */
  composerReady?: boolean;
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
  // As a thread's transcript, with the same follow (the library's createTranscriptFollow): held at the latest while
  // the person is there, left where they scrolled to otherwise, the glide to the latest, the keyboard's travel, and
  // clear of the composer by its measured height.
  const follow = createTranscriptFollow({ viewport: () => viewport });
  // Scrolled back from the latest: the transcript's own Scroll to latest, riding just above the composer.
  const away = follow.latestAway;
  let latest: HTMLButtonElement | undefined;
  const anchorLatest = () => {
    const composer = dock?.firstElementChild?.getBoundingClientRect();
    const shell = root?.getBoundingClientRect();
    if (!latest || !composer || !shell || composer.height <= 0) return;
    const bottom = rideBottom(shell.bottom, composer.top);
    latest.style.setProperty("--ride-bottom", `${bottom}px`);
    if (bottom !== above()) setAbove(bottom);
  };
  const jumpToLatest = () => follow.followLatest();
  // Attached as the chat is built (it waits on jbot's view), the dock's clearing as the composer comes (it waits on the
  // home thread): each under the piece it belongs to, undone with it.
  const attachFollow = (column: HTMLDivElement) => {
    const owner = getOwner();
    queueMicrotask(() => runWithOwner(owner, () => {
      if (!viewport || !column.isConnected) return;
      follow.attach({ viewport, thread: column });
      const frame = requestAnimationFrame(anchorLatest);
      onCleanup(() => cancelAnimationFrame(frame));
    }));
  };
  const clearUnderComposer = (element: HTMLDivElement) => {
    dock = element;
    const owner = getOwner();
    queueMicrotask(() => runWithOwner(owner, () => {
      if (!root || !element.isConnected) return;
      const stop = follow.clearUnder(root, element, anchorLatest);
      onCleanup(stop);
    }));
  };

  return <JbotPanelControl.Provider value={{ open, toggle }}><SheetFill data-jbot-room="" data-presentation={props.presentation}>
    {props.header(name())}
    <Show when={agentView()} fallback={<SplitEmpty>Loading…</SplitEmpty>}>
      <Show when={agentView()?.enabled} fallback={<SplitEmpty>This hub has no agent yet.</SplitEmpty>}>
        <ChatBeside label={`${name()}'s panel`} title={name()} open={open()} above={desktop ? above() ?? 0 : undefined} beside={props.presentation !== "narrow"} onClose={() => setOver(false)} onWide={setWide} actions={props.panelActions?.(() => setOver(false))}
          foldLead={(marks) => <><Segmented size="sm" icons={marks()} label={`${name()}'s panel`} value={tab()} onChange={setTab}
            options={JBOT_TABS.map((item) => ({ value: item.value, label: item.label, title: item.label, icon: marks() ? item.icon() : undefined }))} /><JbotDial /></>}
          panel={<Show when={built() || open()}>{props.panel({ get tab() { return tab(); }, onTab: setTab, done: () => setOver(false) })}</Show>}>
        {/* Hidden until what is on screen is drawn, then faded in, as every chat opens (ChatView opening). */}
        {/* And with its composer: a page drawn without it moved up as it came (the composer is its home thread's). */}
        <ChatView aria-label={`Messages with ${name()}`} opening={!log.loaded() || props.composerReady === false}>
          <ChatScroller ref={(element) => { root = element; }} viewportRef={(element) => { viewport = element; }} columnRef={attachFollow}
            over={<RiderButton ref={(element: HTMLButtonElement) => { latest = element; }} ride="centre" icon={<Icons.ArrowDown />} label="Scroll to latest"
              hidden={!away() || (!wide() && over())} onMouseDown={(event) => event.preventDefault()} onClick={jumpToLatest} />}>
            <JbotMessages bare messages={log.messages()} renderer={props.markdownRenderer} name={name()} working={props.working} />
          </ChatScroller>
          <Show when={props.composer}><ComposerDock ref={clearUnderComposer}>{props.composer}</ComposerDock></Show>
        </ChatView>
        </ChatBeside>
      </Show>
    </Show>
  </SheetFill></JbotPanelControl.Provider>;
}
