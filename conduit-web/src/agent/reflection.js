import path from "node:path";
import { AgentDoc as PiAgentDoc, CompactionTask, defineTask, hook, LiveDoc, ToolTask, UsageDoc } from "@earendil-works/pi-durable";
import { ConduitIds } from "../server/durable-runtime.js";
import { AgentDoc } from "./agent-doc.js";
import { appendEntry, headlineOf } from "./inbox.js";
import { finalText } from "./messages.js";
import { notesTask, promptVars } from "./routines.js";
import { readRoutine, renderVars } from "./routine-files.js";

export const REFLECTION_WAIT_MS = 30 * 60_000;
const terminal = (status = "completed") => ({ status: "terminal", outcome: status === "completed" ? { status, result: null } : { status, reason: "Reflection did not finish" } });
const next = (phase) => ({ status: "running", checkpoint: { phase } });

async function beforeDeadline(api, startedAt, pending) {
  let disarm;
  try {
    return await Promise.race([pending, new Promise((resolve) => {
      disarm = api.setTimer(() => resolve(null), Math.max(0, REFLECTION_WAIT_MS - (api.now() - startedAt)));
    })]);
  } finally { disarm?.(); }
}

/** Only this session record, created by a firing, identifies a live Reflection fork. */
export const isReflection = (state, conversationId) => state?.reflection?.conversationId != null && state.reflection.conversationId === conversationId;
export const needsReflection = (state) => !state.lastReflection || Date.parse(state.lastReflection.at) <= (state.lastBriefAt ? Date.parse(state.lastBriefAt) : 0);

/** Keep the declarations unchanged, but refuse anything that could reach the person or grant later work. */
export function reflectionAllows(agent, record, name, args) {
  if (name === "memory") return true;
  if (name === "read") return !args?.device;
  if (!["write", "edit"].includes(name) || args?.device) return false;
  return path.resolve(agent.folder, String(args?.path || "")) === path.resolve(agent.folder, record.reportPath);
}

/** Applies before every model-issued or nested tool call, including tools from other extensions. */
export function reflectionToolGuard(runtime) {
  return hook(ToolTask, { beforeTool: async (call, api, context) => {
    const state = await api.snapshot(AgentDoc, context);
    if (isReflection(state, api.conversationId) && !reflectionAllows(runtime.agent, state.reflection, call.name, call.arguments)) {
      return { block: "Reflection cannot send, post, notify, request approval, or start other work. Use memory and the report file only." };
    }
  } });
}

/** Decline a nightly summary if a home turn started after admission. */
export function reflectionCompactionGuard() {
  return hook(CompactionTask, { beforeCompact: async (compaction, api, context) => {
    const state = await api.snapshot(AgentDoc, context);
    const reflection = state?.reflection;
    if (reflection && compaction.instructions?.startsWith(`Nightly Reflection ${reflection.taskId}.`)
      && (await api.snapshot(LiveDoc, api.conversationId, context))?.run) return { decline: true };
  } });
}

export function shouldCompact(settings, usage) {
  return Boolean(settings.enabled && usage?.contextWindow > 0 && usage.compactAt > 0
    && usage.tokens >= Math.max(settings.minTokens, settings.minShare * usage.contextWindow)
    && usage.tokens < usage.compactAt);
}

/** One task per cycle. Forks have no chat registration or subagent roster entry. */
export async function startReflection(tx, doc, agent, homeId, key) {
  if (doc.reflection) {
    const held = await tx.task(doc.reflection.taskId);
    if (held && held.state.status !== "terminal") return held.id;
    delete doc.reflection;
  }
  if (doc.lastReflection?.key === key) return null;
  const slot = key.startsWith("r-reflect:") ? Date.parse(key.slice("r-reflect:".length)) : NaN;
  if (Number.isFinite(slot) && Date.parse(doc.lastReflection?.windowEnd || "") >= slot) return null;
  const taskId = await tx.createTask(reflectionTask(agent.runtime), { key, homeId }, {
    conversationId: homeId, ownership: { kind: "conversation" }, background: true,
  });
  doc.reflection = { taskId, key, conversationId: null, startedAt: Date.now() };
  return taskId;
}

/** Consume precisely the notes shown by a successful fork. A failed fork leaves all notes pending. */
export function finishReflection(doc, record, summary, at) {
  doc.cursors ||= {};
  doc.cursors.reflect ||= {};
  doc.cursors.reflect.notes = record.notesCursor;
  doc.lastReflection = { key: record.key, at, windowStart: record.windowStart, windowEnd: record.windowEnd };
  appendEntry(doc, { key: record.key, kind: "reflect", title: "Reflection", level: "fyi", status: "unhandled",
    headline: headlineOf(summary), body: summary }, Date.parse(at));
}

