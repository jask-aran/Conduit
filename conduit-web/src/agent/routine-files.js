import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { isReadAction, programPaths } from "./policy.js";

export const ROUTINES_DIR = "routines";
const PERSON_FIELDS = ["name", "assistant", "timezone", "home"];

const namePattern = /^[a-z][a-z0-9-]{0,40}$/;
const idPattern = /^[a-z][a-z0-9-]{0,30}$/;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keysOnly = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
/** Fields a task kind takes besides its id, kind and program. */
const TASK_FIELDS = { inbox: ["all", "for", "kinds", "except", "addressed"], calendar: ["account", "calendars", "days"], email: ["query", "max"] };
/** What an `on:` trigger can name: an email to jbot from someone who does not wake it (email.js). */
const EVENTS = ["held-mail"];
const oneLine = (error) => String(error.message || error).split(/\r?\n/)[0];

export const settingRule = (trigger, kind) => Array.isArray(trigger)
  ? trigger.find((rule) => rule.kind === kind && rule.during === undefined) || trigger.find((rule) => rule.kind === kind)
  : trigger.kind === kind ? trigger : null;
export const updateTrigger = (trigger, kind, change) => {
  if (!Array.isArray(trigger)) return { kind, ...change };
  const selected = settingRule(trigger, kind);
  return selected ? trigger.map((rule) => rule === selected ? { ...rule, ...change } : rule) : trigger;
};

/** Separate the delimiters without changing the body. */
export function splitFrontMatter(text) {
  const first = text.match(/^---\r?\n/);
  if (!first) return { data: {}, body: text };
  const rest = text.slice(first[0].length);
  const end = /^(?:---)(?:\r?\n|$)/m.exec(rest);
  if (!end) throw new Error("Front matter has no closing delimiter.");
  let data;
  try { data = YAML.parse(rest.slice(0, end.index)); }
  catch (error) { throw new Error(`Invalid YAML: ${oneLine(error)}`); }
  if (data === null) data = {};
  if (!object(data)) throw new Error("Front matter must be a map.");
  return { data, body: rest.slice(end.index + end[0].length) };
}

