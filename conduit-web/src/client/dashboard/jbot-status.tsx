import { createContext, createSignal, Show, useContext } from "solid-js";
import { Button, Gauge, GaugeFigure, IconButton, Icons, Segmented } from "@/components/ui";
import { api } from "../api/client";
import { agentView, refreshAgent, type AgentView } from "../state/agent";
import { AgentPage, type JbotTab } from "./agent-page";

// The jbot chat is a projection of its home thread, not the thread, so the thread's context is not shown here.

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

export function JbotWays(props: { onOpenThread?: () => void; onOpenSettings?: () => void; onDone?: () => void }) {
  const go = (action?: () => void) => () => { props.onDone?.(); action?.(); };
  return <>
    <Show when={props.onOpenThread}><IconButton kind="pane" label="Open jbot's thread" title="Open jbot's thread" onClick={go(props.onOpenThread)}><Icons.Chat /></IconButton></Show>
    <Show when={props.onOpenSettings}><IconButton kind="pane" label="jbot's settings" title="jbot's settings" onClick={go(props.onOpenSettings)}><Icons.Settings /></IconButton></Show>
  </>;
}

export function JbotDial() {
  const status = useJbotStatus();
  const marks = { quiet: <Icons.Quiet />, normal: <Icons.Notification />, chatty: <Icons.Message /> };
  return <Segmented size="sm" icons label="Speaks up" value={status.dial()} onChange={status.setDial}
    options={DIALS.map(({ value, label, title }) => ({ value, label, icon: marks[value], title: `${label}: ${title}` }))} />;
}

export function JbotSpend() {
  const status = useJbotStatus();
  const tone = () => !status.budget() ? "idle" : status.share() >= 100 ? "critical" : status.share() >= 80 ? "warning" : "normal";
  const words = () => status.budget() ? `${money(status.spent())} of ${money(status.budget())} today` : `${money(status.spent())} today`;
  return <GaugeFigure value={status.share()} tone={tone()} used={money(status.spent())} of={status.budget() ? money(status.budget()) : undefined} label={`Spent ${words()}`} />;
}

export const JbotPanelControl = createContext<{ open: () => boolean; toggle: () => void;
  needs?: { count: () => number; open: () => boolean; toggle: () => void } } | null>(null);

export function JbotPanel(props: {
  tab: JbotTab;
  needsMount?: () => HTMLElement | undefined;
  onTab: (tab: JbotTab) => void;
  onOpenChat: (chatId: string, event?: MouseEvent) => void;
  onOpenFile: (path: string) => void;
  onOpenThread?: () => void;
  onOpenSettings: () => void;
  onDone?: () => void;
}) {
  return <>
    <AgentPage panel={props.tab} needsMount={props.needsMount} panelTop={<JbotSpend />} onOpenChat={props.onOpenChat} onOpenFile={props.onOpenFile} onOpenThread={props.onOpenThread} onOpenSettings={props.onOpenSettings} />
  </>;
}

export function JbotChip() {
  const status = useJbotStatus();
  const control = useContext(JbotPanelControl);
  const tone = () => !status.budget() ? "idle" : status.share() >= 100 ? "critical" : status.share() >= 80 ? "warning" : "normal";
  return <Button variant="ghost" size="icon-sm" aria-expanded={control?.open()} onClick={() => control?.toggle()}
    aria-label={`${status.name()}: ${money(status.spent())} of ${money(status.budget())} today`} title={`${money(status.spent())} of ${money(status.budget())} today`}>
    <Gauge value={status.share()} tone={tone()} />
  </Button>;
}
