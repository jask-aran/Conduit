import { defineTool, wrapTool } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { createHash } from "node:crypto";
import { fieldsOf, fieldsText } from "./approval-fields.js";
import { serviceOf } from "./connector-services.js";
import { AgentDoc, nextId } from "./agent-doc.js";
import { sandboxHelper, sandboxedEnv } from "./sandbox.js";

/** Outward calls need an asynchronous approval; private reads taint the conversation. */
/** Tools that leave the folder only when given a device; and tools that always leave it. */
const PLACED = ["read", "write", "edit", "bash"];
const ALWAYS_OUTWARD = { start_chat: "start a chat", steer_chat: "post in one of your chats", feed: "add a feed", routine: "change a routine" };
/** A tool whose other actions stay in its folder: only these leave it. */
const OUTWARD_ACTIONS = { feed: ["add"], routine: ["save", "remove"] };
/** Routine files change through `routine` (which asks), not a plain edit in the folder. */
const routineFile = (name, args) => ["write", "edit"].includes(name) && !args?.device && /(^|[\\/])routines[\\/][^\\/]*$/.test(String(args?.path || ""));
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
/*
 * What the person asked for, it does: in a turn the person started (their message, or their answer to an approval),
 * a connector call that only edits their own data goes without asking -- completing a task, moving an event, labelling
 * mail. One that sends as them or deletes still asks, as does anything a run or the heartbeat starts on its own, and
 * anything outside the connectors (another chat, a device, a routine). Settings › jbot turns it off.
 */
const SEND_WORDS = new Set(["send", "reply", "forward", "share", "post", "submit", "publish", "invite"]);
const DELETE_WORDS = new Set(["delete", "remove", "trash", "empty", "batchdelete", "purge", "destroy", "cancel", "unsubscribe", "revoke",
  "disconnect", "clear", "stop"]);
