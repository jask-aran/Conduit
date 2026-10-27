import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Icons, StatusDot } from "@/components/ui";
import { Button, TextArea } from "@/components/ui/controls";
import { DashIconButton, DashNote } from "@/components/ui/dashboard";
import { Dialog } from "@/components/dialog";
import { api } from "../api/client";
import type { AgentSummary, ChatSummary } from "../api/contracts";
import { agentNeeds, agentView, refreshAgent, type AgentRun, type AgentSchedule } from "../state/agent";
import { SplitDashboard, SplitEmpty, SplitGroup, SplitHeader, SplitQuickActions, SplitRow } from "./primitives/split";

/**
 * The hub's persistent agent's page (docs/plans/persistent-agent.md): what needs the person first, then what it is
 * doing and will do, beside its threads; the composer talks to it in its home thread. On the dashboards' split layout,
 * as a place's page is.
 */

const RUN_KIND: Record<string, string> = {
  manual: "Asked", schedule: "Scheduled", checkback: "Check-back", brief: "Morning brief", heartbeat: "Heartbeat", webhook: "Webhook", event: "Event",
};
/** How a finished run's report was read: what it told the person. */
const LEVEL: Record<string, string> = { urgent: "Urgent", attention: "Told you", fyi: "FYI", none: "Nothing to say" };
const DIAL: Record<string, string> = { quiet: "Quiet", normal: "Normal", chatty: "Chatty" };

function age(value: string | null | undefined, now: number) {
  const at = Date.parse(value || "");
  if (!at) return "";
  const minutes = Math.round(Math.abs(now - at) / 60_000);
  const span = minutes < 1 ? "now" : minutes < 60 ? `${minutes}m` : minutes < 24 * 60 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
  return at > now && span !== "now" ? `in ${span}` : span;
}

const when = (schedule: AgentSchedule) => schedule.kind === "daily" ? `Daily ${schedule.at || ""}`.trim()
  : schedule.kind === "every" ? `Every ${schedule.everyMinutes && schedule.everyMinutes % 60 === 0 ? `${schedule.everyMinutes / 60}h` : `${schedule.everyMinutes}m`}`
  : "Once";

