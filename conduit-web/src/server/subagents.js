import { listAsks } from "../agent/asks.js";
import { notice, stopPending, submitWithNotes } from "../context/notices.js";
import { Type } from "@earendil-works/pi-ai";
import { AgentDoc as PiAgentDoc, configure, defineDoc, defineExtension, defineTask, defineTool, LiveDoc, UsageDoc, watchEvents } from "@earendil-works/pi-durable";
import { AgentDoc } from "../agent/agent-doc.js";
import { appendEntry, headlineOf, RunEnd } from "../agent/inbox.js";

const SubagentRoster = defineDoc({
  checkpointWhen: () => false, kind: "conduit.subagents", version: 1, scope: "conversation", history: "latest", fork: "initial",
  initial: () => ({ next: 1, children: {} }),
});
const runLabel = (kind) => ({ heartbeat: "Heartbeat", brief: "Morning brief", "morning-brief": "Morning brief",
  "check-back": "Check-back", checkback: "Check-back", webhook: "Webhook", manual: "Run" })[kind]
  || kind.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
// An agent's key is its own and never reused (`key`; older agents' were their label); its label -- bg-3, fg-2, a run's
// Heartbeat #4 -- is a name only, counted from 1 each local day. A label still running is skipped, so the model never
// has two agents of one name to address.
const today = () => { const at = new Date(); return `${at.getFullYear()}-${at.getMonth() + 1}-${at.getDate()}`; };
const nextNumber = (roster, counter, taken = () => false) => {
  if (roster.day !== today()) { roster.day = today(); roster.counts = {}; }
  roster.counts ||= {};
  let number = roster.counts[counter] || 0;
  do number += 1; while (taken(number));
  roster.counts[counter] = number;
  return number;
};
const nextKey = (roster) => `k${roster.serial = (roster.serial || 0) + 1}`;
const runningLabels = (roster) => new Set([...Object.values(roster.children), ...Object.values(roster.nested || {})]
  .filter((item) => item.status === "running").map((item) => item.id));
const nextLabel = (roster, prefix) => { const taken = runningLabels(roster); return `${prefix}-${nextNumber(roster, prefix, (n) => taken.has(`${prefix}-${n}`))}`; };
/** The agent a label names: by its key, else the running one of that label, else the latest. */
export const findSubagent = (items, id) => {
  const named = items.filter((item) => item.id === id);
  return items.find((item) => item.key === id) || named.find((item) => item.status === "running") || named.at(-1);
};
const nextRun = (roster, origin, trigger = null) => {
  if (!origin?.kind) return null;
  const kind = origin.kind;
  const number = nextNumber(roster, `run:${kind}`);
  return { routine: kind, label: runLabel(kind), number, trigger: trigger ?? origin.trigger ?? (kind === "webhook" ? "Webhook" : null) };
};
const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
const addUsage = (total, usage) => {
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "cacheWrite1h", "reasoning"]) {
    if (usage[key] != null) total[key] = (total[key] || 0) + usage[key];
  }
  for (const key of Object.keys(total.cost)) total.cost[key] += usage.cost?.[key] || 0;
  return total;
};
export const subagentTitle = (task) => String(task || "").trim().split(/\r?\n/)[0].trim().replace(/\s+/g, " ").slice(0, 80);
const totalUsage = (state) => [...Object.values(state?.models || {}), ...Object.values(state?.tools || {})]
  .reduce((total, usage) => addUsage(total, usage), emptyUsage());
const textResult = (text) => ({ output: [{ type: "text", text }] });
/**
 * What the `subagent` tool lets one conversation start (roadmap #28), generous so that only a runaway meets them:
 * foreground agents at once (a codemode Promise.all included), background agents running at once, model turns per
 * task given to a child, and characters of an answer handed back. `runtime.subagentLimits` overrides any of them.
 * Runs the persistent agent starts (`spawnBackground`) are the app's, not the model's: they meet the turn and output
 * limits but never count toward, or are refused by, the two concurrency limits.
 */
export const SUBAGENT_LIMITS = Object.freeze({ concurrent: 16, background: 10, iterations: 400, outputChars: 100000 });
export class SubagentLimitError extends Error {
  constructor(limit, message) { super(message); this.name = "SubagentLimitError"; this.limit = limit; }
}
/** An answer cut to `max` characters, saying it was. */
export const capOutput = (text, max) => {
  const value = String(text ?? "");
  if (!(max > 0) || value.length <= max) return value;
  return `${value.slice(0, max)}\n\n[Subagent output limit: showing ${max} of ${value.length} characters.]`;
};
const iterationStop = (max) => `The subagent was stopped: it reached the iteration limit (${max} model turns for one task).`;
/**
 * How much a run's report matters, from its answer's first word (templates/agent/SYSTEM.md): NOTHING (or OpenClaw's
 * HEARTBEAT_OK) is none, then FYI, ATTENTION and URGENT; an answer that says none of them is ATTENTION.
 */