const editAction = (path) => { const words = wordsOf(String(path).split(".").at(-1) || ""); return !words.some((word) => SEND_WORDS.has(word) || DELETE_WORDS.has(word)); };
const editOnly = (name, args) => {
  if (!name.startsWith("mcp__")) return false;
  const paths = connectorActions(name, args);
  return Boolean(paths?.length) && paths.every((path) => isReadAction(path) || editAction(path));
};
/** The prompts a turn can start from: the person's (a message, an approval's answer), a run's report, the heartbeat's line. */
const TRIGGERS = new Set(["conduit.user", "conduit.subagent-report", "conduit.agent-beat"]);
async function personStarted(api, context) {
  return api.commit(async (tx) => {
    let cursor;
    for (let pages = 0; pages < 5; pages += 1) {
      const page = await tx.scanEntries({ conversationId: api.conversationId }, 100, cursor);
      const trigger = page.items.find((entry) => TRIGGERS.has(entry.kind));
      if (trigger) return trigger.kind === "conduit.user";
      if (!page.next) return false;
      cursor = page.next;
    }
    return false;
  }, context);
}
export const isReadAction = (path) => { const words = wordsOf(path); return !words.some((word) => WRITE_WORDS.has(word)) && words.some((word) => READ_WORDS.has(word)); };
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
  if (strings.some((literal) => literal[0] === "`" && literal.includes("${"))) return true;
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
export function programPaths(code) {
  if (typeof code !== "string" || !code.trim()) return null;
  if ([...code.matchAll(STRING)].some(([literal]) => literal[0] === "`" && literal.includes("${"))) return null;
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
const summary = (name, args) => {
  if (name.startsWith("mcp__")) {
    // What it will do, one action a line with what it sends; a script that cannot be read ahead says so.
    const calls = connectorCalls(name, args);
    const service = connectorName(name);
    if (calls) {
      const items = Array.isArray(args.calls) ? args.calls : [args.calls];
      const lines = items.map((call) => { const input = fieldsText(fieldsOf(call?.input), 160); return `• ${actionWords(String(call?.path || "").replace(/^tools\./, ""))}${input ? ` — ${input}` : ""}`; });
      return `do this in ${service}:\n${lines.join("\n")}`;
    }
    if (connectorTool(name) === "execute") {
      const paths = programPaths(programOf(args));
      return paths?.length ? `run a script in ${service} that will:\n${[...new Set(paths)].map((path) => `• ${actionWords(path)}`).join("\n")}`
        : `run a script in ${service} whose actions can't be read before it runs.`;
    }
    return mcpLabel(name, args);
  }
  if (name === "feed") return `add a feed, ${args.title || "untitled"}, every ${args.everyMinutes} min (${SOURCE_WORDS[args.source?.kind] || "a source"})`;
  if (name === "routine") return `${args.action === "remove" ? "remove" : "save"} the routine ${args.name || ""}`;
  if (ALWAYS_OUTWARD[name]) {
    const what = name === "steer_chat" ? `${args.chatId || "a chat"}: ${String(args.message || "").slice(0, 200)}`
      : `${args.workspace || "a workspace"}${args.profile ? ` (${args.profile})` : ""}: ${String(args.prompt || "").slice(0, 200)}`;
    return `${ALWAYS_OUTWARD[name]}, ${what}`;
  }
  const target = `${args.device}${args.folder ? ` · ${args.folder}` : ""}`;
  if (name === "bash") return `run on ${target}: ${String(args.command || "").slice(0, 200)}`;
  return `${name} ${args.path || ""} on ${target}`;
};
const outward = (name, args) => Boolean((ALWAYS_OUTWARD[name] && (!OUTWARD_ACTIONS[name] || OUTWARD_ACTIONS[name].includes(args?.action)))
  || (PLACED.includes(name) && args?.device));
const SOURCE_WORDS = { executor: "Executor program", script: "Script in its folder", run: "A model run" };

async function ruleTarget(runtime, name, args) {
  if (name.startsWith("mcp__")) {
    // A gateway call's rule is the exact set of actions; a program has none to match.
    const paths = connectorCalls(name, args);
    return paths ? JSON.stringify([...new Set(paths)].sort()) : connectorTool(name) === "execute" ? null : name;
  }
  // Each feed and routine change is its own decision: no lasting rule.
  if (name === "feed" || name === "routine") return null;
  if (name === "start_chat") {
    if (typeof args.workspace !== "string" || !args.workspace.trim()) return null;
    const workspace = args.workspace.trim();
    const projects = await runtime.agent.projects.list();
    return (projects.find((item) => item.id === workspace) || projects.find((item) => item.slug === workspace)
      || projects.find((item) => item.name === workspace))?.id ?? null;
  }
  if (name === "steer_chat") return args.chatId;
  if (name === "bash") return JSON.stringify([args.device, args.folder ?? null, args.command]);
  return JSON.stringify([args.device, args.folder ?? null]);
}

const ruleLabel = (name, args) => {
  if (name.startsWith("mcp__")) return `${[...new Set(connectorActions(name, args) || [])].map(actionWords).join(", ") || mcpLabel(name, args)}, any input`;
  if (name === "feed") return "add a feed";
  if (name === "routine") return "change a routine";
  if (name === "start_chat") return `start a chat, ${args.workspace || "a workspace"}`;
  if (name === "steer_chat") return `post in one of your chats, ${args.chatId || "a chat"}`;
  const target = `${args.device}${args.folder ? ` · ${args.folder}` : ""}`;
  return name === "bash" ? `run on ${target}: ${String(args.command || "").slice(0, 200)}` : `${name} on ${target}`;
};

// JSON arguments have no cycles. Sort object keys recursively so equivalent calls share a grant.
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
// What leaves a commit is copied out of it: the doc's objects cannot be read once it settles.
const plain = (value) => JSON.parse(JSON.stringify(value));
const result = (text, id, isError = false) => ({ output: [{ type: "text", text }], isError, details: { ask: id } });

/*
 * What the approval card shows: a title, and lines that are plain text or `{ text?, fields?, code? }` -- an action
 * with what it sends as labelled fields, or a command or script as it will run (approval.tsx draws them).
 */
const CODE_MAX = 2000;
const codeOf = (text) => { const code = String(text ?? ""); return code.length > CODE_MAX ? `${code.slice(0, CODE_MAX)}\n… ${code.length - CODE_MAX} more characters` : code; };
function presentation(name, args) {
  if (name.startsWith("mcp__")) {
    const paths = connectorActions(name, args) || [];
    const service = serviceOf(paths[0]);
    const calls = connectorCalls(name, args);
    const items = Array.isArray(args.calls) ? args.calls : args.calls ? [args.calls] : [];
    // One call is named by the title already: only what it sends is left to show.
    let lines = calls ? calls.map((path, i) => {
      const fields = fieldsOf(items[i]?.input);
      return calls.length === 1 ? fields.length ? { fields } : null : fields.length ? { text: actionWords(path), fields } : actionWords(path);
    }).filter(Boolean) : [...new Set(paths)].map(actionWords);
    if (lines.length > 12) lines = [...lines.slice(0, 11), `+ ${lines.length - 11} more actions`];
    if (connectorTool(name) === "execute") lines.push({ text: "Script", code: codeOf(programOf(args)) });
    else if (!calls) { const fields = fieldsOf(args); if (fields.length) lines.push({ fields }); }
    const label = mcpLabel(name, args);
    return { title: label[0].toUpperCase() + label.slice(1), service, lines };
  }
  if (name === "feed") {
    const source = args.source || {};
    const code = source.kind === "executor" ? source.code : source.kind === "script" ? source.command : source.task;
    const reads = source.kind === "executor" ? [...new Set(programPaths(source.code) || [])].map(actionWords).join(", ") : "";
    return { title: `Add a feed: ${String(args.title || "untitled").slice(0, 80)}`, service: source.kind === "executor" ? serviceOf(programPaths(source.code)?.[0]) : null,
      lines: [{ fields: [{ label: "Every", value: `${args.everyMinutes} min` }, { label: "Source", value: SOURCE_WORDS[source.kind] || "unknown" },
        ...reads ? [{ label: "Reads", value: reads }] : [], { label: "Runs", value: source.kind === "run" ? "a model each time, within the budget" : "without a model; new items go to the inbox" }] },
      { text: source.kind === "run" ? "Task" : "Code", code: codeOf(code) }] };
  }
  if (name === "routine") {
    if (args.action === "remove") return { title: `Remove the routine ${args.name || ""}`, service: null, lines: [] };
    return { title: `Save the routine ${args.name || ""}`, service: null, lines: [{ text: "File", code: codeOf(args.text) }] };
  }
  if (name === "start_chat") {
    return { title: `Start a chat in ${args.workspace || "Chats"}`, service: null,
      lines: [{ fields: [...args.title ? [{ label: "Title", value: String(args.title) }] : [], { label: "Message", value: String(args.prompt || "") }] }] };
  }
  if (name === "steer_chat") return { title: `Post in ${args.chatId || "a chat"}`, service: null, lines: [{ fields: [{ label: "Message", value: String(args.message || "") }] }] };
  const target = `${args.device}${args.folder ? ` · ${args.folder}` : ""}`;
  if (name === "bash") return { title: `Run \`${String(args.command || "").slice(0, 80)}\` on ${args.device}`, service: null, lines: [{ text: target, code: codeOf(args.command) }] };
  return { title: `${name[0].toUpperCase() + name.slice(1)} on ${args.device}`, service: null,
    lines: [target, ...args.path ? [String(args.path)] : [], ...name === "write" && args.content ? [{ code: codeOf(args.content) }] : []] };
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
    for (const [id, ask] of Object.entries(doc.asks ||= {})) {
      if (["declined", "expired", "used"].includes(ask.status) && Date.parse(ask.decidedAt || ask.createdAt) < now.getTime() - 7 * 86400_000) delete doc.asks[id];
    }
    const asks = Object.values(doc.asks ||= {});
    for (const ask of asks) if (ask.status === "pending" && ask.expiresAt <= now.toISOString()) ask.status = "expired";
    // A replay of the original ask must never consume a later grant or match a new rule.
    const replay = asks.find((ask) => (ask.toolCallId === api.callId && ask.sourceConversationId === api.conversationId) || ask.waiters?.some((waiter) => waiter.callId === api.callId && waiter.conversationId === api.conversationId));
    if (replay) return { ask: plain(replay), replay: true };
    // A replay after consuming a grant must not execute the external call a second time.
    const consumed = asks.find((ask) => ask.usedCallId === api.callId && ask.chatId === thread.chatId);
    if (consumed) return { ask: plain(consumed), consumed: true };
    const grant = asks.find((ask) => ask.chatId === thread.chatId && ask.argsKey === argsKey && ask.status === "allowed");
    const rule = !doc.tainted?.[api.conversationId] && target != null && Object.values(doc.rules || {}).some((item) => item.tool === name && item.target === target);
    if (grant) { grant.status = "used"; grant.usedCallId = api.callId; return { allowed: true }; }
    if (rule) return { allowed: true };
    const pending = asks.find((ask) => ask.chatId === thread.chatId && ask.argsKey === argsKey && ask.status === "pending");
    if (pending) { (pending.waiters ||= []).push({ callId: api.callId, conversationId: api.conversationId }); return { ask: plain(pending), waiting: true }; }
    const id = nextId(doc, "a");
    const ask = { id, chatId: thread.chatId, conversationId: thread.conversationId, toolCallId: api.callId, parentCallId,
      sourceConversationId: api.conversationId, run: thread.run, tool: name, args, argsKey, ...info, createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 86400_000).toISOString(), status: "pending", ruleTarget: target ?? "", ruleLabel: ruleLabel(name, args),
      tainted: Boolean(doc.tainted?.[api.conversationId]) };
    doc.asks[id] = ask;
    return { ask, created: true };
  }, context);
  if (outcome.allowed) return null;
  const { ask } = outcome;
  if (outcome.consumed) return result(`This approved call was interrupted; it may already have run. Check its effects before trying again (ask ${ask.id}).`, ask.id, true);
  if (outcome.created && !thread.run) runtime.notify?.({ kind: "approval", conversationId: thread.conversationId, text: `${runtime.agent.settings().name} wants to ${summary(name, args)}${ask.tainted ? "\n\nThis thread has read your chats: check that nothing private goes where it should not." : ""}`, key: ask.id });
  if (outcome.waiting || (outcome.replay && ask.toolCallId !== api.callId)) return result(`Still waiting for approval (ask ${ask.id}). Do not repeat this call while it waits.${thread.run ? " Say in your report what is waiting." : ""}`, ask.id);
  return result(`Asked the person to approve: ${ask.title} (ask ${ask.id}). Carry on with anything that does not depend on it. When they answer you will get a message.${thread.run ? " It shows under your report, ready to approve: say in it, in a few words, what is waiting." : ""}`, ask.id);
}

