import { notice } from "../context/notices.js";
import fs from "node:fs/promises";
import path from "node:path";
import { entryText, listInbox } from "./inbox.js";
import { inboxEntryText } from "./inbox-files.js";
import { itemText, runSource, SEEN_KEPT } from "./feeds.js";
import { heldMailTask, mailTask } from "./mail-task.js";
import { defineTool } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { startRoutine } from "./routine-task.js";
import { listRoutines, parseRoutine, readFolderFile, readPerson, readRoutine, removeRoutine, renderVars, routineText, splitFrontMatter, updateTrigger, writeRoutine } from "./routine-files.js";

/**
 * Routines (docs/plans/persistent-agent.md, "Verbs and structures"): a trigger fires a routine; its tasks gather
 * without a model; its gate says whether its run fires; the run's report, or the tasks' new items, go to its output.
 * The files are routine-files.js's; the clock that fires them is schedule.js's. This is what happens in between.
 */

/** Every run's base prompt, in the agent's folder: what a run is, how it reports, how it ends. */
export const RUN_FILE = "RUN.md";
/** How much of the inbox a run's first message carries. */
const ENTRIES = 25;
const ENTRY_BODY = 6000;
const BLOCK_MAX = 40_000;
/** What threads and runs inferred, appended by `memory` note (memory.js), read by the `notes` task. */
export const NOTES_FILE = "NOTES.md";
/** How many recent declined proposals the `notes` task shows beside the notes. */
const DECLINED_SHOWN = 30;
/** A daily routine whose quiet-hours start is off fires at this time instead. */
const QUIET_FALLBACK = "23:00";
/** A NOTES.md line as memory.js writes it: `- <date> | <origin> | <text> <!-- conduit … at:<iso> -->`. */
const NOTE_LINE = /^- (\S+) \| (\S+) \| (.*) <!-- conduit by:\S+ chat:\S+ call:(\S+) at:(\S+) -->$/;
/** Opt-in context blocks a routine may ask for (`context:` in its front matter), by file. */
const CONTEXT_FILES = { soul: "SOUL.md", user: "USER.md", memory: "MEMORY.md" };

const escapeBlock = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attrText = (attrs = {}) => Object.entries(attrs).filter(([, value]) => value !== undefined && value !== null && value !== "")
  .map(([key, value]) => ` ${key}="${escapeBlock(value)}"`).join("");
/** Escape data so it cannot close or forge prompt blocks. */
export const block = (tag, attrs, text) => `<${tag}${attrText(attrs)}>\n${escapeBlock(String(text || "").trim())}\n</${tag}>`;

/** The {{variables}} prompts are filled with: the person's fields (USER.md front matter), the agent's, the time. */
export async function promptVars(agent, now = Date.now()) {
  const person = agent.folder ? await readPerson(agent.folder).catch(() => ({})) : {};
  const timezone = agent.settings().timezone;
  return {
    person: { name: person.name || "the person", home: person.home || "" },
    assistant: { name: agent.settings().name },
    timezone,
    now: new Date(now).toLocaleString("en-AU", { timeZone: timezone, dateStyle: "full", timeStyle: "short" }),
  };
}

async function readText(file) {
  return fs.readFile(file, "utf8").catch((error) => { if (error.code === "ENOENT") return ""; throw error; });
}
/** The agent's own folder is the agent's to change, so the hub reads it never through a link. */
const folderText = async (agent, ...parts) => (await readFolderFile(agent.folder, ...parts)) ?? "";

/**
 * A run's system prompt: RUN.md, then its routine's instructions as a `<routine>` block, then any context it opted
 * into. Stable between firings of one routine, so the provider's prompt cache holds.
 */
export async function runInstructions(agent, routine = null, now = Date.now()) {
  const { now: _now, ...vars } = await promptVars(agent, now);
  const store = agent.runtime?.contextStore;
  const parts = store ? [await store.assemble(routine ? `run:${routine.name}` : "run:task", { vars })] : [renderVars(await folderText(agent, RUN_FILE), vars).trim(), ...(routine?.body?.trim() ? [block("routine", { name: routine.name, title: routine.title }, renderVars(routine.body, vars))] : [])];
  const context = await routineContext(agent, routine, now);
  if (context) parts.push(context);
  return parts.filter(Boolean).join("\n\n");
}

