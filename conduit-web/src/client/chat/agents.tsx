import { AgentDelegate, AgentReport, AgentReportItem, AgentRider, AgentRiderGroup, AgentRow, AgentRows, AgentSpawn, Icons, type AgentState } from "@/components/ui";
import { createEffect, createMemo, createSignal, For, Index, onCleanup, Show, type JSX } from "solid-js";

import type { AgentSummary, Message, ToolItem } from "../api/contracts";
import { createLeaving, createLeavingList, riderMotion } from "./composer-cards";
import { api } from "../api/client";
import { elapsed } from "./tool-card";

export const OPEN_AGENT_EVENT = "conduit:open-agent";
export const openAgentChat = (chatId: string) => window.dispatchEvent(new CustomEvent(OPEN_AGENT_EVENT, { detail: { chatId } }));
export const openRun = (id: string) => void api<{ chatId: string }>(`/v0/agent/runs/${encodeURIComponent(id)}/open`, { method: "POST" })
  .then(({ chatId }) => openAgentChat(chatId)).catch(() => {});

export function useNow(running: () => boolean) {
  const [now, setNow] = createSignal(Date.now());
  createEffect(() => {
    if (!running()) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
  });
  return now;
}
const pad = (value: number) => String(value).padStart(2, "0");
/** Whole seconds while it runs: tenths would flicker. */
export function span(from: string | null | undefined, to: string | null | undefined, now: number): string | undefined {
  const start = from ? Date.parse(from) : NaN;
  const end = to ? Date.parse(to) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  if (to) return elapsed(end - start);
  const seconds = Math.floor((end - start) / 1000);
  return seconds < 60 ? `${pad(seconds)}s` : `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`;
}
const context = (count: number) => count >= 1000 ? `${(count / 1000).toFixed(1)}k context` : `${count} context`;
const lastLine = (output: unknown) => typeof output === "string" ? output.trimEnd().split("\n").at(-1)?.trim() || undefined : undefined;

export const spawned = (tool: ToolItem) => tool.kind === "agent" && Boolean(tool.agent);

type Row = { id?: string; key: string; title: string; state: AgentState; activity?: string; startedAt?: string | null; endedAt?: string | null; usage?: string; chatId?: string | null; background: boolean };

function rowOf(tool: ToolItem, agents: AgentSummary[]): Row {
  const ref = tool.agent!;
  // By its conversation, its key: a label (bg-3) names another agent on another day.
  const listed = ref.conversationId != null ? agents.find((agent) => String(agent.conversationId) === String(ref.conversationId))
    : agents.find((agent) => agent.id === ref.id);
  // fg-N is a turn's own (sa-N and bg-N are background): the listing says, once it has arrived.
  const background = listed ? listed.mode === "background" : Boolean(ref.id) && !ref.id!.startsWith("fg-");
  const own: AgentState = !tool.done ? "running" : tool.cancelled ? "stopped" : tool.isError ? "failed" : "finished";
  // A background spawn's call returns at once: until the chat's agents arrive, a spawn that took is still working.
  const state = background ? listed?.status ?? (own === "finished" ? "running" : own) : own;
  const subject = tool.subject || "Subagent";
  return {
    id: ref.id || undefined, key: String(ref.conversationId ?? listed?.conversationId ?? ref.id ?? ""), background, state, chatId: listed?.chatId,
    title: listed?.title || (ref.id && subject.startsWith(`${ref.id}: `) ? subject.slice(ref.id.length + 2) : subject),
    activity: state === "running" ? (background ? listed?.activity : lastLine(tool.output) || listed?.activity) || undefined : undefined,
    startedAt: listed?.startedAt || tool.timestamp, endedAt: state === "running" ? null : listed?.endedAt || tool.completedAt,
    usage: state !== "running" && listed?.usage.context ? context(listed.usage.context) : undefined,
  };
}

