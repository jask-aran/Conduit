import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createJiti } from "jiti";
import { defineTool } from "@earendil-works/pi-durable";
import { ModelRegistry } from "@earendil-works/pi-coding-agent";

/**
 * Pi extension tools, run by the Conduit runtime.
 *
 * A Pi extension is a function handed Pi's extension API; most of what it
 * registers (commands, widgets, shortcuts, session hooks) is Pi's terminal UI
 * and means nothing here, but its tools are ordinary functions of their
 * arguments and a context. This hands the extension an API that keeps only
 * `registerTool` and `exec`, and runs each tool it registered as a pi-durable
 * tool with a headless context: no UI, the conversation's working directory
 * and model, and the Conduit durable agent's model registry for anything the tool
 * asks a model itself.
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

function piApi(tools, { handlers, append }) {
  const api = {
    registerTool: (tool) => tools.push(tool),
    on: (event, handler) => { if (typeof handler === "function") handlers.push([event, handler]); },
    appendEntry: (customType, data) => append(customType, data),
    exec: (command, args = [], options = {}) => new Promise((resolve) => {
      execFile(command, args, { cwd: options.cwd, timeout: options.timeout, signal: options.signal, maxBuffer: 32 * 1024 * 1024 },
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

export async function loadPiExtensionTools(entry, { models, replaySafe = [], env = {}, entries: entriesFile = null }) {
  const scoped = scopedEnv(env);
  const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: true });
  const factory = await scoped(() => jiti.import(entry, { default: true }));
  const tools = [];
  const handlers = [];
  const store = await entryStore(entriesFile);
  await scoped(() => factory(piApi(tools, { handlers, append: (customType, data) => store.append(customType, data) })));
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
  const safe = new Set(replaySafe);
  return tools.map((tool) => defineTool({
    name: tool.name,
    description: [tool.description, tool.promptSnippet].filter(Boolean).join("\n\n"),
    parameters: tool.parameters,
    ...(safe.has(tool.name) ? { replay: "safe" } : {}),
    execute: async (args, api, context) => {
      const agent = await api.agent(context);
      const ctx = new Proxy({
        cwd: api.env?.cwd || agent.cwd || process.cwd(),
        hasUI: false,
        ui: quiet,
        model: agent.model ? models.getModel(agent.model.provider, agent.model.modelId) : undefined,
        modelRegistry: registry,
        // Every available model is in scope (an empty scope says so), and the
        // session is the one its entries were replayed from.
        scopedModels: [],
        sessionManager: session,
        isProjectTrusted: () => true,
      }, { get: (target, key) => (key in target ? target[key] : undefined) });
      const onUpdate = (partial) => {
        const text = (partial?.content || []).filter((part) => part.type === "text").map((part) => part.text).join("");
        if (text) api.output(`${text}\n`);
      };
      const result = await scoped(() => tool.execute(api.callId, args, context.abortSignal, onUpdate, ctx));
      return {
        output: (result?.content || []).filter((part) => part.type === "text" || part.type === "image"),
        ...(result?.details !== undefined ? { details: JSON.parse(JSON.stringify(result.details)) } : {}),
      };
    },
  }));
}