export async function routineContext(agent, routine, now = Date.now()) {
  const parts = [];
  for (const name of routine?.context || []) {
    if (name === "diary") parts.push(block("diary", { day: agent.today(now) }, await folderText(agent, "diary", `${agent.today(now)}.md`)));
    else if (CONTEXT_FILES[name]) parts.push(block(name, {}, splitFrontMatter(await folderText(agent, CONTEXT_FILES[name])).body));
  }
  return parts.join("\n\n");
}

/** Conduit's own chats that finished since a time, outside the agent's workspace. */
function finishedChats(agent, since) {
  return agent.registry.list().filter((chat) => chat.projectId !== agent.project?.id && Date.parse(chat.lastAssistantCompletedAt || "") > since)
    .sort((left, right) => Date.parse(right.lastAssistantCompletedAt) - Date.parse(left.lastAssistantCompletedAt));
}

/** Midnight today in a time zone, as an epoch: the calendar reader's window starts there. */
function startOfDay(now, zone) {
  const local = new Date(new Date(now).toLocaleString("en-US", { timeZone: zone }));
  return now - (local.getHours() * 3600000 + local.getMinutes() * 60000 + local.getSeconds() * 1000);
}

/**
 * Events from today for `days` days, through Executor's Google Calendar (a built-in reader: the person writes no
 * program, only names the account). Events are state, not news: shown whole each time, never counted as new.
 */
const calendarProgram = ({ account, calendars = ["primary"], days = 2 }, now, zone) => {
  const start = startOfDay(now, zone);
  return `const range = { timeMin: ${JSON.stringify(new Date(start).toISOString())}, timeMax: ${JSON.stringify(new Date(start + days * 86400000).toISOString())} };
const lists = await Promise.all(${JSON.stringify(calendars)}.map((calendarId) => tools.google.api.calendar.calendars.calendarEventsList({
  accountId: ${JSON.stringify(account)}, input: { path: { calendarId }, query: { ...range, singleEvents: true, orderBy: "startTime", maxResults: 50 } } })));
return lists.flatMap((list) => list.items ?? []).map((event) => ({ id: event.id, title: event.summary ?? "(no title)",
  detail: event.location ?? "", at: event.start?.dateTime ?? event.start?.date, url: event.htmlLink }));`;
};

const clip = (text, max) => { const flat = String(text || "").replace(/\s+/g, " ").trim(); return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat; };

/** Lines in order until the block size runs out. */
function capped(items) {
  const shown = [];
  let size = 0;
  for (const item of items) {
    if (size + item.text.length > BLOCK_MAX) break;
    shown.push(item);
    size += item.text.length + 1;
  }
  return { shown, more: items.length - shown.length };
}

/** Pending notes are identified by their call provenance, never by their timestamps. */
export async function notesTask(agent, task, cursor, state) {
  const consumed = new Set(cursor.calls || []);
  const notes = (await folderText(agent, NOTES_FILE)).split(/\r?\n/).map((line) => NOTE_LINE.exec(line)).filter(Boolean)
    .filter((match) => !consumed.has(match[4]))
    .map((match) => ({ call: match[4], text: `- ${match[1]} | ${match[2]} | ${match[3]}` }));
  const { shown, more } = capped(notes);
  const declined = (state.declined || []).slice(-DECLINED_SHOWN).reverse()
    .map((item) => `- ${item.at.slice(0, 10)} · ${item.op} ${item.file}: ${clip(item.text, 300)}`);
  const text = notes.length ? `${shown.map((item) => item.text).join("\n")}${more ? `\n… and ${more} more, next time` : ""}` : "No new notes.";
  return { fresh: shown.length, cursor: { calls: [...consumed, ...shown.map((item) => item.call)] }, items: [],
    notes: block("notes", { new: shown.length }, text), declined: block("declined", {}, declined.join("\n") || "None."),
    block: block(task.id, { new: shown.length }, [text, ...(declined.length ? [`Declined by the person (never propose again without new evidence):\n${declined.join("\n")}`] : [])].join("\n\n")) };
}