export const reportLevel = (answer) => {
  const word = String(answer || "").trim().match(/^\W*([A-Z_]+)/)?.[1] || "";
  return word === "NOTHING" || word === "HEARTBEAT_OK" ? "none" : word === "FYI" ? "fyi" : word === "URGENT" ? "urgent" : "attention";
};
/** A gated run's level: how it ended by tool (quiet, failed), or else its answer's first word. */
const runLevel = (report, end) => end?.outcome === "quiet" ? "none"
  : end?.outcome === "failed" || report.status === "failed" ? "failed" : reportLevel(report.answer);
const LEVELS = ["none", "fyi", "attention", "urgent"];
/** The least a report must matter to reach the person, by their interruption setting. */
const THRESHOLD = { quiet: "urgent", normal: "attention", chatty: "fyi" };
export const reaches = (level, dial = "normal") => LEVELS.indexOf(level === "failed" ? "attention" : level) >= LEVELS.indexOf(THRESHOLD[dial] || "attention");
const aborted = async (task, api, context) => {
  await api.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
};

/** A conversation's background subagents, as `{ id, title, child, anchor, status }`. */
export async function backgroundSubagents(harness, conversationId, context) {
  return Object.values((await harness.snapshot(SubagentRoster, conversationId, context))?.children || {});
}

/** Foreground subagents a codemode script spawned: no top-level call names them, so the roster does (`nested`). */
export async function nestedSubagents(harness, conversationId, context) {
  return Object.values((await harness.snapshot(SubagentRoster, conversationId, context))?.nested || {});
}

/** Stop a conversation's background subagents: its chat is going, and a late report would start a turn no one sees. */
export async function stopBackgroundSubagents(harness, conversationId, context) {
  for (const item of await backgroundSubagents(harness, conversationId, context)) {
    await harness.abortTask(item.anchor, context).catch(() => {});
    await harness.waitForTask(item.anchor, context).catch(() => {});
  }
}

/** The HTTP stop and the tool use the same durable anchor cancellation. */
export async function stopBackgroundSubagent(harness, conversationId, id, context) {
  const item = findSubagent(await backgroundSubagents(harness, conversationId, context), id);
  // A stop tool may have committed its status before it could cancel the durable anchor.
  if (!item || (item.status !== "running" && item.status !== "stopped")) return false;
  await harness.abortTask(item.anchor, context);
  await harness.waitForTask(item.anchor, context);
  return true;
}

/**
 * Delegation (plan decision 10, the thread subagent): `subagent` hands a
 * self-contained task to a child conversation that starts as a copy of this
 * one's agent (model, tools, folder or devices) without `subagent`, so it does
 * not delegate again, and without the question card, which no one is watching
 * it on. The call's details name the child, for a reader that wants its work.
 *
 * In the foreground (the default) the child is owned by the call, as
 * pi-durable's own subagent pattern has it: stopping the turn stops the child,
 * the turn is idle only once the child is, and a restart reruns the call, which
 * finds the same child and submission rather than starting another. Its spend
 * comes back as the call's `usage`, so the parent's ledger counts it.
 *
 * In the background (pi-durable's background pattern) the child is owned by an
 * anchor task the parent conversation owns, so the parent's Esc and idle never
 * reach it, and stays to be messaged again until stopped or the parent resets.
 * Each message is delivered by a reporter task the anchor owns, which posts the
 * answer back to the parent (`conduit.subagent-report`, a short
 * harness row in the transcript); request ids keep a restart from sending a
 * message or a report twice. Its spend stays in the child's own ledger, which
 * the chat's totals add (`backgroundSubagents`): pi-durable's ledger is its own.
 */
