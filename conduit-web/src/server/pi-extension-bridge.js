import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { awaitWithContext } from "@earendil-works/chord/context";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createJiti } from "jiti";
import { defineTool } from "@earendil-works/pi-durable";
import { ModelRegistry } from "@earendil-works/pi-coding-agent";

/**
 * Pi extensions, run by the Conduit runtime.
 *
 * A Pi extension is a function handed Pi's extension API. This hands it an API
 * that keeps what means something outside Pi's terminal: its tools, run as
 * pi-durable tools; its slash commands, run when a chat's message names one;
 * `exec`; and `sendMessage`/`sendUserMessage`, which queue a prompt to the
 * conversation the tool or command runs for. Widgets, shortcuts, status and
 * theme are no-ops. An extension loads once; each tool call or command brings
 * its own chat (an AsyncLocalStorage store), so the context it is handed --
 * working directory, model, the Conduit durable agent's model registry, and
 * `ui` -- is that chat's. `ui.select/confirm/input/editor` put a card up in the
 * chat and wait for the answer; `ui.notify` is a toast in it, when it is open.
 *
 * It also keeps what an extension files for itself with `appendEntry` (Pi
 * keeps those in the session): in `entries`, a file, read back to it at load
 * as a session's entries through its `session_start` handlers. pi-web-access
 * finds an earlier search's results that way, so paging one survives a
 * restart; without the start it also dropped its background fetches.
 *
 * `replaySafe` names the tools that may simply run again after a restart
 * (reads and searches); any other is reported to the model as interrupted.
 */
const quiet = new Proxy({}, { get: () => () => undefined });

function piApi(tools, { commands, calls, handlers, append }) {
  const send = (content, options) => {
    const call = calls.getStore();
    if (call?.active && !call.context.abortSignal?.aborted) call.send(content, options);
  };
  const api = {
    registerTool: (tool) => tools.push(tool),
    registerCommand: (name, command) => commands.set(name, { ...command, name }),
    sendMessage: (message, options) => send(message.content, options),
    sendUserMessage: (content, options) => send(content, options),
    on: (event, handler) => { if (typeof handler === "function") handlers.push([event, handler]); },
    appendEntry: (customType, data) => append(customType, data),
    exec: (command, args = [], options = {}) => new Promise((resolve) => {
      const call = calls.getStore();
      if (call && (!call.active || call.context.abortSignal?.aborted)) return resolve({ stdout: "", stderr: "", code: 1, killed: true });
      const signals = [options.signal, call?.context.abortSignal].filter(Boolean);
      execFile(command, args, { cwd: options.cwd || call?.cwd || call?.agent.cwd, timeout: options.timeout,
        signal: signals.length ? AbortSignal.any(signals) : undefined, maxBuffer: 32 * 1024 * 1024 },
        (error, stdout, stderr) => resolve({ stdout: String(stdout || ""), stderr: String(stderr || ""), code: error ? (typeof error.code === "number" ? error.code : 1) : 0, killed: Boolean(error?.killed) }));
    }),
    getFlag: () => undefined,
  };
  return new Proxy(api, { get: (target, key) => (key in target ? target[key] : () => undefined) });
}

/**
 * Variables an extension reads from process.env as it runs, set only while
 * it runs: they are the extension's, and anything this server spawns
 * meanwhile would otherwise inherit them for good. Overlapping calls share
 * one setting; the last to finish puts back what was there.
 */
function scopedEnv(variables) {
  let depth = 0;
  let saved = {};
  return async (work) => {
    if (depth++ === 0) {
      saved = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]));
      Object.assign(process.env, variables);
    }
    try { return await work(); } finally {
      if (--depth === 0) {
        for (const [key, value] of Object.entries(saved)) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
    }
  };
}

// What an extension files for itself, kept a day and at most this many: Pi
// keeps them for the session's life, and every chat here shares one load.
const ENTRIES_KEPT = 1000;
const ENTRY_DAYS_MS = 24 * 60 * 60 * 1000;