/** One task, with its cursor: what it gathered as a block, how much of it is new, and the cursor to keep. */
async function runTask(agent, task, cursor, state, now, routineName) {
  const zone = agent.settings().timezone;
  if (task.kind === "inbox") {
    const filters = { for: task.for ?? routineName, kinds: task.kinds, addressed: task.addressed };
    // Never its own reports (a routine's run is kept in the inbox as a record, handled or not).
    const entries = listInbox(state, { ...filters, unhandled: !task.all }).filter((entry) => entry.kind !== routineName);
    const since = Date.parse(cursor.since || "") || 0;
    const eligibleAt = (entry) => Math.max(Date.parse(entry.at), Date.parse(entry.reopenedAt || "") || 0);
    const fresh = entries.filter((entry) => eligibleAt(entry) > since).sort((a, b) => eligibleAt(b) - eligibleAt(a));
    const shown = [];
    const inboxIds = [];
    let size = 0;
    for (const entry of fresh.slice(0, ENTRIES)) {
      const body = await inboxEntryText(agent, entry);
      const text = entryText({ ...entry, body: body ? body.slice(0, ENTRY_BODY) : "" }, zone);
      if (size + text.length > BLOCK_MAX) break;
      shown.push(text);
      inboxIds.push(entry.id);
      size += text.length;
    }
    const more = fresh.length - shown.length;
    return { fresh: fresh.length, cursor: fresh.length ? { since: new Date(eligibleAt(fresh[0])).toISOString() } : cursor, items: [], inboxIds,
      block: block(task.id, { new: fresh.length, unhandled: listInbox(state, { ...filters, unhandled: true }).length },
        fresh.length ? `${shown.join("\n")}${more ? `\n… and ${more} more (conduit_inbox list)` : ""}` : "Nothing new.") };
  }
  if (task.kind === "notes") return notesTask(agent, task, cursor, state);
  if (task.kind === "email") return mailTask(agent, task, cursor, { block, now });
  if (task.kind === "held-mail") return heldMailTask(agent, task, cursor, { block, now });
  if (task.kind === "chats") {
    const since = Date.parse(cursor.since || "") || now - 86400000;
    const chats = finishedChats(agent, since).slice(0, 30);
    return { fresh: chats.length, cursor: { since: new Date(now).toISOString() }, items: [],
      block: block(task.id, { finished: chats.length }, chats.map((chat) => `- ${chat.title || "Untitled chat"} (${chat.id})`).join("\n") || "None finished.") };
  }
  const source = task.kind === "calendar" ? { kind: "executor", code: calendarProgram(task, now, zone) }
    : task.kind === "executor" ? { kind: "executor", code: task.code } : { kind: "script", command: task.command };
  const outcome = await runSource(agent, source, { seen: task.kind === "calendar" ? [] : cursor.seen || [] });
  if (outcome.error) return { fresh: 0, cursor, items: [], error: outcome.error, block: block(task.id, { error: "yes" }, outcome.error) };
  if (task.kind === "calendar") {
    const events = [...outcome.items].sort((left, right) => String(left.at).localeCompare(String(right.at)));
    return { fresh: 0, cursor, items: [], block: block(task.id, { from: agent.today(now), days: task.days || 2 }, events.map(itemText).join("\n") || "No events.") };
  }
  // A stream: what it has not seen is new. The first firing only learns what is there.
  const seen = new Set(cursor.seen || []);
  const fresh = cursor.primed ? outcome.items.filter((item) => !seen.has(item.id)) : [];
  const next = { primed: true, seen: [...new Set([...outcome.items.map((item) => item.id), ...(cursor.seen || [])])].slice(0, SEEN_KEPT) };
  return { fresh: fresh.length, cursor: next, items: fresh, block: block(task.id, { new: fresh.length }, fresh.map(itemText).join("\n\n") || "Nothing new.") };
}

/**
 * Fire a routine: its tasks in order, its gate, and, when it runs, its run's prompt and first message. Returns plain
 * JSON (it is memoised by the clock), applied in a commit by `applyRoutine`. Never throws for a task's failure.
 */
