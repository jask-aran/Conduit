import { defineTask, defineTool } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { AgentDoc, nextId } from "./agent-doc.js";
import { applyOutcome, runSource } from "./feeds.js";
import { applyRoutine, executeRoutine, routineClocks } from "./routines.js";
import { listRoutines, readRoutine, writeRoutine } from "./routine-files.js";

const terminal = () => ({ status: "terminal", outcome: { status: "completed" } });
const result = (text, isError = false) => ({ output: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });
const clockOptions = (conversationId) => ({ ownership: { kind: "conversation" }, conversationId, background: true });

/** Read local calendar fields without using the server's time zone. */
function localTime(time, zone) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(time);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function localEpoch(time, zone) {
  const p = localTime(time, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** For a gap, move the time forward by the gap; for a repeat, use the first future occurrence. */
function nextDaily(at, zone, now, lastAt = null) {
  const p = localTime(now, zone);
  const [hour, minute] = at.split(":").map(Number);
  const day = Date.UTC(p.year, p.month - 1, p.day);
  const lastDay = lastAt ? localTime(Date.parse(lastAt), zone) : null;
  const start = lastDay && lastDay.year === p.year && lastDay.month === p.month && lastDay.day === p.day ? 1 : 0;
  for (let n = start; n < 3; n++) {
    const target = day + n * 86400000 + (hour * 60 + minute) * 60000;
    const offsets = new Set([-36, -12, 0, 12, 36].map((h) => {
      const sample = target + h * 3600000;
      return localEpoch(sample, zone) - sample;
    }));
    const candidates = [...offsets].map((offset) => target - offset).sort((a, b) => a - b);
    const exact = candidates.find((time) => time > now && localEpoch(time, zone) === target);
    if (exact !== undefined) return exact;
    if (!candidates.some((time) => localEpoch(time, zone) === target)) {
      const after = candidates.filter((time) => time > now && localEpoch(time, zone) > target)
        .sort((a, b) => localEpoch(a, zone) - localEpoch(b, zone))[0];
      if (after !== undefined) return after;
    }
  }
  throw new Error("Could not find the next daily time");
}

function nextTime(schedule, zone, now) {
  if (schedule.kind === "daily") return nextDaily(schedule.at, zone, now, schedule.lastAt);
  if (schedule.kind === "once") return Date.parse(schedule.at);
  const interval = schedule.everyMinutes * 60000;
  const base = schedule.lastAt ? Date.parse(schedule.lastAt) : now;
  return base + Math.max(1, Math.floor((now - base) / interval) + 1) * interval;
}

function validOnce(at, now) {
  if (typeof at !== "string") return false;
  const match = at.match(/^(\d{4})-(\d\d)-(\d\d)T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/);
  if (!match || !Number.isFinite(Date.parse(at)) || Date.parse(at) <= now) return false;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]);
}