/**
 * `approved`: runs the call an allowed ask holds, once, in the thread it belongs to. The person's answer arrives as a
 * message naming the ask; the call itself (made by this thread earlier, or by a run) is the hub's copy, not retyped.
 */
export function ApprovedTool(runtime, tools) {
  return defineTool({
    name: "approved",
    description: "Run an approved call: the one an [Approval] Allowed message names, by its ask id. It runs exactly as asked, once.",
    parameters: Type.Object({ ask: Type.String({ description: "The ask id, e.g. a-3" }) }),
    execute: async (args, api, context) => {
      const described = await runtime.agent.describe(api.conversationId);
      const chatId = described?.role === "run" ? null : described?.chatId;
      const outcome = await api.commit(async (tx) => {
        const ask = (await tx.doc(AgentDoc)).asks?.[args.ask];
        if (!ask || !chatId || ask.chatId !== chatId) return { error: `No ask ${args.ask} in this thread.` };
        if (ask.usedCallId === api.callId) return { ask: plain(ask), interrupted: true };
        if (ask.status !== "allowed") return { error: `Ask ${ask.id} is ${ask.status === "used" ? "already done" : ask.status === "pending" ? "still waiting for the person" : ask.status}; do not do it.` };
        ask.status = "used"; ask.usedCallId = api.callId;
        return { ask: plain(ask) };
      }, context);
      if (outcome.error) return result(outcome.error, args.ask, true);
      if (outcome.interrupted) return result(`This approved call was interrupted; it may already have run. Check its effects before anything else (ask ${outcome.ask.id}).`, outcome.ask.id, true);
      const target = tools.find((tool) => tool.name === outcome.ask.tool);
      if (!target || !outcome.ask.args) return result(`Ask ${outcome.ask.id}'s tool is not available now.`, outcome.ask.id, true);
      return target.execute(outcome.ask.args, api, context);
    },
  });
}