export async function executeRoutine(agent, routine, { cursors = {}, state, now = Date.now(), force = false, event = null } = {}) {
  const next = {};
  const tasks = [];
  const blocks = [];
  let fresh = 0;
  const items = [];
  const taskVars = {};
  const inboxIds = [];
  const sources = [];
  for (const task of routine.tasks) {
    const done = await runTask(agent, task, cursors[task.id] || {}, state, now, routine.name).catch((error) => ({
      fresh: 0, cursor: cursors[task.id] || {}, items: [], error: error.message, block: block(task.id, { error: "yes" }, error.message) }));
    next[task.id] = done.cursor;
    tasks.push({ id: task.id, kind: task.kind, fresh: done.fresh, ...(done.error ? { error: done.error } : {}) });
    blocks.push(done.block);
    inboxIds.push(...(done.inboxIds || []));
    sources.push(...(done.sources || []));
    taskVars[task.id] = done.block;
    if (task.kind === "notes") Object.assign(taskVars, { notesBlock: done.notes, declinedBlock: done.declined });
    fresh += done.fresh;
    items.push(...done.items);
  }
  // What started it, when an event did (`trigger: { on: … }`): a line of its own; what it brought, its tasks gather.
  if (event) blocks.unshift(block("event", { name: event.name }, event.text));
  const run = force ? routine.gate !== "never" : routine.gate === "always" || (routine.gate === "when-new" && fresh > 0);
  if (!run) return { run: false, cursors: next, tasks, items, fresh };
  const vars = { ...await promptVars(agent, now), ...taskVars,
    windowStart: state.routineState?.[routine.name]?.completedAt || "the start of your home thread",
    windowEnd: new Date(now).toISOString(), reportPath: `reports/${routine.name}/${agent.today(now)}.md` };
  const rendered = { ...routine, body: renderVars(routine.body, vars) };
  return {
    run: true, cursors: next, tasks, items: [], fresh, inboxIds, sources,
    instructions: renderVars(await runInstructions(agent, rendered, now), vars),
    reportPath: vars.reportPath,
    prompt: [rendered.body, await routineContext(agent, routine, now), ...blocks].filter(Boolean).join("\n\n"),
    message: [await notice(agent.runtime?.contextStore, "wake-routine", { ...vars, routine }), ...blocks].join("\n\n"),
  };
}

/** Admission starts one durable lifecycle; gathering happens after prerequisites. */
export async function applyRoutine(tx, doc, agent, conversationId, routine, outcome, slot) {
  if (outcome?.skipped) return;
  return startRoutine(tx, doc, agent, conversationId, routine, slot, { outcome });
}

/** Commit all task cursors only after success, or when the gate starts no run. */
export function completeRoutine(doc, routine, outcome, at) {
  doc.cursors ||= {};
  doc.cursors[routine.name] = outcome.cursors;
  doc.routineState ||= {};
  doc.routineState[routine.name] = { ...doc.routineState[routine.name], ...(outcome.run ? { completedAt: at } : {}),
    fresh: outcome.fresh, ran: outcome.run,
    lastError: outcome.tasks.filter((task) => task.error).map((task) => `${task.id}: ${task.error}`).join("; ") || null };
}

/** The routines, valid ones as the clock wants them: `r-<name>` schedule items (schedule.js seeds their clocks). */
export async function routineClocks(agent) {
  const clocks = {};
  const quiet = agent.settings().quietHours;
  // `at: quiet`: the start of quiet hours, as they are now (a change to them reseeds the clocks).
  const time = (value) => value === "quiet" ? (quiet?.enabled && quiet.start ? quiet.start : QUIET_FALLBACK) : value;
  for (const routine of await listRoutines(agent.folder)) {
    if (routine.error || routine.enabled === false) continue;
    const { trigger } = routine;
    const clockRule = (rule) => ({ kind: rule.kind === "at" ? "daily" : rule.kind,
      at: rule.kind === "at" ? time(rule.time) : rule.kind === "once" ? rule.at : null,
      everyMinutes: rule.kind === "every" ? rule.minutes : null,
      ...(rule.during !== undefined ? { during: rule.during === "quiet" ? (quiet?.enabled ? `${quiet.start}-${quiet.end}` : null) : rule.during } : {}) });
    // A one-off whose time has passed has fired (or was missed): its file stays as a record, its clock does not.
    // An event's trigger (`on:`) has no clock: the event starts the routine (agent.js fireEvent).
    const timed = (Array.isArray(trigger) ? trigger : [trigger]).filter((rule) => rule.kind !== "on");
    const rules = timed.filter((rule) => rule.kind !== "once" || Date.parse(rule.at) >= Date.now() - 60_000).map(clockRule);
    if (!rules.length) continue;
    const windowed = timed.length > 1 || timed[0].during !== undefined;
    clocks[`r-${routine.name}`] = { ...(windowed ? { kind: "rules", rules } : rules[0]),
      title: routine.title, task: null, routine: routine.name };
  }
  return clocks;
}

