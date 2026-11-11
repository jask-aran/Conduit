import { createRoot, createSignal } from "solid-js";
import { api, setJbotHome } from "../api/client";
import { createSingleFlight } from "./single-flight";
import type { AgentNotice, AgentView } from "../../agent/agent-view.js";

export type { AgentDial, AgentWork, AgentWorkKind, AgentRunKind, AgentRun, AgentSchedule, AgentWatch, AgentQuestion, AgentProposal, AgentInboxEntry, AgentNotice, AgentAsk, AgentView } from "../../agent/agent-view.js";

const store = createRoot(() => {
  const [view, setView] = createSignal<AgentView | null>(null);
  let shown = "";
  const read = () => api<AgentView>("/v0/agent")
    // Unchanged, the same object stays, or everything drawn from it redraws each poll.
    .then((next) => { setJbotHome(next.home?.chatId || null); const text = JSON.stringify(next); if (text !== shown) { shown = text; setView(next); } })
    .catch(() => {});
  const refresh = createSingleFlight(async () => { await read(); return view(); });
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
export const agentName = () => store.view()?.settings?.name || "jbot";
export const jbotDoing = () => store.view()?.attention?.working.doing ?? null;
/** Needs you asked for from outside the jbot chat: the jbot chat opens it once drawn. */
const [needsWanted, setNeedsWanted] = createSignal(false);
export const wantNeeds = () => setNeedsWanted(true);
export const takeNeedsWanted = () => { const wanted = needsWanted(); if (wanted) setNeedsWanted(false); return wanted; };
export { needsWanted };

/** The same notice raised again (a routine failing each hour) is one row; dismissing it dismisses every one. */
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
/** A parked task waits for Retry and a connector for connecting, so neither is dismissable. */
export const dismissableNotices = (view = agentView()) => foldNotices(view?.attention?.needsYou?.notices).filter((row) => row.taskId == null && row.kind !== "connector");
export const dismissNotices = async (ids: string[]) => {
  await Promise.all(ids.map((id) => api(`/v0/agent/notices/${encodeURIComponent(id)}`, { method: "DELETE" })));
  await refreshAgent();
};
export const agentNeeds = (view = agentView()) => {
  const needs = view?.attention?.needsYou;
  return needs ? (needs.asks?.length || 0) + needs.questions.length + needs.proposals.length + foldNotices(needs.notices).length : 0;
};