function makeClock(runtime) {
  return defineTask({
    name: "conduit.agent-clock", version: 1, initial: () => ({ phase: "wait" }),
    phases: {
      wait: async (task, api, context) => {
        const agent = runtime.agent;
        if (!agent?.enabled()) { await api.commit(() => terminal(), context); return; }
        const state = await api.snapshot(AgentDoc, context);
        const schedule = state?.schedules[task.input.scheduleId];
        if (!schedule || schedule.cancelling || schedule.clock !== task.id) { await api.commit(() => terminal(), context); return; }
        const next = schedule.nextAt ? Date.parse(schedule.nextAt) : nextTime(schedule, agent.settings().timezone, api.now());
        const slot = new Date(next).toISOString();
        let waiting = false;
        await api.commit(async (tx) => {
          const current = (await tx.doc(AgentDoc)).schedules[task.input.scheduleId];
          if (!current || current.cancelling || current.clock !== task.id) return terminal();
          current.nextAt = slot;
          waiting = true;
        }, context);
        if (!waiting) return;
        // In steps against the wall clock: a timer does not count time the machine sleeps, so one long wait set at
        // night fired hours late after the computer woke.
        while (api.now() < next) await api.sleep(Math.min(next, api.now() + 60_000), context);
        await api.commit(() => ({ status: "running", checkpoint: { phase: "fire", slot } }), context);
      },
      fire: async (task, api, context) => {
        const agent = runtime.agent;
        if (!agent?.enabled()) { await api.commit(() => terminal(), context); return; }
        const schedule = (await api.snapshot(AgentDoc, context))?.schedules[task.input.scheduleId];
        if (!schedule || schedule.cancelling || schedule.clock !== task.id) { await api.commit(() => terminal(), context); return; }
        const slot = task.state.checkpoint.slot;
        const missed = api.now() - Date.parse(slot) > 6 * 3600000;
        // A routine (routines.js): its tasks gather without a model, its gate decides whether its run fires. Memoised
        // before it is applied, so a replay does not ask Executor again.
        const routine = schedule.routine && !missed ? await readRoutine(agent.folder, schedule.routine).catch((error) => ({ error: error.message })) : null;
        let fired = routine && !routine.error ? await api.memo(`routine:${slot}`, context) : null;
        if (routine && !routine.error && fired === undefined) {
          const state = await api.snapshot(AgentDoc, context);
          fired = await api.memo(`routine:${slot}`, await executeRoutine(agent, routine, { cursors: state?.cursors?.[routine.name] || {}, state, now: api.now() }), context);
        }
        // A feed that reads (a program, a script) runs here, without a model; a run feed is a run like any other.
        const direct = schedule.feed && schedule.feed.source.kind !== "run";
        const outcome = direct && !missed ? await api.memo(`feed:${slot}`, await runSource(agent, schedule.feed.source, { seen: schedule.feed.seen || [] }), context) : null;
        const spends = schedule.routine ? Boolean(fired?.run) : !missed && !direct;
        const overBudget = spends && await agent.overBudget();
        if (overBudget) await agent.notice("budget", `Skipped ${schedule.title}: today's budget of $${agent.settings().budgetUsdPerDay} is spent.`);
        await api.commit(async (tx) => {
          const doc = await tx.doc(AgentDoc);
          const current = doc.schedules[task.input.scheduleId];
          if (!current || current.cancelling || current.clock !== task.id) return terminal();
          // Taken already: run by hand while it was due (POST /v0/agent/schedules/:id/run).
          const taken = current.lastAt && Date.parse(current.lastAt) >= Date.parse(slot);
          if (routine?.error) { doc.routineState ||= {}; doc.routineState[schedule.routine] = { lastAt: slot, lastError: routine.error }; }
          else if (fired && !taken) await applyRoutine(tx, doc, agent, api.conversationId, routine, overBudget ? { ...fired, run: false, items: [] } : fired, slot);
          else if (direct) { if (outcome) applyOutcome(doc, current, outcome, slot); }
          else if (!schedule.routine && !missed && !overBudget && !taken) {
            await agent.spawnRun(tx, api.conversationId, {
              key: `${current.id}:${slot}`, kind: current.feed ? "feed" : "checkback", title: current.title,
              task: current.feed ? current.feed.source.task : current.task,
            });
          }
          current.lastAt = slot;
          current.nextAt = null;
          if (current.kind === "once") { delete doc.schedules[current.id]; return terminal(); }
          return { status: "running", checkpoint: { phase: "wait" } };
        }, context);
      },
    },
    abort: async (task, api, context) => { await api.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context); },
  });
}

/**
 * Add a schedule item with its clock, in a commit on the home conversation: a feed's (feeds.js), from jbot or the
 * person. A feed's first run comes a minute later, so it learns what is there before anything new arrives.
 */
export function clockAdder(runtime) {
  const clock = makeClock(runtime);
  return async (tx, doc, item, conversationId) => {
    const zone = runtime.agent.settings().timezone;
    item.clock = await tx.createTask(clock, { scheduleId: item.id }, clockOptions(conversationId));
    item.nextAt = new Date(item.feed ? Date.now() + 60_000 : nextTime(item, zone, Date.now())).toISOString();
    doc.schedules[item.id] = { lastAt: null, system: false, createdAt: new Date().toISOString(), zone, ...item };
  };
}

