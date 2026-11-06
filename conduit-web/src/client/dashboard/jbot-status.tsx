import { createContext, createSignal, Show, useContext, type JSX } from "solid-js";
import { Button, Gauge, Icons, Meter, Reading, ReadingTotal, Rider, RiderScroll, RiderTitle, RiderTop, Rule, Segmented } from "@/components/ui";
import { api } from "../api/client";
import { agentView, refreshAgent, type AgentView } from "../state/agent";
import { AgentPage, JBOT_TABS, type JbotTab } from "./agent-page";

/*
 * jbot's particulars, where a chat keeps its own: how much it speaks up, what it has spent today against its budget,
 * and what it is running, then its page's groups by tab. The jbot chat is a projection of its home thread, not the
 * thread, so the thread's context is not shown (it is the thread's own, a tap away). The composer's chip (a ring of
 * today's spend, in the context gauge's place) and jbot's pill open it.
 */

const DIALS = [
  { value: "quiet", label: "Quiet", title: "Only what is urgent or needs your answer." },
  { value: "normal", label: "Normal", title: "What needs your attention; FYIs wait on its page." },
  { value: "chatty", label: "Chatty", title: "Everything it finds worth saying, FYIs included." },
] as const;
type Dial = typeof DIALS[number]["value"];

const money = (value: number) => `$${value.toFixed(2)}`;

function useJbotStatus() {
  const settings = () => agentView()?.settings;
  const spent = () => agentView()?.spentToday || 0;
  const budget = () => settings()?.budgetUsdPerDay || 0;
  const share = () => budget() ? Math.min(100, (spent() / budget()) * 100) : 0;
  const running = () => agentView()?.attention?.working?.runs.length || 0;
  const [dial, setDialShown] = createSignal<Dial | null>(null);
  const shownDial = () => dial() ?? (settings()?.dial as Dial | undefined) ?? "normal";
  const setDial = (value: Dial) => {
    setDialShown(value);
    void api<AgentView>("/v0/agent", { method: "PATCH", body: JSON.stringify({ dial: value }) })
      .then(() => refreshAgent()).finally(() => setDialShown(null));
  };
  return { name: () => settings()?.name || "jbot", spent, budget, share, running, dial: shownDial, setDial };
}

/** The head of jbot's panel: today's spend, the dial, what runs, and the ways on. */
export function JbotStatus(props: { onOpenThread?: () => void; onOpenSettings?: () => void; onDone?: () => void }) {
  const status = useJbotStatus();
  const tone = () => status.share() >= 100 ? "var(--destructive)" : status.share() >= 80 ? "var(--warning, var(--category-4))" : "var(--category-1)";
  const go = (action?: () => void) => () => { props.onDone?.(); action?.(); };
  return <>
    <Reading>
      <ReadingTotal label={<strong>Today</strong>} value={status.budget() ? `${money(status.spent())} of ${money(status.budget())}` : money(status.spent())} />
      <Show when={status.budget()}>
        <Meter parts={[{ value: status.spent(), colour: tone() }, { value: Math.max(0, status.budget() - status.spent()), colour: "transparent" }]} />
      </Show>
      <ReadingTotal label="Speaks up" />
      <Segmented label="Speaks up" value={status.dial()} options={DIALS.map(({ value, label, title }) => ({ value, label, title }))} onChange={status.setDial} />
      <Show when={status.running()}>{(count) => <ReadingTotal label="Running" value={`${count()} ${count() === 1 ? "run" : "runs"}`} />}</Show>
    </Reading>
    <Rule />
    <div class="ui-dash-room-actions">
      <Show when={props.onOpenThread}><Button variant="ghost" size="sm" onClick={go(props.onOpenThread)}><Icons.Chat />Thread</Button></Show>
      <Show when={props.onOpenSettings}><Button variant="ghost" size="sm" onClick={go(props.onOpenSettings)}><Icons.Settings />Settings</Button></Show>
    </div>
  </>;
}

/** The jbot chat's control of jbot's panel: the composer's chip and jbot's pill open and close it. */
export const JbotPanelControl = createContext<{
  open: () => boolean;
  toggle: () => void;
  /** A desktop's panel takes the composer's place (JbotTakeover) while this holds. */
  takeover: () => boolean;
  close: () => void;
  name: () => string;
  /** The panel, drawn fresh where it shows. */
  panel: () => JSX.Element;
} | null>(null);

/**
 * jbot's panel on a desktop: the composer's takeover, as the question card is (a card rider in the composer's slot:
 * the composer drops and fades, the card rises in). Its close, Esc or the composer's ring put it away.
 */
export function JbotTakeover() {
  const control = useContext(JbotPanelControl);
  return <Show when={control?.takeover()}>
    <Rider layout="card" motion="entering" label={`${control!.name()}'s panel`}>
      <RiderTop><RiderTitle>{control!.name()}</RiderTitle><Button variant="ghost" size="icon-sm" aria-label="Close" title="Close" onClick={() => control!.close()}><Icons.Close /></Button></RiderTop>
      <RiderScroll>{control!.panel()}</RiderScroll>
    </Rider>
  </Show>;
}

/**
 * jbot's panel, beside the jbot chat or over it (ChatBeside): its day and dial (JbotStatus), then its page's groups by
 * tab (Now, Routines, Memory, Threads). Configuration stays in Settings › jbot.
 */
export function JbotPanel(props: {
  tab: JbotTab;
  onTab: (tab: JbotTab) => void;
  /** Its own tab switch. */
  tabs: boolean;
  onOpenChat: (chatId: string, event?: MouseEvent) => void;
  onOpenFile: (path: string) => void;
  onOpenThread?: () => void;
  onOpenSettings: () => void;
  onDone?: () => void;
}) {
  return <>
    <JbotStatus onOpenThread={props.onOpenThread} onOpenSettings={props.onOpenSettings} onDone={props.onDone} />
    <Show when={props.tabs}><Segmented label="jbot's panel" value={props.tab} options={JBOT_TABS} onChange={props.onTab} /></Show>
    <AgentPage panel={props.tab} onOpenChat={props.onOpenChat} onOpenFile={props.onOpenFile} onOpenThread={props.onOpenThread} onOpenSettings={props.onOpenSettings} />
  </>;
}

/** The composer's chip in the jbot chat, in the context gauge's place: a ring of today's spend against the budget,
 *  opening jbot's panel. */
export function JbotChip() {
  const status = useJbotStatus();
  const control = useContext(JbotPanelControl);
  const tone = () => !status.budget() ? "idle" : status.share() >= 100 ? "critical" : status.share() >= 80 ? "warning" : "normal";
  return <Button variant="ghost" size="icon-sm" aria-expanded={control?.open()} onClick={() => control?.toggle()}
    aria-label={`${status.name()}: ${money(status.spent())} of ${money(status.budget())} today`} title={`${money(status.spent())} of ${money(status.budget())} today`}>
    <Gauge value={status.share()} tone={tone()} />
  </Button>;
}