export function routineProblem(routine) {
  if (!object(routine)) return "A routine is required.";
  const fields = ["name", "title", "trigger", "tasks", "gate", "output", "model", "effort",
    "level", "quiet", "enabled", "log", "context", "body", "mode", "before", "after", "working"];
  const unknownField = Object.keys(routine).find((key) => !fields.includes(key));
  if (unknownField) return `Unknown routine field ${unknownField}.`;
  if (typeof routine.name !== "string" || !namePattern.test(routine.name)) return "Invalid routine name.";
  // What a block is shown doing in Working on (work-log.js): a few words, in place of the default for its kind.
  const labelled = (value) => value === undefined || (typeof value === "string" && value.trim().length > 0 && value.length <= 60);
  if (!labelled(routine.working)) return "Working is a few words (at most 60 characters).";
  if (typeof routine.title !== "string" || !routine.title.trim()) return "A title is required.";
  const triggers = Array.isArray(routine.trigger) ? routine.trigger : [routine.trigger];
  if (!triggers.length) return "A valid trigger is required.";
  for (const trigger of triggers) {
    if (!object(trigger)) return "A valid trigger is required.";
    if (trigger.kind === "every") {
      if (!keysOnly(trigger, ["kind", "minutes", "during"]) || !Number.isInteger(trigger.minutes)
        || trigger.minutes < 5 || trigger.minutes > 1440) return "Every must be a whole number from 5 to 1440 minutes.";
    } else if (trigger.kind === "at") {
      // `quiet`: the start of the person's quiet hours, whatever they are set to (routines.js routineClocks).
      if (!keysOnly(trigger, ["kind", "time", "during"]) || typeof trigger.time !== "string"
        || !(trigger.time === "quiet" || /^([01]\d|2[0-3]):[0-5]\d$/.test(trigger.time))) return "At must be a time in HH:MM format, or quiet.";
    } else if (trigger.kind === "once") {
      const iso = /^(\d{4})-(\d\d)-(\d\d)T\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/;
      const match = typeof trigger.at === "string" && iso.exec(trigger.at);
      const date = match && new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
      if (!keysOnly(trigger, ["kind", "at", "during"]) || !match || !Number.isFinite(Date.parse(trigger.at))
        || !date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== match[0].slice(0, 10)) {
        return "Once must be an ISO date-time with a timezone.";
      }
    } else if (trigger.kind === "on") {
      if (!keysOnly(trigger, ["kind", "event"]) || !EVENTS.includes(trigger.event)) return `On must name an event: ${EVENTS.join(", ")}.`;
    } else return "A valid trigger is required.";
    if (trigger.during !== undefined && (typeof trigger.during !== "string"
      || !(trigger.during === "quiet" || /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(trigger.during))
      || (trigger.during !== "quiet" && trigger.during.slice(0, 5) === trigger.during.slice(6)))) {
      return "During must be quiet or HH:MM-HH:MM, with different start and end times.";
    }
  }
  if (routine.mode !== undefined && !["run", "fork"].includes(routine.mode)) return "Mode must be run or fork.";
  for (const field of ["before", "after"]) {
    const steps = routine[field] === undefined ? [] : routine[field];
    if (!Array.isArray(steps)) return `${field} must be a list.`;
    for (const given of steps) {
      if (!object(given)) return `Invalid ${field} step.`;
      if (!labelled(given.label)) return `A ${field} step's label is a few words (at most 60 characters).`;
      const { label: _label, ...step } = given;
      if (field === "before") {
        if (!keysOnly(step, ["routine", "ifMissedSince"]) || (typeof step.routine !== "string" || !namePattern.test(step.routine))
          || step.ifMissedSince !== "last") return "Before requires { routine: name, ifMissedSince: last }.";
      } else if (keysOnly(step, ["routine"]) && typeof step.routine === "string" && namePattern.test(step.routine)) {
        // A dependency is checked for cycles below and against saved files before use.
      } else if (keysOnly(step, ["message"]) && step.message === "jbot") {
        // The final text is sent regardless of output.
      } else if (keysOnly(step, ["compact"]) && object(step.compact)) {
        const options = step.compact;
        if (!keysOnly(options, ["minTokens", "minShare"])
          || (options.minTokens !== undefined && (!Number.isInteger(options.minTokens) || options.minTokens < 0))
          || (options.minShare !== undefined && (!Number.isFinite(options.minShare) || options.minShare < 0 || options.minShare > 1))) return "Invalid compact thresholds.";
      } else return "Invalid after step.";
      if (step.routine === routine.name) return `Routine cycle: ${routine.name} -> ${routine.name}.`;
    }
  }
  if (!Array.isArray(routine.tasks)) return "Tasks must be a list.";
  const ids = new Set();
  for (const task of routine.tasks) {
    if (!object(task) || typeof task.id !== "string" || !idPattern.test(task.id)) return "Each task needs a valid id.";
    if (ids.has(task.id)) return "Task ids must be unique.";
    ids.add(task.id);
    if (!["inbox", "email", "held-mail", "calendar", "chats", "notes", "executor", "script"].includes(task.kind)) return "Invalid task kind.";
    const field = task.kind === "executor" ? "code" : task.kind === "script" ? "command" : null;
    const extra = TASK_FIELDS[task.kind] || [];
    if (!labelled(task.label)) return `Task ${task.id}: label is a few words (at most 60 characters).`;
    const unknown = Object.keys(task).find((key) => !["id", "kind", "label", ...(field ? [field] : []), ...extra].includes(key));
    if (unknown) return `Unknown field ${unknown} on task ${task.id}.`;
    if (task.kind === "inbox" && task.all !== undefined && typeof task.all !== "boolean") return `Task ${task.id}: all is true or false.`;
    if (task.kind === "inbox") {
      if (task.for !== undefined && (typeof task.for !== "string" || !namePattern.test(task.for))) return `Task ${task.id}: for must be a routine name.`;
      if (task.addressed !== undefined && task.addressed !== "only") return `Task ${task.id}: addressed must be only.`;
      if (task.kinds !== undefined && (!Array.isArray(task.kinds) || !task.kinds.length
        || task.kinds.some((kind) => typeof kind !== "string" || !namePattern.test(kind)))) return `Task ${task.id}: kinds must be a nonempty list of entry kinds.`;
      if (task.except !== undefined && (!Array.isArray(task.except) || !task.except.length
        || task.except.some((kind) => typeof kind !== "string" || !namePattern.test(kind)))) return `Task ${task.id}: except must be a nonempty list of entry kinds.`;
    }
    if (task.kind === "calendar") {
      if (typeof task.account !== "string" || !task.account) return `Task ${task.id}: the calendar's Executor account is required.`;
      if (task.calendars !== undefined && (!Array.isArray(task.calendars) || !task.calendars.length || task.calendars.some((id) => typeof id !== "string" || !id))) {
        return `Task ${task.id}: calendars is a list of calendar ids.`;
      }
      if (task.days !== undefined && (!Number.isInteger(task.days) || task.days < 1 || task.days > 14)) return `Task ${task.id}: days is 1 to 14.`;
    }
    if (task.kind === "email") {
      if (task.query !== undefined && (typeof task.query !== "string" || !task.query.trim() || task.query.length > 300)) return `Task ${task.id}: query is a Gmail search.`;
      if (task.max !== undefined && (!Number.isInteger(task.max) || task.max < 1 || task.max > 50)) return `Task ${task.id}: max is 1 to 50.`;
    }
    if (field && (typeof task[field] !== "string" || task[field].length > (field === "code" ? 8000 : 4000))) {
      return `Invalid task ${field}.`;
    }
    // A task only gathers: what its program calls is read before it runs, as a feed's is.
    if (task.kind === "executor") {
      const paths = programPaths(task.code);
      if (!paths) return `Task ${task.id}: the program must call its tools by literal path (tools.app.action(...)).`;
      const writes = paths.filter((item) => !isReadAction(item));
      if (writes.length) return `Task ${task.id} only reads; its program also calls ${writes.join(", ")}.`;
    }
  }
  if (!["always", "when-new", "never"].includes(routine.gate)) return "Invalid gate.";
  if (!["jbot", "inbox", "both"].includes(routine.output)) return "Invalid output.";
  if (routine.model !== null && (typeof routine.model !== "string" || !/^[^\s/]+\/[^\s/]+$/.test(routine.model))) {
    return "Model must be provider/model.";
  }
  if (routine.effort !== null && !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(routine.effort)) {
    return "Invalid effort.";
  }
  if (!["fyi", "attention", "urgent"].includes(routine.level)) return "Invalid level.";
  if (typeof routine.quiet !== "boolean") return "Quiet must be true or false.";
  if (typeof routine.enabled !== "boolean") return "Enabled must be true or false.";
  if (routine.log !== undefined && typeof routine.log !== "boolean") return "Log must be true or false.";
  if (!Array.isArray(routine.context)
    || routine.context.some((item) => !["soul", "user", "memory", "diary"].includes(item))) return "Invalid context.";
  if (typeof routine.body !== "string" || (routine.gate !== "never" && !routine.body.trim())) {
    return "A body is required unless the gate is never.";
  }
  return null;
}

