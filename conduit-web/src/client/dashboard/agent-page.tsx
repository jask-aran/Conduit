import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX, untrack } from "solid-js";
import { approvalLineText, ClockRow, DayStrip, Icons, LevelMark, levelWord, ServiceIcon, StatusDot, type ClockKind, type DayMark } from "@/components/ui";
import { Button, TextArea } from "@/components/ui/controls";
import { DashIconButton, DashNote } from "@/components/ui/dashboard";
import { Dialog } from "@/components/dialog";
import { MenuRow } from "@/components/menus";
import { api } from "../api/client";
import type { AgentSummary, ChatSummary } from "../api/contracts";
import { agentNeeds, agentView, refreshAgent, type AgentInboxEntry, type AgentRun, type AgentSchedule } from "../state/agent";
import { SplitDashboard, SplitEmpty, SplitGroup, SplitHeader, SplitQuickActions, SplitRow } from "./primitives/split";

/**
 * The hub's persistent agent's page (docs/plans/persistent-agent.md): what needs the person first, then what it is
 * doing and will do, beside its threads; Open thread is where it talks. On the dashboards' split layout,
 * as a place's page is.
 */

const RUN_KIND: Record<string, string> = {
  manual: "Asked", schedule: "Scheduled", checkback: "Check-back", brief: "Morning brief", "morning-brief": "Morning brief", heartbeat: "Heartbeat", webhook: "Webhook", event: "Event",
};
const MEMORY = [
  { path: "MEMORY.md", label: "Memory", context: "What it keeps between conversations" },
  { path: "USER.md", label: "About you", context: "What it knows about you" },
  { path: "SOUL.md", label: "Soul", context: "Who it is and how it works" },
  { path: "routines/heartbeat.md", label: "Heartbeat", context: "What it checks when something comes in" },
  { path: "routines/morning-brief.md", label: "Morning brief", context: "What it gathers each morning" },
  { path: "RUN.md", label: "Runs", context: "How every run works and reports" },
];
const FEED_SOURCE: Record<string, string> = { executor: "Executor", script: "Script", run: "Model run" };
const clockKind = (schedule: AgentSchedule): ClockKind => schedule.feed ? "feed"
  : schedule.routine === "heartbeat" ? "heartbeat" : schedule.routine === "morning-brief" ? "brief"
    : schedule.routine && !schedule.task ? "feed" : schedule.kind === "once" ? "checkback" : "schedule";
