import { actionKey } from "./key.js";
import { createAllowCache } from "./cache.js";
import { createBreaker } from "./breaker.js";
import { withRetry } from "./retry.js";
import { canonicalShell } from "./shell.js";
import { addUsage, emptyUsage, rate } from "./classifier.js";
import { DEFAULT_TABLE, outcomeOf } from "./table.js";

/*
 * The gate (docs/plans/approval-model.md). It wraps the tools a holder could hold, so it runs inside each call's own
 * durable task: a held action is judged, and carried out, refused or escalated within that call.
 *
 * Order, for one held action:
 *   1. an exact action the person allowed for good: allow;
 *   2. the denial breaker tripped for this conversation: escalate (the agent stops; the person decides);
 *   3. the allow cache (allows only, keyed on the policy's version and the action);
 *   4. the classifier (two passes, reasoning-blind), its rating put through the table;
 *   5. Rule of Two: a turn that read untrusted input never gets an allow for an action that reaches someone or
 *      cannot be undone;
 *   and a judge that fails (down, timed out, malformed) escalates. Nothing here ever turns an error into an allow.
 *
 * Verdicts are memoised per call (`api.memo`), so a replay after a crash neither asks the model again nor decides
 * differently.
 */

// pi-durable's own shapes (harness/define.js, 1.4): a wrap is `{ tool, wrap }` and an extension a plain object. Made
// here rather than imported, so the package resolves wherever it is installed or linked from; peerDependency pins them.
const wrapTool = (tool, wrapper) => ({ tool: tool.name, wrap: wrapper });
const defineExtension = (extension) => extension;

const text = (message, details, isError = true) => ({ output: [{ type: "text", text: message }], isError, details: { approver: details } });
const refusal = (verdict) => `Not approved: ${verdict.reason} Do not work around this or retry it differently; ask the person, or do something their rules allow.`;
const SHELL_TOOLS = new Set(["bash", "shell", "exec", "run"]);

