import { AgentDelegate, AgentReport, AgentReportItem, AgentRider, AgentRiderGroup, AgentRow, AgentRows, AgentSpawn, type AgentState } from "@/components/ui";
import { createEffect, createMemo, createSignal, For, Index, onCleanup, Show, type JSX } from "solid-js";

import type { AgentSummary, Message, ToolItem } from "../api/contracts";
import { createLeaving, createLeavingList, riderMotion } from "./composer-cards";
import { elapsed } from "./tool-card";

/*
 * Subagents, in Conduit's words for every harness: a turn's own pinned under its head (AgentRows), a chat's
 * background ones on its composer, a line each (AgentRider). What each is doing and how it ended come from the chat's agents
 * (GET /v0/chats/:chatId/agents, refetched on agents_changed); a turn's own runs from its tool row, whose output is
 * the child's latest step. Each opens its transcript, a chat of its own, through the app (OPEN_AGENT_EVENT).
 */
export const OPEN_AGENT_EVENT = "conduit:open-agent";
export const openAgentChat = (chatId: string) => window.dispatchEvent(new CustomEvent(OPEN_AGENT_EVENT, { detail: { chatId } }));

/** A clock that ticks each second while something runs. */
function useNow(running: () => boolean) {
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
/** Whole seconds while it runs (tenths would flicker), the measured time once it has ended. */
function span(from: string | null | undefined, to: string | null | undefined, now: number): string | undefined {
  const start = from ? Date.parse(from) : NaN;
  const end = to ? Date.parse(to) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  if (to) return elapsed(end - start);
  const seconds = Math.floor((end - start) / 1000);
  return seconds < 60 ? `${pad(seconds)}s` : `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`;
}
const context = (count: number) => count >= 1000 ? `${(count / 1000).toFixed(1)}k context` : `${count} context`;
const lastLine = (output: unknown) => typeof output === "string" ? output.trimEnd().split("\n").at(-1)?.trim() || undefined : undefined;

/** A tool row that handed an agent its task (the adapter states it, with the agent's reference). */
export const spawned = (tool: ToolItem) => tool.kind === "agent" && Boolean(tool.agent);

type Row = { id?: string; title: string; state: AgentState; activity?: string; startedAt?: string | null; endedAt?: string | null; usage?: string; chatId?: string | null; background: boolean };

/** A spawn's row: the chat's agents say how a background one is doing; a turn's own is its tool row's. */
function rowOf(tool: ToolItem, agents: AgentSummary[]): Row {
  const ref = tool.agent!;
  const listed = agents.find((agent) => ref.id ? agent.id === ref.id : ref.conversationId != null && String(agent.conversationId) === String(ref.conversationId));
  // fg-N is a turn's own (sa-N, older, and bg-N are background): the listing says, once it has arrived.
  const background = listed ? listed.mode === "background" : Boolean(ref.id) && !ref.id!.startsWith("fg-");
  const own: AgentState = !tool.done ? "running" : tool.cancelled ? "stopped" : tool.isError ? "failed" : "finished";
  // A background spawn's call returns at once: until the chat's agents arrive, a spawn that took is still working.
  const state = background ? listed?.status ?? (own === "finished" ? "running" : own) : own;
  const subject = tool.subject || "Subagent";
  return {
    id: ref.id || undefined, background, state, chatId: listed?.chatId,
    title: listed?.title || (ref.id && subject.startsWith(`${ref.id}: `) ? subject.slice(ref.id.length + 2) : subject),
    activity: state === "running" ? (background ? listed?.activity : lastLine(tool.output) || listed?.activity) || undefined : undefined,
    startedAt: listed?.startedAt || tool.timestamp, endedAt: state === "running" ? null : listed?.endedAt || tool.completedAt,
    usage: state !== "running" && listed?.usage.context ? context(listed.usage.context) : undefined,
  };
}

const ENDED_LABEL = { finished: "Finished", failed: "Failed", stopped: "Stopped" } as const;
/** How agents taken together are doing, for a shut line: "2 of 3 running", "Finished", "2 finished · 1 failed". */
function together(states: AgentState[]): string {
  const count = (state: AgentState) => states.filter((value) => value === state).length;
  const running = count("running");
  if (running) return states.length === 1 ? "Running" : `${running} of ${states.length} running`;
  const ended = (["finished", "failed", "stopped"] as const).map((state) => [state, count(state)] as const).filter(([, n]) => n);
  return ended.length === 1 ? ENDED_LABEL[ended[0]![0]] : ended.map(([state, n]) => `${n} ${state}`).join(" · ");
}
/** An agent a codemode script spawned: the chat's agents are all there is of it (no call of the turn names it). */
function rowOfAgent(agent: AgentSummary): Row {
  return { id: agent.id || undefined, background: agent.mode === "background", state: agent.status, chatId: agent.chatId, title: agent.title,
    activity: agent.status === "running" ? agent.activity || undefined : undefined, startedAt: agent.startedAt, endedAt: agent.endedAt,
    usage: agent.status !== "running" && agent.usage.context ? context(agent.usage.context) : undefined };
}

/** Scroll the transcript the person is in to a row, gently, centred: a report from its spawn line, or back. */
function scrollToRow(selector: string, last = false) {
  const root = (document.activeElement?.closest(".ui-transcript") ?? document) as ParentNode;
  const found = [...root.querySelectorAll<HTMLElement>(selector)];
  (last ? found.at(-1) : found[0])?.scrollIntoView({ block: "center", behavior: "smooth" });
}
/** Back from a report to the line that started its agent. */
export const jumpToSpawn = (id: string) => scrollToRow(`[data-spawn~="${CSS.escape(id)}"]`);
const jumpToReport = (ids: string[]) => scrollToRow(ids.map((id) => `[data-report~="${CSS.escape(id)}"]`).join(", "), true);

/** A turn's agents: its spawn calls', then those its codemode scripts spawned (`scripts`: the turn's script call ids),
 *  drawn alike -- a spawn is a spawn however the model asked for it. A foreground one starts and ends inside the turn,
 *  so it is one live AgentRow; background ones branch off and join later as reports, so the turn keeps only where they
 *  started (AgentSpawn, one line for those started together) -- how they are doing rides on the composer. */
export function TurnAgents(props: { tools: ToolItem[]; agents: AgentSummary[]; scripts?: string[]; onStop?: (id: string) => void }) {
  const all = createMemo(() => [...props.tools.filter(spawned).map((tool) => rowOf(tool, props.agents)),
    ...(props.scripts?.length ? props.agents.filter((agent) => agent.via && props.scripts!.includes(agent.via)).map(rowOfAgent) : [])]);
  const rows = createMemo(() => all().filter((row) => !row.background));
  const started = createMemo(() => all().filter((row) => row.background && row.id));
  const now = useNow(() => all().some((row) => row.state === "running"));
  const reported = () => started().filter((row) => row.state !== "running").map((row) => row.id!);
  // How the started ones are doing, together: the shut line says whether they are all back.
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
        <AgentSpawn ids={started().map((row) => row.id!)} title={started().length === 1 ? started()[0]!.title : undefined} status={status()}
          onReport={reported().length ? () => jumpToReport(reported()) : undefined}>
          <Index each={started()}>{(row) => <AgentRow line id={row().id} title={row().title} state={row().state} activity={row().activity} usage={row().usage}
            time={span(row().startedAt, row().endedAt, now())} onOpen={row().chatId ? () => openAgentChat(row().chatId!) : undefined} />}</Index>
        </AgentSpawn>
      </Show></AgentRows>
  </Show>;
}

/** Background agents' reports that reached the thread together (a "reports" row): one AgentReport line, the join
 *  of their Started line, dropping down each agent's line and what it said (`text`, the transcript's renderer). */
export function TurnReports(props: { reports: Message[]; agents: AgentSummary[]; text: (message: Message) => JSX.Element }) {
  const ids = () => props.reports.map((message) => message.agent!.id!);
  const listed = (message: Message) => props.agents.find((agent) => agent.id === message.agent?.id);
  const state = (message: Message): AgentState => message.sender?.status === "failed" ? "failed" : listed(message)?.status === "stopped" ? "stopped" : "finished";
  return <AgentRows><AgentReport ids={ids()} title={props.reports.length === 1 ? props.reports[0]!.sender?.name : undefined}
    status={together(props.reports.map(state))} onBack={() => jumpToSpawn(ids()[0]!)}>
    <For each={props.reports}>{(message) => {
      const agent = () => listed(message);
      return <AgentReportItem id={message.agent!.id!} title={message.sender?.name || agent()?.title || "Subagent"} state={state(message)}
        time={agent() ? span(agent()!.startedAt, agent()!.endedAt, Date.now()) : undefined}
        usage={agent()?.usage.context ? context(agent()!.usage.context!) : undefined}
        onOpen={agent()?.chatId ? () => openAgentChat(agent()!.chatId!) : undefined}>{props.text(message)}</AgentReportItem>;
    }}</For>
  </AgentReport></AgentRows>;
}

/** A chat's agents on its composer, while they work: Foreground, Background and Runs.
 *  A rider is what is under way, not a history -- one that has ended is in the transcript (its Delegated or Started line,
 *  a background one's report). */
export function RunningAgents(props: { agents: AgentSummary[]; onStop?: (id: string) => void }) {
  const running = createMemo(() => props.agents.filter((agent) => agent.status === "running" && (agent.run || agent.mode === "foreground" || agent.id)));
  // An agent that ends keeps its row while the row closes its room; the rider, when the last has ended, drops back into
  // the composer (the riders' motion, its room closing as it goes: composer.css), held as long.
  const list = createLeavingList(running, (agent) => agent.id || `child:${agent.conversationId}`);
  const rider = createLeaving(running, (agents) => agents.length > 0, undefined, "--duration-gentle");
  const now = useNow(() => running().length > 0);
  const keysOf = (mode: AgentSummary["mode"] | "runs") => list.keys().filter((key) => {
    const agent = list.get(key);
    return mode === "runs" ? Boolean(agent?.run) : !agent?.run && agent?.mode === mode;
  });
  return <Show when={list.keys().length}>
    <AgentRider motion={riderMotion(rider.leaving())}>
      <For each={(["foreground", "background", "runs"] as const).filter((mode) => keysOf(mode).length)}>{(mode) =>
        <AgentRiderGroup label={mode === "foreground" ? "Foreground" : mode === "background" ? "Background" : "Runs"} going={keysOf(mode).every(list.leaving)}>
          <For each={keysOf(mode)}>{(key) => {
            const agent = () => list.get(key)!;
            return <AgentRow line id={mode === "runs" ? undefined : agent().id || undefined} title={agent().run ? `${agent().run!.label} #${agent().run!.number}` : agent().title} state={agent().status} activity={agent().activity || undefined}
              motion={list.leaving(key) ? "leaving" : undefined} time={span(agent().startedAt, agent().endedAt, now())}
              onOpen={agent().chatId ? () => openAgentChat(agent().chatId!) : undefined}
              onStop={mode !== "foreground" && props.onStop && agent().id ? () => props.onStop!(agent().id!) : undefined} stopRoom />;
          }}</For>
        </AgentRiderGroup>}</For>
    </AgentRider>
  </Show>;
}
