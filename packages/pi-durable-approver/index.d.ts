/**
 * pi-durable-approver: an approval model for pi-durable agents. What a tool's own gate or the host holds is judged by a
 * cheap, reasoning-blind classifier against the person's standing policy; what it cannot allow is escalated to the
 * host (a person, usually on their phone). Design: docs/plans/approval-model.md in the Conduit repo.
 *
 * The approver wraps tools (pi-durable `wrapTool`), so it runs inside the tool's own durable task: verdicts are
 * memoised with `api.memo`, and a held action it allows is resumed in the same call.
 */
import type { Context, ToolExecutionApi, ToolExecutionResult, ToolRegistration, Wrap, Extension, JsonObject } from "@earendil-works/pi-durable";
import type { Model } from "@earendil-works/pi-ai";

/** One action held for approval, whatever held it. Data, never instructions. */
export interface HeldAction {
  /** Which holder held it (`executor`, `named`, …). */
  source: string;
  /** The tool the agent called. */
  tool: string;
  /** What it does, as a short path or verb: `gmail.send`, `bash`, `steer_chat`. */
  action: string;
  /** What it sends: the action's own input, canonical (keys sorted, shell split; see canonicalShell). */
  input: JsonObject;
  /** False when it cannot be undone (a send, a delete, a payment); unknown when absent. */
  reversible?: boolean;
  /** Who it reaches, when the holder can tell (addresses, chat ids). */
  recipients?: string[];
  /** How to carry it out once allowed: the tool and arguments to run (Executor: resume with the request id). */
  resume?: { tool: string; arguments: JsonObject };
}

/** The person's standing policy, written by them and stored where the agent cannot write. */
export interface Policy {
  /** Changes whenever the rules change (clears the allow cache). */
  version: string;
  /** Plain-language rules of what the agent may do. */
  may: string[];
  /** Classes that are always the person's to approve. */
  always: string[];
  /** Limits the person stated ("don't email Sam"), kept as policy so compaction cannot drop them. */
  limits?: string[];
  /** Exact actions the person allowed for good (`actionKey` of each). */
  exact?: string[];
}

/** Trusted intent: the person's own words. Never the agent's prose, tool output, mail or web content. */
export interface PersonWords {
  messages: { text: string; at?: string }[];
  /** Their past answers to escalations: the action (as `describeAction`) and what they chose. */
  answers?: { action: string; choice: "allow" | "deny"; reason?: string; at?: string }[];
  /** A task they started, in their words (a run they asked for). */
  task?: string;
}

export type Risk = "low" | "medium" | "high" | "critical";
export type Authorization = "none" | "low" | "medium" | "high";
export type Outcome = "allow" | "deny" | "escalate";

export interface Verdict {
  outcome: Outcome;
  risk: Risk;
  authorization: Authorization;
  /** One sentence; given to the agent on deny, shown to the person on escalation. */
  reason: string;
  /** Where it came from. */
  source: "exact" | "always" | "cache" | "model" | "fallback" | "breaker" | "rule-of-two";
}

/** Outcome by risk × authorisation; critical always escalates whatever the table says. */
export type OutcomeTable = Record<Risk, Record<Authorization, Outcome>>;

/** The host's answer to an escalation. */
export interface Escalation {
  /** allowed: carry it out now; denied: tell the agent; pending: the person will answer later (the host resumes it). */
  status: "allowed" | "denied" | "pending";
  /** What the agent is told (pending: that it waits and must not retry; denied: the person's reason). */
  message?: string;
}

/** A holder decides what is held: before the call (by its arguments) or after it (by its result). */
export interface Holder {
  name: string;
  /** Held before running: the action, or null to let it run. */
  before?(call: { tool: string; arguments: JsonObject }): HeldAction | null;
  /** Held by its result (a tool's own gate answered "approval required"): the action, or null. */
  after?(call: { tool: string; arguments: JsonObject }, result: ToolExecutionResult): HeldAction | null;
}

export interface AuditRecord {
  at: string;
  conversationId: string;
  callId: string;
  held: HeldAction;
  verdict: Verdict;
  escalation?: Escalation["status"];
  attempts: number;
  ms: number;
  model?: string;
}

export interface ApproverOptions {
  /** Extension name (default `approver`). */
  name?: string;
  /** The classifier model; the host's helper model, typically. */
  model(api: ToolExecutionApi): Model<any> | Promise<Model<any>>;
  policy(api: ToolExecutionApi, context: Context): Policy | Promise<Policy>;
  /** The person's words for this call's conversation. */
  words(api: ToolExecutionApi, context: Context): PersonWords | Promise<PersonWords>;
  holders: Holder[];
  /** Find an installed tool by name, to carry out a held action's `resume`. */
  tool(name: string): ToolRegistration | null | undefined;
  escalate(held: HeldAction, verdict: Verdict, api: ToolExecutionApi, context: Context): Promise<Escalation>;
  /**
   * Rule of Two: whether this turn has read untrusted input (mail, web, another's message). With private data
   * touched and an outside action, it escalates whatever the model says. Default: never.
   */
  untrusted?(api: ToolExecutionApi, context: Context): boolean | Promise<boolean>;
  audit?(record: AuditRecord): void;
  table?: OutcomeTable;
  /** Denials before the agent is stopped and the person asked (default 3 in a row, 10 of the last 50). */
  breaker?: { consecutive?: number; window?: number; windowDenials?: number };
  /** Allow-only cache (default 30 min, 500 entries). */
  cache?: { ttlMs?: number; max?: number };
  /** Per classifier attempt (default 20 s) and retries (default 2). */
  timeoutMs?: number;
  retries?: number;
}

export interface Approver {
  /** Wrap these installed tools (those any holder could hold); for a host that builds wraps from its tools. */
  wraps(tools: readonly ToolRegistration[]): Wrap<ToolRegistration>[];
  /** An extension carrying `wraps(tools)`. */
  extension(tools: readonly ToolRegistration[]): Extension;
  /** Judge one held action (exposed for hosts and tests): the verdict, without carrying it out. */
  judge(held: HeldAction, api: ToolExecutionApi, context: Context): Promise<Verdict>;
}

export function createApprover(options: ApproverOptions): Approver;

/** Executor's own gate: `call`/`execute` results that say `approval-required` are held; Allow resumes the request. */
export function executorHolder(options?: { prefix?: string }): Holder;
/** Held by tool name (shell on a device, posting in a chat); `when` narrows by arguments. */
export function namedHolder(tools: string[], options?: { when?(call: { tool: string; arguments: JsonObject }): boolean; reversible?: boolean }): Holder;

/** Default table: low allows; medium allows with medium+ authorisation (none: deny, low: ask); high allows only with high (medium: ask); critical always asks. An action that cannot be undone is never allowed above low risk without high authorisation. */
export const DEFAULT_TABLE: OutcomeTable;
/** A held action's exact key (sha256 of its canonical form), for `Policy.exact` and caches. */
export function actionKey(held: HeldAction): string;
/** A shell command as separate simple commands, env assignments stripped; null when it cannot be read safely. */
export function canonicalShell(command: string): string[] | null;
export function canonicalJson(value: unknown): string;
/** A JSONL audit sink: one file a day under `dir`, kept `keepDays`. */
export function jsonlAudit(dir: string, options?: { keepDays?: number }): (record: AuditRecord) => void;
/** Newest-first records from a `jsonlAudit` directory. */
export function readAudit(dir: string, options?: { limit?: number }): Promise<AuditRecord[]>;
