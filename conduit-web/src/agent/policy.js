import { wrapTool } from "@earendil-works/pi-durable";
import { createHash } from "node:crypto";
import { serviceOf } from "./connector-services.js";
import { AgentDoc, nextId } from "./agent-doc.js";

/** Outward calls need an asynchronous approval; private reads taint the conversation. */
/** Tools that leave the folder only when given a device; and tools that always leave it. */
const PLACED = ["read", "write", "edit", "bash"];
const ALWAYS_OUTWARD = { start_chat: "start a chat", steer_chat: "post in one of your chats" };
/** Calls that read the person's own data, which taint the conversation. */
const PRIVATE_READS = { chats: (args) => ["read", "search"].includes(args?.action) };
const privateRead = (name, args) => PRIVATE_READS[name]?.(args) || (name.startsWith("mcp__") && connectorRead(name, args));

/*
 * A connector's tool is `mcp__<connector>__<tool>`. One the server marks read-only is free (it is not wrapped). A
 * gateway such as Executor puts every app behind one `call` tool, `{ calls: { path, input } | [...] }`, so its calls
 * are judged by the actions they name: a read (a read word in its name, no write word: `gmail…messagesList`,
 * `calendar…eventsGet`) goes alone and taints the conversation, since it is the person's own data; anything else
 * (`gmail.send`, an unclear name) asks. A program (`execute`) cannot be read ahead of running, so it always asks.
 */
const READ_WORDS = new Set(["get", "list", "search", "query", "read", "export", "describe", "check", "find", "lookup", "fetch", "count", "batchget"]);
const WRITE_WORDS = new Set(["send", "create", "insert", "update", "patch", "delete", "remove", "modify", "trash", "untrash", "import",
  "move", "copy", "clear", "append", "set", "put", "post", "watch", "stop", "start", "complete", "cancel", "submit", "resume",
  "connect", "disconnect", "reply", "forward", "archive", "share", "upload", "write", "add", "batchupdate", "batchmodify", "batchdelete", "empty", "run", "execute"]);
const wordsOf = (path) => String(path).split(/[^A-Za-z0-9]+/).flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])/)).map((word) => word.toLowerCase()).filter(Boolean);
const isReadAction = (path) => { const words = wordsOf(path); return !words.some((word) => WRITE_WORDS.has(word)) && words.some((word) => READ_WORDS.has(word)); };
const connectorTool = (name) => name.split("__").slice(2).join("__");
/** The actions a gateway `call` names, `tools.` dropped; null for a tool that is not one. */
const connectorCalls = (name, args) => {
  if (connectorTool(name) !== "call") return null;
  const calls = Array.isArray(args?.calls) ? args.calls : args?.calls ? [args.calls] : [];
  return calls.map((call) => String(call?.path || "").replace(/^tools\./, ""));
};
/*
 * The actions a program (`execute`) names, read off its source: every use of `tools` must call a literal path
 * (`tools.gmail.api.users.messagesList(…)`, `tools["tools.google…eventsList"](…)`), and nothing may reach for them
 * another way (a computed name, globalThis, eval, a constructor…). null when that cannot be told before it runs.
 */
