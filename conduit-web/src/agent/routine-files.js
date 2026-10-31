import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

export const ROUTINES_DIR = "routines";
export const PERSON_FIELDS = ["name", "assistant", "timezone", "home"];

const namePattern = /^[a-z][a-z0-9-]{0,40}$/;
const idPattern = /^[a-z][a-z0-9-]{0,30}$/;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keysOnly = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
/** Fields a task kind takes besides its id, kind and program. */
const TASK_FIELDS = { inbox: ["all"], calendar: ["account", "calendars", "days"] };
const oneLine = (error) => String(error.message || error).split(/\r?\n/)[0];

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
    "level", "quiet", "enabled", "context", "body"];
  const unknownField = Object.keys(routine).find((key) => !fields.includes(key));
  if (unknownField) return `Unknown routine field ${unknownField}.`;
  if (typeof routine.name !== "string" || !namePattern.test(routine.name)) return "Invalid routine name.";
  if (typeof routine.title !== "string" || !routine.title.trim()) return "A title is required.";
  const trigger = routine.trigger;
  if (!object(trigger)) return "A valid trigger is required.";
  if (trigger.kind === "every") {
    if (!keysOnly(trigger, ["kind", "minutes"]) || !Number.isInteger(trigger.minutes)
      || trigger.minutes < 5 || trigger.minutes > 1440) return "Every must be a whole number from 5 to 1440 minutes.";
  } else if (trigger.kind === "at") {
    if (!keysOnly(trigger, ["kind", "time"]) || typeof trigger.time !== "string"
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(trigger.time)) return "At must be a time in HH:MM format.";
  } else if (trigger.kind === "once") {
    const iso = /^(\d{4})-(\d\d)-(\d\d)T\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/;
    const match = typeof trigger.at === "string" && iso.exec(trigger.at);
    const date = match && new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
    if (!keysOnly(trigger, ["kind", "at"]) || !match || !Number.isFinite(Date.parse(trigger.at))
      || !date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== match[0].slice(0, 10)) {
      return "Once must be an ISO date-time with a timezone.";
    }
  } else return "A valid trigger is required.";
  if (!Array.isArray(routine.tasks)) return "Tasks must be a list.";
  const ids = new Set();
  for (const task of routine.tasks) {
    if (!object(task) || typeof task.id !== "string" || !idPattern.test(task.id)) return "Each task needs a valid id.";
    if (ids.has(task.id)) return "Task ids must be unique.";
    ids.add(task.id);
    if (!["inbox", "calendar", "chats", "executor", "script"].includes(task.kind)) return "Invalid task kind.";
    const field = task.kind === "executor" ? "code" : task.kind === "script" ? "command" : null;
    const extra = TASK_FIELDS[task.kind] || [];
    const unknown = Object.keys(task).find((key) => !["id", "kind", ...(field ? [field] : []), ...extra].includes(key));
    if (unknown) return `Unknown field ${unknown} on task ${task.id}.`;
    if (task.kind === "inbox" && task.all !== undefined && typeof task.all !== "boolean") return `Task ${task.id}: all is true or false.`;
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
  }
  if (!["always", "when-new", "never"].includes(routine.gate)) return "Invalid gate.";
  if (!["jbot", "inbox", "both"].includes(routine.output)) return "Invalid output.";
  if (routine.model !== null && (typeof routine.model !== "string" || !/^[^\s/]+\/[^\s/]+$/.test(routine.model))) {
    return "Model must be provider/model.";
  }
  if (routine.effort !== null && !["off", "minimal", "low", "medium", "high", "xhigh"].includes(routine.effort)) {
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
    "context"];
  const unknownKey = Object.keys(data).find((key) => !fields.includes(key));
  if (unknownKey) throw new Error(`Unknown field ${unknownKey} in the front matter.`);
  const input = data.trigger;
  let trigger = null;
  if (object(input) && Object.keys(input).length === 1) {
    if (Object.hasOwn(input, "every")) trigger = { kind: "every", minutes: input.every };
    if (Object.hasOwn(input, "at")) trigger = { kind: "at", time: input.at };
    if (Object.hasOwn(input, "once")) trigger = { kind: "once", at: input.once };
  }
  const routine = { name, title: data.title === undefined ? name : data.title, trigger,
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
  const { name, title, trigger, tasks, gate, output, model, effort, level, quiet, enabled, context, body } = routine;
  const data = { ...(title !== name ? { title } : {}),
    trigger: trigger.kind === "every" ? { every: trigger.minutes }
      : trigger.kind === "at" ? { at: trigger.time } : { once: trigger.at },
    ...(tasks.length ? { tasks } : {}), gate, output, ...(model !== null ? { model } : {}),
    ...(effort !== null ? { effort } : {}), ...(level !== "fyi" ? { level } : {}),
    ...(!quiet ? { quiet } : {}), ...(!enabled ? { enabled } : {}), ...(context.length ? { context } : {}) };
  const doc = new YAML.Document(data);
  doc.get("trigger", true).flow = true;
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

async function readFile(file) {
  try { return await fs.readFile(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
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
  const text = await readFile(routinePath(folder, name));
  return text === null ? null : parseRoutine(text, name);
}

export async function writeRoutine(folder, routine) {
  const text = serializeRoutine(routine);
  const file = routinePath(folder, routine.name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

export async function removeRoutine(folder, name) {
  try { await fs.unlink(routinePath(folder, name)); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

export async function seedRoutines(folder, seedDir) {
  let files;
  try { files = await fs.readdir(seedDir); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  for (const file of files.filter((item) => item.endsWith(".md"))) {
    const target = routinePath(folder, file.slice(0, -3));
    await fs.mkdir(path.dirname(target), { recursive: true });
    try { await fs.copyFile(path.join(seedDir, file), target, 1); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
}

export async function readPerson(folder) {
  const text = await readFile(path.join(folder, "USER.md"));
  const data = text === null ? {} : splitFrontMatter(text).data;
  return Object.fromEntries(PERSON_FIELDS.map((field) => [field, typeof data[field] === "string" ? data[field] : ""]));
}

export async function writePerson(folder, patch) {
  const file = path.join(folder, "USER.md");
  const { data, body } = splitFrontMatter((await readFile(file)) ?? "");
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
