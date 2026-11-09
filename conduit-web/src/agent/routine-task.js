import path from "node:path";
import { AgentDoc as PiAgentDoc, CompactionTask, defineTask, hook, LiveDoc, ToolTask, UsageDoc } from "@earendil-works/pi-durable";
import { ConduitIds } from "../server/durable-runtime.js";
import { notice } from "../context/notices.js";
import { AgentDoc, nextId } from "./agent-doc.js";
import { fileEntry, headlineOf } from "./inbox.js";
import { fileItems } from "./feeds.js";
import { finalText } from "./messages.js";
import { completeRoutine, executeRoutine } from "./routines.js";
import { readRoutine, validateRoutineGraph } from "./routine-files.js";

export const ROUTINE_WAIT_MS = 30 * 60_000;
export const ROUTINE_DEPTH = 16;
const next = (phase, extra = {}) => ({ status: "running", checkpoint: { phase, ...extra } });
const terminal = (error) => ({ status: "terminal", outcome: error
  ? { status: "aborted", reason: error } : { status: "completed", result: null } });
export const forkRecord = (state, id) => Object.values(state?.routineRuns || {}).find((record) => record.conversationId != null && record.conversationId === id)
  // Keep an old fork guarded until the compatibility task has stopped it.
  || (state?.reflection?.conversationId != null && state.reflection.conversationId === id ? state.reflection : undefined);

export function forkAllows(agent, record, name, args) {
  if (name === "memory") return true;
  if (name === "conduit_inbox" && args?.action === "handle") {
    const ids = [...(args.ids || []), ...(args.id ? [args.id] : [])];
    return ids.length > 0 && ids.every((id) => record.outcome?.inboxIds?.includes(id));
  }
  if (name === "read") return !args?.device;
  // Its own routines, to read before proposing a change to one (never to save, test or remove them).
  if (name === "routine") return args?.action === "list" || args?.action === "read";
  if (!["write", "edit"].includes(name) || args?.device || !record.reportPath) return false;
  return path.resolve(agent.folder, String(args?.path || "")) === path.resolve(agent.folder, record.reportPath);
}
export function routineToolGuard(runtime) {
  return hook(ToolTask, { beforeTool: async (call, api, context) => {
    const record = forkRecord(await api.snapshot(AgentDoc, context), api.conversationId);
    if (record && !forkAllows(runtime.agent, record, call.name, call.arguments)) {
      return { block: "A routine run cannot send, post, notify, request approval, or start other work. Put what the person should hear in your final text: that is your report, and jbot tells them. Memory, read, routine list/read and conduit_inbox handle (for gathered entries) are yours to use." };
    }
  } });
}
export function routineCompactionGuard() {
  return hook(CompactionTask, { beforeCompact: async (compaction, api, context) => {
    const legacy = (await api.snapshot(AgentDoc, context))?.reflection;
    if ((compaction.instructions?.startsWith("Routine compaction ")
      || (legacy && compaction.instructions?.startsWith(`Nightly Reflection ${legacy.taskId}.`)))
      && (await api.snapshot(LiveDoc, api.conversationId, context))?.run) return { decline: true };
  } });
}
export function shouldCompact(settings, usage) {
  return Boolean(settings.enabled && usage?.contextWindow > 0 && usage.compactAt > 0
    && usage.tokens >= Math.max(settings.minTokens, settings.minShare * usage.contextWindow)
    && usage.tokens < usage.compactAt);
}

/** The same name cannot run twice at once. Request keys also survive completed firings. */
export async function startRoutine(tx, doc, agent, homeId, routine, slot, { outcome, force = false, chain = [], key = `r-${routine.name}:${slot}`, event = null } = {}) {
  if (chain.includes(routine.name) || chain.length >= ROUTINE_DEPTH) throw new Error(`Routine cycle or depth limit: ${[...chain, routine.name].join(" -> ")}.`);
  doc.routineRuns ||= {};
  doc.routineState ||= {};
  const active = Object.values(doc.routineRuns).find((record) => record.routine.name === routine.name);
  if (active) {
    const held = await tx.task(active.taskId);
    if (held && held.state.status !== "terminal") return held.id;
    delete doc.routineRuns[active.taskId];
  }
  const previous = doc.routineState[routine.name] || {};
  if (previous.key === key) return previous.taskId;
  const taskId = await tx.createTask(routineTask(agent.runtime), { homeId, name: routine.name }, {
    conversationId: homeId, ownership: { kind: "conversation" }, background: true,
  });
  doc.routineRuns[taskId] = { taskId, routine, slot, key, force, ...(event ? { event } : {}), chain: [...chain, routine.name],
    previousAt: previous.lastAt || null, startedAt: Date.now(), ...(outcome ? { outcome } : {}) };
  doc.routineState[routine.name] = { ...previous, key, taskId, lastAt: slot, lastError: null };
  return taskId;
}

