import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, Suspense, type JSX, untrack } from "solid-js";
import { Portal } from "solid-js/web";
import { ChatMarkdown } from "../chat/lazy-markdown";
import { AgentAvatar, Answer, ApprovalCard, approvalLineText, type ApprovalChoice, Empty, Expand, Dashboard, ClockRow, DayStrip, Icons, LevelMark, levelWord, ServiceIcon, StatusDot, type ClockKind, type DayMark, Note, IconButton } from "@/components/ui";
import { capitalised } from "../chat/turn-trace";
import { Button, Spinner, TextArea } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { DashPanel, DashPeek, GroupAction } from "@/components/ui/dashboard";
import { Glance, GlanceBody, GlanceHead } from "@/components/ui/overlay";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger, MenuRow, MenuSection } from "@/components/ui/menus";
import { api } from "../api/client";
import type { AgentsPayload, AgentSummary, ChatSummary } from "../api/contracts";
import { agentName, agentNeeds, agentView, dismissNotices, dismissableNotices, foldNotices, jbotDoing, refreshAgent, type AgentInboxEntry, type AgentNoticeRow, type AgentRun, type AgentSchedule } from "../state/agent";
import { SplitDashboard, SplitEmpty, SplitGroup, SplitGroupMore, SplitHeader, SplitQuickActions } from "./primitives/split";
import { setAgentDashboardLaidOut } from "../state/arrival";
import { Row } from "@/components/ui/row";

/**
 * The agent's dashboard: what needs the person, its work and schedule, its inbox, threads and memory.
 * Messages opens its app room; Open thread opens the home thread underneath.
 */

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

// Its cadence in words when the hub gives one (rules, or an event alongside a clock: "on held mail; every 12 hours").
const when = (schedule: AgentSchedule) => schedule.cadence ? schedule.cadence : schedule.kind === "rules" ? "Scheduled" : schedule.kind === "daily" ? `Daily ${schedule.at || ""}`.trim()
  : schedule.kind === "every" ? `Every ${schedule.everyMinutes && schedule.everyMinutes % 60 === 0 ? `${schedule.everyMinutes / 60}h` : `${schedule.everyMinutes}m`}`
  : "Once";

/** jbot's panel's tabs: its page's groups, by what they are about. */
export type JbotTab = "now" | "routines" | "memory";
export const JBOT_TABS: Array<{ value: JbotTab; label: string; icon: () => JSX.Element }> = [
  { value: "now", label: "Now", icon: () => <Icons.Runtime /> }, { value: "routines", label: "Routines", icon: () => <Icons.Clock /> },
  { value: "memory", label: "Memory", icon: () => <Icons.Reasoning /> },
];

