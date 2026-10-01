import { parse } from "acorn";
import { PI_TOOL_KINDS, piToolSubject } from "./pi-capabilities.js";

const LOOPS = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);
// Array methods whose callback runs once per element.
const ITERATORS = new Set(["map", "forEach", "flatMap", "filter", "reduce", "some", "every", "find"]);
const MAX_PLANNED = 24;
const MAX_NODES = 50_000;

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

const toolName = (callee) => {
  if (callee?.type !== "MemberExpression" || callee.object?.type !== "Identifier" || callee.object.name !== "tools") return null;
  return callee.computed ? literal(callee.property) : callee.property?.name || null;
};

/**
 * The tools a codemode script will call, read from its code before it runs:
 * each `tools.<name>(...)` in the order written, what it acts on where that is
 * a literal, and whether it sits in a loop or a per-element callback -- such a
 * call is one planned row that repeats, never one row per iteration. Nothing
 * here runs the script; a script that does not parse has no plan.
 */
export function planScript(code) {
  if (typeof code !== "string" || !code.includes("tools")) return [];
  let program;
  try {
    program = parse(code, { ecmaVersion: "latest", sourceType: "script", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
  } catch { return []; }
  const planned = [];
  const seen = new Set();
  let visited = 0;
  const walk = (node, looping) => {
    if (!node || typeof node.type !== "string" || ++visited > MAX_NODES || planned.length >= MAX_PLANNED) return;
    const inLoop = looping || LOOPS.has(node.type);
    if (node.type === "CallExpression") {
      const name = toolName(node.callee);
      if (name) {
        const subject = piToolSubject(name, literalInput(node.arguments[0]));
        const key = `${name}\0${subject || ""}\0${inLoop}`;
        if (!seen.has(key)) {
          seen.add(key);
          planned.push({ name, kind: Object.hasOwn(PI_TOOL_KINDS, name) ? PI_TOOL_KINDS[name] : "other",
            ...(subject ? { subject } : {}), planned: true, ...(inLoop ? { repeats: true } : {}) });
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

/**
 * A call that has started, set against the plan: it takes the first planned
 * row of its tool (and subject, where the plan names one). A repeating row
 * stays planned beneath the calls it produces until the script ends.
 */
export function startPlannedCall(calls, call) {
  const index = calls.findIndex((item) => item.planned && item.name === call.name && (!item.subject || item.subject === call.subject));
  if (index < 0) return [...calls, call];
  if (calls[index].repeats) return [...calls.slice(0, index), call, ...calls.slice(index)];
  return [...calls.slice(0, index), call, ...calls.slice(index + 1)];
}

const MAX_SHOWN = 40;

/**
 * At most the last forty calls, with one row saying how many came before:
 * a loop that runs a thousand reads is a count, not a thousand rows.
 */
export function boundCalls(calls) {
  const earlier = calls.filter((call) => call.earlier).reduce((sum, call) => sum + call.earlier, 0);
  const rest = calls.filter((call) => !call.earlier);
  if (rest.length <= MAX_SHOWN) return earlier ? calls : rest;
  const dropped = rest.length - MAX_SHOWN;
  return [{ name: "earlier", kind: "other", earlier: earlier + dropped, done: true }, ...rest.slice(dropped)];
}
