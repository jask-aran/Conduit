import { parse } from "acorn";

/**
 * A script step: a tool whose input is a program that calls other tools (Pi's
 * codemode; any harness's equivalent). Conduit states it the same way for every
 * harness -- kind "script", its calls as `calls` on the tool row -- and this
 * module is the whole of the work an adapter shares:
 *
 * - `planScript(code, tools)` reads a JavaScript script's `tools.<name>(...)`
 *   calls before it runs, for the preview.
 * - `createScriptCalls(tools)` follows a running script's calls as the harness
 *   reports them, and says what its row should list now (`tool.calls`).
 * - `settledCalls(list, tools)` and `callsSubject(list)` state a finished
 *   script's calls, live on `tool.close` and read back from history.
 *
 * `tools` is the adapter's own reading of its tools: `kindOf(name)` and
 * `subjectOf(name, input)`, the same it uses for a tool called directly.
 * Wiring a new harness is mapping its nested-call events onto `start`/`end`.
 */

const LOOPS = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);
// Array methods whose callback runs once per element.
const ITERATORS = new Set(["map", "forEach", "flatMap", "filter", "reduce", "some", "every", "find"]);
const MAX_PLANNED = 24;
const MAX_NODES = 50_000;
const MAX_SHOWN = 40;

const literal = (node) => node?.type === "Literal" && typeof node.value === "string" ? node.value
  : node?.type === "TemplateLiteral" && !node.expressions.length ? node.quasis[0]?.value.cooked ?? null : null;

/* The input a call states literally: `{ command: "ls" }` reads as itself, a
   field built at runtime is left out. */
function literalInput(node) {
  if (node?.type !== "ObjectExpression") return null;
  const input = {};
  for (const property of node.properties) {
    if (property.type !== "Property" || property.computed) continue;
    const key = property.key.type === "Identifier" ? property.key.name : literal(property.key);
    const value = literal(property.value);
    if (key && value != null) input[key] = value;
  }
  return input;
}

const step = (tools, name, input) => {
  const subject = tools.subjectOf(name, input);
  return { name, kind: tools.kindOf(name) || "other", ...(subject ? { subject } : {}) };
};

/**
 * The tools a script will call, read from its code before it runs: each
 * `<object>.<name>(...)` in the order written, what it acts on where that is a
 * literal, and whether it sits in a loop or a per-element callback -- such a
 * call is one planned row that repeats, never one row per iteration. Nothing
 * here runs the script; a script that does not parse has no plan.
 */