/** Tools and clocks resolve the agent only when they run. */
export function ScheduleTools(runtime) {
  const clock = makeClock(runtime);
  const schedule = defineTool({
    name: "schedule",
    description: "Add, list or cancel agent schedules. Daily times use the agent's time zone.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("add"), Type.Literal("list"), Type.Literal("cancel")]),
      kind: Type.Optional(Type.Union([Type.Literal("daily"), Type.Literal("every"), Type.Literal("once")])),
      at: Type.Optional(Type.String()), everyMinutes: Type.Optional(Type.Number()), task: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()), id: Type.Optional(Type.String()),
    }),
    replay: "safe",
    execute: async ({ action, kind, at, everyMinutes, task, title, id }, api, context) => {
      const agent = runtime.agent;
      if (!agent?.enabled()) return result("The agent is not enabled.", true);
      if (action === "list") {
        const schedules = await listSchedules(agent);
        const zone = agent.settings().timezone;
        const today = agent.today();
        const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
        return result(schedules.map((item) => {
          const time = Date.parse(item.nextAt);
          const day = agent.today(time);
          const date = day === today ? "today" : day === tomorrow ? "tomorrow" : day;
          const local = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(time);
          return `${item.id}: ${item.title} — ${date} ${local}`;
        }).join("\n") || "No schedules.");
      }
      if (action === "cancel") {
        if (typeof id !== "string" || !id) return result("A schedule id is required.", true);
        let held = await api.memo("cancel", context);
        if (!held) {
          const marked = await api.commit(async (tx) => {
            const doc = await tx.doc(AgentDoc);
            const item = Object.hasOwn(doc.schedules, id) ? doc.schedules[id] : null;
            if (!item) return null;
            if (item.system) return { system: true };
            item.cancelling = true;
            return { clock: item.clock };
          }, context);
          if (!marked) return result(`Unknown schedule: ${id}`, true);
          if (marked.system) return result("Change this schedule in Settings.", true);
          held = await api.memo("cancel", marked, context);
        }
        if (held.clock) {
          await runtime.harness.abortTask(held.clock, context);
          await runtime.harness.waitForTask(held.clock, context);
        }
        await api.commit(async (tx) => {
          const doc = await tx.doc(AgentDoc);
          if (doc.schedules[id]?.clock === held.clock) delete doc.schedules[id];
        }, context);
        return result(`Cancelled ${id}.`);
      }
      if (action !== "add") return result("Action must be add, list or cancel.", true);
      let intent = await api.memo("add", context);
      if (!intent) {
        if (!["daily", "every", "once"].includes(kind) || typeof task !== "string" || !task.trim()) return result("A kind and task are required.", true);
        if (title !== undefined && typeof title !== "string") return result("Title must be text.", true);
        if (kind === "daily" && (typeof at !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(at))) return result("Daily time must be HH:MM.", true);
        if (kind === "once" && !validOnce(at, Date.now())) return result("Once time must be a future ISO time with a zone.", true);
        if (kind === "every" && (!Number.isInteger(everyMinutes) || everyMinutes < 15 || everyMinutes > 10080)) {
          return result("everyMinutes must be an integer from 15 to 10080.", true);
        }
        const home = (await agent.state()).home;
        if (!home?.conversationId) return result("The agent's home conversation is unavailable.", true);
        // Reserve before creating anything: even a deleted schedule keeps its replay identity.
        const id = await api.commit(async (tx) => nextId(await tx.doc(AgentDoc), "sc"), context);
        intent = await api.memo("add", { id, conversationId: home.conversationId, kind, at: kind === "every" ? null : at,
          everyMinutes: kind === "every" ? everyMinutes : null, task: task.trim(), title: title?.trim() || task.trim().slice(0, 80),
          createdAt: new Date().toISOString(), zone: agent.settings().timezone }, context);
      }
      if (!await api.memo("added", context)) {
        await api.commit(async (tx) => {
          const doc = await tx.doc(AgentDoc);
          if (doc.schedules[intent.id]) return;
          // Clock inputs survive cancellation and one-off completion, including a crash before the result memo.
          let cursor;
          do {
            const page = await tx.scanTasks({ kind: "conduit.agent-clock", conversationId: intent.conversationId }, 100, cursor);
            if (page.items.some((item) => item.input.scheduleId === intent.id)) return;
            cursor = page.next;
          } while (cursor);
          const { conversationId, ...item } = intent;
          item.clock = await tx.createTask(clock, { scheduleId: item.id }, clockOptions(conversationId));
          item.nextAt = new Date(nextTime(item, agent.settings().timezone, Date.now())).toISOString();
          doc.schedules[item.id] = { ...item, lastAt: null, system: false, callId: api.callId, by: api.conversationId };
        }, context);
        await api.memo("added", true, context);
      }
      const item = intent;
      return result(`Scheduled ${item.id}: ${item.title}`);
    },
  });
  return { tools: [schedule], tasks: [clock], addClocked: clockAdder(runtime) };
}