async function beforeDeadline(api, startedAt, pending) {
  let disarm;
  try {
    return await Promise.race([pending, new Promise((resolve) => {
      disarm = api.setTimer(() => resolve(null), Math.max(0, ROUTINE_WAIT_MS - (api.now() - startedAt)));
    })]);
  } finally { disarm?.(); }
}

/** Submit a report once; admission wakes jbot without waiting for its next turn. */
async function messageJbot(runtime, task, record, text, key, context) {
  const home = await runtime.harness.conversation(task.input.homeId, context);
  const content = await notice(runtime.contextStore, "report-run", { report: text, title: record.routine.title });
  await home.submit({ type: "input", whenBusy: "followUp", requestId: key, content,
    entry: { kind: "conduit.subagent-report", data: { messageId: key, title: record.routine.title,
      report: text, status: "finished", origin: { kind: record.routine.name, key: record.key } } } }, context);
  runtime.wakeChat?.(task.input.homeId);
}

function routineNotice(doc, title, error, now) {
  doc.notices ||= [];
  doc.notices.push({ id: nextId(doc, "n"), kind: "routine", text: `${title}: ${error}`, at: new Date(now).toISOString() });
  doc.notices.splice(0, Math.max(0, doc.notices.length - 20));
}

export function routineTask(runtime) {
  const get = async (task, api, context) => (await api.snapshot(AgentDoc, context))?.routineRuns?.[task.id];
  const finish = async (task, api, context, error) => {
    await api.commit(async (tx) => {
      const doc = await tx.doc(AgentDoc);
      const record = doc.routineRuns?.[task.id];
      if (record) {
        const state = doc.routineState[record.routine.name];
        if (error) {
          state.lastError = error;
          routineNotice(doc, record.routine.title, error, api.now());
        }
        else state.finishedAt = new Date(api.now()).toISOString();
        delete doc.routineRuns[task.id];
      }
      return terminal(error);
    }, context);
  };
  const stop = async (task, api, context) => {
    const record = await get(task, api, context);
    if (record?.conversationId) await (await runtime.harness.conversation(record.conversationId, context))?.abort(context);
    if (record?.run?.anchor) await runtime.harness.abortTask(record.run.anchor, context);
    if (record?.childId) await runtime.harness.abortTask(record.childId, context);
    if (record?.compactionId) await runtime.harness.abortTask(record.compactionId, context);
    if (record?.conversationId) {
      const ledger = await api.snapshot(UsageDoc, record.conversationId, context);
      const cost = [...Object.values(ledger?.models || {}), ...Object.values(ledger?.tools || {})]
        .reduce((sum, item) => sum + (item.cost?.total || 0), 0);
      await api.commit(async (tx) => {
        const doc = await tx.doc(AgentDoc);
        if (doc.routineRuns?.[task.id]?.conversationId) {
          const day = runtime.agent.today(api.now());
          doc.spend[day] = (doc.spend[day] || 0) + cost;
          delete doc.routineRuns[task.id].conversationId;
        }
      }, context);
    }
  };
  const dependency = async (task, api, context, record, step, phase, index) => {
    if (phase === "before" && !record.childId) {
      const state = await api.snapshot(AgentDoc, context);
      if (Date.parse(state.routineState?.[step.routine]?.finishedAt || "") > (Date.parse(record.previousAt || "") || 0)) return true;
    }
    let childId = record.childId;
    if (!childId) {
      const routine = await readRoutine(runtime.agent.folder, step.routine);
      if (!routine || !routine.enabled) throw new Error(`Routine ${step.routine} is missing or disabled.`);
      await validateRoutineGraph(runtime.agent.folder, routine);
      await api.commit(async (tx) => {
        const doc = await tx.doc(AgentDoc);
        const current = doc.routineRuns[task.id];
        childId = current.childId || await startRoutine(tx, doc, runtime.agent, task.input.homeId, routine,
          new Date(api.now()).toISOString(), { chain: record.chain, key: `${record.key}:${phase}:${index}` });
        current.childId = childId;
        current.stepStartedAt ||= api.now();
      }, context);
    }
    const current = await get(task, api, context);
    const done = await beforeDeadline(api, current.stepStartedAt, api.waitForTask(childId, context));
    if (!done) throw new Error(`Routine ${step.routine} exceeded the 30-minute limit.`);
    if (done.state.outcome?.status !== "completed") throw new Error(`Routine ${step.routine}: ${done.state.outcome?.reason || done.state.outcome?.error?.message || done.state.outcome?.status || "no outcome"}`);
    return true;
  };
  const advance = async (task, api, context, phase, index, error) => api.commit(async (tx) => {
    const doc = await tx.doc(AgentDoc);
    const current = doc.routineRuns[task.id];
    if (error) routineNotice(doc, current.routine.title, error, api.now());
    delete current.childId;
    delete current.compactionId;
    delete current.stepStartedAt;
    return next(phase, { index: index + 1 });
  }, context);
  const definition = {
    name: "conduit.agent-routine", version: 1, initial: () => ({ phase: "before", index: 0 }),
    phases: {
      before: async (task, api, context) => {
        const record = await get(task, api, context);
        // Switched off stops its clock, not the person: a routine run by hand (force) runs whether it is on or not.
        if (!record || !runtime.agent.enabled() || (!record.routine.enabled && !record.force)) throw new Error("Routine is disabled or unavailable.");
        await validateRoutineGraph(runtime.agent.folder, record.routine);
        const index = task.state.checkpoint.index || 0;
        const step = record.routine.before?.[index];
        if (!step) { await api.commit(() => next("gather"), context); return; }
        let error;
        try { await dependency(task, api, context, record, step, "before", index); }
        catch (failure) {
          if (api.signal.aborted || context.abortSignal?.aborted) throw failure;
          error = failure?.message || String(failure);
          const current = await get(task, api, context);
          if (current?.childId) await runtime.harness.abortTask(current.childId, context);
        }
        await advance(task, api, context, "before", index, error);
      },
      gather: async (task, api, context) => {
        const record = await get(task, api, context);
        const agent = runtime.agent;
        const state = await api.snapshot(AgentDoc, context);
        const outcome = record.outcome || await api.memo("gather", await executeRoutine(agent, record.routine, {
          cursors: state.cursors?.[record.routine.name] || {}, state, now: api.now(), force: record.force, event: record.event || null,
        }), context);
        if (outcome.run && await agent.overBudget()) throw new Error("Routine skipped: today's budget is spent.");
        await api.commit(async (tx) => {
          const doc = await tx.doc(AgentDoc);
          const current = doc.routineRuns[task.id];
          current.outcome = outcome;
          for (const task of outcome.tasks || []) if (task.error === "Executor isn't connected") routineNotice(doc, record.routine.title, `${task.id}: ${task.error}`, api.now());
          current.startedAt = api.now();
          if (!outcome.run) {
            completeRoutine(doc, record.routine, outcome, new Date(api.now()).toISOString());
            if (record.routine.output !== "jbot" && outcome.items.length) await fileItems(tx,
              { key: record.key, title: record.routine.title, feedId: `r-${record.routine.name}`, level: record.routine.level }, outcome.items, record.slot);
          }
          return next(outcome.run ? "wait" : "done");
        }, context);
      },
      wait: async (task, api, context) => {
        const record = await get(task, api, context);
        const { routine, outcome } = record;
        if (routine.mode === "fork" && api.now() - record.startedAt >= ROUTINE_WAIT_MS) throw new Error("Routine fork exceeded the 30-minute idle wait limit.");
        let ready = false;
        await api.commit(async (tx) => {
          const doc = await tx.doc(AgentDoc);
          const current = doc.routineRuns[task.id];
          if (routine.mode === "fork") {
            if (!current.conversationId) {
              if ((await tx.doc(LiveDoc, task.input.homeId)).run) return;
              const entry = (await tx.scanEntries({ conversationId: task.input.homeId }, 1)).items[0];
              if (!entry) return;
              const homeAgent = JSON.parse(JSON.stringify(await tx.doc(PiAgentDoc, task.input.homeId)));
              const fork = await tx.forkConversation(task.input.homeId, entry.id, { ownership: { kind: "task", taskId: task.id } });
              const forkAgent = await tx.doc(PiAgentDoc, fork.id);
              for (const key of Object.keys(forkAgent)) delete forkAgent[key];
              Object.assign(forkAgent, homeAgent);
              const identity = await tx.doc(ConduitIds, fork.id);
              delete identity.chatId;
              identity.messages = {};
              identity.branches = [];
              Object.assign(current, { conversationId: fork.id, reportPath: outcome.reportPath });
            }
          } else if (!current.run) {
            current.run = await runtime.agent.spawnRun(tx, task.input.homeId, { key: record.key, kind: routine.name,
              title: routine.title, task: outcome.message, instructions: outcome.instructions, output: routine.output,
              raw: true, routineTaskId: task.id, model: routine.model, thinkingLevel: routine.effort, log: routine.log !== false });
          }
          ready = true;
          return next("run");
        }, context);
        if (!ready) {
          if (api.now() - record.startedAt >= ROUTINE_WAIT_MS) throw new Error("Routine fork exceeded the 30-minute idle wait limit.");
          await api.sleepUntil(api.now() + 5000, { phase: "wait" }, context);
        }
      },
      run: async (task, api, context) => {
        const record = await get(task, api, context);
        let summary;
        let cost = 0;
        if (record.routine.mode === "fork") {
          const fork = await runtime.harness.conversation(record.conversationId, context);
          const submission = await fork.submit({ type: "input", requestId: record.key, content: record.outcome.prompt,
            whenBusy: "reject", entry: { kind: "conduit.routine", data: { text: record.outcome.prompt } } }, context);
          const settled = await beforeDeadline(api, record.startedAt, submission.wait(context));
          if (!settled) throw new Error("Routine fork exceeded the 30-minute limit.");
          const entry = settled.status === "done" ? (await fork.entries({ minEntryId: settled.answer, maxEntryId: settled.answer }, 1, undefined, context)).items[0] : null;
          const message = entry?.model?.[0];
          if (message?.stopReason !== "stop" || !(summary = finalText(message))) throw new Error("Routine fork did not finish successfully.");
          const ledger = await api.snapshot(UsageDoc, fork.id, context);
          cost = [...Object.values(ledger?.models || {}), ...Object.values(ledger?.tools || {})].reduce((sum, item) => sum + (item.cost?.total || 0), 0);
        } else {
          const done = await beforeDeadline(api, record.startedAt, api.waitForTask(record.run.reporter, context));
          if (!done) throw new Error("Routine run exceeded the 30-minute limit.");
          const report = done.state.outcome?.result;
          if (done.state.outcome?.status !== "completed" || report?.status !== "finished") throw new Error("Routine run did not finish successfully.");
          summary = report.answer;
        }
        await api.commit(async (tx) => {
          const doc = await tx.doc(AgentDoc);
          const current = doc.routineRuns[task.id];
          if (!current.runSucceeded) completeRoutine(doc, record.routine, record.outcome, new Date(api.now()).toISOString());
          current.summary = summary;
          const day = runtime.agent.today(api.now());
          doc.spend[day] = (doc.spend[day] || 0) + cost;
          delete current.conversationId;
          return next("output");
        }, context);
      },
      output: async (task, api, context) => {
        const record = await get(task, api, context);
        if (record.routine.mode === "fork") {
          if (record.routine.output !== "jbot") await api.commit(async (tx) => {
            await fileEntry(tx, { key: record.key, kind: record.routine.name, title: record.routine.title,
              level: record.routine.level, status: "unhandled", headline: headlineOf(record.summary), body: record.summary }, Date.parse(record.slot));
          }, context);
          if (record.routine.output !== "inbox") await messageJbot(runtime, task, record, record.summary, `${record.key}:output`, context);
        }
        await api.commit(() => next("after", { index: 0 }), context);
      },
      after: async (task, api, context) => {
        const record = await get(task, api, context);
        const index = task.state.checkpoint.index || 0;
        const step = record.routine.after?.[index];
        if (!step) { await finish(task, api, context); return; }
        if (step.routine) await dependency(task, api, context, record, step, "after", index);
        else if (step.message) await messageJbot(runtime, task, record, record.summary, `${record.key}:after:${index}`, context);
        else {
          const startedAt = record.stepStartedAt ?? api.now();
          if (!record.stepStartedAt) await api.commit(async (tx) => { (await tx.doc(AgentDoc)).routineRuns[task.id].stepStartedAt = startedAt; }, context);
          let compactId = record.compactionId;
          if (!compactId) {
            const live = await api.snapshot(LiveDoc, task.input.homeId, context);
            if (live?.run || live?.compactions?.length) {
              if (api.now() - startedAt >= ROUTINE_WAIT_MS) throw new Error("Compaction exceeded the 30-minute idle wait limit.");
              await api.sleepUntil(api.now() + 5000, { phase: "after", index }, context); return;
            }
            const home = await runtime.harness.conversation(task.input.homeId, context);
            const usage = await runtime.routineContextUsage?.(home, context, api.settings?.compaction);
            const settings = { ...runtime.agent.settings().nightlyCompaction, ...step.compact };
            if (!shouldCompact(settings, usage)) {
              // Said on its routine's row: not compacted, and why (the thread below the size it compacts from).
              const from = usage?.contextWindow ? Math.max(settings.minTokens, settings.minShare * usage.contextWindow) : null;
              await api.commit(async (tx) => { const doc = await tx.doc(AgentDoc); doc.routineState ||= {};
                (doc.routineState[record.routine.name] ||= {}).compaction = { at: new Date(api.now()).toISOString(), done: false,
                  tokens: usage?.tokens ?? null, from: from === null ? null : Math.round(from), enabled: Boolean(settings.enabled) }; }, context);
              await advance(task, api, context, "after", index); return;
            }
            await api.commit(async (tx) => {
              const doc = await tx.doc(AgentDoc);
              const live = await tx.doc(LiveDoc, task.input.homeId);
              if (live.run || live.compactions?.length) return;
              const instructions = `Routine compaction ${task.id}. Keep the thread's working state: open commitments, threads in progress, and how the person likes to be spoken to. Do not restate the memory files.`;
              compactId = doc.routineRuns[task.id].compactionId || await tx.createTask(CompactionTask, { reason: "manual", instructions },
                { conversationId: task.input.homeId, ownership: { kind: "conversation" }, background: false });
              live.compactions ||= [];
              live.compactions.push({ taskId: compactId, reason: "manual", blocking: false, attempt: 1 });
              doc.routineRuns[task.id].compactionId = compactId;
            }, context);
            if (!compactId) {
              if (api.now() - startedAt >= ROUTINE_WAIT_MS) throw new Error("Compaction exceeded the 30-minute idle wait limit.");
              await api.sleepUntil(api.now() + 5000, { phase: "after", index }, context); return;
            }
          }
          const receipt = await beforeDeadline(api, startedAt, api.waitForTask(compactId, context));
          if (!receipt) throw new Error("Compaction exceeded the 30-minute limit.");
          const outcome = receipt.state.outcome;
          if (outcome?.status !== "completed") throw new Error(`Compaction: ${outcome?.error?.message || outcome?.status || "no outcome"}`);
          let compacted = outcome.result?.entryId != null;
          if (outcome.result?.submissionId != null) {
            const write = await runtime.harness.submission(outcome.result.submissionId, context);
            const placed = write && await beforeDeadline(api, startedAt, write.wait(context));
            if (write && !placed) await write.abort(context);
            compacted = placed?.status === "done";
          }
          if (!compacted) throw new Error("Compaction did not place a summary.");
          await api.commit(async (tx) => { const doc = await tx.doc(AgentDoc); const at = new Date(api.now()).toISOString(); doc.lastCompactionAt = at;
            doc.routineState ||= {}; (doc.routineState[record.routine.name] ||= {}).compaction = { at, done: true }; }, context);
        }
        await advance(task, api, context, "after", index);
      },
      done: async (task, api, context) => finish(task, api, context),
    },
    abort: async (task, api, context) => { await stop(task, api, context); await finish(task, api, context, "Routine aborted."); },
  };
  for (const [phase, run] of Object.entries(definition.phases)) definition.phases[phase] = async (task, api, context) => {
    try { await run(task, api, context); }
    catch (error) {
      if (api.signal.aborted || context.abortSignal?.aborted) throw error;
      // Revoke memory rights only after the fork has stopped, including when abort fails.
      await stop(task, api, context);
      await finish(task, api, context, error?.message || String(error));
    }
  };
  return defineTask(definition);
}
