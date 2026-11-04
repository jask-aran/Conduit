import { constants } from "node:fs";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { isReadAction, programPaths } from "./policy.js";

export const ROUTINES_DIR = "routines";
export const PERSON_FIELDS = ["name", "assistant", "timezone", "home"];

const namePattern = /^[a-z][a-z0-9-]{0,40}$/;
const idPattern = /^[a-z][a-z0-9-]{0,30}$/;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keysOnly = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
/** Fields a task kind takes besides its id, kind and program. */
const TASK_FIELDS = { inbox: ["all", "for", "kinds", "addressed"], calendar: ["account", "calendars", "days"] };
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
    "level", "quiet", "enabled", "context", "body", "mode", "before", "after"];
  const unknownField = Object.keys(routine).find((key) => !fields.includes(key));
  if (unknownField) return `Unknown routine field ${unknownField}.`;
  if (typeof routine.name !== "string" || !namePattern.test(routine.name)) return "Invalid routine name.";
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
    for (const step of steps) {
      if (!object(step)) return `Invalid ${field} step.`;
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
    if (!["inbox", "calendar", "chats", "notes", "executor", "script"].includes(task.kind)) return "Invalid task kind.";
    const field = task.kind === "executor" ? "code" : task.kind === "script" ? "command" : null;
    const extra = TASK_FIELDS[task.kind] || [];
    const unknown = Object.keys(task).find((key) => !["id", "kind", ...(field ? [field] : []), ...extra].includes(key));
    if (unknown) return `Unknown field ${unknown} on task ${task.id}.`;
    if (task.kind === "inbox" && task.all !== undefined && typeof task.all !== "boolean") return `Task ${task.id}: all is true or false.`;
    if (task.kind === "inbox") {
      if (task.for !== undefined && (typeof task.for !== "string" || !namePattern.test(task.for))) return `Task ${task.id}: for must be a routine name.`;
      if (task.addressed !== undefined && task.addressed !== "only") return `Task ${task.id}: addressed must be only.`;
      if (task.kinds !== undefined && (!Array.isArray(task.kinds) || !task.kinds.length
        || task.kinds.some((kind) => typeof kind !== "string" || !namePattern.test(kind)))) return `Task ${task.id}: kinds must be a nonempty list of entry kinds.`;
    }
    if (task.kind === "calendar") {
      if (typeof task.account !== "string" || !task.account) return `Task ${task.id}: the calendar's Executor account is required.`;
      if (task.calendars !== undefined && (!Array.isArray(task.calendars) || !task.calendars.length || task.calendars.some((id) => typeof id !== "string" || !id))) {
        return `Task ${task.id}: calendars is a list of calendar ids.`;
      }
      if (task.days !== undefined && (!Number.isInteger(task.days) || task.days < 1 || task.days > 14)) return `Task ${task.id}: days is 1 to 14.`;
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
  const fields = ["title", "trigger", "tasks", "gate", "output", "model", "effort", "level", "quiet", "enabled",
    "context", "mode", "before", "after"];
  const unknownKey = Object.keys(data).find((key) => !fields.includes(key));
  if (unknownKey) throw new Error(`Unknown field ${unknownKey} in the front matter.`);
  const parseTrigger = (input) => {
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
    enabled: data.enabled === undefined ? true : data.enabled,
    context: data.context === undefined ? [] : data.context, body: body.replace(/^\r?\n/, "").replace(/\n$/, "") };
  const problem = routineProblem(routine);
  if (problem) throw new Error(problem);
  return routine;
}

export function serializeRoutine(routine) {
  const problem = routineProblem(routine);
  if (problem) throw new Error(problem);
  const { name, title, trigger, tasks, gate, output, model, effort, level, enabled, context, body } = routine;
  const writeTrigger = (rule) => ({ ...(rule.kind === "every" ? { every: rule.minutes }
    : rule.kind === "at" ? { at: rule.time } : { once: rule.at }), ...(rule.during !== undefined ? { during: rule.during } : {}) });
  const data = { ...(routine.mode === "fork" ? { mode: "fork" } : {}),
    ...(routine.before?.length ? { before: routine.before } : {}), ...(routine.after?.length ? { after: routine.after } : {}), ...(title !== name ? { title } : {}),
    trigger: Array.isArray(trigger) ? trigger.map(writeTrigger) : writeTrigger(trigger),
    ...(tasks.length ? { tasks } : {}), gate, output, ...(model !== null ? { model } : {}),
    ...(effort !== null ? { effort } : {}), ...(level !== "fyi" ? { level } : {}),
    ...(!enabled ? { enabled } : {}), ...(context.length ? { context } : {}) };
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

// Committed seed bytes, plus the old migration's default-settings serialized copies (SHA-256).
const OLD_SEEDS = {
  heartbeat: ["0c5b4c99095960a5b50e835f2e52f03f970e0f11afb82ba715268c54d4af67c3", "fcb64153edd18c39b88661fa5adb498b9852179be7ef29b7beaa0be800b585ad",
    "1a49c0072d7c2492d2f672ee15b092bbdb767378e6c5dd457c2bbdeea4eade0b", "7290af75c97331f32d4783c26ef6301c7caf21d638b0128eea8cb64182b4988e"],
  "morning-brief": ["7ba36bcd56a4720beaeec5af06e706653922c0718dbd4ca8b2a388cc84b2735c", "951d7434a833c93816c91d2473534539f3acfa33b2e1914dddd6cf5c2db37c9c",
    "d66dc906bbb0e79b7dae596a8b2bddd409c630baf0777cf39a642bcfb5b75cd0", "c9299bcbe0c150bd1e91b6fe1f7c0bd0c287f754e76787537cc3e9cd76ce5025"],
  reflect: ["0172fa248f2822c85ee718e5351ddf062f273dc9942d5898ca42f2798be0d39e"],
};
const SEED_RECORD = ".seeds.json";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Only replace a seed whose exact bytes match its recorded or historical version. */
export async function seedRoutines(folder, seedDir) {
  let files;
  try { files = await fs.readdir(seedDir); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  await fs.mkdir(path.join(folder, ROUTINES_DIR), { recursive: true });
  const manifestPath = path.join(folder, ROUTINES_DIR, SEED_RECORD);
  const raw = await readFolderFile(folder, ROUTINES_DIR, SEED_RECORD);
  const records = raw === null ? {} : JSON.parse(raw);
  if (!object(records)) throw new Error("Invalid routine seed record.");
  const save = () => writeFile(manifestPath, `${JSON.stringify(records, null, 2)}\n`);
  for (const file of files.filter((item) => item.endsWith(".md"))) {
    const name = file.slice(0, -3);
    const target = routinePath(folder, name);
    const seed = await fs.readFile(path.join(seedDir, file));
    const seedHash = digest(seed);
    let current = await readFolderBytes(folder, ROUTINES_DIR, file);
    if (current === null) {
      try {
        await fs.writeFile(target, seed, { flag: "wx" });
        records[name] = { hash: seedHash };
        await save();
        continue;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        current = await readFolderBytes(folder, ROUTINES_DIR, file);
        if (current === null) continue;
      }
    }
    const currentHash = digest(current);
    let record = records[name];
    // A crash after replacement but before recording the new hash is recoverable.
    if (record?.pending === currentHash) {
      records[name] = record = { hash: currentHash };
      await save();
    }
    if (!record) {
      if (currentHash !== seedHash && !OLD_SEEDS[name]?.includes(currentHash)) continue;
      records[name] = record = { hash: currentHash };
      await save();
    }
    if (currentHash !== record.hash) {
      if (record.pending) { records[name] = { hash: record.hash }; await save(); }
      continue;
    }
    if (currentHash === seedHash) continue;
    records[name] = { hash: currentHash, pending: seedHash };
    await save();
    // Recheck immediately before replacement; an intervening edit stays untouched.
    const latest = await readFolderBytes(folder, ROUTINES_DIR, file);
    if (latest === null || digest(latest) !== currentHash) {
      records[name] = { hash: currentHash };
      await save();
      continue;
    }
    await writeFile(target, seed);
    records[name] = { hash: seedHash };
    await save();
  }
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
