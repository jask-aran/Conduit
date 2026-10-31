import fs from "node:fs/promises";
import path from "node:path";
import { entryText, inQuietHours, listInbox } from "./inbox.js";
import { fileItems, itemText, runSource, SEEN_KEPT } from "./feeds.js";
import { defineTool } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { listRoutines, parseRoutine, readPerson, readRoutine, removeRoutine, renderVars, splitFrontMatter, writeRoutine } from "./routine-files.js";

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
/** Opt-in context blocks a routine may ask for (`context:` in its front matter), by file. */
const CONTEXT_FILES = { soul: "SOUL.md", user: "USER.md", memory: "MEMORY.md" };

const attrText = (attrs = {}) => Object.entries(attrs).filter(([, value]) => value !== undefined && value !== null && value !== "")
  .map(([key, value]) => ` ${key}="${String(value).replace(/"/g, "'")}"`).join("");
/** A tagged context block, as every prompt is composed from. */
export const block = (tag, attrs, text) => `<${tag}${attrText(attrs)}>\n${String(text || "").trim()}\n</${tag}>`;

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

/**
 * A run's system prompt: RUN.md, then its routine's instructions as a `<routine>` block, then any context it opted
 * into. Stable between firings of one routine, so the provider's prompt cache holds.
 */