/** The wraps the agent extension applies to its threads' tools, built against the installed tools. */
export function policyWraps(runtime, tools) {
  let helper;
  return tools.filter((tool) => PLACED.includes(tool.name) || ALWAYS_OUTWARD[tool.name] || PRIVATE_READS[tool.name] || (tool.name.startsWith("mcp__") && !tool.connectorReadOnly)).map((target) =>
    wrapTool(target, (tool) => ({ ...tool, execute: async (args, api, context) => {
      if (routineFile(tool.name, args)) {
        return { output: [{ type: "text", text: "Routines change through the routine tool (save), which the person approves." }], isError: true };
      }
      if ((tool.name.startsWith("mcp__") && !connectorRead(tool.name, args)) || outward(tool.name, args)) {
        const described = await runtime.agent.describe(api.conversationId);
        const run = described?.role === "run";
        const home = run ? await runtime.agent.home() : null;
        const thread = { chatId: run ? home.chat.id : described?.chatId, conversationId: run ? home.conversationId : api.conversationId, run };
        if (!thread.chatId) throw new Error("Agent thread not found");
        // Decided once per call, so a replay does not decide again on a turn that has since moved on.
        const asked = !run && runtime.agent.settings().youAsk !== false && editOnly(tool.name, args)
          && (await api.memo("personAsked", context) ?? await api.memo("personAsked", await personStarted(api, context), context));
        if (!asked) {
          const waiting = await approve(runtime, api, tool.name, args, context, thread);
          if (waiting) return waiting;
        }
      }
      const local = PLACED.includes(tool.name) && !args?.device;
      const env = local ? sandboxedEnv(api.env, { folder: runtime.agent.folder, dataRoot: runtime.dataRoot, shellEnv: runtime.shellEnv, helper: () => helper ||= sandboxHelper(runtime.dataRoot) }) : api.env;
      const result = await tool.execute(args, local ? { ...api, env } : api, context);
      if (privateRead(tool.name, args) && !result?.isError) {
        await api.commit(async (tx) => { (await tx.doc(AgentDoc)).tainted[api.conversationId] = true; }, context);
      }
      return result;
    } })));
}