export function Subagents(runtime) {
  const limits = () => ({ ...SUBAGENT_LIMITS, ...runtime.subagentLimits });
  // Foreground calls running per conversation, by call task id (a replayed call is the same one, so is counted once).
  const foregroundRuns = new Map();
  // `onLimit`: the child began more model turns for this task than `iterations` allows; it is stopped, and told once.
  // Counted while observed, so a restart counts afresh: the limit catches a runaway, it is not an exact budget.
  const observe = async (parent, child, api, context, foreground = false, onLimit = null) => {
    const signal = context.abortSignal;
    const maxTurns = limits().iterations;
    let turns = 0;
    const stream = await watchEvents(runtime.harness, child, context);
    runtime.subagentObservers ||= new Map();
    const observers = runtime.subagentObservers.get(child) || new Set();
    runtime.subagentObservers.set(child, observers);
    let stopped = null;
    let last = 0;
    let previous = null;
    let pending = null;
    let flush = null;
    const output = () => {
      flush = null;
      if (signal?.aborted || pending.key === previous) return;
      api.output(`${pending.line}\n`);
      previous = pending.key;
      last = Date.now();
    };
    const step = (event) => {
      if (stopped || signal?.aborted) return;
      if (event.type === "turn_start" && onLimit && maxTurns > 0 && ++turns > maxTurns) {
        const tell = onLimit;
        onLimit = null;
        tell(maxTurns);
        void runtime.harness.conversation(child, context).then((conversation) => conversation.abort(context)).catch(() => {});
        return;
      }
      const line = runtime.subagentStep?.(event);
      if (!line) return;
      runtime.subagentActivity ||= new Map();
      runtime.subagentActivity.set(child, line);
      const key = event.type === "tool_execution_start" ? event.toolCallId || line : line;
      if (foreground && key !== previous) {
        pending = { key, line };
        if (Date.now() - last >= 500) { clearTimeout(flush); output(); }
        else if (!flush) flush = setTimeout(output, 500 - (Date.now() - last));
      }
    };
    const calls = stream.snapshot.entries.flatMap((entry) => Array.isArray(entry.model?.[0]?.content) ? entry.model[0].content : []).filter((part) => part.type === "toolCall");
    for (const tool of stream.snapshot.tools) if (tool.status !== "done") {
      step({ type: "tool_execution_start", toolName: tool.name, args: calls.find((call) => call.id === tool.callId)?.arguments || {} });
    }
    if (stream.snapshot.generation?.message) step({ type: "message_update", changes: [{ type: "text_delta" }] });
    stream.start(async (events) => { for (const event of events) step(event); });
    const timer = setInterval(() => runtime.subagentsChanged?.(parent, true), 2000);
    timer.unref?.();
    if (foreground) runtime.subagentsChanged?.(parent, { conversationId: child, status: "running" });
    const unobserve = () => {
      if (stopped) return stopped;
      clearInterval(timer);
      clearTimeout(flush);
      signal?.removeEventListener("abort", onAbort);
      observers.delete(unobserve);
      if (!observers.size) {
        runtime.subagentObservers.delete(child);
        runtime.subagentActivity?.delete(child);
      }
      stopped = stream.stop();
      return stopped;
    };
    const onAbort = () => { void unobserve().catch(() => {}); };
    observers.add(unobserve);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    return unobserve;
  };
  const resetSince = async (conversation, sinceEntry, context) => {
    if (!conversation) return true;
    let cursor;
    do {
      const page = await conversation.entries({ minEntryId: sinceEntry + 1 }, 50, cursor, context);
      if (page.items.some((entry) => entry.kind === "pi.reset")) return true;
      cursor = page.next;
    } while (cursor);
    return false;
  };
  const anchor = defineTask({
    name: "conduit.subagent-anchor", version: 1, initial: () => ({ phase: "hold" }),
    phases: { hold: async (task, api, context) => {
      const harness = runtime.harness;
      const stop = () => { void harness.abortTask(task.id, context).catch((error) => { if (!api.signal.aborted) api.report(error); }); };
      // Reset ends this child's context lease; ordinary Esc still leaves it alone.
      const unsubscribe = harness.subscribeCommits((publication) => {
        if (publication.changes.some((change) => change.type === "entry"
          && change.value.conversationId === api.conversationId && change.value.kind === "pi.reset")) stop();
      });
      try {
        const parent = await harness.conversation(api.conversationId, context);
        if (await resetSince(parent, task.input.sinceEntry || 0, context)) stop();
        // Held, not asleep: a durable sleep would end the phase and with it the watch for a reset. A day, then again.
        await new Promise((resolve) => {
          const disarm = api.setTimer(resolve, 86400000);
          api.signal.addEventListener("abort", () => { disarm(); resolve(undefined); }, { once: true });
        });
        if (api.signal.aborted) return;
        await api.commit(() => ({ status: "pending", checkpoint: { phase: "hold" } }), context);
      } finally { unsubscribe(); }
    } },
    abort: async (task, api, context) => {
      await api.commit(async (tx) => {
        const item = (await tx.doc(SubagentRoster, api.conversationId)).children[task.input.id];
        item.status = "stopped";
        item.endedAt = new Date().toISOString();
        return { status: "terminal", outcome: { status: "aborted" } };
      }, context);
      const item = (await backgroundSubagents(runtime.harness, api.conversationId, context)).find((item) => (item.key || item.id) === task.input.id);
      if (item) runtime.subagentsChanged?.(api.conversationId, { conversationId: item.child, status: "stopped" });
    },
  });
  const reporter = defineTask({
    name: "conduit.subagent-reporter", version: 1, initial: () => ({ phase: "deliver" }),
    phases: { deliver: async (task, api, context) => {
      const { id, child, title, content, mode, number } = task.input;
      // `id` is the agent's key in the roster; what the thread and the person call it is its label.
      const label = (await api.snapshot(SubagentRoster, api.conversationId, context))?.children[id]?.id || id;
      const handle = await api.conversation(child, context);
      const requestId = `subagent-message:${child}:${number}`;
      let unobserve = async () => {};
      let limited = null;
      try {
        unobserve = await observe(api.conversationId, child, api, context, false, (max) => { limited = max; });
        const settled = await (await submitWithNotes(runtime, await runtime.harness.conversation(child, context), { type: "input", content, whenBusy: mode, requestId,
          entry: { kind: "conduit.user", data: { messageId: requestId, text: content, timestamp: new Date().toISOString() } } }, context, { opensWithTime: Boolean(task.input.gate), admit: (input) => handle.submit(input, context) })).wait(context);
        const conversation = await runtime.harness.conversation(child, context);
        const answerEntry = settled.status === "done" ? (await conversation.entries({ minEntryId: settled.answer,
          maxEntryId: settled.answer }, 1, undefined, context)).items[0] : null;
        const answer = limited ? iterationStop(limited) : (answerEntry?.model?.[0]?.content || []).filter((part) => part.type === "text").map((part) => part.text).join("")
          || (settled.status === "done" ? "(The subagent finished without a reply.)" : `The subagent did not finish (${settled.status}).`);
        // Persist the answer before submitting it, so a replay cannot pick up a later answer.
        const report = await api.memo("report", { answer: capOutput(answer, limits().outputChars),
          status: settled.status === "done" && !limited ? "finished" : "failed" }, context);
        const endedAt = task.input.gate ? await api.memo("endedAt", new Date().toISOString(), context) : null;
        let stopped = false;
        let changed = false;
        await api.commit(async (tx) => {
          const roster = await tx.doc(SubagentRoster, api.conversationId);
          const item = roster.children[id];
          if (task.input.gate && !item.run) item.run = nextRun(roster, task.input.origin);
          stopped = item.status === "stopped";
          if (!stopped && item.number === number) {
            changed = item.status !== report.status;
            item.status = report.status;
            item.endedAt = task.input.gate ? item.endedAt || endedAt : new Date().toISOString();
          }
        }, context);
        if (changed) runtime.subagentsChanged?.(api.conversationId, { conversationId: child, status: report.status });
        // The agent's runs: what they spent counts toward its day, and what they found goes to its inbox (inbox.js).
        const end = task.input.gate ? await api.memo("end", (await api.snapshot(RunEnd, child, context))?.end || null, context) : null;
        const level = task.input.gate ? runLevel(report, end) : null;
        if (task.input.gate && !task.input.origin?.test) {
          const spent = totalUsage(await api.snapshot(UsageDoc, child, context)).cost.total;
          const day = await api.memo("day", runtime.agentDay?.() || new Date().toISOString().slice(0, 10), context);
          await api.commit(async (tx) => {
            const item = (await tx.doc(SubagentRoster, api.conversationId)).children[id];
            if (item.counted?.includes(number)) return;
            item.counted = [...(item.counted || []), number];
            item.level = level;
            const doc = await tx.doc(AgentDoc);
            doc.spend[day] = (doc.spend[day] || 0) + spent;
          }, context);
        }
        // Told at once: what was asked for (a brief, a task the person started, the heartbeat's decision), what is
        // urgent, and a run that left something to approve, whose asks show under its report. The rest waits in the
        // inbox for the heartbeat, or for the person to talk to jbot first.
        const kind = task.input.origin?.kind;
        // Where its report goes: a routine says (output jbot, inbox or both); before routines, by kind.
        const output = task.input.origin?.output;
        const asked = (output ? output !== "inbox" : ["brief", "manual", "heartbeat"].includes(kind)) && level !== "none";
        const waiting = task.input.gate && !task.input.origin?.test ? await api.memo("waiting", Object.values((await api.snapshot(AgentDoc, context))?.asks || {})
          .filter((ask) => ask.status === "pending" && String(ask.sourceConversationId) === String(child)).length, context) : 0;
        const heard = !task.input.gate || await api.memo("heard", level !== "none" && (asked || waiting > 0 || level === "urgent"), context);
        // Only what waits: the inbox collects for the heartbeat (and the brief), so a report the person was told at once
        // (the brief itself, a task they started, anything urgent) goes to the home thread alone.
        if (task.input.gate && !task.input.origin?.test && level !== "none" && kind !== "heartbeat" && (!heard || output === "both")) {
          const at = await api.memo("entryAt", new Date().toISOString(), context);
          await api.commit(async (tx) => {
            appendEntry(await tx.doc(AgentDoc), { key: `${child}:${number}`, kind, title, subagentId: label, conversationId: child, level,
              headline: headlineOf(level === "failed" && end?.reason ? end.reason : report.answer),
              status: "unhandled" }, Date.parse(at));
          }, context);
        }
        if (task.input.gate && !heard && !stopped) {
          const snapshot = kind === "heartbeat" && !task.input.origin?.test ? await api.snapshot(AgentDoc, context) : null;
          const counts = await api.memo("beat", {
            handled: Object.values(snapshot?.inbox || {}).filter((item) => String(item.handledBy) === String(child)).length,
            set: Object.values(snapshot?.schedules || {}).filter((item) => String(item.by) === String(child)).length,
            at: new Date().toISOString(),
          }, context);
          await api.commit(async (tx) => {
            const item = (await tx.doc(SubagentRoster, api.conversationId)).children[id];
            if (item.status === "stopped" || item.quietLine) return;
            let cursor;
            do {
              const page = await tx.scanEntries({ conversationId: api.conversationId, minEntryId: (task.input.sinceEntry || 0) + 1 }, 100, cursor);
              if (page.items.some((entry) => entry.kind === "pi.reset")) return;
              if (page.items.some((entry) => entry.kind === "conduit.agent-beat" && String(entry.data?.conversationId) === String(child))) {
                item.quietLine = true;
                return;
              }
              cursor = page.next;
            } while (cursor);
            item.quietLine = true;
            const reason = end?.reason || (report.status === "failed" ? headlineOf(report.answer) : null);
            const summary = level === "failed" ? `failed${reason ? `: ${reason}` : ""}`
              : counts.handled || counts.set ? [counts.handled && `handled ${counts.handled}`, counts.set && `set ${counts.set}`].filter(Boolean).join(" · ")
              : level === "none" ? "nothing new" : headlineOf(report.answer);
            await tx.appendEntry(api.conversationId, { kind: "conduit.run-quiet", data: { messageId: `run-quiet:${child}:${item.run?.number ?? number}`, subagentId: label,
              conversationId: child, title, run: { ...item.run, woke: false, status: report.status, startedAt: item.startedAt, endedAt: item.endedAt, summary },
              level, timestamp: counts.at } });
          }, context);
        }
        const parent = await runtime.harness.conversation(api.conversationId, context);
        if (heard && !stopped && !await resetSince(parent, task.input.sinceEntry || 0, context)) {
          const requestId = `subagent-report:${child}:${number}`;
          const handle = await api.conversation(api.conversationId, context);
          // A run's report comes with the decision it asks of jbot (SYSTEM.md, When a run reports): told bare, jbot
          // acknowledged it ("Noted. …") instead of choosing. The thread shows both, the addition apart.
          // What the run left waiting on the person's approval, said by the hub rather than left to the run's own words: a
          // run that asked and ended often never mentioned it.
          const waiting = task.input.gate && runtime.agent ? await api.memo("waitingAsks", listAsks(await runtime.agent.state())
            .filter((ask) => ask.status === "pending" && ask.run === String(child)).map((ask) => `• ${ask.title} (ask ${ask.id})`), context) : [];
          const answer = waiting.length ? `${report.answer}\n\nWaiting on the person's approval (they have been notified):\n${waiting.join("\n")}` : report.answer;
          const content = await notice(runtime.contextStore, task.input.gate ? (kind === "brief" || kind === "morning-brief" ? "report-brief" : "report-run") : "report-subagent", { report: answer, title });
          const at = content.indexOf(answer);
          const appended = task.input.gate && at >= 0 ? content.slice(at + answer.length) : null;
          const item = (await api.snapshot(SubagentRoster, api.conversationId, context)).children[id];
          const data = { subagentId: label, conversationId: child, title, status: report.status, messageId: requestId, report: answer, ...(appended ? { appended } : {}),
            ...(item.run ? { run: { ...item.run, startedAt: item.startedAt, endedAt: item.endedAt } } : {}),
            ...(task.input.origin ? { origin: task.input.origin, level } : {}) };
          // A Stop leaves a chat's background agents working, but meant stop: until the person speaks again a report is kept
          // -- written to the thread without a turn, for the next turn to read -- whether it waited in the stopped turn
          // (a Stop withdraws what waits) or came after.
          // A run of the persistent agent's (`gate`: heartbeat, brief, check-back) is the app's, not the thread's: a Stop
          // there never quiets it.
          const quiet = await api.memo("quiet", !task.input.gate && await stopPending(runtime, parent, context), context);
          let kept = quiet;
          if (!quiet) {
            const submitted = await submitWithNotes(runtime, parent, { type: "input", whenBusy: task.input.gate ? "followUp" : "steer", requestId,
              content, entry: { kind: "conduit.subagent-report", data } }, context, { admit: (input) => handle.submit(input, context) });
            if (item.run) {
              await api.commit(async (tx) => { (await tx.doc(SubagentRoster, api.conversationId)).children[id].heard = true; }, context);
              runtime.subagentsChanged?.(api.conversationId, { conversationId: child, status: report.status, woke: true });
            }
            // The parent may have no live chat (an agent's home thread nobody has open): the report's turn is followed.
            runtime.wakeChat?.(api.conversationId);
            const settled = await submitted.wait(context);
          kept = settled.status === "unanswered" && settled.reason === "aborted" && settled.entry === undefined;
          }
          if (kept && task.input.gate) {
            // A Stop in the home thread withdrew a run's report that waited there: the run is the app's, so it is given
            // again, to wake jbot once the stopped turn has ended.
            await submitWithNotes(runtime, parent, { type: "input", whenBusy: "followUp", requestId: `${requestId}:again`,
              content, entry: { kind: "conduit.subagent-report", data: { ...data, messageId: `${requestId}:again` } } }, context, { admit: (input) => handle.submit(input, context) });
            runtime.wakeChat?.(api.conversationId);
          } else if (kept) {
            // A Stop withdraws a waiting report before its run has ended; written while that run winds down, the report
            // would queue behind it until the person next speaks. It is written once the run is over.
            for (let tries = 0; tries < 100 && (await api.snapshot(LiveDoc, api.conversationId, context)).run; tries++) {
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            const timestamp = await api.memo("keptAt", Date.now(), context);
            await (await handle.submit({ type: "write", requestId: `${requestId}:kept`, entry: { kind: "conduit.subagent-report",
              data: { ...data, messageId: `${requestId}:kept`, kept: true }, model: [{ role: "user", content, timestamp }] } }, context)).wait(context);
          }
          // The person's devices hear of it only if jbot decides they should (`message` with notify); approvals push on their own.
        }
        await api.commit(() => ({ status: "terminal", outcome: { status: "completed", result: report } }), context);
      } catch (error) {
        let changed = false;
        if (!api.signal.aborted) await api.commit(async (tx) => {
          const item = (await tx.doc(SubagentRoster, api.conversationId)).children[id];
          if (item.number === number && item.status !== "stopped") {
            changed = item.status !== "failed";
            item.status = "failed";
            if (!task.input.gate || !item.endedAt) item.endedAt = new Date().toISOString();
          }
        }, context);
        if (changed) runtime.subagentsChanged?.(api.conversationId, { conversationId: child, status: "failed" });
        throw error;
      } finally { await unobserve(); }
    } },
    abort: aborted,
  });
  // The child starts as a copy of its parent's agent (pi-durable copies the owner's `pi.agent`); it loses only
  // delegation and the question card. Edited in place on the copy: `configure`'s `{ remove }` would replace the copied
  // lists with "the host's default selection less these" -- every extension and tool the hub has, jbot's included.
  const stripTools = async (tx, child) => {
    const gone = new Set(["subagent", "ask_user", "ui"]);
    // Nor the hub's browser: one page, the person's, and children working in parallel would fight over it.
    const extensions = [extension.name, "browser"];
    const agent = await tx.doc(PiAgentDoc, child);
    if (Array.isArray(agent.extensions)) agent.extensions = agent.extensions.filter((name) => !extensions.includes(name));
    else agent.extensions = { ...agent.extensions, remove: [...new Set([...(agent.extensions?.remove || []), ...extensions])] };
    if (Array.isArray(agent.tools)) agent.tools = agent.tools.filter((name) => !gone.has(name));
    else agent.tools = { remove: [...new Set([...(agent.tools?.remove || []), ...gone])] };
    if (Array.isArray(agent.modelTools)) agent.modelTools = agent.modelTools.filter((name) => !gone.has(name));
  };
  const subagent = defineTool({
    name: "subagent",
    description: "Delegate a self-contained task with your tools and workspace but no conversation history. "
      + "Default: wait for its answer; Esc stops it. Prefer this: the answer comes back inside your turn. For several at once, "
      + "spawn them in parallel from one codemode script (Promise.all) rather than as background children. "
      + "Use background:true only when the work should outlive your turn; it returns an id immediately and reports the answer "
      + "back to you while you can go idle; parent Esc leaves it running. Children cannot delegate or ask the user. "
      + "Manage your background children with action:list, message (id, task, mode:steer or followUp), wait (id), or stop (id). "
      + "Message sends new work and returns immediately; wait returns the latest delivery. stop ends the child and its reporters. "
      + "Give each spawn a short name (2-4 words, such as Ryokan research) so the person can tell your agents apart. "
      + "Limits (a refusal names the one hit): concurrent foreground agents, background agents running at once, "
      + "model turns per task, and answer length.",
    parameters: Type.Object({
      task: Type.Optional(Type.String({ description: "The whole task or message: goal, context, constraints, and what to report back." })),
      name: Type.Optional(Type.String({ description: "On spawn: what the person sees this agent called, 2-4 words." })),
      background: Type.Optional(Type.Boolean()),
      action: Type.Optional(Type.Union(["spawn", "list", "message", "wait", "stop"].map((value) => Type.Literal(value)))),
      id: Type.Optional(Type.String({ description: "This conversation's background subagent id, such as bg-3." })),
      mode: Type.Optional(Type.Union([Type.Literal("steer"), Type.Literal("followUp")])),
    }),
    replay: "safe",
    execute: async ({ task, name, background = false, action = "spawn", id, mode = "followUp" }, api, context) => {
      // Its name: the one the model gave it, else the task's first words.
      const titled = () => typeof name === "string" && name.trim() ? name.trim().slice(0, 60) : subagentTitle(task);
      if (action === "list") {
        const roster = await api.snapshot(SubagentRoster, api.conversationId, context);
        return textResult(Object.entries(roster?.children || {}).map(([key, item]) => `${key}: ${item.status}: ${item.title}`).join("\n") || "No background subagents.");
      }
      if ((action === "spawn" || action === "message") && typeof task !== "string") throw new Error("subagent requires task for spawn or message.");
      // A spawn from inside a codemode script is the same spawn: the roster notes the script's call (`via`, the model's
      // call id, before any nested key) so the turn draws its agent row under that call, as for a direct one.
      const own = action === "spawn" ? await api.getTask(api.taskId, context) : null;
      const via = own?.input?.kind === "nested" && own.input.parentCallId ? String(own.input.parentCallId).split("/")[0] : null;
      // A child of the persistent agent's threads is a run like any other: RUN.md is its prompt, not jbot's.
      const runPrompt = action !== "spawn" ? "" : await api.memo("runPrompt", context)
        ?? await api.memo("runPrompt", (await runtime.agentRunPrompt?.(api.conversationId)) || await runtime.contextStore?.assemble("subagent") || "", context);
      const childSettings = action !== "spawn" ? null : (await api.memo("childSettings", context)
        ?? await api.memo("childSettings", { value: await runtime.subagentSettings?.(api.conversationId, context) || null }, context)).value;
      if (action === "spawn" && !background) {
        // A foreground agent has an id too (fg-1, as background ones are bg-1), so every agent is named in one place;
        // the model never addresses it: its turn waits for the answer.
        const running = foregroundRuns.get(api.conversationId) || new Set();
        foregroundRuns.set(api.conversationId, running);
        const { child, agentId } = await api.commit(async (tx) => {
          const roster = await tx.doc(SubagentRoster, api.conversationId);
          roster.foreground ||= {};
          const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
          if (existing !== undefined) { running.add(api.taskId); return { child: existing.id, agentId: roster.foreground[existing.id] ?? null }; }
          const { concurrent } = limits();
          if (!running.has(api.taskId) && running.size >= concurrent) {
            throw new SubagentLimitError("concurrent", `Subagent limit reached: concurrent foreground subagents (${concurrent}). `
              + `${running.size} are already running in this conversation; wait for them to finish, then spawn the rest.`);
          }
          running.add(api.taskId);
          const created = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
          await stripTools(tx, created.id);
          if (runPrompt) await configure(tx, created.id, { instructions: runPrompt });
          if (childSettings) await configure(tx, created.id, childSettings);
          const agentId = nextLabel(roster, "fg");
          roster.foreground[created.id] = agentId;
          return { child: created.id, agentId };
        }, context).catch((error) => {
          running.delete(api.taskId);
          throw error;
        });
        let limited = null;
        let unobserve = async () => {};
        try {
          const title = titled();
          const startedAt = await api.memo("startedAt", new Date().toISOString(), context);
          await api.details({ conversationId: child, subagentId: agentId, title, startedAt }, context);
          const noteNested = async (fields) => {
            if (!via) return;
            await api.commit(async (tx) => {
              const roster = await tx.doc(SubagentRoster, api.conversationId);
              roster.nested ||= {};
              roster.nested[child] = { ...roster.nested[child], id: agentId, conversationId: child, title, via, startedAt, ...fields };
              return undefined;
            }, context);
            runtime.subagentsChanged?.(api.conversationId, { conversationId: child, status: fields.status });
          };
          await noteNested({ status: "running", endedAt: null });
          await runtime.ensureSubagent?.(api.conversationId, { conversationId: child, id: agentId, title });
          unobserve = await observe(api.conversationId, child, api, context, true, (max) => { limited = max; });
          const handle = await api.conversation(child, context);
          const requestId = `subagent:${api.taskId}`;
          const settled = await (await handle.submit({ type: "input", content: task, requestId,
            entry: { kind: "conduit.user", data: { messageId: requestId, text: task, timestamp: new Date().toISOString() } } }, context)).wait(context);
          const ended = { status: limited ? "failed" : settled.status === "done" ? "finished" : settled.reason === "aborted" ? "stopped" : "failed", endedAt: new Date().toISOString() };
          await api.details({ conversationId: child, subagentId: agentId, title, startedAt, ...ended }, context);
          await noteNested(ended);
          const answer = await runtime.lastAnswer(child);
          const usage = totalUsage(await api.snapshot(UsageDoc, child, context));
          const { outputChars } = limits();
          if (limited) {
            return { ...textResult(capOutput(answer ? `${iterationStop(limited)} Its last reply:\n\n${answer}` : iterationStop(limited), outputChars)), isError: true, usage };
          }
          if (settled.status !== "done" && !answer) {
            return { ...textResult(`The subagent did not finish (${settled.status}).`), isError: true, usage };
          }
          return { ...textResult(capOutput(answer || "(The subagent finished without a reply.)", outputChars)), usage };
        } finally {
          running.delete(api.taskId);
          await unobserve();
        }
      }
      const item = await api.commit(async (tx) => {
        const roster = await tx.doc(SubagentRoster, api.conversationId);
        // Background agents at once: a spawn, or a message that sets an idle one working again, waits for room.
        const room = (verb) => {
          const { background } = limits();
          const busy = Object.values(roster.children).filter((value) => value.status === "running").length;
          if (busy >= background) {
            throw new SubagentLimitError("background", `Subagent limit reached: background subagents running at once (${background}). `
              + `${busy} are running in this conversation; wait for one (action:wait) or stop one (action:stop) before you ${verb}.`);
          }
        };
        if (action === "spawn") {
          const existing = Object.values(roster.children).find((value) => value.spawn === api.taskId);
          if (existing) return JSON.parse(JSON.stringify(existing));
          room("spawn another");
          const label = nextLabel(roster, "bg");
          id = nextKey(roster);
          const title = titled();
          const sinceEntry = (await tx.scanEntries({ conversationId: api.conversationId }, 1)).items[0]?.id || 0;
          const owner = await tx.createTask(anchor, { id, sinceEntry }, { ownership: { kind: "conversation" }, background: true });
          const child = await tx.createConversation({ ownership: { kind: "task", taskId: owner } });
          await stripTools(tx, child.id);
          if (runPrompt) await configure(tx, child.id, { instructions: runPrompt });
          if (childSettings) await configure(tx, child.id, childSettings);
          roster.children[id] = { key: id, id: label, title, sinceEntry, child: child.id, anchor: owner, spawn: api.taskId, number: 0, ...(via ? { via } : {}),
            status: "running", startedAt: new Date().toISOString(), endedAt: null, deliveries: {} };
        }
        // The model names an agent by its label; the roster holds it by its key.
        else id = (findSubagent(Object.values(roster.children), id)?.key) || id;
        const held = Object.hasOwn(roster.children, id) ? roster.children[id] : null;
        if (!held) throw new Error(`Unknown background subagent: ${id}`);
        if (action === "stop") { held.status = "stopped"; held.endedAt = new Date().toISOString(); }
        if (action === "spawn" || action === "message") {
          if (held.status === "stopped") throw new Error(`Subagent ${id} is stopped.`);
          if (!held.deliveries[api.taskId]) {
            if (action === "message" && held.status !== "running") room(`message ${held.id}`);
            const delivery = await tx.createTask(reporter, { id, child: held.child, title: held.title, content: task,
              mode, number: ++held.number, sinceEntry: held.sinceEntry || 0 }, { ownership: { kind: "task", taskId: held.anchor } });
            held.deliveries[api.taskId] = delivery;
            held.reporter = delivery;
            held.status = "running";
            held.startedAt ||= new Date().toISOString();
            held.endedAt = null;
          }
        }
        return JSON.parse(JSON.stringify(held));
      }, context);
      if (["spawn", "message", "stop"].includes(action)) {
        runtime.subagentsChanged?.(api.conversationId, { conversationId: item.child, status: item.status });
      }
      await api.details({ conversationId: item.child, subagentId: item.id, title: item.title }, context);
      await runtime.ensureSubagent?.(api.conversationId, { conversationId: item.child, id: item.id, title: item.title });
      if (action === "stop") {
        await runtime.harness.abortTask(item.anchor, context);
        await api.waitForTask(item.anchor, context);
        return textResult(`Stopped subagent ${item.id}: ${item.title}`);
      }
      if (action === "wait") {
        const settled = await api.waitForTask(item.reporter, context);
        return textResult(capOutput(settled.state.outcome.result?.answer || `Subagent ${item.id}: ${item.status}`, limits().outputChars));
      }
      return textResult(`${action === "spawn" ? "Started" : "Messaged"} subagent ${item.id}: ${item.title}`);
    },
  });
  /**
   * Start a background subagent from outside a tool call: the persistent agent's runs (a schedule, an event, a
   * webhook). In the caller's commit on the parent conversation (`tx.createTask()` defaults to it); `key` makes it
   * idempotent, as a spawning call's task id does. `gate`: its report is a run's, weighed before it reaches the
   * parent, and its spend counts toward the agent's day. Returns the roster item, `{ id, child, anchor, ... }`.
   */
  runtime.spawnBackground = async (tx, conversationId, { key, task, title = subagentTitle(task), origin = null, trigger = null, gate = false, mode = "followUp", model = null, thinkingLevel = null, instructions = null }) => {
    const roster = await tx.doc(SubagentRoster, conversationId);
    const existing = Object.values(roster.children).find((value) => value.spawn === key);
    if (existing) return JSON.parse(JSON.stringify(existing));
    const run = nextRun(roster, origin, trigger);
    const label = nextLabel(roster, "bg");
    const id = nextKey(roster);
    const sinceEntry = (await tx.scanEntries({ conversationId }, 1)).items[0]?.id || 0;
    const owner = await tx.createTask(anchor, { id, sinceEntry }, { ownership: { kind: "conversation" }, background: true });
    const child = await tx.createConversation({ ownership: { kind: "task", taskId: owner } });
    await stripTools(tx, child.id);
    // Its own system prompt (RUN.md and its routine), in place of the parent's it would otherwise inherit.
    if (instructions) await configure(tx, child.id, { instructions });
    // A run may use its own model and effort (the agent's `work` settings); otherwise it has its thread's.
    if (model) {
      const slash = model.indexOf("/");
      await configure(tx, child.id, { model: { provider: model.slice(0, slash), modelId: model.slice(slash + 1) }, ...(thinkingLevel ? { thinkingLevel } : {}) });
    }
    const delivery = await tx.createTask(reporter, { id, child: child.id, title, content: task, mode, number: 1, sinceEntry,
      gate, ...(origin ? { origin } : {}) }, { ownership: { kind: "task", taskId: owner } });
    roster.children[id] = { key: id, id: label, title, sinceEntry, child: child.id, anchor: owner, spawn: key, number: 1,
      status: "running", startedAt: new Date().toISOString(), endedAt: null, deliveries: { [key]: delivery }, reporter: delivery,
      ...(origin ? { origin } : {}), ...(run ? { run } : {}) };
    return JSON.parse(JSON.stringify(roster.children[id]));
  };
  const extension = defineExtension({ name: "subagents", tools: [subagent], tasks: [anchor, reporter] });
  return extension;
}

/**
 * The agent's own reset (pi-durable's `control.handoff`): a long-lived
 * conversation ends its context and goes on from a note it writes, which is
 * how the persistent shape stays bounded besides compaction (decision 9).
 * The transcript keeps everything before it.
 */
export const Handoff = defineExtension({ name: "handoff", tools: [defineTool({
  name: "handoff",
  description: "Start your context again from a note, when what came before is finished and no longer worth carrying. "
    + "Write everything you will still need in `note`: the goal, decisions, open work and where things are. You will "
    + "see only the note afterwards; the person still sees the whole conversation.",
  parameters: Type.Object({ note: Type.String({ description: "What to carry into the new context." }) }),
  execute: async ({ note }) => ({ output: [{ type: "text", text: "Context will restart from the note." }], control: { handoff: note } }),
})] });