const ENDED_LABEL = { finished: "Finished", failed: "Failed", stopped: "Stopped" } as const;
function together(states: AgentState[]): string {
  const count = (state: AgentState) => states.filter((value) => value === state).length;
  const running = count("running");
  if (running) return states.length === 1 ? "Running" : `${running} of ${states.length} running`;
  const ended = (["finished", "failed", "stopped"] as const).map((state) => [state, count(state)] as const).filter(([, n]) => n);
  return ended.length === 1 ? ENDED_LABEL[ended[0]![0]] : ended.map(([state, n]) => `${n} ${state}`).join(" · ");
}
function rowOfAgent(agent: AgentSummary): Row {
  return { id: agent.id || undefined, key: String(agent.conversationId), background: agent.mode === "background", state: agent.status, chatId: agent.chatId, title: agent.title,
    activity: agent.status === "running" ? agent.activity || undefined : undefined, startedAt: agent.startedAt, endedAt: agent.endedAt,
    usage: agent.status !== "running" && agent.usage.context ? context(agent.usage.context) : undefined };
}

function scrollToRow(selector: string, last = false) {
  const root = (document.activeElement?.closest(".ui-transcript") ?? document) as ParentNode;
  const found = [...root.querySelectorAll<HTMLElement>(selector)];
  (last ? found.at(-1) : found[0])?.scrollIntoView({ block: "center", behavior: "smooth" });
}
export const jumpToSpawn = (key: string) => scrollToRow(`[data-spawn~="${CSS.escape(key)}"]`);
const jumpToReport = (keys: string[]) => scrollToRow(keys.map((key) => `[data-report~="${CSS.escape(key)}"]`).join(", "), true);

export function TurnAgents(props: { tools: ToolItem[]; agents: AgentSummary[]; scripts?: string[]; onStop?: (id: string) => void }) {
  const all = createMemo(() => [...props.tools.filter(spawned).map((tool) => rowOf(tool, props.agents)),
    ...(props.scripts?.length ? props.agents.filter((agent) => agent.via && props.scripts!.includes(agent.via)).map(rowOfAgent) : [])]);
  const rows = createMemo(() => all().filter((row) => !row.background));
  const started = createMemo(() => all().filter((row) => row.background && row.id));
  const now = useNow(() => all().some((row) => row.state === "running"));
  const reported = () => started().filter((row) => row.state !== "running").map((row) => row.key);
  const status = () => together(started().map((row) => row.state));
  return <Show when={all().length}>
    <AgentRows>
      <Show when={rows().length}>
        <AgentDelegate count={rows().length} status={together(rows().map((row) => row.state))}>
          <Index each={rows()}>{(row) => <AgentRow line id={row().id} title={row().title} state={row().state} activity={row().activity} usage={row().usage}
            time={span(row().startedAt, row().endedAt, now())} onOpen={row().chatId ? () => openAgentChat(row().chatId!) : undefined} />}</Index>
        </AgentDelegate>
      </Show>
      <Show when={started().length}>
        <AgentSpawn ids={started().map((row) => row.id!)} keys={started().map((row) => row.key)} title={started().length === 1 ? started()[0]!.title : undefined} status={status()}
          onReport={reported().length ? () => jumpToReport(reported()) : undefined}>
          <Index each={started()}>{(row) => <AgentRow line id={row().id} title={row().title} state={row().state} activity={row().activity} usage={row().usage}
            time={span(row().startedAt, row().endedAt, now())} onOpen={row().chatId ? () => openAgentChat(row().chatId!) : undefined} />}</Index>
        </AgentSpawn>
      </Show></AgentRows>
  </Show>;
}