async function entryStore(file) {
  let entries = [];
  if (file) {
    const since = Date.now() - ENTRY_DAYS_MS;
    const text = await fs.readFile(file, "utf8").catch(() => "");
    for (const line of text.split("\n")) {
      try {
        const entry = JSON.parse(line);
        if (entry?.type === "custom" && Date.parse(entry.timestamp) >= since) entries.push(entry);
      } catch { /* a torn last line */ }
    }
    entries = entries.slice(-ENTRIES_KEPT);
  }
  let writing = Promise.resolve();
  const write = (work) => { writing = writing.then(work, work).catch((error) => console.warn("[conduit-runtime] extension entries not kept:", error?.message || error)); };
  // What was kept, pruned, as of now: an entry filed before this write lands is appended after it.
  const kept = entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
  if (file) write(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, kept);
  });
  return {
    entries: () => entries,
    append(customType, data) {
      const entry = { type: "custom", customType: String(customType), data, timestamp: new Date().toISOString() };
      entries.push(entry);
      const rewrite = entries.length > ENTRIES_KEPT;
      if (rewrite) entries = entries.slice(-ENTRIES_KEPT);
      if (file) write(() => (rewrite
        ? fs.writeFile(file, entries.map((item) => `${JSON.stringify(item)}\n`).join(""))
        : fs.appendFile(file, `${JSON.stringify(entry)}\n`)));
    },
  };
}

export async function loadPiExtensionTools(entry, { models, replaySafe = [], env = {}, entries: entriesFile = null, runtime }) {
  const scoped = scopedEnv(env);
  const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: true });
  const factory = await scoped(() => jiti.import(entry, { default: true }));
  const tools = [];
  const handlers = [];
  const commands = new Map();
  const calls = new AsyncLocalStorage();
  const store = await entryStore(entriesFile);
  await scoped(() => factory(piApi(tools, { commands, calls, handlers, append: (customType, data) => store.append(customType, data) })));
  const registry = new ModelRegistry(models);
  // One session, as far as the extension can tell, holding what it filed before.
  const session = { getBranch: () => store.entries(), getEntries: () => store.entries(), getSessionId: () => "conduit" };
  for (const [event, handler] of handlers) {
    if (event !== "session_start") continue;
    const ctx = new Proxy({ cwd: process.cwd(), hasUI: false, ui: quiet, modelRegistry: registry, sessionManager: session,
      isProjectTrusted: () => true }, { get: (target, key) => (key in target ? target[key] : undefined) });
    try { await scoped(() => handler({ type: "session_start" }, ctx)); }
    catch (error) { console.warn("[conduit-runtime] extension session_start failed:", error?.message || error); }
  }
  // `hasUI` says the user is at a terminal running this: true for a command they typed. A tool says false, as
  // before, since tools read it as leave to open UI of their own (pi-web-access's curator opens a browser on this
  // server's machine); the dialogs still work for a tool that asks.
  const callContext = (agent, call, context, hasUI) => {
    const ask = async (kind, fields) => {
      context.abortSignal?.throwIfAborted();
      const response = await runtime.ask(call.conversationId, { id: randomUUID(), kind, ...fields }, context);
      if (kind === "confirm") return !response?.cancelled && Boolean(response?.confirmed);
      return response?.cancelled ? undefined : response?.value;
    };
    return new Proxy({
      cwd: call.cwd || agent.cwd || process.cwd(), hasUI, signal: context.abortSignal,
      ui: new Proxy({
        select: (title, options) => ask("select", { title, options }),
        confirm: (title, message) => ask("confirm", { title, message }),
        input: (title, placeholder) => ask("input", { title, placeholder }),
        editor: (title, prefill) => ask("editor", { title, prefill }),
        notify: (message, level = "info") => {
          if (!context.abortSignal?.aborted) runtime.notify(call.conversationId, { message: String(message ?? ""), level });
        },
      }, { get: (target, key) => key in target ? target[key] : quiet[key] }),
      model: agent.model ? models.getModel(agent.model.provider, agent.model.modelId) : undefined,
      modelRegistry: registry, scopedModels: [], sessionManager: session, isProjectTrusted: () => true,
    }, { get: (target, key) => key in target ? target[key] : undefined });
  };
  const safe = new Set(replaySafe);
  const loaded = tools.map((tool) => defineTool({
    name: tool.name,
    description: [tool.description, tool.promptSnippet].filter(Boolean).join("\n\n"),
    parameters: tool.parameters,
    ...(safe.has(tool.name) ? { replay: "safe" } : {}),
    execute: async (args, api, context) => {
      const agent = await api.agent(context);
      const pending = [];
      const call = { conversationId: api.conversationId, cwd: api.env?.cwd, agent, context, active: true,
        send: (content, options) => pending.push({ content, options }) };
      const ctx = callContext(agent, call, context, false);
      const onUpdate = (partial) => {
        const text = (partial?.content || []).filter((part) => part.type === "text").map((part) => part.text).join("");
        if (text) api.output(`${text}\n`);
      };
      let result;
      try { result = await calls.run(call, () => scoped(() => tool.execute(api.callId, args, context.abortSignal, onUpdate, ctx))); }
      finally { call.active = false; }
      for (const { content, options } of pending) await runtime.say(api.conversationId, content, options?.deliverAs === "steer" ? "steer" : "followUp", context);
      return {
        output: (result?.content || []).filter((part) => part.type === "text" || part.type === "image"),
        ...(result?.details !== undefined ? { details: JSON.parse(JSON.stringify(result.details)) } : {}),
      };
    },
  }));
  loaded.commands = [...commands.values()].map((command) => ({
    name: command.name, description: command.description || "", source: "extension",
    run: async (args, call, context) => {
      context.abortSignal?.throwIfAborted();
      call = { ...call, context, active: true };
      try { await awaitWithContext(calls.run(call, () => scoped(() => command.handler(args, callContext(call.agent, call, context, true)))), context); }
      finally { call.active = false; }
    },
  }));
  return loaded;
}

