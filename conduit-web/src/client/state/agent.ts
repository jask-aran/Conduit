import { createRoot, createSignal } from "solid-js";
import { api } from "../api/client";

/**
 * The hub's persistent agent as the client sees it (GET /v0/agent, docs/plans/persistent-agent.md): its settings, its
 * threads, what it is doing and what needs the person. One copy for the app: the sidebar's row reads its name and how
 * many things wait; its page reads the rest and refreshes it while open.
 */

export type AgentDial = "quiet" | "normal" | "chatty";
export type AgentRunKind = "manual" | "schedule" | "checkback" | "brief" | "heartbeat" | "webhook" | "event" | string;
export interface AgentRun { id: string; title: string; kind: AgentRunKind; startedAt?: string; endedAt?: string; status?: string; level?: string | null; conversationId: number }
export interface AgentSchedule { id: string; title: string; kind: "once" | "daily" | "every" | string; at?: string; everyMinutes?: number; nextAt?: string | null; lastAt?: string | null; system?: boolean }
export interface AgentWatch { id: string; kind: "watch" | "webhook"; title: string; event?: string; lastFiredAt?: string | null }
export interface AgentQuestion { kind: "question"; chatId: string; requestId: string | null; title: string }
/** A change to its memory a run proposed, waiting for the person (memory.js). */
export interface AgentProposal { id: string; file: string; op: "add" | "remove" | string; text: string; by?: string; chatId?: string | null; at: string }
export interface AgentNotice { id: string; kind: string; text: string; at: string }
export interface AgentView {
  enabled: boolean;
  /** Its workspace: its folder, holding its memory files. */
  projectId?: string;
  settings?: { name: string; dial: AgentDial; budgetUsdPerDay: number; timezone: string; brief: { enabled: boolean; at: string }; heartbeat: { enabled: boolean; everyMinutes: number } };
  home?: { chatId: string; conversationId: number } | null;
  sides?: Array<{ chatId: string; title: string; updatedAt?: string }>;
  spentToday?: number;
  rules?: Array<{ id: string; tool: string; target: string; label: string; createdAt: string }>;
  attention?: {
    working: { runs: AgentRun[]; recent: AgentRun[]; schedules: AgentSchedule[]; watches: AgentWatch[] };
    needsYou: { questions: AgentQuestion[]; proposals: AgentProposal[]; notices: AgentNotice[] };
  };
}

const store = createRoot(() => {
  const [view, setView] = createSignal<AgentView | null>(null);
  let asking: Promise<AgentView | null> | null = null;
  const refresh = () => asking ??= api<AgentView>("/v0/agent")
    // Unchanged, the same object stays: a new one each poll redrew everything drawn from it.
    .then((next) => { if (JSON.stringify(next) !== JSON.stringify(view())) setView(next); return view(); })
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
/** How many things wait on the person: questions, memory to review and notices. */
export const agentNeeds = (view = agentView()) => {
  const needs = view?.attention?.needsYou;
  return needs ? needs.questions.length + needs.proposals.length + needs.notices.length : 0;
};