/** Minutes after midnight of a time of day ("07:30"), or of an instant in a time zone. */
const minutesOf = (time: string) => { const [hours, minutes] = time.split(":").map(Number); return (hours || 0) * 60 + (minutes || 0); };
const minutesIn = (at: number, timeZone?: string) => {
  try { return minutesOf(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at)); }
  catch { const date = new Date(at); return date.getHours() * 60 + date.getMinutes(); }
};
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
  /** Opens its home thread: the page shows none of it. */
  onOpenThread?: () => void;
  /** Opens one of its chats (a thread, a run's transcript, a question's thread), as a dashboard row opens a chat. */
  onOpenChat: (chatId: string, event?: MouseEvent) => void;
  /** Opens one of its memory files (a path in its folder) in the file viewer. */
  onOpenFile: (path: string) => void;
  onOpenSettings: () => void;
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
  const runsKey = createMemo(() => `${view()?.home?.chatId ?? ""}|${working()?.runs.length ?? 0}|${working()?.recent[0]?.id ?? ""}`);
  createEffect(on(runsKey, () => {
    const home = untrack(() => view()?.home?.chatId);
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
      lead={live ? <StatusDot label="Running" tone="active" spinning /> : run.status === "failed" || run.level ? <LevelMark level={run.status === "failed" ? "failed" : run.level!} /> : <Icons.Agent />}
      primary={run.title || "A run"}
      context={[RUN_KIND[run.kind] || run.kind, !live && run.status === "failed" ? "Failed" : !live && run.level ? levelWord(run.level) : null].filter(Boolean).join(" · ")}
      trailing={age(live ? run.startedAt : run.endedAt, now())} />;
  };

  const needsGroup = () => <SplitGroup id="agent-needs" label="Needs you" count={agentNeeds() || null} order="first">
    <Show when={agentNeeds()} fallback={<SplitEmpty>Nothing waits on you.</SplitEmpty>}>
      <For each={needs()?.asks}>{(ask) =>
        <SplitRow element="button" onClick={(event: MouseEvent) => props.onOpenChat(ask.chatId, event)}
          lead={<ServiceIcon service={ask.service || ""} fallback={<Icons.Permissions />} />} primary={ask.title} title={ask.lines.map(approvalLineText).join("\n")}
          context="Waiting for your approval · open to see it all"
          trailing={<>
            <DashIconButton aria-label="Don't" title="Don't" disabled={busy() !== null} onClick={(event: MouseEvent) => { event.stopPropagation(); void act(ask.id, () => api(`/v0/agent/asks/${encodeURIComponent(ask.id)}`, { method: "POST", body: JSON.stringify({ choice: "deny" }) })); }}><Icons.Close /></DashIconButton>
          </>} />}
      </For>
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

  // What runs reported: waiting for the heartbeat (or for the person to talk first), then what became of the rest.
  const inbox = createMemo(() => [...(view()?.inbox || [])].sort((a, b) => Number(a.status === "handled") - Number(b.status === "handled")));
  const unhandled = () => inbox().filter((entry) => entry.status === "unhandled").length;
  // What came in, counted by where it came from ("12 emails · 1 report"), never read out: the thread is where it is told.
  const tally = (entries: AgentInboxEntry[]) => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      const noun = entry.kind === "feed" ? (entry.title || "item").toLowerCase() : "report";
      const count = entry.count ?? Number(/^(\d+) new:/.exec(entry.headline || "")?.[1] || 1);
      counts.set(noun, (counts.get(noun) ?? 0) + count);
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([noun, count]) => `${count} ${count === 1 || noun.endsWith("s") ? noun : `${noun}s`}`).join(" · ");
  };
  const waiting = () => inbox().filter((entry) => entry.status === "unhandled");
  const handled = () => inbox().filter((entry) => entry.status === "handled");
  const inboxGroup = () => <SplitGroup id="agent-inbox" label="Inbox" count={unhandled() || null}>
    <Show when={inbox().length} fallback={<SplitEmpty>Nothing has come in this week.</SplitEmpty>}>
      <Show when={waiting().length}><SplitRow lead={<Icons.Inbox />} primary={tally(waiting())} context="For the next heartbeat" /></Show>
      <Show when={handled().length}><SplitRow lead={<Icons.Check />} primary={tally(handled())} context="Handled this week" /></Show>
    </Show>
  </SplitGroup>;

  const workingGroup = () => <SplitGroup id="agent-working" label="Working on" count={working()?.runs.length || null}>
    <Show when={working()?.runs.length} fallback={<SplitEmpty>Nothing running.</SplitEmpty>}>
      <For each={working()?.runs}>{(run) => runRow(run, true)}</For>
    </Show>
  </SplitGroup>;

  // What runs on its clock, next first: the heartbeat, the brief, feeds filling the inbox, check-backs; over its day.
  const timed = createMemo(() => [...(working()?.schedules || [])].sort((a, b) => (Date.parse(a.nextAt || "") || Infinity) - (Date.parse(b.nextAt || "") || Infinity)));
  const day = () => {
    const settings = view()?.settings;
    const zone = settings?.timezone;
    const beat = timed().find((schedule) => clockKind(schedule) === "heartbeat");
    const marks: DayMark[] = timed().filter((schedule) => schedule.kind === "daily" && schedule.at && !schedule.feed)
      .map((schedule) => ({ at: minutesOf(schedule.at!), label: clockKind(schedule) === "brief" ? "Brief" : schedule.title, kind: clockKind(schedule) }));
    return <DayStrip now={minutesIn(now(), zone)} marks={marks} pulse={beat?.everyMinutes ?? null}
      quiet={settings?.quietHours?.enabled ? { start: minutesOf(settings.quietHours.start), end: minutesOf(settings.quietHours.end) } : null} />;
  };
  // In quiet hours the heartbeat still ticks but decides nothing until they end.
  const quietUntil = () => {
    const quiet = view()?.settings?.quietHours;
    if (!quiet?.enabled) return null;
    const at = minutesIn(now(), view()?.settings?.timezone), start = minutesOf(quiet.start), end = minutesOf(quiet.end);
    return (start <= end ? at >= start && at < end : at >= start || at < end) ? quiet.end : null;
  };
  const clockRow = (schedule: AgentSchedule) => {
    const feed = schedule.feed;
    const quiet = () => clockKind(schedule) === "heartbeat" && quietUntil() ? `Quiet until ${quietUntil()}` : undefined;
    const status = () => !feed ? undefined : feed.lastError ? "Last check failed" : !feed.primed ? "First check soon"
      : `${feed.lastCount ? `${feed.lastCount} new` : "Nothing new"} ${age(feed.lastRunAt, now())}`.trim();
    return <ClockRow kind={clockKind(schedule)} title={schedule.title} cadence={when(schedule)} warn={feed?.lastError || undefined}
      status={feed ? [FEED_SOURCE[feed.source], status()].join(" · ") : quiet()} next={age(schedule.nextAt, now())}
      actions={<>
        <DashIconButton aria-label={`Run ${schedule.title} now`} title="Run now" disabled={busy() !== null}
          onClick={() => act(schedule.id, () => api(`/v0/agent/schedules/${encodeURIComponent(schedule.id)}/run`, { method: "POST" }))}><Icons.Play /></DashIconButton>
        {feed ? <DashIconButton aria-label="Remove feed" title="Remove feed" disabled={busy() !== null}
        onClick={() => act(schedule.id, () => api(`/v0/agent/feeds/${encodeURIComponent(schedule.id)}`, { method: "DELETE" }))}><Icons.Delete /></DashIconButton> : undefined}
      </>} />;
  };
  const timedGroup = () => <SplitGroup id="agent-timed" label="Timed" count={timed().length || null}>
    {day()}
    <For each={timed()}>{clockRow}</For>
  </SplitGroup>;

  const watchesGroup = () => <Show when={working()?.watches.length}>
    <SplitGroup id="agent-watches" label="Watching" count={working()?.watches.length}>
      <For each={working()?.watches}>{(watch) =>
        <SplitRow lead={watch.kind === "webhook" ? <Icons.ExternalLink /> : <Icons.Focus />} primary={watch.title}
          context={watch.kind === "webhook" ? "Webhook" : watch.event?.replace(/_/g, " ")} trailing={age(watch.lastFiredAt, now())} />}
      </For>
    </SplitGroup>
  </Show>;

  // What it may do without asking: each rule an Always on an approval saved, removable here.
  const rulesGroup = () => <Show when={view()?.rules?.length}>
    <SplitGroup id="agent-rules" label="Allowed" count={view()?.rules?.length}>
      <For each={view()?.rules}>{(rule) =>
        <SplitRow lead={<Icons.Permissions />} primary={rule.label} title={rule.label} context={age(rule.createdAt, now())}
          trailing={<DashIconButton aria-label="Stop allowing" title="Stop allowing" disabled={busy() !== null}
            onClick={() => act(rule.id, () => api(`/v0/agent/rules/${encodeURIComponent(rule.id)}`, { method: "DELETE" }))}><Icons.Close /></DashIconButton>} />}
      </For>
    </SplitGroup>
  </Show>;

  // Its memory is files in its folder, read and edited where any file is.
  const memoryGroup = () => <SplitGroup id="agent-memory" label="Memory">
    <For each={MEMORY}>{(file) =>
      <SplitRow element="button" onClick={() => props.onOpenFile(file.path)} lead={<Icons.FileText />} primary={file.label} context={file.context} />}
    </For>
  </SplitGroup>;

  const recentGroup = () => <SplitGroup id="agent-recent" label="Recent" count={working()?.recent.length || null}>
    <Show when={working()?.recent.length} fallback={<SplitEmpty>Nothing here yet.</SplitEmpty>}>
      <For each={working()?.recent}>{(run) => runRow(run, false)}</For>
    </Show>
  </SplitGroup>;

  // Its threads: home, where it talks to the person, then the side threads it or they started.
  const threads = createMemo(() => [...(view()?.sides || [])].sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "")));
  const threadsGroup = () => <SplitGroup id="agent-threads" label="Threads" count={threads().length + (view()?.home ? 1 : 0)}>
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
            ...(props.onOpenThread ? [{ icon: <Icons.Chat />, label: "Open thread", onClick: () => props.onOpenThread?.() }] : []),
            { icon: <Icons.Play />, label: "Run a task", onClick: () => setAsking(true) },
            { icon: <Icons.NewChat />, label: "New thread", onClick: () => void newThread() },
          ]} manage={() => <MenuRow icon={<Icons.Settings />} onSelect={props.onOpenSettings}>Settings</MenuRow>} />}
          notice={error() ? <DashNote error>{error()}</DashNote> : undefined}
          // What it is doing and what waits on the person in the main column; its threads, watches and files beside.
          stacked list={<>{needsGroup()}{workingGroup()}{timedGroup()}{inboxGroup()}{recentGroup()}</>}
          aside={<>{threadsGroup()}{watchesGroup()}{rulesGroup()}{memoryGroup()}</>} />
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