export function TurnReports(props: { reports: Message[]; agents: AgentSummary[]; text: (message: Message) => JSX.Element }) {
  const ids = () => props.reports.map((message) => message.agent!.id!);
  const keyOf = (message: Message) => String(message.agent?.conversationId ?? message.agent?.id ?? "");
  const listed = (message: Message) => message.agent?.conversationId != null
    ? props.agents.find((agent) => String(agent.conversationId) === String(message.agent!.conversationId))
    : props.agents.find((agent) => agent.id === message.agent?.id);
  const state = (message: Message): AgentState => message.sender?.status === "failed" ? "failed" : listed(message)?.status === "stopped" ? "stopped" : "finished";
  return <AgentRows><AgentReport ids={ids()} title={props.reports.length === 1 ? props.reports[0]!.sender?.name : undefined}
    status={together(props.reports.map(state))} onBack={() => jumpToSpawn(keyOf(props.reports[0]!))}>
    <For each={props.reports}>{(message) => {
      const agent = () => listed(message);
      return <AgentReportItem id={message.agent!.id!} title={message.sender?.name || agent()?.title || "Subagent"} state={state(message)}
        time={agent() ? span(agent()!.startedAt, agent()!.endedAt, Date.now()) : undefined}
        usage={agent()?.usage.context ? context(agent()!.usage.context!) : undefined}
        onOpen={agent()?.chatId ? () => openAgentChat(agent()!.chatId!) : undefined}>{props.text(message)}</AgentReportItem>;
    }}</For>
  </AgentReport></AgentRows>;
}

export function RunningAgents(props: { agents: AgentSummary[]; connections?: { id: string; name: string; kind?: string }[]; onStop?: (id: string) => void; onDisconnect?: (paper: string) => void }) {
  const running = createMemo(() => props.agents.filter((agent) => agent.status === "running" && (agent.run || agent.mode === "foreground" || agent.id)));
  const list = createLeavingList(running, (agent) => `child:${agent.conversationId}`);
  // A connected paper rides under Background for as long as it is connected.
  const papers = createLeavingList(() => props.connections ?? [], (paper) => paper.id);
  const rider = createLeaving(() => running().length + (props.connections?.length ?? 0), (count) => count > 0, undefined, "--duration-gentle");
  const now = useNow(() => running().length > 0);
  const keysOf = (mode: AgentSummary["mode"] | "runs") => list.keys().filter((key) => {
    const agent = list.get(key);
    return mode === "runs" ? Boolean(agent?.run) : !agent?.run && agent?.mode === mode;
  });
  const papersIn = (mode: AgentSummary["mode"] | "runs") => mode === "background" ? papers.keys() : [];
  return <Show when={list.keys().length + papers.keys().length}>
    <AgentRider motion={riderMotion(rider.leaving())}>
      <For each={(["foreground", "background", "runs"] as const).filter((mode) => keysOf(mode).length + papersIn(mode).length)}>{(mode) =>
        <AgentRiderGroup label={mode === "foreground" ? "Foreground" : mode === "background" ? "Background" : "Runs"} going={keysOf(mode).every(list.leaving) && papersIn(mode).every(papers.leaving)}>
          <For each={keysOf(mode)}>{(key) => {
            const agent = () => list.get(key)!;
            return <AgentRow line id={agent().id || undefined} title={agent().run ? (agent().run!.number ? `${agent().run!.label} #${agent().run!.number}` : agent().run!.label) : agent().title} state={agent().status} activity={agent().activity || undefined}
              motion={list.leaving(key) ? "leaving" : undefined} time={span(agent().startedAt, agent().endedAt, now())}
              onOpen={agent().chatId ? () => openAgentChat(agent().chatId!) : undefined}
              onStop={mode !== "foreground" && props.onStop && agent().id ? () => props.onStop!(agent().id!) : undefined} stopRoom />;
          }}</For>
          <For each={papersIn(mode)}>{(id) => <AgentRow line title={`Connected to ${papers.get(id)!.name}`} name={papers.get(id)!.name} state="running" icon={papers.get(id)!.kind === "site" ? <Icons.Browser /> : <Icons.FileText />} activity="Comments come here" stop="Disconnect"
            motion={papers.leaving(id) ? "leaving" : undefined} onOpen={() => window.dispatchEvent(new CustomEvent("conduit:open-artifact", { detail: { id, beside: true } }))}
            onStop={() => props.onDisconnect?.(id)} />}</For>
        </AgentRiderGroup>}</For>
    </AgentRider>
  </Show>;
}
