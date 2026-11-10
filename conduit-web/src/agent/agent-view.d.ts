/*
 * The hub's persistent agent as GET /v0/agent and PATCH /v0/agent return it (agent.js view, server/routes/agent.js
 * attention), declared once beside its builder. The client takes these as types (client/state/agent.ts); the hub's
 * JavaScript is not checked against them, so a field added to the builder is added here.
 */
import type { ApprovalLine } from "../components/ui/approval.tsx";
import type { APPROVAL_CHOICES, PERMISSIONS } from "../approval-api.js";

/** An answer to an ask, as declared. */
export type ApprovalAnswer = keyof typeof APPROVAL_CHOICES;

export type AgentDial = "quiet" | "normal" | "chatty";
/** The model and effort a kind of background run uses; null is the home thread's. */
export type AgentWork = { model: string; thinkingLevel: string };
export type AgentWorkKind = "brief" | "heartbeat" | "other";
export type AgentRunKind = "manual" | "schedule" | "checkback" | "brief" | "heartbeat" | "webhook" | "event" | string;
/** A run of the roster's, or a routine's firing in its own fork (Reflection: no conversation of its own to open; its
 *  report is the inbox entry `inboxId`). */
export interface AgentRun { id: string; title: string; kind: AgentRunKind; startedAt?: string; endedAt?: string; status?: string | null; level?: string | null; conversationId: number | null; inboxId?: string | null;
  /** A unit of the work log (work-log.js): what it is doing now, its agents rolled up, what the one working is doing (the
   *  turn digest's words), and once done what it found and whether jbot was told. */
  number?: number | null; label?: string | null; phase?: string; agents?: { running: number; total: number } | null; activity?: string | null; summary?: string | null; woke?: boolean;
  /** What it did, in the turn digest's words ("checked Gmail and searched the web"); null when it used no tools to tell. */
  did?: string | null;
  compaction?: { done: boolean; tokens?: number | null; from?: number | null; enabled?: boolean } | null }
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
export interface AgentAsk { id: string; chatId: string; toolCallId: string; parentCallId: string | null; title: string; service: string | null; lines: ApprovalLine[]; createdAt: string; expiresAt: string; status: "pending" | "allowed" | "declined" | "expired" | "used"; /** The kind of permission asked for, and the answers it offers (approval-api.js). */ permission?: keyof typeof PERMISSIONS; choices?: ApprovalAnswer[]; /** What Always would allow from now on; null: it is not offered. */ always?: string | null; decidedAt?: string; choice?: ApprovalAnswer }
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
    working: { /** What the home thread's turn is doing now, in the turn digest's words ("checking Gmail"); null when idle. */ doing?: string | null; runs: AgentRun[]; recent: AgentRun[]; schedules: AgentSchedule[]; watches: AgentWatch[] };
    needsYou: { asks: AgentAsk[]; questions: AgentQuestion[]; proposals: AgentProposal[]; notices: AgentNotice[] };
  };
}