export function parseRoutine(text, name) {
  if (!/^---\r?\n/.test(text)) throw new Error("Front matter is required.");
  const { data, body } = splitFrontMatter(text);
  const fields = ["title", "trigger", "tasks", "gate", "output", "model", "effort", "level", "quiet", "enabled", "log",
    "context", "mode", "before", "after", "working"];
  const unknownKey = Object.keys(data).find((key) => !fields.includes(key));
  if (unknownKey) throw new Error(`Unknown field ${unknownKey} in the front matter.`);
  const parseTrigger = (input) => {
    if (object(input) && Object.hasOwn(input, "on")) return keysOnly(input, ["on"]) ? { kind: "on", event: input.on } : null;
    if (!object(input) || !keysOnly(input, ["every", "at", "once", "during"])
      || ["every", "at", "once"].filter((key) => Object.hasOwn(input, key)).length !== 1) return null;
    const during = Object.hasOwn(input, "during") ? { during: input.during } : {};
    if (Object.hasOwn(input, "every")) return { kind: "every", minutes: input.every, ...during };
    if (Object.hasOwn(input, "at")) return { kind: "at", time: input.at, ...during };
    return { kind: "once", at: input.once, ...during };
  };
  const trigger = Array.isArray(data.trigger) ? data.trigger.map(parseTrigger) : parseTrigger(data.trigger);
  const routine = { name, mode: data.mode === undefined ? "run" : data.mode,
    before: data.before === undefined ? [] : data.before, after: data.after === undefined ? [] : data.after, title: data.title === undefined ? name : data.title, trigger,
    tasks: data.tasks === undefined ? [] : data.tasks, gate: data.gate, output: data.output,
    model: data.model === undefined ? null : data.model, effort: data.effort === undefined ? null : data.effort,
    level: data.level === undefined ? "fyi" : data.level, quiet: data.quiet === undefined ? true : data.quiet,
    enabled: data.enabled === undefined ? true : data.enabled, log: data.log === undefined ? true : data.log,
    context: data.context === undefined ? [] : data.context, ...(data.working !== undefined ? { working: data.working } : {}),
    body: body.replace(/^\r?\n/, "").replace(/\n$/, "") };
  const problem = routineProblem(routine);
  if (problem) throw new Error(problem);
  return routine;
}