export async function runInstructions(agent, routine = null, now = Date.now()) {
  const vars = await promptVars(agent, now);
  const base = await readText(path.join(agent.folder, RUN_FILE));
  const parts = [renderVars(base, vars).trim()];
  if (routine?.body?.trim()) parts.push(block("routine", { name: routine.name, title: routine.title }, renderVars(routine.body, vars)));
  for (const name of routine?.context || []) {
    if (name === "diary") parts.push(block("diary", { day: agent.today(now) }, await readText(path.join(agent.folder, "diary", `${agent.today(now)}.md`))));
    else if (CONTEXT_FILES[name]) parts.push(block(name, {}, splitFrontMatter(await readText(path.join(agent.folder, CONTEXT_FILES[name]))).body));
  }
  return parts.filter(Boolean).join("\n\n");
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

/** One task, with its cursor: what it gathered as a block, how much of it is new, and the cursor to keep. */
async function runTask(agent, task, cursor, state, now) {
  const zone = agent.settings().timezone;
  if (task.kind === "inbox") {
    const entries = listInbox(state, task.all ? {} : { unhandled: true });
    const since = Date.parse(cursor.since || "") || 0;
    const fresh = entries.filter((entry) => Date.parse(entry.at) > since);
    const shown = [];
    let size = 0;
    for (const entry of fresh.slice(0, ENTRIES)) {
      const text = entryText({ ...entry, body: entry.body ? String(entry.body).slice(0, ENTRY_BODY) : "" }, zone);
      if (size + text.length > BLOCK_MAX) break;
      shown.push(text);
      size += text.length;
    }
    const more = fresh.length - shown.length;
    return { fresh: fresh.length, cursor: fresh.length ? { since: fresh[0].at } : cursor, items: [],
      block: block(task.id, { new: fresh.length, unhandled: listInbox(state, { unhandled: true }).length },
        fresh.length ? `${shown.join("\n")}${more ? `\n… and ${more} more (inbox list)` : ""}` : "Nothing new.") };
  }
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
export async function executeRoutine(agent, routine, { cursors = {}, state, now = Date.now(), force = false } = {}) {
  if (!force && routine.quiet !== false && inQuietHours(agent.settings(), now)) return { skipped: "quiet" };
  const next = {};
  const tasks = [];
  const blocks = [];
  let fresh = 0;
  const items = [];
  for (const task of routine.tasks) {
    const done = await runTask(agent, task, cursors[task.id] || {}, state, now).catch((error) => ({
      fresh: 0, cursor: cursors[task.id] || {}, items: [], error: error.message, block: block(task.id, { error: "yes" }, error.message) }));
    next[task.id] = done.cursor;
    tasks.push({ id: task.id, kind: task.kind, fresh: done.fresh, ...(done.error ? { error: done.error } : {}) });
    blocks.push(done.block);
    fresh += done.fresh;
    items.push(...done.items);
  }
  const run = force ? routine.gate !== "never" : routine.gate === "always" || (routine.gate === "when-new" && fresh > 0);
  if (!run) return { run: false, cursors: next, tasks, items, fresh };
  const vars = await promptVars(agent, now);
  return {
    run: true, cursors: next, tasks, items: [], fresh,
    instructions: await runInstructions(agent, routine, now),
    message: [`It is ${vars.now}. ${routine.title} (the ${routine.name} routine).`, ...blocks].join("\n\n"),
  };
}

/** The work settings a routine's run takes when its file names no model: the brief's, the heartbeat's, or other. */
const workKind = (name) => name === "morning-brief" ? "brief" : name === "heartbeat" ? "heartbeat" : "other";

/** What a firing did, in the commit that keeps its cursors: start its run, or file its tasks' new items. */
export async function applyRoutine(tx, doc, agent, conversationId, routine, outcome, slot) {
  doc.cursors ||= {};
  doc.routineState ||= {};
  if (outcome.skipped) return;
  doc.cursors[routine.name] = outcome.cursors;
  const errors = outcome.tasks.filter((task) => task.error).map((task) => `${task.id}: ${task.error}`);
  doc.routineState[routine.name] = { lastAt: slot, fresh: outcome.fresh, ran: outcome.run, lastError: errors.join("; ") || null };
  if (outcome.run) {
    const work = agent.settings().work[workKind(routine.name)];
    const model = routine.model || work?.model || null;
    await agent.spawnRun(tx, conversationId, { key: `r-${routine.name}:${slot}`, kind: routine.name, title: routine.title,
      task: outcome.message, instructions: outcome.instructions, output: routine.output, raw: true,
      ...(model ? { model, thinkingLevel: routine.effort || (routine.model ? null : work?.thinkingLevel) || null } : {}) });
  } else if (routine.output !== "jbot" && outcome.items.length) {
    fileItems(doc, { key: `r-${routine.name}:${slot}`, title: routine.title, feedId: `r-${routine.name}`, level: routine.level }, outcome.items, slot);
  }
}

/** The routines, valid ones as the clock wants them: `r-<name>` schedule items (schedule.js seeds their clocks). */
export async function routineClocks(agent) {
  const clocks = {};
  for (const routine of await listRoutines(agent.folder)) {
    if (routine.error || routine.enabled === false) continue;
    const { trigger } = routine;
    // A one-off whose time has passed has fired (or was missed): its file stays as a record, its clock does not.
    if (trigger.kind === "once" && Date.parse(trigger.at) < Date.now() - 60_000) continue;
    clocks[`r-${routine.name}`] = { kind: trigger.kind === "at" ? "daily" : trigger.kind, at: trigger.kind === "at" ? trigger.time : trigger.kind === "once" ? trigger.at : null,
      everyMinutes: trigger.kind === "every" ? trigger.minutes : null, title: routine.title, task: null, routine: routine.name };
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
    ["morning-brief", (routine) => ({ ...routine, enabled: settings.brief.enabled !== false, trigger: { kind: "at", time: settings.brief.at || routine.trigger.time } })],
    ["heartbeat", (routine) => ({ ...routine, enabled: settings.heartbeat.enabled !== false })],
  ]) {
    if (await readRoutine(agent.folder, name).catch(() => "invalid") !== null) continue;
    const seed = await readText(path.join(seedDir, `${name}.md`));
    if (!seed) continue;
    await writeRoutine(agent.folder, adjust(parseRoutine(seed, name)));
    if (name === "heartbeat") await fs.unlink(path.join(agent.folder, "HEARTBEAT.md")).catch(() => {});
  }
}

const toolResult = (text, isError = false) => ({ output: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });
const triggerWords = (trigger) => trigger.kind === "every" ? `every ${trigger.minutes} min` : trigger.kind === "at" ? `daily at ${trigger.time}` : `once at ${trigger.at}`;
const TEST_SHOWN = 12_000;

/**
 * jbot's hand on its routines: list, read and test them freely; save (a new file or a change) and remove ask the person
 * (policy.js). A saved routine's clock follows at once.
 */
export function RoutineTools(runtime) {
  const routine = defineTool({
    name: "routine",
    description: "Your routines (routines/<name>.md): list, read one, test one (runs its tasks once and shows the first message "
      + "its run would get; moves nothing), save one (the whole file: YAML front matter, then the run's instructions; the "
      + "person approves) or remove one (the person approves). Front matter: title; trigger { every: minutes } | { at: \"HH:MM\" } "
      + "| { once: ISO time }; tasks, each { id, kind } with kind inbox (all?: true for handled too), calendar (account, "
      + "calendars?, days?), chats, executor (code: a read-only program returning a JSON list of { id, title, detail?, text?, "
      + "at?, url? }) or script (command printing that JSON); gate always | when-new | never; output jbot | inbox | both; "
      + "model?, effort?, level?, quiet?, enabled?, context? (soul, user, memory, diary).",
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
          const state = await agent.state();
          return toolResult((await listRoutines(agent.folder)).map((item) => item.error ? `${item.name}: invalid (${item.error})`
            : `${item.name}: ${item.title} — ${triggerWords(item.trigger)}, gate ${item.gate}, to ${item.output}${item.enabled ? "" : ", off"}`
              + `${state.routineState?.[item.name]?.lastError ? `; last failed: ${state.routineState[item.name].lastError}` : ""}`).join("\n") || "No routines.");
        }
        if (typeof name !== "string" || !name) return toolResult("A routine name is required.", true);
        if (action === "read") {
          const file = await readText(path.join(agent.folder, "routines", `${name}.md`));
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