const seeding = new WeakMap();

/**
 * From before routines, once: a feed that reads (a program, a script) becomes a routine file (its task, gate never,
 * output inbox) and keeps what it has seen as its task's cursor; the heartbeat's place in the inbox becomes its
 * cursor. The feed's own clock goes (the routine's replaces it).
 */
async function feedsToRoutines(agent, harness, conversation) {
  const state = await agent.state();
  for (const item of Object.values(state.schedules)) {
    if (!item.feed || item.feed.source.kind === "run" || item.cancelling) continue;
    const name = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || item.id;
    if (!/^[a-z]/.test(name) || await readRoutine(agent.folder, name).catch(() => "invalid") !== null) continue;
    const source = item.feed.source;
    await writeRoutine(agent.folder, { name, title: item.title, trigger: { kind: "every", minutes: item.everyMinutes },
      tasks: [source.kind === "executor" ? { id: "items", kind: "executor", code: source.code } : { id: "items", kind: "script", command: source.command }],
      gate: "never", output: "inbox", model: null, effort: null, level: item.feed.level || "fyi", quiet: false, enabled: true, context: [], body: "" });
    if (item.clock) {
      await harness.abortTask(item.clock, agent.context);
      await harness.waitForTask(item.clock, agent.context);
    }
    await conversation.commit(async (tx) => {
      const doc = await tx.doc(AgentDoc);
      // Through the doc, not the object `||=` returns: only writes through it are recorded.
      doc.cursors ||= {};
      doc.cursors[name] = { items: { primed: item.feed.primed, seen: item.feed.seen || [] } };
      delete doc.schedules[item.id];
    }, agent.context);
  }
  if (state.heartbeatSeenAt && !state.cursors?.heartbeat) await conversation.commit(async (tx) => {
    const doc = await tx.doc(AgentDoc);
    doc.cursors ||= {};
    doc.cursors.heartbeat ||= { inbox: { since: doc.heartbeatSeenAt } };
  }, agent.context);
}