export function serializeRoutine(routine) {
  const problem = routineProblem(routine);
  if (problem) throw new Error(problem);
  const { name, title, trigger, tasks, gate, output, model, effort, level, enabled, context, body } = routine;
  const writeTrigger = (rule) => rule.kind === "on" ? { on: rule.event } : ({ ...(rule.kind === "every" ? { every: rule.minutes }
    : rule.kind === "at" ? { at: rule.time } : { once: rule.at }), ...(rule.during !== undefined ? { during: rule.during } : {}) });
  const data = { ...(routine.mode === "fork" ? { mode: "fork" } : {}),
    ...(routine.before?.length ? { before: routine.before } : {}), ...(routine.after?.length ? { after: routine.after } : {}), ...(title !== name ? { title } : {}),
    trigger: Array.isArray(trigger) ? trigger.map(writeTrigger) : writeTrigger(trigger),
    ...(tasks.length ? { tasks } : {}), gate, output, ...(model !== null ? { model } : {}),
    ...(effort !== null ? { effort } : {}), ...(level !== "fyi" ? { level } : {}),
    ...(!enabled ? { enabled } : {}), ...(routine.working ? { working: routine.working } : {}), ...(routine.log === false ? { log: false } : {}), ...(routine.quiet === false ? { quiet: false } : {}), ...(context.length ? { context } : {}) };
  const doc = new YAML.Document(data);
  if (Array.isArray(trigger)) {
    for (const rule of doc.get("trigger", true).items) rule.flow = true;
  } else doc.get("trigger", true).flow = true;
  for (const task of doc.get("tasks", true)?.items || []) {
    const field = task.get("kind") === "executor" ? "code" : task.get("kind") === "script" ? "command" : null;
    const value = field && task.get(field, true);
    if (value && value.value.includes("\n")) value.type = "BLOCK_LITERAL";
    else task.flow = true;
  }
  if (context.length) doc.get("context", true).flow = true;
  return `---\n${doc.toString({ lineWidth: 0 })}---\n\n${body}\n`;
}

function routinePath(folder, name) {
  if (typeof name !== "string" || !namePattern.test(name)) throw new Error("Invalid routine name.");
  return path.join(folder, ROUTINES_DIR, `${name}.md`);
}