export function createApprover(options) {
  const name = options.name || "approver";
  const table = options.table || DEFAULT_TABLE;
  const cache = createAllowCache(options.cache);
  const breaker = createBreaker(options.breaker);
  // Executor requests this gate has seen, by request id: what became of them, so a resume the agent makes itself
  // cannot carry out what the gate refused or what waits on the person.
  const requests = new Map();
  const remember = (id, value) => {
    requests.delete(id);
    requests.set(id, value);
    // Bounded: the oldest go first (a resume of one that old escalates, as one the gate never saw).
    if (requests.size > 1000) requests.delete(requests.keys().next().value);
  };

  async function judge(held, api, context) {
    const started = Date.now();
    const key = actionKey(held);
    const memoName = `${name}:verdict:${key}`;
    // A replay finds the verdict decided before, and spends nothing again (`usage` is only the first decision's).
    const remembered = await api.memo(memoName, context);
    if (remembered) return { ...remembered, usage: undefined };
    const decided = await decide(held, key, api, context);
    const verdict = await api.memo(memoName, decided.verdict, context);
    breaker.record(String(api.conversationId), verdict.outcome === "deny");
    try {
      options.audit?.({ at: new Date().toISOString(), conversationId: String(api.conversationId), callId: api.callId, held, verdict,
        attempts: decided.attempts, ms: Date.now() - started, ...(decided.model ? { model: decided.model } : {}), ...(decided.usage ? { usage: decided.usage } : {}) });
    } catch {}
    return { ...verdict, usage: decided.usage };
  }

  async function decide(held, key, api, context) {
    const policy = await options.policy(api, context);
    if (policy.exact?.includes(key)) return { verdict: { outcome: "allow", risk: "low", authorization: "high", reason: "You allowed this exact action before.", source: "exact" }, attempts: 0 };
    if (breaker.tripped(String(api.conversationId))) {
      return { verdict: { outcome: "escalate", risk: "high", authorization: "none", reason: "Several of the agent's actions were refused in a row; you decide from here.", source: "breaker" }, attempts: 0 };
    }
    const cacheKey = `${policy.version}:${key}`;
    const cached = cache.get(cacheKey);
    if (cached) return { verdict: cached, attempts: 0 };
    const commands = SHELL_TOOLS.has(held.action) && typeof held.input?.command === "string" ? canonicalShell(held.input.command) : null;
    let model;
    let rating;
    let attempts = 0;
    try {
      model = await options.model(api);
      const words = await options.words(api, context);
      const instructions = await options.instructions?.(api, context);
      const run = await withRetry((signal) => rate({ complete: (...args) => api.models.completeSimple(...args), model, policy, words, held,
        canonicalCommands: commands ?? undefined, instructions, signal }), { timeoutMs: options.timeoutMs, retries: options.retries, signal: api.signal });
      rating = run.value;
      attempts = run.attempts;
    } catch (error) {
      const why = error?.timeout ? "The approval model timed out" : error?.malformed ? "The approval model's answer could not be read" : "The approval model could not be reached";
      return { verdict: { outcome: "escalate", risk: "high", authorization: "none", reason: `${why}, so you decide.`, source: "fallback" }, attempts: error?.attempts ?? attempts, model: model?.id, usage: error?.usage };
    }
    // An unreadable shell command (substitutions, heredocs) is never allowed past low risk on the model's word.
    const unreadable = SHELL_TOOLS.has(held.action) && commands === null;
    let outcome = outcomeOf(rating, held, table);
    if (outcome === "allow" && (rating.truncated || unreadable) && rating.risk !== "low") outcome = "escalate";
    let verdict = { outcome, risk: rating.risk, authorization: rating.authorization, reason: rating.reason, source: "model" };
    if (outcome === "allow" && (held.reversible === false || held.recipients?.length) && await options.untrusted?.(api, context)) {
      verdict = { ...verdict, outcome: "escalate", reason: `${rating.reason} The agent read outside content in this turn, so an action that reaches someone is yours to approve.`, source: "rule-of-two" };
    }
    if (verdict.outcome === "allow") cache.set(cacheKey, verdict);
    return { verdict, attempts, model: model?.id, usage: rating.usage };
  }

  /** Carry out an allowed held action: its own resume, or the call itself. */
  async function carryOut(held, run, api, context) {
    if (!held.resume) return run();
    const target = options.tool(held.resume.tool);
    if (!target) return text(`Approved, but ${held.resume.tool} is not available now; tell the person.`, { held: held.action, outcome: "allow" });
    return target.execute(held.resume.arguments, api, context);
  }

  /** A verdict that is not an allow, as the call's result: refused, or put to the person. */
  async function notAllowed(held, verdict, run, api, context) {
    if (verdict.outcome === "deny") {
      if (held.resume?.arguments?.requestId) await decline(held, api, context);
      return text(refusal(verdict), { held: held.action, verdict });
    }
    const answer = await options.escalate(held, verdict, api, context);
    if (answer.status === "allowed") return carryOut(held, run, api, context);
    if (answer.status === "denied") {
      if (held.resume?.arguments?.requestId) await decline(held, api, context);
      return text(answer.message || "The person declined this. Do not try it another way.", { held: held.action, verdict, escalation: "denied" });
    }
    return text(answer.message || "Waiting for the person's approval. Do not repeat this call; carry on with anything that does not depend on it.",
      { held: held.action, verdict, escalation: "pending" }, false);
  }

  // Executor's held request, refused: tell Executor so it does not wait on it. Best effort.
  async function decline(held, api, context) {
    try { await options.tool(held.resume.tool)?.execute({ requestId: held.resume.arguments.requestId, response: { action: "decline" } }, api, context); } catch {}
  }

  function wrap(target) {
    return wrapTool(target, (tool) => ({
      ...tool,
      execute: async (args, api, context) => {
        const call = { tool: tool.name, arguments: args ?? {} };
        const run = () => tool.execute(args, api, context);
        // What the judge spent goes on the call's result, so pi-durable counts it with the conversation's usage.
        const spent = emptyUsage();
        const charged = (result) => {
          if (!spent.totalTokens && !spent.cost.total) return result;
          return { ...result, usage: addUsage(addUsage(emptyUsage(), result?.usage), spent) };
        };
        const judgeOf = async (held) => { const verdict = await judge(held, api, context); addUsage(spent, verdict.usage); return verdict; };
        for (const holder of options.holders) {
          const held = holder.before?.(call);
          if (!held) continue;
          if (held.action === "executor.resume") return resumeByAgent(held, run, api, context);
          const verdict = await judgeOf(held);
          return charged(verdict.outcome === "allow" ? await run() : await notAllowed(held, verdict, run, api, context));
        }
        const result = await run();
        for (const holder of options.holders) {
          const held = holder.after?.(call, result);
          if (!held) continue;
          const id = held.resume?.arguments?.requestId;
          const verdict = await judgeOf(held);
          if (id) remember(id, { held, outcome: verdict.outcome });
          if (verdict.outcome === "allow") return charged(await carryOut(held, run, api, context));
          const answer = await notAllowed(held, verdict, run, api, context);
          if (id) remember(id, { held, outcome: answer.details?.approver?.escalation === "pending" ? "pending" : answer.isError ? "deny" : "allow" });
          return charged(answer);
        }
        return result;
      },
    }));
  }

  /**
   * The agent resuming an Executor request itself (as Executor's own instructions tell it to). Only a request the
   * gate has not decided goes on, and only as the gate decides it: never around a refusal or a pending approval.
   */
  async function resumeByAgent(held, run, api, context) {
    const known = requests.get(held.input.requestId);
    if (known?.outcome === "allow") return text("This request was already approved and carried out. Do not resume it again.", { held: held.action }, false);
    if (known?.outcome === "pending") return text("This request waits for the person's approval. Do not resume it yourself.", { held: held.action }, false);
    if (known?.outcome === "deny") return text("This request was refused. Do not resume it.", { held: held.action });
    // Unseen (a restart lost the record): only the person can say.
    const verdict = { outcome: "escalate", risk: "high", authorization: "none", reason: "The agent asked to resume an Executor request this gate did not see.", source: "fallback" };
    return notAllowed(held, verdict, run, api, context);
  }

  return {
    wraps: (tools) => tools.map(wrap),
    extension: (tools) => defineExtension({ name, wraps: tools.map(wrap) }),
    judge: (held, api, context) => judge(held, api, context),
  };
}
