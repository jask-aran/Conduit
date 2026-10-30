import { AgentRider, AgentRow, AgentRows, type AgentState } from "@/components/ui";
import { createEffect, createMemo, createSignal, Index, onCleanup, Show } from "solid-js";

import type { AgentSummary, ToolItem } from "../api/contracts";
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
  const background = Boolean(ref.id) || listed?.mode === "background";
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

/** A turn's subagents, pinned under its head: one row per spawn among its tools. */
export function TurnAgents(props: { tools: ToolItem[]; agents: AgentSummary[]; onStop?: (id: string) => void }) {
  const rows = createMemo(() => props.tools.filter(spawned).map((tool) => rowOf(tool, props.agents)));
  const now = useNow(() => rows().some((row) => row.state === "running"));
  return <Show when={rows().length}>
    <AgentRows><Index each={rows()}>{(row) => <AgentRow id={row().id} title={row().title} state={row().state} activity={row().activity} usage={row().usage}
      time={span(row().startedAt, row().endedAt, now())} onOpen={row().chatId ? () => openAgentChat(row().chatId!) : undefined}
      onStop={row().background && row().id && props.onStop ? () => props.onStop!(row().id!) : undefined} />}</Index></AgentRows>
  </Show>;
}

/** Long enough to see how it ended; its report is in the transcript after that. */
const ENDED_SHOWN_MS = 2 * 60_000;

/** A chat's background agents on its composer: those working, and those that ended in the last two minutes. */
export function BackgroundAgents(props: { agents: AgentSummary[]; onStop?: (id: string) => void }) {
  const background = createMemo(() => props.agents.filter((agent) => agent.mode === "background" && agent.id));
  const now = useNow(() => background().some((agent) => agent.status === "running" || (agent.endedAt && Date.now() - Date.parse(agent.endedAt) < ENDED_SHOWN_MS)));
  const shown = createMemo(() => background().filter((agent) => agent.status === "running" || (agent.endedAt && now() - Date.parse(agent.endedAt) < ENDED_SHOWN_MS)));
  return <Show when={shown().length}>
    <AgentRider><Index each={shown()}>{(agent) => <AgentRow line id={agent().id!} title={agent().title} state={agent().status} activity={agent().activity || undefined}
      usage={agent().status !== "running" && agent().usage.context ? context(agent().usage.context!) : undefined} time={span(agent().startedAt, agent().endedAt, now())}
      onOpen={agent().chatId ? () => openAgentChat(agent().chatId!) : undefined} onStop={props.onStop ? () => props.onStop!(agent().id!) : undefined} />}</Index></AgentRider>
  </Show>;
}
