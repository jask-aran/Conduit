import { createRoot, createSignal } from "solid-js";
import type { ApprovalLine } from "@/components/ui";
import { api, setJbotHome } from "../api/client";

/**
 * The hub's persistent agent as the client sees it (GET /v0/agent, docs/plans/persistent-agent.md): its settings, its
 * threads, what it is doing and what needs the person. One copy for the app: the sidebar's row reads its name and how
 * many things wait; its page reads the rest and refreshes it while open.
 */

export type AgentDial = "quiet" | "normal" | "chatty";
/** The model and effort a kind of background run uses; null is the home thread's. */
export type AgentWork = { model: string; thinkingLevel: string };
export type AgentWorkKind = "brief" | "heartbeat" | "other";
export type AgentRunKind = "manual" | "schedule" | "checkback" | "brief" | "heartbeat" | "webhook" | "event" | string;
/** A run of the roster's, or a routine's firing in its own fork (Reflection: no conversation of its own to open; its
 *  report is the inbox entry `inboxId`). */
export interface AgentRun { id: string; title: string; kind: AgentRunKind; startedAt?: string; endedAt?: string; status?: string; level?: string | null; conversationId: number | null; inboxId?: string | null }
export interface AgentSchedule { id: string; title: string; kind: "once" | "daily" | "every" | string; at?: string; everyMinutes?: number; cadence?: string; nextAt?: string | null; lastAt?: string | null; system?: boolean; routine?: string; task?: string | null; /** A routine switched off: listed, dimmed, with no clock. */ off?: boolean;
  /** A routine with several timing rules: each as it applies now, `during` a local "HH:MM-HH:MM" window or null. */
  rules?: Array<{ kind: string; everyMinutes?: number; at?: string; during: string | null }>;
  /** A feed (feeds.js): what it reads from and how its last run went. */
  feed?: { source: "executor" | "script" | "run"; lastRunAt: string | null; lastCount: number; lastError: string | null; primed: boolean };
  /** A routine under way: its work, or compacting the home thread after it. */
  running?: "working" | "compacting";
  /** How its last compaction step went: done, or not and why (the home thread's tokens, below the size it compacts from). */
  compaction?: { at: string; done: boolean; tokens?: number | null; from?: number | null; enabled?: boolean } }
export interface AgentWatch { id: string; kind: "watch" | "webhook"; title: string; event?: string; log?: boolean; lastFiredAt?: string | null }
export interface AgentQuestion { kind: "question"; chatId: string; requestId: string | null; title: string }
/** A change to its memory a run proposed, waiting for the person (memory.js). */
export interface AgentProposal { id: string; file: string; op: "add" | "remove" | string; text: string; by?: string; chatId?: string | null; at: string }
/** What a run reported (inbox.js): waiting for the heartbeat or the person, or handled, kept a week. */
export interface AgentInboxEntry { id: string; at: string; kind: AgentRunKind; title: string; subagentId: string; conversationId: number; level: "fyi" | "attention" | "urgent" | "failed"; headline: string; body?: string; feedId?: string; count?: number; status: "unhandled" | "handled"; for?: string[]; handledAt?: string; outcome?: string;
  /** Its text as a file in the agent's folder (inbox/…md), which a row opens in the file viewer. */
  file?: string }
export interface AgentNotice { id: string; kind: string; text: string; at: string | null; taskId?: number }
export interface AgentAsk { id: string; chatId: string; toolCallId: string; parentCallId: string | null; title: string; service: string | null; lines: ApprovalLine[]; createdAt: string; expiresAt: string; status: "pending" | "allowed" | "declined" | "expired" | "used"; /** What Always would allow from now on; null: no lasting rule fits. */ always?: string | null; decidedAt?: string; choice?: "allow" | "always" | "deny" }
export interface AgentView {
  enabled: boolean;
  /** Its workspace: its folder, holding its memory files. */
  projectId?: string;
  settings?: { name: string; dial: AgentDial; on?: boolean; youAsk?: boolean; toolsDecide?: boolean; remindMinutes?: number; budgetUsdPerDay: number; timezone: string; email?: { enabled: boolean }; brief: { enabled: boolean; at: string }; heartbeat: { enabled: boolean; everyMinutes: number }; quietHours: { enabled: boolean; start: string; end: string }; work: Record<AgentWorkKind, AgentWork | null> };
  home?: { chatId: string; conversationId: number } | null;
  sides?: Array<{ chatId: string; title: string; updatedAt?: string }>;
  spentToday?: number;
  asks?: AgentAsk[];
  inbox?: AgentInboxEntry[];
  rules?: Array<{ id: string; tool: string; target: string; label: string; createdAt: string }>;
  attention?: {
    working: { runs: AgentRun[]; recent: AgentRun[]; schedules: AgentSchedule[]; watches: AgentWatch[] };
    needsYou: { asks: AgentAsk[]; questions: AgentQuestion[]; proposals: AgentProposal[]; notices: AgentNotice[] };
  };
}

const store = createRoot(() => {
  const [view, setView] = createSignal<AgentView | null>(null);
  let asking: Promise<AgentView | null> | null = null;
  const refresh = () => asking ??= api<AgentView>("/v0/agent")
    // Unchanged, the same object stays: a new one each poll redrew everything drawn from it.
    .then((next) => { setJbotHome(next.home?.chatId || null); if (JSON.stringify(next) !== JSON.stringify(view())) setView(next); return view(); })
    .catch(() => view())
    .finally(() => { asking = null; });
  // Quiet enough to leave running: what waits on the person shows in the sidebar within a minute, and at once on return.
  if (typeof window !== "undefined") {
    window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    window.addEventListener("focus", () => void refresh());
  }
  return { view, refresh };
});

export const agentView = store.view;
export const refreshAgent = store.refresh;
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
