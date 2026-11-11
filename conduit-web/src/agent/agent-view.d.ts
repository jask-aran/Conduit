/* The hub's JavaScript is not checked against these types, so a field added to the builder is added here. */
import type { ApprovalLine } from "../components/ui/approval.tsx";
import type { APPROVAL_CHOICES, PERMISSIONS } from "../approval-api.js";

export type ApprovalAnswer = keyof typeof APPROVAL_CHOICES;

export type AgentDial = "quiet" | "normal" | "chatty";
/** The model and effort a kind of background run uses; null is the home thread's. */
export type AgentWork = { model: string; thinkingLevel: string };
export type AgentWorkKind = "brief" | "heartbeat" | "other";
export type AgentRunKind = "manual" | "schedule" | "checkback" | "brief" | "heartbeat" | "webhook" | "event" | string;
export interface AgentRun { id: string; title: string; kind: AgentRunKind; startedAt?: string; endedAt?: string; status?: string | null; level?: string | null; conversationId: number | null; inboxId?: string | null;
  number?: number | null; label?: string | null; phase?: string; agents?: { running: number; total: number } | null; activity?: string | null; summary?: string | null; woke?: boolean;
  /** null when it used no tools to tell. */
  did?: string | null;
  compaction?: { done: boolean; tokens?: number | null; from?: number | null; enabled?: boolean } | null }
export interface AgentSchedule { id: string; title: string; kind: "once" | "daily" | "every" | string; at?: string; everyMinutes?: number; cadence?: string; nextAt?: string | null; lastAt?: string | null; system?: boolean; routine?: string; task?: string | null; off?: boolean;
  /** `during` is a local "HH:MM-HH:MM" window. */
  rules?: Array<{ kind: string; everyMinutes?: number; at?: string; during: string | null }>;
  feed?: { source: "executor" | "script" | "run"; lastRunAt: string | null; lastCount: number; lastError: string | null; primed: boolean };
  running?: "working" | "compacting";
  compaction?: { at: string; done: boolean; tokens?: number | null; from?: number | null; enabled?: boolean } }
export interface AgentWatch { id: string; kind: "watch" | "webhook"; title: string; event?: string; log?: boolean; lastFiredAt?: string | null }
export interface AgentQuestion { kind: "question"; chatId: string; requestId: string | null; title: string }
export interface AgentProposal { id: string; file: string; op: "add" | "remove" | string; text: string; by?: string; chatId?: string | null; at: string }
export interface AgentInboxEntry { id: string; at: string; kind: AgentRunKind; title: string; subagentId: string; conversationId: number; level: "fyi" | "attention" | "urgent" | "failed"; headline: string; body?: string; feedId?: string; count?: number; status: "unhandled" | "handled"; for?: string[]; handledAt?: string; outcome?: string;
  file?: string }
export interface AgentNotice { id: string; kind: string; text: string; at: string | null; taskId?: number }
export interface AgentAsk { id: string; chatId: string; toolCallId: string; parentCallId: string | null; title: string; service: string | null; lines: ApprovalLine[]; createdAt: string; expiresAt: string; status: "pending" | "allowed" | "declined" | "expired" | "used"; permission?: keyof typeof PERMISSIONS; choices?: ApprovalAnswer[]; /** What Always would allow from now on; null: it is not offered. */ always?: string | null; decidedAt?: string; choice?: ApprovalAnswer }
export interface AgentView {
  enabled: boolean;
  projectId?: string;
  settings?: { name: string; dial: AgentDial; on?: boolean; youAsk?: boolean; toolsDecide?: boolean; remindMinutes?: number; grantHours?: number; budgetUsdPerDay: number; timezone: string; email?: { enabled: boolean }; brief: { enabled: boolean; at: string }; heartbeat: { enabled: boolean; everyMinutes: number }; quietHours: { enabled: boolean; start: string; end: string }; work: Record<AgentWorkKind, AgentWork | null> };
  home?: { chatId: string; conversationId: number } | null;
  sides?: Array<{ chatId: string; title: string; updatedAt?: string }>;
  spentToday?: number;
  asks?: AgentAsk[];
  inbox?: AgentInboxEntry[];
  rules?: Array<{ id: string; tool: string; target: string; label: string; createdAt: string }>;
  attention?: {
    working: { /** What the home thread's turn is doing now, in the turn digest's words ("checking Gmail"); null when idle. */ doing?: string | null; runs: AgentRun[]; recent: AgentRun[]; schedules: AgentSchedule[]; watches: AgentWatch[] };
    needsYou: { asks: AgentAsk[]; questions: AgentQuestion[]; proposals: AgentProposal[]; notices: AgentNotice[] };
  };
}