export function reflectionTask(runtime) {
  const clear = async (api, context, status) => {
    const record = (await api.snapshot(AgentDoc, context))?.reflection;
    const ledger = record?.taskId === api.taskId && record.conversationId
      ? await api.snapshot(UsageDoc, record.conversationId, context) : null;
    const cost = [...Object.values(ledger?.models || {}), ...Object.values(ledger?.tools || {})]
      .reduce((sum, item) => sum + (item.cost?.total || 0), 0);
    await api.commit(async (tx) => {
      const doc = await tx.doc(AgentDoc);
      if (doc.reflection?.taskId === api.taskId) {
        // Failed and stopped turns still count against the background budget.
        const day = runtime.agent.today(api.now());
        doc.spend[day] = (doc.spend[day] || 0) + cost;
        delete doc.reflection;
      }
      return terminal(status);
    }, context);
  };
  const definition = {
    name: "conduit.agent-reflection", version: 1, initial: () => ({ phase: "wait" }),
    phases: {
      wait: async (task, api, context) => {
        const agent = runtime.agent;
        const state = await api.snapshot(AgentDoc, context);
        if (state?.reflection?.taskId !== task.id) { await clear(api, context, "aborted"); return; }
        const routine = await readRoutine(agent.folder, "reflect").catch(() => null);
        if (!routine || routine.enabled === false || !agent.enabled() || await agent.overBudget()) {
          await clear(api, context, "aborted"); return;
        }
        const notes = await notesTask(agent, { id: "notes" }, state.cursors?.reflect?.notes || {}, state);
        const now = api.now();
        const windowStart = state.lastReflection?.windowEnd || "the start of your home thread";
        const windowEnd = new Date(now).toISOString();
        const reportPath = `reflections/${agent.today(now)}.md`;
        const message = renderVars(routine.body, { ...await promptVars(agent, now), windowStart, windowEnd,
          notesBlock: notes.notes, declinedBlock: notes.declined, reportPath });
        let forked = false;
        await api.commit(async (tx) => {
          const doc = await tx.doc(AgentDoc);
          if (doc.reflection?.taskId !== task.id) return;
          if (doc.reflection.conversationId != null) { forked = true; return next("run"); }
          // The idle check and fork are one commit; no home state or turn lock is changed.
          if ((await tx.doc(LiveDoc, task.input.homeId)).run) return;
          const entry = (await tx.scanEntries({ conversationId: task.input.homeId }, 1)).items[0];
          if (!entry) return;
          const homeAgent = JSON.parse(JSON.stringify(await tx.doc(PiAgentDoc, task.input.homeId)));
          const fork = await tx.forkConversation(task.input.homeId, entry.id, { ownership: { kind: "task", taskId: task.id } });
          // pi.agent forks as of the entry. Include a model or effort change made after that entry too.
          const forkAgent = await tx.doc(PiAgentDoc, fork.id);
          for (const key of Object.keys(forkAgent)) delete forkAgent[key];
          Object.assign(forkAgent, homeAgent);
          // ConduitIds is copied too. Never let restart recovery attach the fork as the home chat.
          const identity = await tx.doc(ConduitIds, fork.id);
          delete identity.chatId;
          identity.messages = {};
          identity.branches = [];
          Object.assign(doc.reflection, { conversationId: fork.id, reportPath, message, notesCursor: notes.cursor, windowStart, windowEnd });
          forked = true;
          return next("run");
        }, context);
        if (forked) return;
        if (now - state.reflection.startedAt >= REFLECTION_WAIT_MS) { await clear(api, context, "aborted"); return; }
        await api.sleepUntil(now + 5000, { phase: "wait" }, context);
      },
      run: async (task, api, context) => {
        const record = (await api.snapshot(AgentDoc, context))?.reflection;
        if (record?.taskId !== task.id) { await clear(api, context, "aborted"); return; }
        const fork = await runtime.harness.conversation(record.conversationId, context);
        // A request ID makes replay reuse the one Reflection message and its settlement.
        const submission = await fork.submit({ type: "input", requestId: record.key, content: record.message,
          whenBusy: "reject", entry: { kind: "conduit.reflection", data: { text: record.message } } }, context);
        // Bound the whole night cycle, including a provider that never answers.
        const settled = await beforeDeadline(api, record.startedAt, submission.wait(context));
        if (!settled) { await fork.abort(context); await clear(api, context, "aborted"); return; }
        const entry = settled.status === "done" ? (await fork.entries({ minEntryId: settled.answer, maxEntryId: settled.answer }, 1, undefined, context)).items[0] : null;
        const message = entry?.model?.[0];
        if (!message || message.stopReason !== "stop") { await clear(api, context, "aborted"); return; }
        const summary = finalText(message);
        if (!summary) { await clear(api, context, "aborted"); return; }
        const ledger = await api.snapshot(UsageDoc, fork.id, context);
        const cost = [...Object.values(ledger?.models || {}), ...Object.values(ledger?.tools || {})]
          .reduce((sum, item) => sum + (item.cost?.total || 0), 0);
        await api.commit(async (tx) => {
          const doc = await tx.doc(AgentDoc);
          if (doc.reflection?.taskId !== task.id) return terminal("aborted");
          finishReflection(doc, record, summary, new Date(api.now()).toISOString());
          const day = runtime.agent.today(api.now());
          doc.spend[day] = (doc.spend[day] || 0) + cost;
          // Revoke fork access before compaction. The fork can never be reused by a follow-up run.
          delete doc.reflection.conversationId;
          return next("compact");
        }, context);
      },
      compact: async (task, api, context) => {
        const agent = runtime.agent;
        const record = (await api.snapshot(AgentDoc, context))?.reflection;
        if (record?.taskId !== task.id) { await clear(api, context, "aborted"); return; }
        let compactId = record.compactionId;
        if (!compactId) {
          if ((await api.snapshot(LiveDoc, task.input.homeId, context))?.run) {
            if (api.now() - record.startedAt >= REFLECTION_WAIT_MS) { await clear(api, context); return; }
            await api.sleepUntil(api.now() + 5000, { phase: "compact" }, context); return;
          }
          const home = await runtime.harness.conversation(task.input.homeId, context);
          const usage = await runtime.reflectionContextUsage?.(home, context, api.settings?.compaction);
          if (!shouldCompact(agent.settings().nightlyCompaction, usage)) { await clear(api, context); return; }
          const instructions = `Nightly Reflection ${task.id}. Durable facts were just written to USER.md, MEMORY.md and the diary. Keep the thread's working state: open commitments, threads in progress, and how the person likes to be spoken to. Do not restate those memory files.`;
          let busy = false;
          await api.commit(async (tx) => {
            const doc = await tx.doc(AgentDoc);
            if (doc.reflection?.taskId !== task.id) return;
            if (doc.reflection.compactionId) { compactId = doc.reflection.compactionId; return; }
            const live = await tx.doc(LiveDoc, task.input.homeId);
            if (live.run || live.compactions?.length) { busy = true; return; }
            // Same task and status as Conversation.compact(), with the idle check in this commit.
            compactId = await tx.createTask(CompactionTask, { reason: "manual", instructions },
              { conversationId: task.input.homeId, ownership: { kind: "conversation" }, background: false });
            live.compactions ||= [];
            live.compactions.push({ taskId: compactId, reason: "manual", blocking: false, attempt: 1 });
            doc.reflection.compactionId = compactId;
          }, context);
          if (!compactId) {
            if (!busy || api.now() - record.startedAt >= REFLECTION_WAIT_MS) { await clear(api, context); return; }
            await api.sleepUntil(api.now() + 5000, { phase: "compact" }, context); return;
          }
        }
        const receipt = await beforeDeadline(api, record.startedAt, api.waitForTask(compactId, context));
        if (!receipt) {
          await runtime.harness.abortTask(compactId, context);
          throw new Error("Compaction exceeded the 30-minute Reflection limit.");
        }
        const outcome = receipt.state.outcome;
        let compacted = outcome?.status === "completed" && outcome.result?.entryId != null;
        if (outcome?.status === "completed" && outcome.result?.submissionId != null) {
          const write = await runtime.harness.submission(outcome.result.submissionId, context);
          const placed = write && await beforeDeadline(api, record.startedAt, write.wait(context));
          if (write && !placed) {
            await write.abort(context);
            throw new Error("Compaction summary exceeded the 30-minute Reflection limit.");
          }
          compacted = placed?.status === "done";
        }
        if (outcome?.status !== "completed") await api.commit(async (tx) => {
          const doc = await tx.doc(AgentDoc);
          doc.routineState ||= {};
          doc.routineState.reflect = { ...(doc.routineState.reflect || {}),
            lastError: `Compaction: ${outcome?.error?.message || outcome?.status || "no outcome"}` };
        }, context);
        if (compacted) await api.commit(async (tx) => {
          (await tx.doc(AgentDoc)).lastNightlyCompaction = new Date(api.now()).toISOString();
        }, context);
        await clear(api, context);
      },
    },
    abort: async (task, api, context) => {
      const record = (await api.snapshot(AgentDoc, context))?.reflection;
      if (record?.taskId === task.id && record.conversationId) {
        const fork = await runtime.harness.conversation(record.conversationId, context);
        await fork?.abort(context);
      }
      await clear(api, context, "aborted");
    },
  };
  for (const [phase, run] of Object.entries(definition.phases)) {
    definition.phases[phase] = async (task, api, context) => {
      try { await run(task, api, context); }
      catch (error) {
        if (api.signal.aborted || context.abortSignal?.aborted) throw error;
        if (phase === "run") {
          const record = (await api.snapshot(AgentDoc, context))?.reflection;
          if (record?.taskId === task.id && record.conversationId) {
            const fork = await runtime.harness.conversation(record.conversationId, context);
            // Keep the guard record until the fork is idle, even if abort itself fails.
            await fork?.abort(context);
          }
        }
        await api.commit(async (tx) => {
          const doc = await tx.doc(AgentDoc);
          doc.routineState ||= {};
          doc.routineState.reflect = { lastError: error?.message || String(error), lastAt: new Date(api.now()).toISOString() };
        }, context);
        await clear(api, context, "aborted");
      }
    };
  }
  return defineTask(definition);
}
