import { wrapTool } from "@earendil-works/pi-durable";
import { answerTo, isDismissal, questionRequest } from "../harnesses/questions.js";
import { AgentDoc, nextId } from "./agent-doc.js";

/**
 * What the agent may do alone (plan decision 7). Reading, drafting and work in
 * its own folder need no one. A call that leaves the folder is outward: one
 * placed on a device (`device` given), starting or steering another chat. In a
 * thread the person is in, an outward call asks first, on the question card;
 * a run never approves itself, so there it is refused with what it needed,
 * for its report to carry to the home thread.
 *
 * A conversation that has read the person's private data (their chats) is
 * tainted: its approval card says so, since what it sends may carry that data.
 */

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
const connectorRead = (name, args) => { const paths = connectorCalls(name, args); return Boolean(paths?.length && paths.every(isReadAction)); };
const connectorName = (name) => { const connector = name.split("__")[1] || ""; return `${connector[0]?.toUpperCase() ?? ""}${connector.slice(1)}`; };
const mcpLabel = (name, args) => {
  const paths = connectorCalls(name, args);
  if (paths) return `use ${connectorName(name)}: ${[...new Set(paths)].join(", ") || "an action"}`;
  return connectorTool(name) === "execute" ? `run a program on ${connectorName(name)}` : `use ${connectorName(name)}: ${connectorTool(name)}`;
};
const preview = (value) => { try { return JSON.stringify(value).slice(0, 300); } catch { return ""; } };
const summary = (name, args) => {
  if (name.startsWith("mcp__")) {
    const calls = connectorCalls(name, args);
    const detail = calls ? preview((Array.isArray(args.calls) ? args.calls : [args.calls]).map((call) => call?.input))
      : connectorTool(name) === "execute" ? String(args?.code ?? args?.source ?? preview(args)).slice(0, 300) : preview(args);
    return `${mcpLabel(name, args)}${detail ? `\n\n${detail}` : ""}`;
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
const refused = (text) => ({ output: [{ type: "text", text }], isError: true });

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

/** Ask the person on the question card whether one outward call may go ahead. */
async function approve(runtime, api, name, args, context) {
  const state = await api.snapshot?.(AgentDoc, context);
  const tainted = Boolean(state?.tainted?.[api.conversationId]);
  const target = await ruleTarget(runtime, name, args);
  // A tainted conversation must ask even when a saved rule matches.
  if (!tainted && target != null && Object.values(state?.rules || {}).some((rule) => rule.tool === name && rule.target === target)) return true;
  const request = questionRequest({
    id: `approve-${api.callId}`, title: "Allow this?",
    questions: [{ id: "q1", header: "Approval", prompt: `${runtime.agent?.settings().name || "The agent"} wants to ${summary(name, args)}`
      + (tainted ? "\n\nThis thread has read your chats: check that nothing private goes where it should not." : ""),
    options: [{ id: "allow", label: "Allow once" }, { id: "always", label: "Always allow" }, { id: "deny", label: "Don't" }] }],
  });
  // Tagged with the request, so a replay's second push replaces the first on the device.
  runtime.notify?.({ kind: "approval", conversationId: api.conversationId, text: request.questions[0].prompt, key: request.id });
  const response = await runtime.ask(api.conversationId, request, context);
  if (isDismissal(response)) return false;
  const choice = answerTo(response, request.questions[0]).options[0]?.id;
  if (choice === "always") {
    await api.commit(async (tx) => {
      const doc = await tx.doc(AgentDoc);
      const id = nextId(doc, "r");
      (doc.rules ||= {})[id] = { id, tool: name, target: target ?? "", label: ruleLabel(name, args), createdAt: new Date().toISOString() };
    }, context);
  }
  return choice === "allow" || choice === "always";
}

/** The wraps the agent extension applies to its threads' tools, built against the installed tools. */
export function policyWraps(runtime, tools) {
  return tools.filter((tool) => PLACED.includes(tool.name) || ALWAYS_OUTWARD[tool.name] || PRIVATE_READS[tool.name] || (tool.name.startsWith("mcp__") && !tool.connectorReadOnly)).map((target) =>
    wrapTool(target, (tool) => ({ ...tool, execute: async (args, api, context) => {
      if ((tool.name.startsWith("mcp__") && !connectorRead(tool.name, args)) || outward(tool.name, args)) {
        const role = (await runtime.agent?.describe(api.conversationId))?.role;
        if (role === "run") {
          return refused(`Not done: this needs the person's approval (${summary(tool.name, args)}). `
            + "A run cannot approve itself; say in your report exactly what to approve.");
        }
        if (!await approve(runtime, api, tool.name, args, context)) return refused("The person did not allow this; it was not done.");
      }
      const result = await tool.execute(args, api, context);
      if (privateRead(tool.name, args) && !result?.isError) {
        await api.commit(async (tx) => { (await tx.doc(AgentDoc)).tainted[api.conversationId] = true; }, context);
      }
      return result;
    } })));
}
