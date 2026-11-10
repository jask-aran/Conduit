import { createRoot, createSignal } from "solid-js";
import { api, setJbotHome } from "../api/client";
import { createSingleFlight } from "./single-flight";
import type { AgentNotice, AgentView } from "../../agent/agent-view.js";

/**
 * The hub's persistent agent as the client sees it (GET /v0/agent, docs/plans/persistent-agent.md): its settings, its
 * threads, what it is doing and what needs the person. One copy for the app: the sidebar's row reads its name and how
 * many things wait; its page reads the rest and refreshes it while open. Its types are the hub's (agent/agent-view.d.ts),
 * declared beside the builder that makes it.
 */

export type { AgentDial, AgentWork, AgentWorkKind, AgentRunKind, AgentRun, AgentSchedule, AgentWatch, AgentQuestion, AgentProposal, AgentInboxEntry, AgentNotice, AgentAsk, AgentView } from "../../agent/agent-view.js";

const store = createRoot(() => {
  const [view, setView] = createSignal<AgentView | null>(null);
  let shown = "";
  const read = () => api<AgentView>("/v0/agent")
    // Unchanged, the same object stays: a new one each poll redrew everything drawn from it.
    .then((next) => { setJbotHome(next.home?.chatId || null); const text = JSON.stringify(next); if (text !== shown) { shown = text; setView(next); } })
    .catch(() => {});
  // One read at a time. Asked for while one is under way (after an action, a change the hub pushed), it is read once
  // more after it: whoever waits gets the view as it is after their ask, never the answer to an earlier one.
  const refresh = createSingleFlight(async () => { await read(); return view(); });
  // Quiet enough to leave running: what waits on the person shows in the sidebar within a minute, and at once on return.
  // A change the hub pushes is read only by a page in sight; one out of sight reads on its return.
  if (typeof window !== "undefined") {
    const seen = () => { if (document.visibilityState === "visible") void refresh(); };
    window.setInterval(seen, 60_000);
    window.addEventListener("focus", () => void refresh());
    document.addEventListener("visibilitychange", seen);
    window.addEventListener("conduit:agent-changed", seen);
  }
  return { view, refresh };
});

export const agentView = store.view;
export const refreshAgent = store.refresh;
/** What the agent is called where the person reads it: the name they gave it. */
export const agentName = () => store.view()?.settings?.name || "jbot";
/** What jbot's home thread is doing right now, as the hub says it, or null when it is idle: Working on's first row. */
export const jbotDoing = () => store.view()?.attention?.working.doing ?? null;
/** Needs you asked for from outside the jbot chat (the rail's jbot, its count): the jbot chat opens it once drawn. */
const [needsWanted, setNeedsWanted] = createSignal(false);
export const wantNeeds = () => setNeedsWanted(true);
export const takeNeedsWanted = () => { const wanted = needsWanted(); if (wanted) setNeedsWanted(false); return wanted; };
export { needsWanted };

/** A notice as Needs you shows it: the same one raised again (a routine failing each hour) is one row, counted, its
 *  newest time; dismissing it dismisses every one. */
export interface AgentNoticeRow { key: string; kind: string; text: string; at: string | null; taskId?: number; ids: string[] }
export const foldNotices = (notices: AgentNotice[] = []): AgentNoticeRow[] => {
  const rows = new Map<string, AgentNoticeRow>();
  for (const notice of notices) {
    const key = notice.taskId != null ? `task:${notice.taskId}` : `${notice.kind}:${notice.text}`;
    const row = rows.get(key);
    if (!row) { rows.set(key, { key, kind: notice.kind, text: notice.text, at: notice.at, taskId: notice.taskId, ids: [notice.id] }); continue; }
    row.ids.push(notice.id);
    if ((notice.at || "") > (row.at || "")) row.at = notice.at;
  }
  return [...rows.values()].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
};
/** The notices that only tell (a parked task waits for Retry, a connector for connecting): what Dismiss all clears. */
export const dismissableNotices = (view = agentView()) => foldNotices(view?.attention?.needsYou?.notices).filter((row) => row.taskId == null && row.kind !== "connector");
/** Dismiss notices (every one a row folds), then read the agent again. */
export const dismissNotices = async (ids: string[]) => {
  await Promise.all(ids.map((id) => api(`/v0/agent/notices/${encodeURIComponent(id)}`, { method: "DELETE" })));
  await refreshAgent();
};
/** How many things wait on the person: approvals, questions, memory to review and notices (repeats as one). */
export const agentNeeds = (view = agentView()) => {
  const needs = view?.attention?.needsYou;
  return needs ? (needs.asks?.length || 0) + needs.questions.length + needs.proposals.length + foldNotices(needs.notices).length : 0;
};