/**
 * From before routines, once and never over a file: the brief's time and switch (agent.json) and the heartbeat's
 * switch become routines/morning-brief.md and routines/heartbeat.md from the seed; HEARTBEAT.md, whose instructions
 * the heartbeat routine's body now holds, goes. (Feeds become routines in schedule.js, which holds their state.)
 */
export async function migrateToRoutines(agent, seedDir) {
  const settings = agent.settings();
  for (const [name, adjust] of [
    ["morning-brief", (routine) => ({ ...routine, enabled: settings.brief.enabled !== false, trigger: settings.brief.at ? updateTrigger(routine.trigger, "at", { time: settings.brief.at }) : routine.trigger })],
    ["heartbeat", (routine) => ({ ...routine, enabled: settings.heartbeat.enabled !== false })],
  ]) {
    if (await readRoutine(agent.folder, name).catch(() => "invalid") !== null) continue;
    const seed = await readText(path.join(seedDir, `${name}.md`));
    if (!seed) continue;
    const original = parseRoutine(seed, name);
    const adjusted = adjust(original);
    if (JSON.stringify(adjusted) === JSON.stringify(original)) {
      // Preserve the exact seed bytes so future seed upgrades can identify it.
      const target = path.join(agent.folder, "routines", `${name}.md`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, seed, { flag: "wx" });
    } else await writeRoutine(agent.folder, adjusted);
    if (name === "heartbeat") await fs.unlink(path.join(agent.folder, "HEARTBEAT.md")).catch(() => {});
  }
}

/**
 * The Email routine (a Gmail reader on its own clock, filing into the context inbox) became the heartbeat's email task
 * (mail-task.js): once, its file goes when it is still the packaged one (its tasks as shipped), and what it had seen
 * becomes the heartbeat's email task's, so the next heartbeat reports only what is new. A Gmail routine the person
 * wrote or changed is theirs, and stays.
 */
export async function retireEmailRoutine(agent, historyDir) {
  const current = await readRoutine(agent.folder, "email").catch(() => null);
  if (!current) return;
  const shipped = [];
  for (const commit of JSON.parse(await readText(path.join(historyDir, "index.json")) || "[]")) {
    const text = await readText(path.join(historyDir, commit, "routines", "email.md"));
    if (text) shipped.push(JSON.stringify(parseRoutine(text, "email").tasks));
  }
  if (!shipped.includes(JSON.stringify(current.tasks))) return;
  await agent.update((doc) => {
    const seen = doc.cursors?.email?.items?.seen || [];
    doc.cursors ||= {};
    doc.cursors.heartbeat ||= {};
    if (seen.length && !doc.cursors.heartbeat.email) doc.cursors.heartbeat.email = { primed: true, seen };
    delete doc.cursors.email;
  });
  await removeRoutine(agent.folder, "email");
  for (const file of [path.join(".seeds", "routines", "email.md"), path.join(".seeds", "routines", "email.md.state.json")]) {
    await fs.rm(path.join(agent.folder, file), { force: true });
  }
}