/**
 * A file of the agent's folder, read by the hub (outside the sandbox): never through a link, which the agent can make
 * point anywhere on the hub. Null when it is not there.
 */
async function readFolderBytes(folder, ...parts) {
  let handle;
  try {
    const file = path.join(await fs.realpath(folder), ...parts);
    if (await fs.realpath(path.dirname(file)) !== path.dirname(file)) throw new Error(`${parts.join("/")} must not be under a link.`);
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    return await handle.readFile();
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error.code === "ELOOP") throw new Error(`${parts.join("/")} must not be a link.`);
    throw error;
  } finally { await handle?.close(); }
}

export async function readFolderFile(folder, ...parts) {
  const bytes = await readFolderBytes(folder, ...parts);
  return bytes === null ? null : bytes.toString("utf8");
}

export async function writeFolderFile(folder, name, content) {
  await readFolderFile(folder, name);
  const root = await fs.realpath(folder);
  await writeFile(path.join(root, name), content);
}

export async function routineText(folder, name) {
  if (typeof name !== "string" || !namePattern.test(name)) throw new Error("Invalid routine name.");
  return readFolderFile(folder, ROUTINES_DIR, `${name}.md`);
}

/** A temporary file in the same directory makes replacement atomic. */
async function writeFile(file, text) {
  const temp = path.join(path.dirname(file), `.conduit-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`);
  let created = false;
  try {
    await fs.writeFile(temp, text, { flag: "wx" });
    created = true;
    await fs.rename(temp, file);
  } finally {
    if (created) await fs.unlink(temp).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

export async function listRoutines(folder) {
  let files;
  try { files = await fs.readdir(path.join(folder, ROUTINES_DIR)); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const result = [];
  for (const file of files.filter((item) => item.endsWith(".md")).sort()) {
    const name = file.slice(0, -3);
    try { const routine = await readRoutine(folder, name); if (routine) result.push(routine); }
    catch (error) { result.push({ name, error: oneLine(error) }); }
  }
  return result;
}

export async function readRoutine(folder, name) {
  const text = await routineText(folder, name);
  return text === null ? null : parseRoutine(text, name);
}

/** Validate both dependency directions; unavailable targets cannot form a cycle yet. */
export async function validateRoutineGraph(folder, candidate) {
  const routines = new Map((await listRoutines(folder)).filter((item) => !item.error).map((item) => [item.name, item]));
  routines.set(candidate.name, candidate);
  const visited = new Set();
  const visit = (name, stack) => {
    if (stack.includes(name)) throw new Error(`Routine cycle: ${[...stack, name].join(" -> ")}.`);
    if (visited.has(name)) return;
    const routine = routines.get(name);
    for (const step of [...(routine?.before || []), ...(routine?.after || [])]) {
      if (step.routine) visit(step.routine, [...stack, name]);
    }
    visited.add(name);
  };
  visit(candidate.name, []);
}

export async function writeRoutine(folder, routine) {
  const text = serializeRoutine(routine);
  await validateRoutineGraph(folder, routine);
  const file = routinePath(folder, routine.name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

export async function removeRoutine(folder, name) {
  try { await fs.unlink(routinePath(folder, name)); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

const digest = (text) => createHash("sha256").update(text).digest("hex");
const SEED_HISTORY = new URL("../../../templates/agent/seed-history/", import.meta.url);
const seedStatePath = (relative) => path.join(".seeds", `${relative}.state.json`);
const isRoutineSeed = (relative) => relative.startsWith(`${ROUTINES_DIR}/`);
const seedBody = (relative, text) => isRoutineSeed(relative) ? splitFrontMatter(text).body.trim() : text;
const sameSeedBody = (relative, left, right) => {
  try { return seedBody(relative, left) === seedBody(relative, right); }
  catch { return false; } // Broken front matter is never permission to replace a body.
};

/** Check each directory before creating its children: no writes through an agent-made link. */
async function seedDirectory(folder, ...parts) {
  let directory = await fs.realpath(folder);
  for (const part of parts) {
    directory = path.join(directory, part);
    await fs.mkdir(directory).catch((error) => { if (error.code !== "EEXIST") throw error; });
    if (await fs.realpath(directory) !== directory) throw new Error(`${parts.join("/")} must not be under a link.`);
  }
}

async function seedState(folder, relative) {
  const text = await readFolderFile(folder, seedStatePath(relative));
  return text === null ? {} : JSON.parse(text);
}

async function saveSeedState(folder, relative, state) {
  await seedDirectory(folder, ".seeds", ...path.dirname(relative).split("/").filter((part) => part !== "."));
  await writeFolderFile(folder, seedStatePath(relative), `${JSON.stringify(state)}\n`);
}

/** Pending offers survive edits and reloads, but accepting the actual template clears the offer. */
export async function seedTemplateUpdate(folder, relative, template) {
  const state = await seedState(folder, relative);
  const current = await readFolderFile(folder, relative);
  return Boolean((state.waiting || state.pending?.waiting) && current !== null && !sameSeedBody(relative, current, template));
}

export async function acceptSeedTemplate(folder, relative, template) {
  const current = await readFolderFile(folder, relative);
  if (current === null || !sameSeedBody(relative, current, template)) return;
  await saveSeedState(folder, relative, {});
  await writeFolderFile(folder, path.join(".seeds", relative), template);
}

async function historicalSeeds(historyDir, relative) {
  const index = await fs.readFile(new URL("index.json", historyDir), "utf8").catch((error) => {
    if (error.code === "ENOENT") return "[]";
    throw error;
  });
  const versions = [];
  for (const commit of JSON.parse(index)) {
    const text = await fs.readFile(new URL(`${commit}/${relative}`, historyDir), "utf8").catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (text !== null && !versions.includes(text)) versions.push(text);
  }
  return versions;
}

/** Upgrade RUN.md and routines from saved template bytes, independently of Settings changes. */
export async function seedRoutines(folder, seedDir) {
  let files;
  try { files = await fs.readdir(seedDir); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  await seedDirectory(folder, ROUTINES_DIR);
  const legacyText = await readFolderFile(folder, ROUTINES_DIR, ".seeds.json");
  const legacy = legacyText === null ? {} : JSON.parse(legacyText);
  if (!object(legacy)) throw new Error("Invalid routine seed record.");
  const sources = files.filter((file) => file.endsWith(".md")).map((file) => ({
    relative: `${ROUTINES_DIR}/${file}`, source: path.join(seedDir, file),
  }));
  const runSeed = path.join(seedDir, "..", "RUN.md");
  if (await fs.stat(runSeed).then(() => true, (error) => { if (error.code === "ENOENT") return false; throw error; })) {
    sources.push({ relative: "RUN.md", source: runSeed });
  }
  for (const { relative, source } of sources) {
    const seed = await fs.readFile(source, "utf8");
    let current = await readFolderFile(folder, relative);
    let state = await seedState(folder, relative);
    // Journal the output and its input before replacement. A crash can occur on either side of the rename.
    if (state.pending) {
      const pending = state.pending;
      if (current === pending.before) {
        await writeFolderFile(folder, relative, pending.after);
        current = pending.after;
      }
      // An intervening edit is merged against the input base, including Settings-only changes before replacement.
      const recoveredBase = current === pending.after ? pending.base ?? pending.seed : pending.previousBase;
      if (recoveredBase !== undefined) await writeFolderFile(folder, path.join(".seeds", relative), recoveredBase);
      state = { waiting: current !== null && !sameSeedBody(relative, current, pending.seed) };
      await saveSeedState(folder, relative, state);
    }
    let base = await readFolderFile(folder, ".seeds", relative);
    let inferredEdit = false;
    if (base === null) {
      const history = await historicalSeeds(SEED_HISTORY, relative);
      const candidates = [seed, ...history];
      const record = legacy[path.basename(relative, ".md")];
      const hash = record?.pending === (current === null ? null : digest(current)) ? record.pending : record?.hash;
      // Old migrations also recorded the serializer's default-settings form of the template.
      const recorded = hash && candidates.flatMap((candidate) => {
        try { return [candidate, serializeRoutine(parseRoutine(candidate, path.basename(relative, ".md")))]; }
        catch { return [candidate]; }
      }).find((candidate) => digest(candidate) === hash);
      const matched = current === null ? seed : candidates.find((candidate) => sameSeedBody(relative, current, candidate));
      base = recorded || matched || history.find((version) => version !== seed) || seed;
      inferredEdit = current !== null && !recorded && !matched;
      await saveSeedState(folder, relative, { ...state, waiting: Boolean(state.waiting || inferredEdit) });
      await writeFolderFile(folder, path.join(".seeds", relative), base);
    }
    if (base === seed && current !== null) {
      if (state.waiting && sameSeedBody(relative, current, seed)) await saveSeedState(folder, relative, {});
      continue;
    }
    let after = current;
    let waiting = Boolean(state.waiting || inferredEdit);
    if (current === null || current === base) { after = seed; waiting = false; }
    else if (isRoutineSeed(relative)) {
      try {
        const name = path.basename(relative, ".md");
        const old = splitFrontMatter(base).data;
        const person = splitFrontMatter(current).data;
        const next = splitFrontMatter(seed).data;
        const merged = {};
        for (const key of new Set([...Object.keys(old), ...Object.keys(person), ...Object.keys(next)])) {
          const value = isDeepStrictEqual(person[key], old[key]) ? next[key] : person[key];
          if (value !== undefined) merged[key] = value;
        }
        const edited = inferredEdit || !sameSeedBody(relative, current, base);
        const body = edited ? splitFrontMatter(current).body : splitFrontMatter(seed).body;
        waiting = edited && !sameSeedBody(relative, current, seed);
        after = serializeRoutine(parseRoutine(`---\n${YAML.stringify(merged)}---\n${body}`, name));
      } catch { waiting = true; } // Invalid routines stay intact and still offer the new template.
    } else waiting = current !== seed;
    const nextBase = !isRoutineSeed(relative) && waiting ? base : seed;
    await saveSeedState(folder, relative, { waiting, pending: { before: current, after, seed, previousBase: base, base: nextBase, waiting } });
    // A concurrent edit wins. Keep the old base so the next load can merge that edit.
    if (await readFolderFile(folder, relative) !== current) {
      await saveSeedState(folder, relative, { waiting: true });
      continue;
    }
    if (after !== current) await writeFolderFile(folder, relative, after);
    await writeFolderFile(folder, path.join(".seeds", relative), nextBase);
    await saveSeedState(folder, relative, { waiting });
  }
  if (legacyText !== null) await fs.unlink(path.join(folder, ROUTINES_DIR, ".seeds.json"));
}

export async function readPerson(folder) {
  const text = await readFolderFile(folder, "USER.md");
  const data = text === null ? {} : splitFrontMatter(text).data;
  return Object.fromEntries(PERSON_FIELDS.map((field) => [field, typeof data[field] === "string" ? data[field] : ""]));
}

export async function writePerson(folder, patch) {
  const file = path.join(folder, "USER.md");
  const { data, body } = splitFrontMatter((await readFolderFile(folder, "USER.md")) ?? "");
  for (const field of PERSON_FIELDS) {
    if (!Object.hasOwn(patch, field)) continue;
    if (typeof patch[field] !== "string") throw new Error(`${field} must be a string.`);
    if (patch[field] === "") delete data[field];
    else data[field] = patch[field];
  }
  await fs.mkdir(folder, { recursive: true });
  await writeFile(file, Object.keys(data).length ? `---\n${YAML.stringify(data)}---\n${body}` : body);
}

export function renderVars(text, vars) {
  return text.replace(/\{\{\s*([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)\s*\}\}/g, (match, key) => {
    let value = vars;
    for (const part of key.split(".")) {
      if (value === null || value === undefined || !Object.hasOwn(Object(value), part)) return match;
      value = value[part];
    }
    return String(value);
  });
}
