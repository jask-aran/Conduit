import { parse } from "acorn";

/**
 * `tools` is the adapter's own reading of its tools, the same it uses for a tool called directly. Wiring a new harness
 * is mapping its nested-call events onto `start`/`end`.
 */

const LOOPS = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);
const ITERATORS = new Set(["map", "forEach", "flatMap", "filter", "reduce", "some", "every", "find"]);
const MAX_PLANNED = 24;
const MAX_NODES = 50_000;
const MAX_SHOWN = 40;

const literal = (node) => node?.type === "Literal" && typeof node.value === "string" ? node.value
  : node?.type === "TemplateLiteral" && !node.expressions.length ? node.quasis[0]?.value.cooked ?? null : null;

const literalValue = (node, depth) => {
  const text = literal(node);
  if (text != null) return text;
  if (node?.type === "Literal" && (typeof node.value === "number" || typeof node.value === "boolean")) return node.value;
  if (depth >= 4) return undefined;
  if (node?.type === "ObjectExpression") return literalInput(node, depth + 1);
  if (node?.type === "ArrayExpression") {
    const items = node.elements.map((element) => literalValue(element, depth + 1)).filter((value) => value !== undefined);
    return items;
  }
  return undefined;
};
function literalInput(node, depth = 0) {
  if (node?.type !== "ObjectExpression") return null;
  const input = {};
  for (const property of node.properties) {
    if (property.type !== "Property" || property.computed) continue;
    const key = property.key.type === "Identifier" ? property.key.name : literal(property.key);
    const value = literalValue(property.value, depth);
    if (key && value != null) input[key] = value;
  }
  return input;
}

const step = (tools, name, input) => {
  const subject = tools.subjectOf(name, input);
  // What the adapter can say of the call better than its subject, less a diff: a script's rows are lines.
  const { diff, ...facts } = tools.factsOf?.(name, input) || {};
  const kind = tools.kindOf(name) || "other";
  // A message a script sends (notify) keeps what it said: it is drawn as its own row, as a direct call's is.
  return { name, kind, ...(subject ? { subject } : {}), ...(Object.keys(facts).length ? { facts } : {}),
    ...(kind === "message" && input && typeof input === "object" ? { input } : {}) };
};

/** A call in a loop or a per-element callback is one planned row that repeats, never one row per iteration. */
function planScript(code, tools, { object = "tools" } = {}) {
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

/* A repeating row stays planned beneath the calls it produces until the script ends. */
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

export function createScriptCalls(tools, { now = Date.now } = {}) {
  const scripts = new Map();
  return {
    open(scriptId, code) {
      const plan = code ? planScript(code, tools) : [];
      if (plan.length) scripts.set(scriptId, plan);
      return plan.length ? view(plan) : null;
    },
    start(scriptId, callId, name, input) {
      const calls = startPlanned(scripts.get(scriptId) || [], { id: callId, ...step(tools, name, input), done: false, startedAt: now() });
      scripts.set(scriptId, bound(calls));
      return view(scripts.get(scriptId));
    },
    end(scriptId, callId, isError = false) {
      const calls = scripts.get(scriptId) || [];
      const call = calls.find((item) => item.id === callId);
      if (call) Object.assign(call, { done: true, isError: Boolean(isError), durationMs: now() - call.startedAt });
      return view(calls);
    },
    close(scriptId) { scripts.delete(scriptId); },
  };
}

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

export function callsSubject(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const counts = new Map();
  for (const call of list) counts.set(String(call.name || ""), (counts.get(String(call.name || "")) || 0) + 1);
  return [...counts].map(([tool, count]) => count > 1 ? `${tool} ×${count}` : tool).join(" · ");
}
