import { createEffect, createSignal, on, Show, type JSX } from "solid-js";
import { Button, Gauge, Icons, Meter, Reading, ReadingTotal, Rule, Segmented } from "@/components/ui";
import { Popover, PopoverContent } from "@/components/ui/menus";
import { api } from "../api/client";
import { agentView, refreshAgent, type AgentView } from "../state/agent";
import type { ActiveChatStore } from "../state/active-chat";
import { ContextBreakdown } from "../chat/context-gauge";
import { contextUsagePercent } from "../chat/context-metrics";

/*
 * jbot's particulars, where a chat keeps its own: how much it speaks up, what it has spent today against its budget,
 * what it is running, and its home thread's context. The room it is read in is a projection of that thread, so the
 * thread's context is jbot's. A desktop opens it from the composer's chip (in the context gauge's place); a phone from
 * jbot's pill at the top, as a chat's pill opens its menu. Nothing of it takes the messages' room.
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

/** The panel itself: today's spend, the dial, what runs, the thread's context, and the ways on. */
export function JbotStatus(props: { chat?: ActiveChatStore; onOpenPage?: () => void; onOpenThread?: () => void; onOpenSettings?: () => void; onDone?: () => void }) {
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
    <Show when={props.chat}>{(chat) => <><Rule /><ContextBreakdown chat={chat()} canCompact={chat().capabilities()?.compaction !== false} /></>}</Show>
    <Rule />
    <div class="ui-dash-room-actions">
      <Show when={props.onOpenPage}><Button variant="ghost" size="sm" onClick={go(props.onOpenPage)}><Icons.Agent />{status.name()}'s page</Button></Show>
      <Show when={props.onOpenThread}><Button variant="ghost" size="sm" onClick={go(props.onOpenThread)}><Icons.Chat />Thread</Button></Show>
      <Show when={props.onOpenSettings}><Button variant="ghost" size="sm" onClick={go(props.onOpenSettings)}><Icons.Settings />Settings</Button></Show>
    </div>
  </>;
}

/**
 * The panel opened from a control the caller draws (`trigger` gets the ref and the toggle): the composer's chip on a
 * desktop, jbot's pill on a phone.
 */
export function JbotStatusPopover(props: {
  trigger: (control: { ref: (element: HTMLElement) => void; open: boolean; toggle: () => void }) => JSX.Element;
  placement?: "top-start" | "bottom-start";
  chat?: ActiveChatStore;
  onOpenPage?: () => void;
  onOpenThread?: () => void;
  onOpenSettings?: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  let anchor: HTMLElement | undefined;
  createEffect(on(open, (now) => { if (now) { props.chat?.refreshContext(); void refreshAgent(); } }, { defer: true }));
  return <Popover open={open()} onOpenChange={(now) => { if (!now) setOpen(false); }} anchorRef={() => anchor} placement={props.placement ?? "top-start"}>
    {props.trigger({ ref: (element) => { anchor = element; }, open: open(), toggle: () => setOpen(!open()) })}
    <PopoverContent width="lg" unfolds aria-label="jbot"
      onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}
      onPointerDownOutside={(event) => { if (anchor?.contains(event.target as Node)) event.preventDefault(); }}>
      <JbotStatus chat={props.chat} onOpenPage={props.onOpenPage} onOpenThread={props.onOpenThread} onOpenSettings={props.onOpenSettings} onDone={() => setOpen(false)} />
    </PopoverContent>
  </Popover>;
}

/** The composer's chip for jbot's room, in the context gauge's place: the thread's context ring and today's spend. */
export function JbotChip(props: { chat: ActiveChatStore; onOpenPage?: () => void; onOpenThread?: () => void; onOpenSettings?: () => void }) {
  const status = useJbotStatus();
  const context = () => contextUsagePercent(props.chat.contextUsage());
  const tone = () => context() == null ? "idle" : context()! >= 90 ? "critical" : context()! >= 70 ? "warning" : "normal";
  return <JbotStatusPopover chat={props.chat} onOpenPage={props.onOpenPage} onOpenThread={props.onOpenThread} onOpenSettings={props.onOpenSettings}
    trigger={(control) => <Button ref={control.ref as (element: HTMLButtonElement) => void} variant="ghost" size="sm" aria-expanded={control.open}
      aria-label={`${status.name()}: ${money(status.spent())} today, context ${Math.round(context() ?? 0)}%`} onClick={control.toggle}>
      <Gauge value={Math.max(0, Math.min(100, context() ?? 0))} tone={tone()} />
      {money(status.spent())}<Show when={status.running()}>{(count) => <> · {count()} running</>}</Show>
    </Button>} />;
}