export function AgentPage(props: {
  /** The page's header in its pane, titled with the agent's name. */
  header: (title: string) => JSX.Element;
  /** The composer: what is sent goes to the agent's home thread. */
  composer?: JSX.Element;
  /** Opens one of its chats (a thread, a run's transcript, a question's thread), as a dashboard row opens a chat. */
  onOpenChat: (chatId: string, event?: MouseEvent) => void;
}) {
  const [now, setNow] = createSignal(Date.now());
  const [runChats, setRunChats] = createSignal(new Map<string, string>());
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal<string | null>(null);
  const [asking, setAsking] = createSignal(false);
  const [task, setTask] = createSignal("");

  // While the page is open it follows the agent closely; the sidebar's minute is too slow to watch a run finish.
  onMount(() => {
    void refreshAgent();
    const tick = window.setInterval(() => { setNow(Date.now()); if (document.visibilityState === "visible") void refreshAgent(); }, 10_000);
    onCleanup(() => window.clearInterval(tick));
  });

  const view = agentView;
  const name = () => view()?.settings?.name || "Agent";
  const working = () => view()?.attention?.working;
  const needs = () => view()?.attention?.needsYou;
  // A run is a subagent of the home thread, with a transcript of its own: its chat comes from the home thread's list.
  createEffect(on(() => [view()?.home?.chatId, working()?.runs.length, working()?.recent[0]?.id] as const, ([home]) => {
    if (!home) return;
    void api<{ agents: AgentSummary[] }>(`/v0/chats/${encodeURIComponent(home)}/agents`)
      .then(({ agents }) => setRunChats(new Map(agents.filter((agent) => agent.id && agent.chatId).map((agent) => [agent.id!, agent.chatId!]))))
      .catch(() => {});
  }));

  const act = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key); setError("");
    try { await work(); await refreshAgent(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  };
  const newThread = () => act("thread", async () => {
    const chat = await api<ChatSummary>("/v0/agent/threads", { method: "POST", body: JSON.stringify({}) });
    props.onOpenChat(chat.id);
  });
  const runTask = () => act("wake", async () => {
    const text = task().trim();
    if (!text) return;
    await api("/v0/agent/wake", { method: "POST", body: JSON.stringify({ task: text }) });
    setAsking(false); setTask("");
  });

  const runRow = (run: AgentRun, live: boolean) => {
    const chatId = () => runChats().get(run.id);
    return <SplitRow element="button" disabled={!chatId()} onClick={(event: MouseEvent) => chatId() && props.onOpenChat(chatId()!, event)}
      lead={live ? <StatusDot label="Running" tone="active" spinning /> : <Icons.Agent />}
      primary={run.title || "A run"}
      context={[RUN_KIND[run.kind] || run.kind, !live && run.status === "failed" ? "Failed" : !live && run.level ? LEVEL[run.level] : null].filter(Boolean).join(" · ")}
      trailing={age(live ? run.startedAt : run.endedAt, now())} />;
  };

  const needsGroup = () => <SplitGroup id="agent-needs" label="Needs you" count={agentNeeds() || null} order="first">
    <Show when={agentNeeds()} fallback={<SplitEmpty>Nothing waits on you.</SplitEmpty>}>
      <For each={needs()?.questions}>{(question) =>
        <SplitRow element="button" onClick={(event: MouseEvent) => props.onOpenChat(question.chatId, event)}
          lead={<StatusDot label="Waiting" tone="warn" />} primary={question.title} context="Waiting for your answer" />}
      </For>
      <For each={needs()?.proposals}>{(proposal) =>
        <SplitRow lead={<Icons.FileText />} primary={proposal.text} title={proposal.text}
          context={`${proposal.op === "remove" ? "Forget" : "Remember"} · ${proposal.file}`}
          trailing={<>
            <DashIconButton aria-label="Keep" title="Keep" disabled={busy() !== null} onClick={() => act(proposal.id, () => api(`/v0/agent/proposals/${encodeURIComponent(proposal.id)}/accept`, { method: "POST" }))}><Icons.Check /></DashIconButton>
            <DashIconButton aria-label="Discard" title="Discard" disabled={busy() !== null} onClick={() => act(proposal.id, () => api(`/v0/agent/proposals/${encodeURIComponent(proposal.id)}/reject`, { method: "POST" }))}><Icons.Close /></DashIconButton>
          </>} />}
      </For>
      <For each={needs()?.notices}>{(notice) =>
        <SplitRow lead={<Icons.Warning />} primary={notice.text} title={notice.text} context={age(notice.at, now())}
          trailing={<DashIconButton aria-label="Dismiss" title="Dismiss" disabled={busy() !== null} onClick={() => act(notice.id, () => api(`/v0/agent/notices/${encodeURIComponent(notice.id)}`, { method: "DELETE" }))}><Icons.Close /></DashIconButton>} />}
      </For>
    </Show>
  </SplitGroup>;

  const workingGroup = () => <SplitGroup id="agent-working" label="Working on" count={working()?.runs.length || null}>
    <Show when={working()?.runs.length} fallback={<SplitEmpty>Nothing running.</SplitEmpty>}>
      <For each={working()?.runs}>{(run) => runRow(run, true)}</For>
    </Show>
  </SplitGroup>;

  const schedulesGroup = () => <SplitGroup id="agent-schedules" label="Schedules" count={working()?.schedules.length || null}>
    <Show when={working()?.schedules.length} fallback={<SplitEmpty>Nothing here yet.</SplitEmpty>}>
      <For each={working()?.schedules}>{(schedule) =>
        <SplitRow lead={<Icons.Runtime />} primary={schedule.title} context={when(schedule)} trailing={age(schedule.nextAt, now())} />}
      </For>
    </Show>
  </SplitGroup>;

  const watchesGroup = () => <Show when={working()?.watches.length}>
    <SplitGroup id="agent-watches" label="Watching" count={working()?.watches.length}>
      <For each={working()?.watches}>{(watch) =>
        <SplitRow lead={watch.kind === "webhook" ? <Icons.ExternalLink /> : <Icons.Focus />} primary={watch.title}
          context={watch.kind === "webhook" ? "Webhook" : watch.event?.replace(/_/g, " ")} trailing={age(watch.lastFiredAt, now())} />}
      </For>
    </SplitGroup>
  </Show>;

  const recentGroup = () => <SplitGroup id="agent-recent" label="Recent" count={working()?.recent.length || null}>
    <Show when={working()?.recent.length} fallback={<SplitEmpty>Nothing here yet.</SplitEmpty>}>
      <For each={working()?.recent}>{(run) => runRow(run, false)}</For>
    </Show>
  </SplitGroup>;

  // Its threads: home, where it talks to the person, then the side threads it or they started.
  const threads = createMemo(() => [...(view()?.sides || [])].sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "")));
  const threadsGroup = () => <SplitGroup id="agent-threads" label="Threads" order="list" count={threads().length + (view()?.home ? 1 : 0)}>
    <Show when={view()?.home}>{(home) =>
      <SplitRow element="button" onClick={(event: MouseEvent) => props.onOpenChat(home().chatId, event)} lead={<Icons.Home />} primary="Home" context="Where it talks to you" />}
    </Show>
    <For each={threads()}>{(side) =>
      <SplitRow element="button" onClick={(event: MouseEvent) => props.onOpenChat(side.chatId, event)} lead={<Icons.Chat />} primary={side.title || "Untitled thread"} trailing={age(side.updatedAt, now())} />}
    </For>
  </SplitGroup>;

  const spent = () => {
    const settings = view()?.settings;
    return settings ? `$${(view()?.spentToday || 0).toFixed(2)} of $${settings.budgetUsdPerDay.toFixed(2)} today` : null;
  };
  const running = () => working()?.runs.length ? `${working()!.runs.length} running` : null;

  return <>
    {props.header(name())}
    <Show when={view()} fallback={<SplitEmpty>Loading…</SplitEmpty>}>
      <Show when={view()?.enabled} fallback={<SplitEmpty>This hub has no agent yet.</SplitEmpty>}>
        <SplitDashboard page="Agent" label={`${name()}'s page`}
          header={<SplitHeader title={name()} kind="Agent" glyph={<Icons.Agent />} context={[DIAL[view()?.settings?.dial || ""], spent(), running()]} />}
          quickActions={<SplitQuickActions items={[
            { icon: <Icons.Play />, label: "Run a task", onClick: () => setAsking(true) },
            { icon: <Icons.NewChat />, label: "New thread", onClick: () => void newThread() },
          ]} />}
          notice={error() ? <DashNote error>{error()}</DashNote> : undefined}
          composer={props.composer}
          list={threadsGroup()}
          aside={<>{needsGroup()}{workingGroup()}{schedulesGroup()}{watchesGroup()}{recentGroup()}</>} />
      </Show>
    </Show>

    {/* A run now: a task it works on alone, reporting to the home thread. */}
    <Dialog open={asking()} onOpenChange={setAsking} title="Run a task" close="Cancel" busy={busy() === "wake"}
      actions={<Button type="button" disabled={!task().trim() || busy() === "wake"} onClick={() => void runTask()}>Run <Icons.Proceed /></Button>}>
      <TextArea aria-label="Task" rows={4} autofocus value={task()} onInput={(event) => setTask(event.currentTarget.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void runTask(); }} />
    </Dialog>
  </>;
}