export function planScript(code, tools, { object = "tools" } = {}) {
  if (typeof code !== "string" || !code.includes(object)) return [];
  let program;
  try {
    program = parse(code, { ecmaVersion: "latest", sourceType: "script", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
  } catch { return []; }
  const toolName = (callee) => {
    if (callee?.type !== "MemberExpression" || callee.object?.type !== "Identifier" || callee.object.name !== object) return null;
    return callee.computed ? literal(callee.property) : callee.property?.name || null;
  };
  const planned = [];
  const seen = new Set();
  let visited = 0;
  const walk = (node, looping) => {
    if (!node || typeof node.type !== "string" || ++visited > MAX_NODES || planned.length >= MAX_PLANNED) return;
    const inLoop = looping || LOOPS.has(node.type);
    if (node.type === "CallExpression") {
      const name = toolName(node.callee);
      if (name) {
        const call = step(tools, name, literalInput(node.arguments[0]));
        const key = `${name}\0${call.subject || ""}\0${inLoop}`;
        if (!seen.has(key)) {
          seen.add(key);
          planned.push({ ...call, planned: true, ...(inLoop ? { repeats: true } : {}) });
        }
      }
      // `files.map(f => tools.read(...))`: the callback runs per element.
      const method = node.callee?.type === "MemberExpression" && !node.callee.computed ? node.callee.property?.name : null;
      walk(node.callee, inLoop);
      for (const argument of node.arguments) walk(argument, inLoop || ITERATORS.has(method));
      return;
    }
    for (const key in node) {
      if (key === "type" || key === "start" || key === "end") continue;
      const value = node[key];
      if (Array.isArray(value)) for (const child of value) walk(child, inLoop);
      else if (value && typeof value === "object") walk(value, inLoop);
    }
  };
  walk(program, false);
  return planned;
}

/* A call that has started takes the first planned row of its tool (and
   subject, where the plan names one). A repeating row stays planned beneath
   the calls it produces until the script ends. */
function startPlanned(calls, call) {
  const index = calls.findIndex((item) => item.planned && item.name === call.name && (!item.subject || item.subject === call.subject));
  if (index < 0) return [...calls, call];
  if (calls[index].repeats) return [...calls.slice(0, index), call, ...calls.slice(index)];
  return [...calls.slice(0, index), call, ...calls.slice(index + 1)];
}

/* At most the last forty calls, with one row saying how many came before: a
   loop that runs a thousand reads is a count, not a thousand rows. */
function bound(calls) {
  const earlier = calls.reduce((sum, call) => sum + (call.earlier || 0), 0);
  const rest = calls.filter((call) => !call.earlier);
  if (rest.length <= MAX_SHOWN) return earlier ? calls : rest;
  const dropped = rest.length - MAX_SHOWN;
  return [{ name: "earlier", kind: "other", earlier: earlier + dropped, done: true }, ...rest.slice(dropped)];
}

const view = (calls) => calls.map(({ id: _id, startedAt: _at, ...call }) => call);

/** A running script's calls, per script, as the harness reports them. */
export function createScriptCalls(tools, { now = Date.now } = {}) {
  const scripts = new Map();
  return {
    /** The script started; `code` gives it a preview when it is JavaScript. */
    open(scriptId, code) {
      const plan = code ? planScript(code, tools) : [];
      if (plan.length) scripts.set(scriptId, plan);
      return plan.length ? view(plan) : null;
    },
    /** One of its calls started. Returns the row's calls now. */
    start(scriptId, callId, name, input) {
      const calls = startPlanned(scripts.get(scriptId) || [], { id: callId, ...step(tools, name, input), done: false, startedAt: now() });
      scripts.set(scriptId, bound(calls));
      return view(scripts.get(scriptId));
    },
    /** One of its calls ended. Returns the row's calls now. */
    end(scriptId, callId, isError = false) {
      const calls = scripts.get(scriptId) || [];
      const call = calls.find((item) => item.id === callId);
      if (call) Object.assign(call, { done: true, isError: Boolean(isError), durationMs: now() - call.startedAt });
      return view(calls);
    },
    /** The script ended; what it states as its calls comes from its result. */
    close(scriptId) { scripts.delete(scriptId); },
  };
}

/**
 * A finished script's calls, from whatever the harness records of them:
 * `{ name, input, isError, durationMs }` each, in order.
 */
export function settledCalls(list, tools) {
  if (!Array.isArray(list)) return null;
  const shown = list.slice(-MAX_SHOWN);
  const earlier = list.length - shown.length;
  return [
    ...(earlier ? [{ name: "earlier", kind: "other", earlier, done: true }] : []),
    ...shown.map((call) => ({
      ...step(tools, String(call.name || ""), call.input),
      done: true,
      isError: Boolean(call.isError),
      ...(Number.isFinite(call.durationMs) ? { durationMs: Math.round(call.durationMs) } : {}),
    })),
  ];
}

/** A finished script's subject: the tools it called, counted -- "bash ×2 · read". */
export function callsSubject(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const counts = new Map();
  for (const call of list) counts.set(String(call.name || ""), (counts.get(String(call.name || "")) || 0) + 1);
  return [...counts].map(([tool, count]) => count > 1 ? `${tool} ×${count}` : tool).join(" · ");
}