const OPAQUE = /\b(?:globalThis|self|window|this|eval|Function|import|require|Reflect|Proxy|constructor|prototype|__proto__|with|arguments)\b/;
const KEYWORDS = new Set(["return", "typeof", "await", "yield", "in", "of", "case", "void", "delete", "throw", "new", "else", "do"]);
const STRING = /(["'`])(?:\\.|(?!\1)[^\\])*\1/g;
/** An index by anything but a number or a plain string (`x[i]`, `x["con" + "structor"]`) could reach for anything. */
function computedIndex(code) {
  const strings = [];
  const blank = code.replace(STRING, (literal) => { strings.push(literal); return `"${strings.length - 1}"`; });
  for (const match of blank.matchAll(/\[/g)) {
    const before = blank.slice(0, match.index).trimEnd();
    const word = /[\w$]+$/.exec(before)?.[0];
    const member = /[\w$)\]]$/.test(before) && !(word && KEYWORDS.has(word));
    if (!member) continue; // an array literal
    const index = /^\[\s*(\d+|"(\d+)")\s*\]/.exec(blank.slice(match.index));
    if (!index) return true;
    if (index[2] != null) {
      const text = strings[Number(index[2])].slice(1, -1);
      if (strings[Number(index[2])][0] === "`" || /^(?:constructor|prototype|__proto__)$/.test(text)) return true;
    }
  }
  return false;
}
function programPaths(code) {
  if (typeof code !== "string" || !code.trim()) return null;
  const literal = /\btools\s*\[\s*(["'])([^"'`$\\]+)\1\s*\]\s*\(|\btools((?:\s*\.\s*[A-Za-z_$][\w$]*)+)\s*\(/g;
  const paths = [];
  let rest = code;
  for (const match of code.matchAll(literal)) {
    paths.push((match[2] ?? match[3].replace(/\s/g, "").slice(1)).replace(/^tools\./, ""));
    rest = rest.replace(match[0], "(");
  }
  // Whatever is left may not touch `tools`, name a way around it, or index by a computed value.
  const code_ = rest.replace(STRING, '""');
  return /\btools\b/.test(code_) || OPAQUE.test(code_) || computedIndex(rest) ? null : paths;
}
const programOf = (args) => args?.code ?? args?.source ?? args?.program;
/** The actions a connector tool's call will take: a gateway call's, or a program's; null when not knowable. */
const connectorActions = (name, args) => connectorCalls(name, args) ?? (connectorTool(name) === "execute" ? programPaths(programOf(args)) : null);
const connectorRead = (name, args) => { const paths = connectorActions(name, args); return Boolean(paths?.length && paths.every(isReadAction)); };
const connectorName = (name) => { const connector = name.split("__")[1] || ""; return `${connector[0]?.toUpperCase() ?? ""}${connector.slice(1)}`; };
/** An action as words: `gmail.send` → "Gmail · send", `google.api.calendar.events.calendarEventsInsert` → "Google · calendar events insert". */
function actionWords(path) {
  const parts = String(path).split(".").filter((part) => part !== "api");
  const app = parts[0] || "";
  const words = wordsOf(parts.at(-1) || "");
  const tail = words.filter((word, index) => word !== words[index - 1]);
  return `${app[0]?.toUpperCase() ?? ""}${app.slice(1)} · ${tail.join(" ") || parts.slice(1).join(" ")}`;
}
const mcpLabel = (name, args) => {
  const paths = connectorActions(name, args);
  const listed = [...new Set(paths || [])].map(actionWords).join(", ");
  if (connectorTool(name) === "execute") return `run a script in ${connectorName(name)}${listed ? `: ${listed}` : ""}`;
  return paths ? `use ${connectorName(name)}: ${listed || "an action"}` : `use ${connectorName(name)}: ${connectorTool(name)}`;
};
const preview = (value) => { try { return JSON.stringify(value).slice(0, 300); } catch { return ""; } };
const summary = (name, args) => {
  if (name.startsWith("mcp__")) {
    // What it will do, one action a line with what it sends; a script that cannot be read ahead says so.
    const calls = connectorCalls(name, args);
    const service = connectorName(name);
    if (calls) {
      const items = Array.isArray(args.calls) ? args.calls : [args.calls];
      const lines = items.map((call) => { const input = preview(call?.input?.input ?? call?.input); return `• ${actionWords(String(call?.path || "").replace(/^tools\./, ""))}${input && input !== "{}" ? ` — ${input.slice(0, 160)}` : ""}`; });
      return `do this in ${service}:\n${lines.join("\n")}`;
    }
    if (connectorTool(name) === "execute") {
      const paths = programPaths(programOf(args));
      return paths?.length ? `run a script in ${service} that will:\n${[...new Set(paths)].map((path) => `• ${actionWords(path)}`).join("\n")}`
        : `run a script in ${service} whose actions can't be read before it runs.`;
    }
    return mcpLabel(name, args);
  }
  if (ALWAYS_OUTWARD[name]) {
    const what = name === "steer_chat" ? `${args.chatId || "a chat"}: ${String(args.message || "").slice(0, 200)}`
      : `${args.workspace || "a workspace"}${args.profile ? ` (${args.profile})` : ""}: ${String(args.prompt || "").slice(0, 200)}`;
    return `${ALWAYS_OUTWARD[name]}, ${what}`;
  }
  const target = `${args.device}${args.folder ? ` · ${args.folder}` : ""}`;
  if (name === "bash") return `run on ${target}: ${String(args.command || "").slice(0, 200)}`;
  return `${name} ${args.path || ""} on ${target}`;
};
const outward = (name, args) => Boolean(ALWAYS_OUTWARD[name] || (PLACED.includes(name) && args?.device));

async function ruleTarget(runtime, name, args) {
  if (name.startsWith("mcp__")) {
    // A gateway call's rule is the exact set of actions; a program has none to match.
    const paths = connectorCalls(name, args);
    return paths ? JSON.stringify([...new Set(paths)].sort()) : connectorTool(name) === "execute" ? null : name;
  }
  if (name === "start_chat") {
    if (typeof args.workspace !== "string" || !args.workspace.trim()) return null;
    const workspace = args.workspace.trim();
    const projects = await runtime.agent.projects.list();
    return (projects.find((item) => item.id === workspace) || projects.find((item) => item.slug === workspace)
      || projects.find((item) => item.name === workspace))?.id ?? null;
  }
  if (name === "steer_chat") return args.chatId;
  if (name === "bash") return JSON.stringify([args.device, args.command]);
  return JSON.stringify([args.device, args.folder ?? null]);
}

const ruleLabel = (name, args) => {
  if (name.startsWith("mcp__")) return mcpLabel(name, args);
  if (name === "start_chat") return `start a chat, ${args.workspace || "a workspace"}`;
  if (name === "steer_chat") return `post in one of your chats, ${args.chatId || "a chat"}`;
  const target = `${args.device}${args.folder ? ` · ${args.folder}` : ""}`;
  return name === "bash" ? `run on ${args.device}: ${String(args.command || "").slice(0, 200)}` : `${name} on ${target}`;
};

// JSON arguments have no cycles. Sort object keys recursively so equivalent calls share a grant.
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const result = (text, id, isError = false) => ({ output: [{ type: "text", text }], isError, details: { ask: id } });

function presentation(name, args) {
  if (name.startsWith("mcp__")) {
    const paths = connectorActions(name, args) || [];
    const service = serviceOf(paths[0]);
    const calls = connectorCalls(name, args);
    const items = Array.isArray(args.calls) ? args.calls : args.calls ? [args.calls] : [];
    const lines = calls ? calls.map((path, i) => {
      const input = preview(items[i]?.input?.input ?? items[i]?.input).slice(0, 160);
      return `${actionWords(path)}${input && input !== "{}" ? ` — ${input}` : ""}`;
    }) : paths.map(actionWords);
    const label = mcpLabel(name, args);
    return { title: label[0].toUpperCase() + label.slice(1), service, lines: lines.slice(0, 4) };
  }
  if (ALWAYS_OUTWARD[name]) {
    const target = name === "start_chat" ? args.workspace || "a workspace" : args.chatId || "a chat";
    return { title: name === "start_chat" ? `Start a chat in ${target}` : `Post in ${target}`, service: null,
      lines: [String(target), String(name === "start_chat" ? args.prompt || "" : args.message || "").slice(0, 200)].filter(Boolean) };
  }
  const target = `${args.device}${args.folder ? ` · ${args.folder}` : ""}`;
  return { title: name === "bash" ? `Run \`${String(args.command || "").slice(0, 80)}\` on ${args.device}` : `${name[0].toUpperCase() + name.slice(1)} on ${args.device}`,
    service: null, lines: [target, String(name === "bash" ? args.command || "" : args.path || "").slice(0, 200)].filter(Boolean) };
}

/** Create an ask or consume one exact, single-use grant in the tool's commit. */
async function approve(runtime, api, name, args, context, thread) {
  const target = await ruleTarget(runtime, name, args);
  const argsKey = createHash("sha256").update(JSON.stringify(canonical([name, args]))).digest("hex");
  const task = await api.getTask(api.taskId, context);
  const parentCallId = task?.input?.kind === "nested" ? task.input.parentCallId : null;
  const info = presentation(name, args);
  const now = new Date();
  const outcome = await api.commit(async (tx) => {
    const doc = await tx.doc(AgentDoc);
    const asks = Object.values(doc.asks ||= {});
    for (const ask of asks) if (ask.status === "pending" && ask.expiresAt <= now.toISOString()) ask.status = "expired";
    // A replay of the original ask must never consume a later grant or match a new rule.
    const replay = asks.find((ask) => (ask.toolCallId === api.callId && ask.sourceConversationId === api.conversationId) || ask.waiters?.some((waiter) => waiter.callId === api.callId && waiter.conversationId === api.conversationId));
    if (replay) return { ask: replay, replay: true };
    // A replay after consuming a grant must not execute the external call a second time.
    const consumed = asks.find((ask) => ask.usedCallId === api.callId && ask.chatId === thread.chatId);
    if (consumed) return { ask: consumed, consumed: true };
    const grant = asks.find((ask) => ask.chatId === thread.chatId && ask.argsKey === argsKey && ask.status === "allowed");
    const rule = !doc.tainted?.[api.conversationId] && target != null && Object.values(doc.rules || {}).some((item) => item.tool === name && item.target === target);
    if (grant) { grant.status = "used"; grant.usedCallId = api.callId; return { allowed: true }; }
    if (rule) return { allowed: true };
    const pending = asks.find((ask) => ask.chatId === thread.chatId && ask.argsKey === argsKey && ask.status === "pending");
    if (pending) { (pending.waiters ||= []).push({ callId: api.callId, conversationId: api.conversationId }); return { ask: pending, waiting: true }; }
    const id = nextId(doc, "a");
    const ask = { id, chatId: thread.chatId, conversationId: thread.conversationId, toolCallId: api.callId, parentCallId,
      sourceConversationId: api.conversationId, tool: name, argsKey, ...info, createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 86400_000).toISOString(), status: "pending", ruleTarget: target ?? "", ruleLabel: ruleLabel(name, args),
      tainted: Boolean(doc.tainted?.[api.conversationId]) };
    doc.asks[id] = ask;
    return { ask, created: true };
  }, context);
  if (outcome.allowed) return null;
  const { ask } = outcome;
  if (outcome.consumed) return result(`This approved call was interrupted; it may already have run. Check its effects before trying again (ask ${ask.id}).`, ask.id, true);
  if (outcome.created) runtime.notify?.({ kind: "approval", conversationId: thread.conversationId, text: `${runtime.agent.settings().name} wants to ${summary(name, args)}${ask.tainted ? "\n\nThis thread has read your chats: check that nothing private goes where it should not." : ""}`, key: ask.id });
  if (outcome.waiting || (outcome.replay && ask.toolCallId !== api.callId)) return result(`Still waiting for approval (ask ${ask.id}). Do not repeat this call while it waits.${thread.run ? " Say in your report that it is waiting for approval." : ""}`, ask.id);
  return result(`Asked the person to approve: ${ask.title} (ask ${ask.id}). Carry on with anything that does not depend on it. When they answer you will get a message; if they allow it, make this same call again with exactly the same arguments.${thread.run ? " Say in your report that it is waiting for approval." : ""}`, ask.id);
}

/** The wraps the agent extension applies to its threads' tools, built against the installed tools. */
export function policyWraps(runtime, tools) {
  return tools.filter((tool) => PLACED.includes(tool.name) || ALWAYS_OUTWARD[tool.name] || PRIVATE_READS[tool.name] || (tool.name.startsWith("mcp__") && !tool.connectorReadOnly)).map((target) =>
    wrapTool(target, (tool) => ({ ...tool, execute: async (args, api, context) => {
      if ((tool.name.startsWith("mcp__") && !connectorRead(tool.name, args)) || outward(tool.name, args)) {
        const described = await runtime.agent.describe(api.conversationId);
        const run = described?.role === "run";
        const home = run ? await runtime.agent.home() : null;
        const thread = { chatId: run ? home.chat.id : described?.chatId, conversationId: run ? home.conversationId : api.conversationId, run };
        if (!thread.chatId) throw new Error("Agent thread not found");
        const waiting = await approve(runtime, api, tool.name, args, context, thread);
        if (waiting) return waiting;
      }
      const result = await tool.execute(args, api, context);
      if (privateRead(tool.name, args) && !result?.isError) {
        await api.commit(async (tx) => { (await tx.doc(AgentDoc)).tainted[api.conversationId] = true; }, context);
      }
      return result;
    } })));
}