/** Keep settings-owned clocks stable across ordinary restarts. */
export async function seedSchedules(agent) {
  if (!agent?.enabled()) return;
  const previous = seeding.get(agent) || Promise.resolve();
  const work = previous.catch(() => {}).then(async () => {
    if (!agent.enabled()) return;
    const harness = await agent.runtime.open();
    const { conversationId } = await agent.home();
    if (!conversationId) return;
    const conversation = await harness.conversation(conversationId, agent.context);
    if (!conversation) return;
    const settings = agent.settings();
    await feedsToRoutines(agent, harness, conversation);
    // The routine files are the clocks the hub owns: one `r-<name>` each. A built-in schedule from before them (the
    // brief's, the heartbeat's) or one whose routine file went is removed.
    const desired = await routineClocks(agent);
    const schedules = (await agent.state()).schedules;
    const ids = new Set([...Object.keys(desired), ...Object.keys(schedules)]);
    for (const id of ids) {
      const old = (await agent.state()).schedules[id];
      if (old?.cancelling) continue;
      const target = Object.hasOwn(desired, id) ? desired[id] : old?.system ? null : old;
      const task = old?.clock ? await harness.getTask(old.clock, agent.context) : null;
      const live = task && !task.abortRequested && !["terminal", "completing"].includes(task.state.status);
      const changed = old && (!target || !live || task.conversationId !== conversationId || old.kind !== target.kind || old.at !== target.at || old.everyMinutes !== target.everyMinutes
        || (old.kind === "daily" && old.zone !== settings.timezone));
      if (old && !changed) {
        // Same clock, newer words (a built-in task's text changed in a release): take them without a new clock.
        if (target.task !== old.task) await conversation.commit(async (tx) => {
          const current = (await tx.doc(AgentDoc)).schedules[id];
          if (current && current.clock === old.clock) current.task = target.task;
        }, agent.context);
        continue;
      }
      if (old?.clock && task) {
        await harness.abortTask(old.clock, agent.context);
        await harness.waitForTask(old.clock, agent.context);
      }
      await conversation.commit(async (tx) => {
        const doc = await tx.doc(AgentDoc);
        if (old ? doc.schedules[id]?.clock !== old.clock : doc.schedules[id]) return;
        if (doc.schedules[id]?.cancelling) return;
        if (!target) { delete doc.schedules[id]; return; }
        const current = doc.schedules[id];
        const sameTime = current && current.kind === target.kind && current.at === target.at && current.everyMinutes === target.everyMinutes
          && (current.kind !== "daily" || current.zone === settings.timezone);
        const item = { ...target, id, clock: null, nextAt: sameTime ? current.nextAt : null, lastAt: current?.lastAt || null,
          system: Object.hasOwn(desired, id), createdAt: current?.createdAt || new Date().toISOString(), zone: settings.timezone };
        item.nextAt ||= new Date(nextTime({ ...item, lastAt: item.kind === "daily" && !sameTime ? null : item.lastAt }, settings.timezone, Date.now())).toISOString();
        item.clock = await tx.createTask(makeClock(agent.runtime), { scheduleId: id }, clockOptions(conversationId));
        doc.schedules[id] = item;
      }, agent.context);
    }
  });
  seeding.set(agent, work);
  try { await work; } finally { if (seeding.get(agent) === work) seeding.delete(agent); }
}

/** Remove a schedule or a feed the person or the agent made (not a settings-owned one): its clock first. */
export async function cancelSchedule(agent, id) {
  const marked = await agent.update((doc) => {
    const item = Object.hasOwn(doc.schedules, id) ? doc.schedules[id] : null;
    if (!item || item.system) return null;
    item.cancelling = true;
    return { clock: item.clock };
  });
  if (!marked) return false;
  const harness = await agent.runtime.open();
  if (marked.clock) {
    await harness.abortTask(marked.clock, agent.context).catch(() => {});
    await harness.waitForTask(marked.clock, agent.context).catch(() => {});
  }
  await agent.update((doc) => { if (doc.schedules[id]?.clock === marked.clock) delete doc.schedules[id]; });
  return true;
}

export async function listSchedules(agent) {
  if (!agent?.enabled()) return [];
  const zone = agent.settings().timezone;
  const now = Date.now();
  const state = await agent.state();
  // A routine that only gathers (no run) shows as a feed does: where it reads from and how its last firing went.
  const gathers = new Map((await listRoutines(agent.folder)).filter((routine) => !routine.error && routine.gate === "never")
    .map((routine) => [routine.name, routine.tasks[0]?.kind]));
  return Object.values(state.schedules).map((item) => {
    const { id, title, kind, at, everyMinutes, lastAt, system, routine } = item;
    const nextAt = item.nextAt || new Date(nextTime(item, zone, now)).toISOString();
    const last = routine && state.routineState?.[routine];
    const feed = item.feed ? { source: item.feed.source.kind, lastRunAt: item.feed.lastRunAt, lastCount: item.feed.lastCount, lastError: item.feed.lastError, primed: item.feed.primed }
      : gathers.has(routine) ? { source: gathers.get(routine) === "script" ? "script" : "executor", lastRunAt: last?.lastAt || null, lastCount: last?.fresh || 0,
        lastError: last?.lastError || null, primed: true } : null;
    return { id, title, kind, at, everyMinutes, nextAt, lastAt, system, ...(routine ? { routine, task: item.task } : {}), ...(feed ? { feed } : {}) };
  })
    .sort((a, b) => (a.nextAt || "9999").localeCompare(b.nextAt || "9999"));
}
