import { createEffect, createSignal, getOwner, onCleanup, onMount, runWithOwner, Show, type JSX } from "solid-js";
import { Button, ChatBeside, ChatScroller, ChatView, ComposerDock, createTranscriptFollow, Icons, Ledge, RiderButton, rideBottom, Segmented, SheetFill, Tray } from "@/components/ui";
import type { MarkdownRendererId } from "../chat/markdown-settings";
import { agentName, agentNeeds, agentView, dismissNotices, dismissableNotices, needsWanted, refreshAgent, takeNeedsWanted } from "../state/agent";
import { JbotMessages, useJbotMessages } from "./jbot-messages";
import { JbotDial, JbotPanelControl } from "./jbot-status";
import { JBOT_TABS, type JbotTab } from "./agent-page";
import { isMobileLayout } from "../navigation/mobile-layout";
import { dropLatestScroller, setLatestScroller, tellLatestAway } from "../chat/latest-away";
import { SplitEmpty } from "./primitives/split";
import type { TurnTraceData } from "../turn-rows";

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
  panel: (state: { tab: JbotTab; onTab: (tab: JbotTab) => void; done: () => void; needsMount?: () => HTMLElement | undefined }) => JSX.Element;
  /** The panel's ways on (JbotWays), in its head; done: the panel put away first, where it is over the chat. */
  panelActions?: (done: () => void) => JSX.Element;
  markdownRenderer: MarkdownRendererId;
  composer?: JSX.Element;
  working?: boolean;
  /** The home thread's turn while it runs, as its Folded trace (JbotMessages live). */
  live?: TurnTraceData | null;
  /** What the person just sent in the home thread (JbotMessages sent). */
  sent?: { text: string; at: string } | null;
  threadChanged?: unknown;
  /** On a desktop: "phone", a phone's header (its pill, its actions frost over the chat) and column; "narrow", the
   *  column alone (jbot's dock tool, under the tool's header). */
  presentation?: "phone" | "narrow";
}) {
  const log = useJbotMessages(() => props.threadChanged);
  const name = agentName;
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
    if (!wide()) { setNeedsOpen(false); return void setOver(!over()); }
    const next = !beside();
    setBeside(next);
    try { localStorage.setItem(besideKey, next ? "1" : "0"); } catch { /* a per-viewer convenience */ }
  };
  // What waits on the person, apart from the panel wherever the panel is over the chat: on a desktop a card of its own
  // over the Ledge, while there is any; on a phone a sheet of its own, opened by the count beside jbot's pill.
  const [needsMount, setNeedsMount] = createSignal<HTMLElement>();
  const mountNeeds = (element: HTMLElement) => { setNeedsMount(element); onCleanup(() => { if (needsMount() === element) setNeedsMount(undefined); }); };
  const [needsOpen, setNeedsOpen] = createSignal(false);
  createEffect(() => { if (!agentNeeds() || wide()) setNeedsOpen(false); });
  // Asked for from outside (the rail's jbot with its count): beside the chat, the panel, which holds it; else Needs you.
  createEffect(() => {
    if (!needsWanted() || !agentNeeds()) return;
    takeNeedsWanted();
    if (wide()) { if (!beside()) toggle(); } else { setOver(false); setNeedsOpen(true); }
  });
  const needs = { count: () => agentNeeds(), open: needsOpen, toggle: () => { setOver(false); setNeedsOpen(!needsOpen()); } };
  // On a desktop Needs you is a Ledge of its own, stacked above the panel's: shown with the panel (unless put away while
  // it is open) or alone.
  const [needsShut, setNeedsShut] = createSignal(false);
  createEffect(() => { if (!over()) setNeedsShut(false); });
  const needsShown = () => needsOpen() || (over() && !needsShut());
  const shutNeeds = () => { setNeedsOpen(false); if (over()) setNeedsShut(true); };
  // Its head: Dismiss all, for the notices that only tell.
  const [dismissing, setDismissing] = createSignal(false);
  const needsActions = () => <Show when={dismissableNotices().length}>
    <Button size="sm" variant="ghost" disabled={dismissing()} onClick={() => { setDismissing(true); void dismissNotices(dismissableNotices().flatMap((row) => row.ids)).finally(() => setDismissing(false)); }}>Dismiss all</Button>
  </Show>;
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
  // A phone's composer has Scroll to latest in its own row (the pill, latest-away.ts), as in a thread: the room tells it
  // when the latest is out of view and takes its press, and its own floating one stays hidden there.
  if (!desktop) {
    setLatestScroller(jumpToLatest);
    createEffect(() => tellLatestAway(jumpToLatest, away()));
    onCleanup(() => dropLatestScroller(jumpToLatest));
  }
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

  return <JbotPanelControl.Provider value={{ open, toggle, needs: desktop ? undefined : needs }}><SheetFill data-jbot-room="" data-presentation={props.presentation}>
    {props.header(name())}
    <Show when={agentView()} fallback={<SplitEmpty>Loading…</SplitEmpty>}>
      <Show when={agentView()?.enabled} fallback={<SplitEmpty>This hub has no agent yet.</SplitEmpty>}>
        <ChatBeside label={`${name()}'s panel`} title={name()} open={open()} above={desktop ? above() ?? 0 : undefined} beside={props.presentation !== "narrow"} onClose={() => setOver(false)} onWide={setWide} actions={props.panelActions?.(() => setOver(false))}
          over={desktop && agentNeeds() ? <Ledge fit open={Boolean(needsShown())} onClose={shutNeeds} label="Needs you" title="Needs you" actions={needsActions()}><div ref={mountNeeds} /></Ledge> : undefined}
          foldLead={(marks) => <><Segmented size="sm" icons={marks()} label={`${name()}'s panel`} value={tab()} onChange={setTab}
            options={JBOT_TABS.map((item) => ({ value: item.value, label: item.label, title: item.label, icon: marks() ? item.icon() : undefined }))} /><JbotDial /></>}
          panel={<Show when={built() || open() || needsOpen()}>{props.panel({ get tab() { return tab(); }, onTab: setTab, done: () => setOver(false),
            get needsMount() { return wide() ? undefined : needsMount; } })}</Show>}>
        {/* Hidden until what is on screen is drawn, then faded in, as every chat opens (ChatView opening). */}
        {/* And with its composer: a page drawn without it moved up as it came (the composer is its home thread's). */}
        <ChatView aria-label={`Messages with ${name()}`} opening={!log.loaded() || props.composerReady === false}>
          <ChatScroller ref={(element) => { root = element; }} viewportRef={(element) => { viewport = element; }} columnRef={attachFollow}
            over={<RiderButton ref={(element: HTMLButtonElement) => { latest = element; }} ride="centre" icon={<Icons.ArrowDown />} label="Scroll to latest"
              hidden={!desktop || !away() || (!wide() && over())} onMouseDown={(event) => event.preventDefault()} onClick={jumpToLatest} />}>
            <JbotMessages bare messages={log.messages()} renderer={props.markdownRenderer} name={name()} working={props.working} live={props.live} sent={props.sent} />
          </ChatScroller>
          <Show when={props.composer}><ComposerDock ref={clearUnderComposer}>{props.composer}</ComposerDock></Show>
        </ChatView>
        </ChatBeside>
        <Show when={!desktop}>
          <Tray fit open={needsOpen()} onClose={() => setNeedsOpen(false)} label="Needs you" title="Needs you" actions={needsActions()}><div ref={mountNeeds} /></Tray>
        </Show>
      </Show>
    </Show>
  </SheetFill></JbotPanelControl.Provider>;
}