// The package exports these functions from this module, but not its public index.
export async function loadPiPrompts(options) {
  const { loadPromptTemplates, expandPromptTemplate } = await import(new URL("./core/prompt-templates.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
  return loadPromptTemplates(options).templates.map((prompt) => ({
    name: prompt.name, description: prompt.description, source: "prompt",
    expand: (text) => expandPromptTemplate(text, [prompt]),
  }));
}

// Match Pi's explicit extension paths: package manifests, index files, or one directory level.
export async function resolvePiExtensionEntries(entry, seen = new Set()) {
  entry = await fs.realpath(entry);
  if (seen.has(entry)) return [];
  seen.add(entry);
  const declared = async (directory) => {
    const manifest = JSON.parse(await fs.readFile(path.join(directory, "package.json"), "utf8").catch((error) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return "{}";
      throw error;
    }));
    const entries = [];
    for (const file of manifest.pi?.extensions || []) {
      const resolved = path.resolve(directory, file);
      if (await fs.stat(resolved).catch(() => null)) entries.push(resolved);
    }
    if (entries.length) return entries;
    for (const file of ["index.ts", "index.js"]) {
      const resolved = path.join(directory, file);
      if (await fs.stat(resolved).catch(() => null)) return [resolved];
    }
    return [];
  };
  if (!(await fs.stat(entry)).isDirectory()) return [await fs.realpath(entry)];
  let entries = await declared(entry);
  if (!entries.length) {
    for (const item of await fs.readdir(entry, { withFileTypes: true })) {
      const file = path.join(entry, item.name);
      if ((item.isFile() || item.isSymbolicLink()) && /\.(ts|js)$/.test(item.name)) entries.push(file);
      else if (item.isDirectory() || item.isSymbolicLink()) entries.push(...await declared(file));
    }
  }
  const files = [];
  for (const file of entries) files.push(...await resolvePiExtensionEntries(file, seen));
  return files;
}