export function AgentPage(props: {
  /** Drawn as one tab of jbot's panel (beside or over the jbot chat): that tab's groups in one column, no header. */
  panel?: JbotTab;
  /** In the panel: beside its day's timeline, at the top whatever the tab (jbot's spend). */
  panelTop?: JSX.Element;
  /** In the panel: Needs you drawn here, not at the panel's top (a card over the Ledge, a phone's own sheet). */
  needsMount?: () => HTMLElement | undefined;
  /** What the page needs for its two columns, for the pane holding it (SplitDashboard's onNeed). */
  onNeed?: (width: number) => void;
  /** The page's header in its pane, titled with the agent's name. */
  header?: (title: string) => JSX.Element;
  /** Opens its home thread: the page shows none of it. */
  onOpenThread?: () => void;
  /** Opens one of its chats (a thread, a run's transcript, a question's thread), as a dashboard row opens a chat. */
  onOpenChat: (chatId: string, event?: MouseEvent) => void;
  /** Opens one of its memory files (a path in its folder) in the file viewer. */
  onOpenFile: (path: string) => void;
  onOpenSettings: () => void;
  onOpenMessages?: () => void;
}) {
  const [now, setNow] = createSignal(Date.now());
  // A run's chat, by its conversation: run ids (bg-1, bg-2…) are counted again and repeat; a conversation never does.
  const [runChats, setRunChats] = createSignal(new Map<string, string>());
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal<string | null>(null);
  const [asking, setAsking] = createSignal(false);
  const [task, setTask] = createSignal("");

  // While the page is open it follows the agent closely; the sidebar's minute is too slow to watch a run finish.
  onMount(() => {
    if (!props.panel) setAgentDashboardLaidOut(true);
    void refreshAgent();
    // In jbot's panel the jbot chat already follows the agent: only the ages tick here.
    const tick = window.setInterval(() => { setNow(Date.now()); if (!props.panel && document.visibilityState === "visible") void refreshAgent(); }, 10_000);
    onCleanup(() => window.clearInterval(tick));
  });

  const view = agentView;
  const name = agentName;
  const working = () => view()?.attention?.working;
  const needs = () => view()?.attention?.needsYou;
  // A run is a subagent of the home thread, with a transcript of its own: its chat comes from the home thread's list.
  const runsKey = createMemo(() => `${view()?.home?.chatId ?? ""}|${working()?.runs.length ?? 0}|${working()?.recent[0]?.id ?? ""}`);
  createEffect(on(runsKey, () => {
    const home = untrack(() => view()?.home?.chatId);
    if (!home) return;
    void api<AgentsPayload>(`/v0/chats/${encodeURIComponent(home)}/agents`)
      .then(({ agents }) => setRunChats(new Map(agents.filter((agent) => agent.conversationId != null && agent.chatId).map((agent) => [String(agent.conversationId), agent.chatId!]))))
      .catch(() => {});
  }));

  const act = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key); setError("");
    try { await work(); await refreshAgent(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  };
  // A report with no run behind it, asking jbot to say hi: a report's turn to watch end to end.
  const testReport = () => void act("test-report", () => api("/v0/agent/test-report", { method: "POST" }));
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

  // In jbot's panel a row is previewed in place first (what a report said, why a call was decided), its own way on
  // (the file, the run's chat) a press from there; Back returns to the tab.
  type Peek = { title: string; context: string; text: string; file?: string; open?: { label: string; icon: JSX.Element; go: (event?: MouseEvent) => void } };
  const [peek, setPeek] = createSignal<Peek | null>(null);
  createEffect(on(() => props.panel, () => setPeek(null), { defer: true }));
  // A report's whole text is its file (inbox/…md): read when previewed, its front matter left out.
  const [peekText, setPeekText] = createSignal<string | null>(null);
  createEffect(on(peek, (shown) => {
    setPeekText(null);
    const project = untrack(() => view()?.projectId);
    if (!shown?.file || !project) return;
    void api<{ content?: string }>(`/v0/projects/${encodeURIComponent(project)}/file?path=${encodeURIComponent(shown.file)}`)
      .then((file) => { if (peek() === shown && file.content) setPeekText(file.content.replace(/^---\n[\s\S]*?\n---\n/, "").trim()); })
      .catch(() => {});
  }));
  const peekView = (shown: Peek) => {
    const text = () => peekText() ?? shown.text;
    // Drawn as chat search's preview is (Glance): its title the one strong line, its facts in the data face, what it
    // says at the row's size a tone under the text, not a transcript's answer.
    return <DashPeek onBack={() => setPeek(null)} open={shown.open ? { ...shown.open, go: (event) => { setPeek(null); shown.open!.go(event); } } : undefined}>
      <Glance label={shown.title}>
        <GlanceHead title={shown.title} facts={[shown.context]} />
        {/* Keyed: the headline first, then the file's whole text once read, each drawn afresh. */}
        <Show when={text()} keyed fallback={<Empty kind="glance">It reported nothing.</Empty>}>{(shownText) =>
          <GlanceBody><Answer><Suspense fallback={<div class="markdown-skeleton" />}><ChatMarkdown streaming={false}>{shownText}</ChatMarkdown></Suspense></Answer></GlanceBody>}
        </Show>
      </Glance>
    </DashPeek>;
  };
  const entryText = (entry: AgentInboxEntry) => entry.body && entry.body !== entry.headline ? entry.body : entry.headline || "";
  const runRow = (run: AgentRun, live: boolean) => {
    const chatId = () => runChats().get(String(run.conversationId));
    const report = () => inbox().find((entry) => run.inboxId ? entry.id === run.inboxId : run.conversationId != null && entry.conversationId === run.conversationId);
    // Live, what it is doing (its phase; at work, what its agent is doing, in the digest's words) and its agents rolled
    // up; done, how it ended. Never its agents one by one.
    const doing = () => run.phase === "Working" && run.activity ? capitalised(run.activity) : run.phase || "Working";
    const crew = () => run.agents && run.agents.total > 0 && run.agents.running ? `${run.agents.running} ${run.agents.running === 1 ? "agent" : "agents"} working` : null;
    const ended = () => run.status === "failed" ? `Failed${run.summary ? `: ${run.summary}` : ""}` : run.status === "stopped" ? "Stopped"
      // What it did, as a turn's line says it; with no tools to tell, what it found.
      : run.did ? capitalised(run.did) : run.summary || (run.woke ? `Reported to ${name()}` : run.level ? levelWord(run.level) : null);
    const told = () => !live && run.woke && run.status !== "failed" && run.status !== "stopped" ? `Reported to ${name()}` : null;
    const named = () => run.number && run.kind !== "agent" ? `${run.title || "A run"} #${run.number}` : run.title || "A run";
    const line = () => (live ? [doing(), crew()] : [ended()]).filter(Boolean).join(" · ");
    const context = () => [line(), told() !== line() ? told() : null, age(live ? run.startedAt : run.endedAt, now())].filter(Boolean).join(" · ");
    const preview = () => setPeek({ title: named(), context: context(), text: report() ? entryText(report()!) : run.summary || "", file: report()?.file,
      open: chatId() ? { label: "Open its chat", icon: <Icons.Chat />, go: (event?: MouseEvent) => props.onOpenChat(chatId()!, event) }
        : report()?.file ? { label: "Open the file", icon: <Icons.FileText />, go: () => props.onOpenFile(report()!.file!) } : undefined });
    // Its chat; one with none of its own (Reflection, whose report is its inbox entry) opens the report's file.
    const file = () => report()?.file;
    const open = (event: MouseEvent) => chatId() ? props.onOpenChat(chatId()!, event) : file() && props.onOpenFile(file()!);
    return <Row density="list" element="button" disabled={!(props.panel && !live) && !chatId() && !file()} onClick={(event: MouseEvent) => props.panel && !live ? preview() : open(event)}
      lead={live ? <StatusDot label="Running" tone="active" spinning /> : run.status === "failed" || run.level ? <LevelMark level={run.status === "failed" ? "failed" : run.level!} /> : <Icons.Agent />}
      label={named()}
      context={line()}
      meta={age(live ? run.startedAt : run.endedAt, now())} />;
  };

  // What waits on the person, each answered where it stands, never in a thread: an approval's Allow and Don't on its
  // row, its whole card (what it sends, Always) unfolded by a tap; a notice's whole text the same; the rest by their
  // own buttons. Only a question opens its chat (it is answered in the composer there).
  const [unfolded, setUnfolded] = createSignal<string | null>(null);
  const unfold = (key: string) => setUnfolded(unfolded() === key ? null : key);
  const decideAsk = (id: string, choice: ApprovalChoice) => act(id, () => api(`/v0/agent/asks/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ choice }) }));
  const noticeRows = createMemo(() => foldNotices(needs()?.notices));
  const dismissNotice = (row: AgentNoticeRow) => act(row.key, () => Promise.all(row.ids.map((id) => api(`/v0/agent/notices/${encodeURIComponent(id)}`, { method: "DELETE" }))));
  // Dismiss all: the notices that only tell (a parked task waits for Retry, a connector for connecting).
  const dismissAll = () => act("clear", () => dismissNotices(dismissableNotices().flatMap((row) => row.ids)));
  const stop = (event: MouseEvent) => event.stopPropagation();
  // How long an approval waits, as its card's meta (as the thread's card says it): "23 h left", "40 min left".
  const left = (expiresAt: string) => { const minutes = Math.max(0, Math.round((Date.parse(expiresAt) - now()) / 60_000)); return minutes >= 90 ? `${Math.round(minutes / 60)} h left` : `${minutes} min left`; };

  // headless: under a Ledge's or Tray's own title (Needs you apart from the panel), which carries Dismiss all.
  const needsGroup = (headless = false) => <SplitGroup id="agent-needs" label="Needs you" count={agentNeeds() || null} order="first" headless={headless}
    actions={dismissableNotices().length ? <GroupAction disabled={busy() !== null} onClick={() => void dismissAll()}>Dismiss all</GroupAction> : undefined}>
    <Show when={agentNeeds()} fallback={<SplitEmpty>Nothing waits on you.</SplitEmpty>}>
      <For each={needs()?.asks}>{(ask) => <>
        <Row density="list" element="button" aria-expanded={unfolded() === ask.id} onClick={() => unfold(ask.id)}
          lead={<ServiceIcon service={ask.service || ""} fallback={<Icons.Permissions />} />} label={ask.title} title={ask.lines.map(approvalLineText).join("\n")}
          context={unfolded() === ask.id ? `Approval · ${left(ask.expiresAt)}` : `Approval · ${ask.lines[0] ? approvalLineText(ask.lines[0]).split("\n")[0] : "tap to see it all"}`}
          meta={<Show when={unfolded() !== ask.id}>
            <IconButton kind="dash" aria-label="Allow" title="Allow" disabled={busy() !== null} onClick={(event: MouseEvent) => { stop(event); void decideAsk(ask.id, "allow"); }}><Icons.Check /></IconButton>
            <IconButton kind="dash" aria-label="Don't" title="Don't" disabled={busy() !== null} onClick={(event: MouseEvent) => { stop(event); void decideAsk(ask.id, "deny"); }}><Icons.Close /></IconButton>
          </Show>} />
        <Expand open={unfolded() === ask.id}>
          <ApprovalCard bare title={ask.title} service={ask.service} lines={ask.lines} state="pending" busy={busy() !== null} always={ask.always ?? null} choices={ask.choices}
            onChoose={(choice) => void decideAsk(ask.id, choice)} />
        </Expand>
      </>}
      </For>
      <For each={needs()?.questions}>{(question) =>
        <Row density="list" element="button" onClick={(event: MouseEvent) => props.onOpenChat(question.chatId, event)}
          lead={<StatusDot label="Waiting" tone="warn" />} label={question.title} context="Waiting for your answer · open to answer" />}
      </For>
      <For each={needs()?.proposals}>{(proposal) => <>
        <Row density="list" element="button" aria-expanded={unfolded() === proposal.id} onClick={() => unfold(proposal.id)} lead={<Icons.FileText />} label={proposal.text} title={proposal.text}
          context={`${proposal.op === "remove" ? "Forget" : "Remember"} · ${proposal.file}`}
          meta={<>
            <IconButton kind="dash" aria-label="Keep" title="Keep" disabled={busy() !== null} onClick={(event: MouseEvent) => { stop(event); void act(proposal.id, () => api(`/v0/agent/proposals/${encodeURIComponent(proposal.id)}/accept`, { method: "POST" })); }}><Icons.Check /></IconButton>
            <IconButton kind="dash" aria-label="Discard" title="Discard" disabled={busy() !== null} onClick={(event: MouseEvent) => { stop(event); void act(proposal.id, () => api(`/v0/agent/proposals/${encodeURIComponent(proposal.id)}/reject`, { method: "POST" })); }}><Icons.Close /></IconButton>
          </>} />
        <Expand open={unfolded() === proposal.id}><Note kind="dash">{proposal.text}</Note></Expand>
      </>}
      </For>
      <For each={noticeRows()}>{(notice) => <>
        <Row density="list" element="button" aria-expanded={unfolded() === notice.key} onClick={() => unfold(notice.key)} lead={<Icons.Warning />} label={notice.text} title={notice.text}
          context={[notice.ids.length > 1 ? `${notice.ids.length} times` : null, notice.at ? (notice.ids.length > 1 ? `last ${age(notice.at, now())}` : age(notice.at, now())) : null].filter(Boolean).join(" · ") || undefined}
          meta={notice.taskId != null
            // Parked by the runtime after too many restarts: it runs again from where it stopped.
            ? <IconButton kind="dash" aria-label="Retry" title="Retry" disabled={busy() !== null} onClick={(event: MouseEvent) => { stop(event); void act(notice.key, () => api(`/v0/agent/tasks/${notice.taskId}/retry`, { method: "POST" })); }}><Icons.Refresh /></IconButton>
            : notice.kind === "connector"
              ? <IconButton kind="dash" aria-label="Connect" title="Connect in Settings" onClick={(event: MouseEvent) => { stop(event); props.onOpenSettings(); }}><Icons.Settings /></IconButton>
              : <IconButton kind="dash" aria-label="Dismiss" title="Dismiss" disabled={busy() !== null} onClick={(event: MouseEvent) => { stop(event); void dismissNotice(notice); }}><Icons.Close /></IconButton>} />
        <Expand open={unfolded() === notice.key}><Note kind="dash">{notice.text}</Note></Expand>
      </>}
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
      const noun = entry.kind === "feed" ? (entry.title || "item").toLowerCase() : entry.kind === "email" ? "email" : "report";
      const count = entry.count ?? Number(/^(\d+) new:/.exec(entry.headline || "")?.[1] || 1);
      counts.set(noun, (counts.get(noun) ?? 0) + count);
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([noun, count]) => `${count} ${count === 1 || noun.endsWith("s") ? noun : `${noun}s`}`).join(" · ");
  };
  /*
   * The context inbox, the person's to edit as much as jbot's (POST/PATCH/DELETE /v0/agent/inbox, the same verbs as
   * conduit_inbox): a row opens the entry's file (inbox/…md in its folder) in the file viewer; its menu marks it handled or reopens it, addresses it to a routine, dismisses
   * it (handled, outcome dismissed: nothing lost) or deletes it (the person only). The person talks to jbot rather
   * than filing notes here: the inbox is what routines report.
   */
  const [readingEntry, setReadingEntry] = createSignal<AgentInboxEntry | null>(null);
  // A function, not a memo: `timed` is declared below, and a memo would read it now.
  const routines = () => timed().filter((rule) => rule.routine).map((rule) => ({ id: rule.routine!, title: rule.title }));
  const routineTitle = (id: string) => routines().find((routine) => routine.id === id)?.title || id;
  const editEntry = (entry: AgentInboxEntry, body: Record<string, unknown>) => act(`inbox:${entry.id}`, () =>
    api(`/v0/agent/inbox/${encodeURIComponent(entry.id)}`, { method: "PATCH", body: JSON.stringify(body) }));
  const deleteEntry = (entry: AgentInboxEntry) => act(`inbox:${entry.id}`, () =>
    api(`/v0/agent/inbox/${encodeURIComponent(entry.id)}`, { method: "DELETE" }));
  const entryContext = (entry: AgentInboxEntry) => entry.status === "handled"
    ? `${entry.title} · ${entry.outcome === "dismissed" ? "dismissed" : "handled"}`
    : `${entry.title} · ${entry.for?.length ? `for ${entry.for.map(routineTitle).join(", ")}` : "for the next heartbeat"}`;
  // A long group shows its latest few, the rest a press away (SplitGroupMore), never an endless list.
  const [opened, setOpened] = createSignal<ReadonlySet<string>>(new Set());
  const capped = <T,>(id: string, list: () => readonly T[] | undefined, shown = props.panel ? 3 : 5) => ({
    rows: () => { const all = list() || []; return opened().has(id) ? all : all.slice(0, shown); },
    more: () => {
      const rest = (list()?.length || 0) - shown;
      return rest > 0 && !opened().has(id) ? <SplitGroupMore count={rest} onClick={() => setOpened(new Set([...opened(), id]))}>Show all</SplitGroupMore> : undefined;
    },
  });
  const inboxShown = capped("inbox", inbox);
  const inboxGroup = () => <SplitGroup id="agent-inbox" order="first" label="Context inbox" count={unhandled() || null} more={inboxShown.more()}>
    <Show when={inbox().length} fallback={<SplitEmpty>Nothing has come in this week.</SplitEmpty>}>
      {/* One row an entry -- what one poll or run brought in -- counted, not read out. */}
      <For each={inboxShown.rows()}>{(entry) =>
        <ContextMenu><ContextMenuTrigger density="list" as={Row} element="button" onClick={() => props.panel
            ? setPeek({ title: entry.title || tally([entry]), context: `${entryContext(entry)} · ${age(entry.at, now())}`, text: entryText(entry), file: entry.file,
                open: entry.file ? { label: "Open the file", icon: <Icons.FileText />, go: () => props.onOpenFile(entry.file!) } : undefined })
            : entry.file ? props.onOpenFile(entry.file) : setReadingEntry(entry)}
            lead={entry.status === "handled" ? <Icons.Check /> : <Icons.Inbox />} label={entry.headline || tally([entry])}
            context={entryContext(entry)} meta={age(entry.at, now())} />
          <ContextMenuContent>
            <ContextMenuGroup>
              <Show when={entry.status === "unhandled"} fallback={<ContextMenuItem onSelect={() => void editEntry(entry, { action: "reopen" })}><Icons.Undo />Reopen</ContextMenuItem>}>
                <ContextMenuItem onSelect={() => void editEntry(entry, { action: "handle", outcome: "Handled by the person" })}><Icons.Check />Mark handled</ContextMenuItem>
                <ContextMenuItem onSelect={() => void editEntry(entry, { action: "dismiss" })}><Icons.Hide />Dismiss</ContextMenuItem>
              </Show>
            </ContextMenuGroup>
            <MenuSection title="For">
              <ContextMenuItem onSelect={() => void editEntry(entry, { action: "address", for: [] })}>{entry.for?.length ? <Icons.Inbox /> : <Icons.Check />}Any routine</ContextMenuItem>
              <For each={routines()}>{(routine) =>
                <ContextMenuItem onSelect={() => void editEntry(entry, { action: "address", for: [routine.id] })}>{entry.for?.length === 1 && entry.for?.[0] === routine.id ? <Icons.Check /> : <Icons.Clock />}{routine.title}</ContextMenuItem>}
              </For>
            </MenuSection>
            <MenuSection><ContextMenuItem variant="destructive" onSelect={() => void deleteEntry(entry)}><Icons.Delete />Delete</ContextMenuItem></MenuSection>
          </ContextMenuContent>
        </ContextMenu>}
      </For>
    </Show>
  </SplitGroup>;

  // jbot's own turn first, in the turn digest's words ("jbot · checking Gmail"), then each unit of work under way.
  const busy_ = () => (working()?.runs.length || 0) + (jbotDoing() ? 1 : 0);
  const jbotRow = () => <Row density="list" element="button" disabled={!props.onOpenThread} onClick={() => props.onOpenThread?.()}
    lead={<StatusDot label="Working" tone="active" spinning />} label={name()} context={capitalised(jbotDoing()!)} />;
  const workingGroup = () => <Show when={!props.panel || busy_()}><SplitGroup id="agent-working" order="first" label="Working on" count={busy_() || null}>
    <Show when={busy_()} fallback={<SplitEmpty>Nothing running.</SplitEmpty>}>
      <Show when={jbotDoing()}>{jbotRow()}</Show>
      <For each={working()?.runs}>{(run) => runRow(run, true)}</For>
    </Show>
  </SplitGroup></Show>;

  /*
   * Where the heartbeat fires through the day, by its timing rules (schedule.js): a windowed rule wins inside its window
   * (the narrower of two), an unwindowed one elsewhere; an interval counts from its window's start (midnight unwindowed).
   */
  const beatTicks = (rules: NonNullable<AgentSchedule["rules"]>) => {
    const windowOf = (during: string | null) => during ? during.split("-").map(minutesOf) as [number, number] : null;
    const inside = (at: number, [from, to]: [number, number]) => from < to ? at >= from && at < to : at >= from || at < to;
    const width = ([from, to]: [number, number]) => (to - from + 1440) % 1440;
    const winner = (at: number) => rules.filter((rule) => rule.kind === "every" && rule.everyMinutes)
      .map((rule) => ({ rule, window: windowOf(rule.during) }))
      .filter(({ window }) => !window || inside(at, window))
      .sort((a, b) => (a.window ? width(a.window) : 1441) - (b.window ? width(b.window) : 1441))[0]?.rule;
    const out = new Set<number>();
    for (const rule of rules) {
      if (rule.kind !== "every" || !rule.everyMinutes) continue;
      const start = windowOf(rule.during)?.[0] ?? 0;
      for (let step = 0; step < 1440; step += rule.everyMinutes) {
        const at = (start + step) % 1440;
        if (winner(at) === rule) out.add(at);
      }
    }
    return [...out].sort((a, b) => a - b);
  };
  // What runs on its clock, next first: the heartbeat, the brief, feeds filling the inbox, check-backs; over its day.
  // On first by when they next run, then the ones switched off (dimmed, no clock).
  const timed = createMemo(() => [...(working()?.schedules || [])].sort((a, b) => Number(!!a.off) - Number(!!b.off) || (Date.parse(a.nextAt || "") || Infinity) - (Date.parse(b.nextAt || "") || Infinity)));
  const clocked = () => timed().filter((schedule) => !schedule.off);
  const day = () => {
    const settings = view()?.settings;
    const zone = settings?.timezone;
    const beat = clocked().find((schedule) => clockKind(schedule) === "heartbeat");
    const marks: DayMark[] = clocked().filter((schedule) => schedule.kind === "daily" && schedule.at && !schedule.feed)
      .map((schedule) => ({ at: minutesOf(schedule.at!), label: clockKind(schedule) === "brief" ? "Brief" : schedule.title, kind: clockKind(schedule) }));
    return <DayStrip now={minutesIn(now(), zone)} marks={marks} pulse={beat?.everyMinutes ?? null} ticks={beat?.rules ? beatTicks(beat.rules) : undefined}
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
    // A routine under way says so, and how its last compaction of the home thread went (done, or why not).
    const thousands = (count: number) => `${Math.round(count / 1000)}k`;
    const compaction = () => {
      const last = schedule.compaction;
      if (!last) return undefined;
      if (last.done) return `Compacted ${age(last.at, now())}`.trim();
      if (last.enabled === false) return "Compaction off";
      return last.tokens != null && last.from ? `Not compacted: ${thousands(last.tokens)} of ${thousands(last.from)}` : "Not compacted";
    };
    const status = () => schedule.running === "compacting" ? "Compacting the home thread" : schedule.running ? "Running"
      : !feed ? compaction() : feed.lastError ? "Last check failed" : !feed.primed ? "First check soon"
      : `${feed.lastCount ? `${feed.lastCount} new` : "Nothing new"} ${age(feed.lastRunAt, now())}`.trim();
    const runNow = <IconButton kind="dash" aria-label={schedule.running ? `${schedule.title} is running` : `Run ${schedule.title} now`} title={schedule.running ? "Running" : "Run now"}
      disabled={busy() !== null || Boolean(schedule.running)}
      onClick={() => act(schedule.id, () => api(`/v0/agent/schedules/${encodeURIComponent(schedule.id)}/run`, { method: "POST" }))}>
      <Show when={schedule.running || busy() === schedule.id} fallback={<Icons.Play />}><Spinner /></Show></IconButton>;
    // Off: no clock, but it still runs by hand.
    if (schedule.off) return <ClockRow wrap={Boolean(props.panel)} kind={clockKind(schedule)} title={schedule.title} cadence={when(schedule)} status={status()} next="Off" off actions={schedule.routine ? runNow : undefined} />;
    return <ClockRow wrap={Boolean(props.panel)} kind={clockKind(schedule)} title={schedule.title} cadence={when(schedule)} warn={feed?.lastError || undefined}
      status={feed && !schedule.running ? [FEED_SOURCE[feed.source], status()].join(" · ") : [quiet(), status()].filter(Boolean).join(" · ") || undefined} next={age(schedule.nextAt, now())}
      actions={<>
        {runNow}
        {feed ? <IconButton kind="dash" aria-label="Remove feed" title="Remove feed" disabled={busy() !== null}
        onClick={() => act(schedule.id, () => api(`/v0/agent/feeds/${encodeURIComponent(schedule.id)}`, { method: "DELETE" }))}><Icons.Delete /></IconButton> : undefined}
      </>} />;
  };
  const timedGroup = () => <SplitGroup id="agent-timed" order="first" label="Timed" count={clocked().length || null}
    actions={props.panel ? <GroupAction onClick={() => setAsking(true)}><Icons.Play />Run a task</GroupAction> : undefined}>
    <For each={timed()}>{clockRow}</For>
  </SplitGroup>;

  const watchesGroup = () => <Show when={working()?.watches.length}>
    <SplitGroup id="agent-watches" order="rest" label="Watching" count={working()?.watches.length}>
      <For each={working()?.watches}>{(watch) =>
        <Row density="list" lead={watch.kind === "webhook" ? <Icons.ExternalLink /> : <Icons.Focus />} label={watch.title}
          context={[watch.kind === "webhook" ? "Webhook" : watch.event?.replace(/_/g, " "), watch.log === false ? "not in the log" : null].filter(Boolean).join(" · ")}
          meta={<>{age(watch.lastFiredAt, now())}<IconButton kind="dash" aria-label="Remove" title="Remove" disabled={busy() !== null}
            onClick={() => act(watch.id, () => api(`/v0/agent/watches/${encodeURIComponent(watch.id)}`, { method: "DELETE" }))}><Icons.Close /></IconButton></>} />}
      </For>
    </SplitGroup>
  </Show>;

  // What it may do without asking: each rule an Always on an approval saved, removable here.
  const rulesGroup = () => <Show when={view()?.rules?.length}>
    <SplitGroup id="agent-rules" order="rest" label="Allowed" count={view()?.rules?.length}>
      <For each={view()?.rules}>{(rule) =>
        <Row density="list" lead={<Icons.Permissions />} label={rule.label} title={rule.label} context={age(rule.createdAt, now())}
          meta={<IconButton kind="dash" aria-label="Stop allowing" title="Stop allowing" disabled={busy() !== null}
            onClick={() => act(rule.id, () => api(`/v0/agent/rules/${encodeURIComponent(rule.id)}`, { method: "DELETE" }))}><Icons.Close /></IconButton>} />}
      </For>
    </SplitGroup>
  </Show>;

  // What the approval model decided without asking (GET /v0/agent/approvals): allowed and refused, newest first, so a
  // rule can be tightened (Settings › Agent › Approvals). Read again on the page's own clock.
  type Decided = { at: string; held: { action: string; recipients?: string[] }; verdict: { outcome: string; reason: string; source: string } };
  const [decided, setDecided] = createSignal<Decided[]>([]);
  const readDecided = () => void api<{ records: Decided[] }>("/v0/agent/approvals?limit=20").then((result) => setDecided(result.records.filter((record) => record.verdict.outcome !== "escalate"))).catch(() => {});
  readDecided();
  createEffect(on(now, readDecided, { defer: true }));
  // What it decided for the person in the last few days; all it has kept, behind Show all.
  const DECIDED_DAYS = 3;
  const decidedLately = () => decided().filter((record) => now() - Date.parse(record.at) < DECIDED_DAYS * 86_400_000);
  const decidedRows = () => opened().has("decided") ? decided() : decidedLately().slice(0, props.panel ? 3 : 5);
  const decidedGroup = () => <Show when={decided().length}>
    <SplitGroup id="agent-decided" order="rest" label="Decided for you" count={decidedLately().length || null}
      more={!opened().has("decided") && decided().length > decidedRows().length ? <SplitGroupMore count={decided().length - decidedRows().length} onClick={() => setOpened(new Set([...opened(), "decided"]))}>Earlier</SplitGroupMore> : undefined}>
      <Show when={decidedRows().length} fallback={<SplitEmpty>Nothing in the last {DECIDED_DAYS} days.</SplitEmpty>}>
        <For each={decidedRows()}>{(record) => {
          const context = () => `${record.verdict.outcome === "allow" ? "Allowed" : "Refused"}${record.held.recipients?.length ? ` · ${record.held.recipients.join(", ")}` : ""}`;
          return <Row density="list" element={props.panel ? "button" : undefined} lead={record.verdict.outcome === "allow" ? <Icons.Check /> : <Icons.Close />} label={record.held.action}
            context={context()} title={record.verdict.reason} meta={age(record.at, now())}
            onClick={props.panel ? () => setPeek({ title: record.held.action, context: `${context()} · ${age(record.at, now())}`, text: record.verdict.reason }) : undefined} />;
        }}</For>
      </Show>
    </SplitGroup>
  </Show>;

  // What it remembers, line by line (GET /v0/agent/memory): where each line is, what reads it, who wrote it, when and
  // where; its chat button opens the chat it was learned in; forgetting asks twice. A prototype (roadmap 19).
  type MemoryEntry = { file: string; date: string | null; section: string | null; text: string; line: string; scope: string;
    provenance: { by: string; from: string; chatId: string | null; at: string; accepted: string | null } | null };
  const FILE_LABELS: Record<string, string> = { soul: "Soul", user: "About you", memory: "Memory", diary: "Diary" };
  const [remembered, setRemembered] = createSignal<MemoryEntry[] | null>(null);
  const [allRemembered, setAllRemembered] = createSignal(false);
  const [arming, setArming] = createSignal<string | null>(null);
  const loadRemembered = () => void api<{ entries: MemoryEntry[] }>("/v0/agent/memory").then((value) => setRemembered(value.entries)).catch(() => setRemembered(null));
  onMount(loadRemembered);
  const rememberedOrder = createMemo(() => [...(remembered() || [])].sort((left, right) =>
    (right.provenance?.at || "").localeCompare(left.provenance?.at || "")));
  const entryKey = (entry: MemoryEntry) => `${entry.file}:${entry.date || ""}:${entry.line}`;
  const forget = (entry: MemoryEntry) => {
    const key = entryKey(entry);
    if (arming() !== key) { setArming(key); setTimeout(() => { if (arming() === key) setArming(null); }, 3000); return; }
    setArming(null);
    void act(key, () => api("/v0/agent/memory/forget", { method: "POST", body: JSON.stringify({ file: entry.file, date: entry.date, line: entry.line }) })).finally(loadRemembered);
  };
  const whereOf = (entry: MemoryEntry) => [entry.file === "diary" ? `Diary ${entry.date}` : FILE_LABELS[entry.file] || entry.file,
    entry.section && entry.section !== entry.date && entry.section !== FILE_LABELS[entry.file] ? entry.section : null].filter(Boolean).join(" › ");
  const whoOf = (entry: MemoryEntry) => entry.provenance
    ? `${entry.provenance.accepted ? "kept by you, from" : "from"} ${entry.provenance.from} · ${age(entry.provenance.at, now())}`
    : "written by you";
  const rememberedGroup = () => <Show when={remembered()}>{(entries) =>
    <SplitGroup id="agent-remembered" order="rest" label="Remembered" count={entries().length || null}
      more={rememberedOrder().length > 6 && !allRemembered() ? <SplitGroupMore count={rememberedOrder().length - 6} onClick={() => setAllRemembered(true)}>Show all</SplitGroupMore> : undefined}>
      <Show when={entries().length} fallback={<SplitEmpty>Nothing remembered yet.</SplitEmpty>}>
        <For each={allRemembered() ? rememberedOrder() : rememberedOrder().slice(0, 6)}>{(entry) =>
          <Row density="list" lead={entry.provenance ? <Icons.Agent /> : <Icons.User />} label={entry.text} title={`${entry.text}\n${whereOf(entry)}, ${whoOf(entry)}\n${entry.scope}`}
            context={`${entry.file === "diary" ? "Diary" : entry.section || FILE_LABELS[entry.file] || entry.file} · ${entry.provenance ? age(entry.provenance.at, now()) : "you"}`}
            meta={<><Show when={entry.provenance?.chatId}>{(chatId) =>
              <IconButton kind="dash" aria-label="Open the chat it was learned in" title="Open the chat it was learned in" onClick={(event: MouseEvent) => props.onOpenChat(chatId(), event)}><Icons.Chat /></IconButton>}</Show>
              <IconButton kind="dash" aria-label={arming() === entryKey(entry) ? "Forget it: click again" : "Forget"} title={arming() === entryKey(entry) ? "Click again to forget" : "Forget"}
              disabled={busy() !== null} onClick={() => forget(entry)}>
              {arming() === entryKey(entry) ? <Icons.Check /> : <Icons.Close />}</IconButton></>} />}
        </For>
      </Show>
    </SplitGroup>}
  </Show>;

  // Its memory is files in its folder, read and edited where any file is.
  const memoryGroup = () => <SplitGroup id="agent-memory" order="rest" label="Memory">
    <For each={MEMORY}>{(file) =>
      <Row density="list" element="button" onClick={() => props.onOpenFile(file.path)} lead={<Icons.FileText />} label={file.label} context={file.context} />}
    </For>
  </SplitGroup>;

  const recentShown = capped("recent", () => working()?.recent);
  const recentGroup = () => <SplitGroup id="agent-recent" order="rest" label="Recent" count={working()?.recent.length || null} more={recentShown.more()}>
    <Show when={working()?.recent.length} fallback={<SplitEmpty>Nothing here yet.</SplitEmpty>}>
      <For each={recentShown.rows()}>{(run) => runRow(run, false)}</For>
    </Show>
  </SplitGroup>;

  // Its threads: home, where it talks to the person, then the side threads it or they started.
  const threads = createMemo(() => [...(view()?.sides || [])].sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "")));
  const threadsShown = capped("threads", threads);
  const threadsGroup = () => <SplitGroup id="agent-threads" order="rest" label="Threads" count={threads().length + (view()?.home ? 1 : 0)} more={threadsShown.more()}
    actions={props.panel ? <GroupAction disabled={busy() === "thread"} onClick={() => void newThread()}><Icons.NewChat />New thread</GroupAction> : undefined}>
    <Show when={view()?.home}>{(home) =>
      <Row density="list" element="button" onClick={(event: MouseEvent) => props.onOpenChat(home().chatId, event)} lead={<Icons.Home />} label="Home" context="Where it talks to you" />}
    </Show>
    <For each={threadsShown.rows()}>{(side) =>
      <Row density="list" element="button" onClick={(event: MouseEvent) => props.onOpenChat(side.chatId, event)} lead={<Icons.Chat />} label={side.title || "Untitled thread"} meta={age(side.updatedAt, now())} />}
    </For>
  </SplitGroup>;


  const spent = () => {
    const settings = view()?.settings;
    return settings ? `$${(view()?.spentToday || 0).toFixed(2)} of $${settings.budgetUsdPerDay.toFixed(2)} today` : null;
  };
  const running = () => working()?.runs.length ? `${working()!.runs.length} running` : null;

  // jbot's panel: one tab's groups, a tab's own action first.
  // What needs the person is in the panel's top, whatever the tab; its threads close Now (no tab of their own).
  const tabGroups = (tab: JbotTab) => tab === "now" ? <>{workingGroup()}{inboxGroup()}{recentGroup()}{decidedGroup()}{threadsGroup()}</>
    : tab === "routines" ? <>{timedGroup()}{watchesGroup()}</>
    : <>{rememberedGroup()}{memoryGroup()}{rulesGroup()}</>;

  return <>
    {props.header?.(`${name()}'s page`)}
    {/* In the panel its day stays at the top, whatever the tab; the tab's groups scroll under it. */}
    <Show when={props.panel}>{(tab) => <Show when={view()?.enabled}>
      <DashPanel band={day()} figure={props.panelTop}
        under={<Show when={agentNeeds() && !props.needsMount}><Dashboard label="Needs you" page="Agent" compact oneColumn stacked list={needsGroup()} /></Show>}>
          <Dashboard label={`${name()}: ${JBOT_TABS.find((item) => item.value === tab())?.label}`} page="Agent" compact oneColumn stacked
            notice={error() ? <Note kind="dash" tone="error">{error()}</Note> : undefined} list={<Show when={peek()} fallback={tabGroups(tab())}>{(shown) => peekView(shown())}</Show>} />
      </DashPanel>
      <Show when={props.needsMount?.()}>{(mount) => <Show when={agentNeeds()}>
        <Portal mount={mount()}><Dashboard label="Needs you" page="Agent" compact oneColumn stacked list={needsGroup(true)} /></Portal>
      </Show>}</Show>
    </Show>}</Show>
    <Show when={!props.panel && view()} fallback={<Show when={!props.panel}><SplitEmpty>Loading…</SplitEmpty></Show>}>
      <Show when={view()?.enabled} fallback={<SplitEmpty>This hub has no agent yet.</SplitEmpty>}>
        <SplitDashboard page="Agent" label={`${name()}'s page`} onNeed={props.onNeed}
          header={<SplitHeader title={name()} kind="Agent" glyph={<AgentAvatar />} context={[DIAL[view()?.settings?.dial || ""], spent(), running()]} />}
          quickActions={<SplitQuickActions items={[
            ...(props.onOpenMessages ? [{ icon: <Icons.Chat />, label: "Messages", onClick: props.onOpenMessages }] : []),
            ...(props.onOpenThread ? [{ icon: <Icons.Chat />, label: "Open thread", onClick: () => props.onOpenThread?.() }] : []),
            { icon: <Icons.Play />, label: "Run a task", onClick: () => setAsking(true) },
            { icon: <Icons.NewChat />, label: "New thread", onClick: () => void newThread() },
          ]} manage={() => <><MenuRow icon={<Icons.Notification />} onSelect={testReport}>Test report</MenuRow>
            <MenuRow icon={<Icons.Settings />} onSelect={props.onOpenSettings}>Settings</MenuRow></>} />}
          notice={error() ? <Note kind="dash" tone="error">{error()}</Note> : undefined}
          // Its day across both columns: in the side column it was too narrow to read.
          band={day()}
          stacked
          list={<>{needsGroup()}{workingGroup()}{timedGroup()}{inboxGroup()}</>}
          aside={<>{recentGroup()}{threadsGroup()}{watchesGroup()}{rulesGroup()}{decidedGroup()}{rememberedGroup()}{memoryGroup()}</>} />
      </Show>
    </Show>

    <Dialog open={readingEntry() !== null} onOpenChange={(open) => { if (!open) setReadingEntry(null); }} title={readingEntry()?.title || ""} close="Close">
      <Show when={readingEntry()}>{(entry) => <>
        <For each={(entry().body && entry().body !== entry().headline ? entry().body! : entry().headline).split(/\n{2,}/)}>{(paragraph) => <p>{paragraph}</p>}</For>
        <Note kind="card" tone="quiet">{entryContext(entry())} · {age(entry().at, now())}</Note>
      </>}</Show>
    </Dialog>
    {/* A run now: a task it works on alone, reporting to the home thread. */}
    <Dialog open={asking()} onOpenChange={setAsking} title="Run a task" close="Cancel" busy={busy() === "wake"}
      actions={<Button type="button" disabled={!task().trim() || busy() === "wake"} onClick={() => void runTask()}>Run <Icons.Proceed /></Button>}>
      <TextArea aria-label="Task" rows={4} autofocus value={task()} onInput={(event) => setTask(event.currentTarget.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void runTask(); }} />
    </Dialog>
  </>;
}