const toolResult = (text, isError = false) => ({ output: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });
export const triggerWords = (trigger, compact = false) => {
  if (Array.isArray(trigger)) return trigger.map((rule) => triggerWords(rule, true)).join("; ");
  const words = trigger.kind === "every" ? (compact && trigger.minutes === 60 ? "hourly" : compact && trigger.minutes % 60 === 0 ? `every ${trigger.minutes / 60} hours` : `every ${trigger.minutes} min`)
    : trigger.kind === "on" ? `on ${trigger.event.replace(/-/g, " ")}`
    : trigger.kind === "at" ? (trigger.time === "quiet" ? "daily as quiet hours start" : `daily at ${trigger.time}`) : `once at ${trigger.at}`;
  return words + (trigger.during === "quiet" ? " in quiet hours" : trigger.during ? ` during ${trigger.during}` : "");
};
const TEST_SHOWN = 12_000;

/**
 * jbot's hand on its routines: list, read and test them freely; save (a new file or a change) and remove ask the person
 * (policy.js). A saved routine's clock follows at once.
 */
export function RoutineTools(runtime) {
  const routine = defineTool({
    name: "routine",
    description: "Your routines (routines/<name>.md): list, read one, test one (runs its tasks once and shows the first message "
      + "its run would get; moves nothing), save one (the whole file; the person approves) or remove one (the person approves). "
      + "Load the routines skill for the file's format before writing one.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list"), Type.Literal("read"), Type.Literal("test"), Type.Literal("save"), Type.Literal("remove")]),
      name: Type.Optional(Type.String({ description: "The file's name without .md: lowercase, digits and dashes." })),
      text: Type.Optional(Type.String({ description: "For test and save: the whole file. Test without it tests the saved one." })),
    }),
    replay: "safe",
    execute: async ({ action, name, text }, api, context) => {
      const agent = runtime.agent;
      if (!agent?.enabled()) return toolResult("The agent is not enabled.", true);
      try {
        if (action === "list") {
          const [state, routines] = await Promise.all([agent.state(), listRoutines(agent.folder)]);
          return toolResult(routines.map((item) => item.error ? `${item.name}: invalid (${item.error})`
            : `${item.name}: ${item.title} — ${triggerWords(item.trigger)}, gate ${item.gate}, to ${item.output}${item.enabled ? "" : ", off"}`
              + `${state.routineState?.[item.name]?.lastError ? `; last failed: ${state.routineState[item.name].lastError}` : ""}`).join("\n") || "No routines.");
        }
        if (typeof name !== "string" || !name) return toolResult("A routine name is required.", true);
        if (action === "read") {
          const file = (await routineText(agent.folder, name)) ?? "";
          return toolResult(file || `No routine ${name}.`, !file);
        }
        if (action === "remove") {
          const removed = await removeRoutine(agent.folder, name);
          if (removed) for (const listener of agent.settingsListeners) await listener(agent.settings());
          return toolResult(removed ? `Removed ${name}.` : `No routine ${name}.`, !removed);
        }
        const parsed = typeof text === "string" ? parseRoutine(text, name) : await readRoutine(agent.folder, name);
        if (!parsed) return toolResult(`No routine ${name}.`, true);
        if (action === "test") {
          const state = await agent.state();
          const outcome = await executeRoutine(agent, parsed, { cursors: state.cursors?.[name] || {}, state, force: true });
          const tasks = outcome.tasks.map((task) => `${task.id}: ${task.error ? `failed: ${task.error}` : `${task.fresh} new`}`).join("; ");
          const gate = parsed.gate === "never" ? "Its gate is never: no run; new items go to the inbox."
            : `On its clock its run would ${parsed.gate === "always" || outcome.fresh ? "fire" : "not fire (nothing new)"}.`;
          return toolResult(`${tasks || "No tasks."}\n${gate} A stream task's first firing only learns what is there.\n\n`
            + `${outcome.message ? outcome.message.slice(0, TEST_SHOWN) : outcome.items.map(itemText).join("\n\n").slice(0, TEST_SHOWN) || "(nothing new)"}`);
        }
        if (action !== "save") return toolResult("Action must be list, read, test, save or remove.", true);
        await writeRoutine(agent.folder, parsed);
        for (const listener of agent.settingsListeners) await listener(agent.settings());
        return toolResult(`Saved ${name}: ${triggerWords(parsed.trigger)}${parsed.enabled ? "" : " (off)"}.`);
      } catch (error) { return toolResult(error.message || "The routine could not be used.", true); }
    },
  });
  return { tools: [routine] };
}
