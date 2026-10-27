import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPiExtensionTools } from "./pi-extension-bridge.js";
import { placeProcesses } from "../nodes/place-processes.js";
import { DeviceTools, deviceEnv } from "./device-tools.js";
import { Handoff, Subagents } from "./subagents.js";
import { AgentExtension } from "../agent/extension.js";
import { awaitWithContext, BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import { createRegistry, defineDoc, defineExtension, defineTool, Harness, section } from "@earendil-works/pi-durable";
import { answerTo, isDismissal, questionRequest } from "../harnesses/questions.js";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools, createCodingTools } from "@earendil-works/pi-durable/tools";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import { createCodemodeExtension } from "@earendil-works/pi-durable/codemode";
import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import { ModelRuntime, resolveModelScopeWithDiagnostics } from "@earendil-works/pi-coding-agent";
import { buildManagedToolEnvironment } from "../../../scripts/pi-runtime.mjs";

// What the web tools are for and how to use them; a template that asks for
// them also brings the web-research skill.
const WEB_PROMPT = fs.readFileSync(new URL("../../../templates/conduit-runtime/WEB.md", import.meta.url), "utf8");
const WEB_ACCESS = fileURLToPath(new URL("../../node_modules/pi-web-access/index.ts", import.meta.url));
// A template's own extension that only asked Pi for its codemode, offered alone.
const CODEMODE_ONLY = /codemode-only\.js$/;
// Conduit's own tool, offered under every template.
const ALWAYS = ["ask_user"];
// Reads and searches: asking again after a restart costs a request, not a side effect.
const WEB_REPLAY_SAFE = ["web_search", "fetch_content", "get_search_content", "source_check"];

const MAX_QUESTIONS = 4;

/**
 * Ask the person, through Conduit's question card.
 *
 * Asking again is harmless, so a restart while the card is up asks again
 * rather than reporting the call interrupted. The card goes to whichever
 * chat holds the conversation; one not attached yet is waited for.
 */
const askUser = (runtime) => defineTool({
  name: "ask_user",
  description: "Ask the user one or more questions and wait for their answers. Offer short options where you can; "
    + "they may also type their own answer. Use it when you need a decision or information only they have.",
  parameters: Type.Object({
    title: Type.Optional(Type.String({ description: "A few words saying what this is about" })),
    questions: Type.Array(Type.Object({
      question: Type.String(),
      header: Type.Optional(Type.String({ description: "A short label for the question" })),
      options: Type.Optional(Type.Array(Type.Object({ label: Type.String(), description: Type.Optional(Type.String()) }))),
      multiSelect: Type.Optional(Type.Boolean()),
    }), { minItems: 1, maxItems: MAX_QUESTIONS }),
  }),
  replay: "safe",
  execute: async (args, api, context) => {
    const request = questionRequest({
      id: `ask-${api.callId}`, title: args.title || "A question for you",
      questions: args.questions.map((item, index) => ({
        id: `q${index + 1}`, header: item.header || "", prompt: item.question, multiSelect: Boolean(item.multiSelect),
        options: (item.options || []).map((option, at) => ({ id: `o${at + 1}`, label: option.label, description: option.description || "" })),
        // Something of their own can always be said.
        freeform: { placeholder: "Your answer", multiline: false, numeric: false },
      })),
    });
    const response = await runtime.ask(api.conversationId, request, context);
    if (isDismissal(response)) return { output: [{ type: "text", text: "The user dismissed the question without answering." }] };
    const lines = request.questions.map((question) => {
      const answer = answerTo(response, question);
      const said = [...answer.options.map((option) => option.label), answer.freeform].filter(Boolean).join("; ") || "(no answer)";
      return `${question.prompt}\n→ ${said}${answer.note ? ` (note: ${answer.note})` : ""}`;
    });
    return { output: [{ type: "text", text: lines.join("\n\n") }] };
  },
});

/** What Conduit tells every runtime conversation, ahead of the tools' own sections. */
const Conduit = (runtime) => defineExtension({
  name: "conduit",
  tools: [askUser(runtime)],
  sections: [
    // The working directory the tools resolve against: the chat's project.
    section("cwd", (input) => input.env?.cwd),
  ],
});

/**
 * Conduit's own runtime: one pi-durable Harness for the whole server.
 *
 * Every chat on the Conduit runtime is a conversation in one SQLite file under
 * the data root, so a turn, its tool calls and what is queued behind it are
 * committed before anything is shown, and a restarted server picks unfinished
 * work up where it stopped (a tool that is not safe to run twice is reported
 * to the model as interrupted instead). The record there is authoritative; the
 * chat's log is a projection of it.
 *
 * Models and credentials are the Conduit Pi agent's: the same auth file, the
 * same custom models and the same enabled list, so signing in to a provider
 * once serves both runtimes.
 */

/** The message ids Conduit gave a conversation's entries, which pi-durable numbers only once they commit. */
export const ConduitIds = defineDoc({
  kind: "conduit.ids",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  // `branches`: the conversations this chat was on before its edits forked it,
  // oldest first. Branches share the entries before their fork, so the chat's
  // history tree is drawn by merging their transcripts.
  initial: () => ({ messages: {}, branches: [] }),
});

/** Which paired device a conversation's tools run on: `null` is this server. */
export const ConduitWorkspace = defineDoc({
  kind: "conduit.workspace",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  // `place` is `{ root, path }` on that node: a shared root by id, never a path.
  // `roaming`: no home device; its tools pick one per call (decision 21).
  initial: () => ({ nodeId: null, place: null, roaming: false }),
});

/** A prompt as Conduit placed it: the model sees `content`, the transcript keeps the browser's id. */
export const USER_ENTRY = "conduit.user";

export class DurableRuntime {
  constructor({ dataRoot, piAgentDir, nodeHub = null, templates = [], promptStore = null }) {
    this.nodeHub = nodeHub;
    // The profiles (Assistant, Coding, Runtime) this agent runs: Conduit's templates.
    this.templates = templates;
    this.promptStore = promptStore;
    this.dataRoot = dataRoot;
    this.file = path.join(dataRoot, "runtime", "conduit-runtime.sqlite");
    this.piAgentDir = piAgentDir;
    this.context = BACKGROUND_CONTEXT;
    this.harness = null;
    this.models = null;
    this.opening = null;
    // Who answers a conversation's questions: the adapter record of the chat
    // holding it, registered while that chat is live.
    this.askers = new Map();
    this.askerWaits = new Map();
  }

  /** Tell the chat holding a conversation that its next step waits for an offline device. */
  emitWaiting(conversationId, device) {
    this.waiters?.get(conversationId)?.(device);
  }

  /**
   * What a conversation's calls on a device ask before waiting for it: whether
   * the user chose to go on without it (decision 21). That holds until the
   * device is back; the thread keeps its owner.
   */
  excuseFor(conversationId, nodeId) {
    const key = `${conversationId} ${nodeId}`;
    const entry = () => {
      this.excuses ||= new Map();
      if (!this.excuses.has(key)) this.excuses.set(key, { controller: new AbortController(), excused: false, name: null });
      return this.excuses.get(key);
    };
    return { excused: () => entry().excused, signal: () => entry().controller.signal, name: () => entry().name };
  }

  /** Go on without a device: its waiting calls end, and later ones answer at once that it is unavailable. */
  excuse(conversationId, device) {
    const key = `${conversationId} ${device.id}`;
    this.excuseFor(conversationId, device.id).signal();
    const entry = this.excuses.get(key);
    if (entry.excused) return;
    Object.assign(entry, { excused: true, name: device.name });
    entry.controller.abort();
    this.nodeHub?.once(`online:${device.id}`, () => { if (this.excuses.get(key) === entry) this.excuses.delete(key); });
  }

  waitFor(conversationId, onWait) {
    (this.waiters ||= new Map()).set(conversationId, onWait);
    return () => { if (this.waiters.get(conversationId) === onWait) this.waiters.delete(conversationId); };
  }

  answerFor(conversationId, asker) {
    this.askers.set(conversationId, asker);
    for (const wake of this.askerWaits.get(conversationId) || []) wake();
    this.askerWaits.delete(conversationId);
    return () => { if (this.askers.get(conversationId) === asker) this.askers.delete(conversationId); };
  }

  /** Who shows a conversation's extension notices: the live chat holding it, if any (a notice is not kept). */
  noticesFor(conversationId, onNotice) {
    (this.notices ||= new Map()).set(conversationId, onNotice);
    return () => { if (this.notices.get(conversationId) === onNotice) this.notices.delete(conversationId); };
  }

  notify(conversationId, notice) { this.notices?.get(conversationId)?.(notice); }

  /** A prompt a Pi extension sends its conversation (`sendUserMessage`), after what it is doing. */
  async say(conversationId, content, whenBusy, context) {
    const conversation = await this.harness.conversation(conversationId, context);
    const messageId = randomUUID();
    const text = typeof content === "string" ? content : content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    await conversation.submit({ type: "input", content, whenBusy, requestId: messageId,
      entry: { kind: USER_ENTRY, data: { messageId, text, timestamp: new Date().toISOString() } } }, context);
  }

  async ask(conversationId, request, context) {
    while (!this.askers.has(conversationId)) {
      await awaitWithContext(new Promise((resolve) => {
        this.askerWaits.set(conversationId, [...(this.askerWaits.get(conversationId) || []), resolve]);
      }), context);
    }
    return awaitWithContext(this.askers.get(conversationId)(request), context);
  }

  exists() { return fs.existsSync(this.file); }

  /** Opened on first use: a server with no runtime chats pays nothing for it. */
  open() {
    return this.opening ??= (async () => {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const agent = (name) => path.join(this.piAgentDir, name);
      this.modelsSignature = await this.modelFilesSignature();
      this.models = await ModelRuntime.create({
        authPath: agent("auth.json"), modelsPath: agent("models.json"), modelsStorePath: agent("models-store.json"),
      });
      const registry = createRegistry();
      // Every extension a template may select, by name; a conversation selects its template's.
      this.extensions = new Map();
      const install = (extension) => { registry.install(extension); this.extensions.set(extension.name, extension); };
      install(Conduit(this));
      // Images read or attached are resized and converted to fit the model
      // (pi-durable's Photon processor, in a worker), unless Pi's settings turn
      // autoResize off: without it a large screenshot was refused outright.
      this.images = await this.imageProcessor();
      const coding = this.images ? createCodingTools({ images: this.images }) : CodingTools;
      install(coding);
      install(DeviceTools(this, coding));
      install(Subagents(this));
      install(Handoff);
      const web = await this.webTools();
      if (web) install(web);
      install(createCodemodeExtension({ sandbox: new CodemodeSandbox(), namespaces: [{ name: "executor", prefix: "mcp__executor__", description: "Executor: the person’s connected accounts (mail, calendar, docs…)",
        instructions: "Find actions with search, read their signatures with describe, then run them with call: one action, or an array of independent ones. Anything that only reads (get, list, search…) goes ahead; anything that sends, creates, changes or deletes asks the person first, so batch reads together and keep each write its own call. Use execute only when one result must feed the next; name each action directly in it (tools.<path>(…) or tools[\"<path>\"](…), never a computed name), or it asks before running." }] }));
      this.refreshConnectors = () => {
        const tools = this.agent?.connectors.tools() || [];
        install(defineExtension({ name: "connectors", tools }));
        install(AgentExtension(this, [...this.extensions.get("device-tools").tools, ...tools]));
      };
      this.refreshConnectors();
      // Bash finds Conduit's managed Python first, as it does for Conduit Pi.
      const shellEnv = this.shellEnv = buildManagedToolEnvironment(process.env);
      this.harness = await Harness.open(await openNodeSqliteStorage(this.file), {
        models: this.models,
        registry,
        // Each call's files and processes are the conversation's working
        // directory: the project the chat belongs to, on whichever device holds it.
        env: async ({ conversationId, cwd, read }, context) => {
          const { nodeId, place } = (await read.snapshot(ConduitWorkspace, conversationId, context)) || {};
          // A conversation on a node never falls back to this machine's disk.
          if (nodeId && (!place || !this.nodeHub)) throw new Error("This conversation's device folder is not known; open it from its workspace again");
          return placeProcesses(this.nodeHub, { nodeId, place }).env({ cwd, shellEnv, shellSettings: this.piSettings(),
            onWait: (device) => this.emitWaiting(conversationId, device), excuse: nodeId ? this.excuseFor(conversationId, nodeId) : null });
        },
        settings: ((runtime) => ({
          get retry() {
            const retry = runtime.piSettings().retry;
            return Object.fromEntries([["enabled", retry?.enabled], ["maxRetries", retry?.maxRetries],
              ["baseDelayMs", retry?.baseDelayMs], ["maxAgentDelayMs", retry?.maxDelayMs]]
              .filter(([key, value]) => key === "enabled" ? typeof value === "boolean" : Number.isFinite(value) && value >= 0));
          },
          get compaction() {
            const compaction = runtime.piSettings().compaction;
            return Object.fromEntries([["enabled", compaction?.enabled], ["reserveTokens", compaction?.reserveTokens],
              ["keepRecentTokens", compaction?.keepRecentTokens]]
              .filter(([key, value]) => key === "enabled" ? typeof value === "boolean" : Number.isFinite(value) && value >= 0));
          },
          get steeringMode() {
            const mode = runtime.piSettings().steeringMode;
            return mode === "all" || mode === "one-at-a-time" ? mode : undefined;
          },
          get followUpMode() {
            const mode = runtime.piSettings().followUpMode;
            return mode === "all" || mode === "one-at-a-time" ? mode : undefined;
          },
          // A partial is committed, and so drawn, this often. The default 100ms
          // reads as a stutter; a frame at 30Hz is as often as is worth a write.
          progress: { partialIntervalMs: 33, outputIntervalMs: 100 },
        }))(this),
        onReport: (error) => console.warn("[conduit-runtime]", error?.message || error),
      }, this.context);
      this.harness.closed.then((end) => {
        if (end.reason === "failed") console.error("[conduit-runtime] closed after a storage failure", end.error);
        this.harness = null;
        this.opening = null;
      });
      // Whatever the last process left running goes on now, before anyone asks.
      this.harness.resume();
      return this.harness;
    })().catch((error) => { this.opening = null; throw error; });
  }

  /**
   * The Assistant profile's web research tools, from the same pi-web-access
   * extension Conduit Pi loads, with its configuration (web-search.json) read
   * from the Conduit Pi agent's directory. A runtime without them still runs.
   */
  async webTools() {
    this.piExtensionLoads = new Map();
    this.piExtensionFor = async (entry) => {
      const { resolvePiExtensionEntries } = await import("./pi-extension-bridge.js");
      const loaded = [];
      const webEntry = fs.existsSync(WEB_ACCESS) ? fs.realpathSync(WEB_ACCESS) : WEB_ACCESS;
      // Templates name the package directory; reuse the source entry already used by its tools.
      const source = fs.existsSync(entry) && fs.realpathSync(entry) === path.dirname(webEntry) ? WEB_ACCESS : entry;
      for (const file of await resolvePiExtensionEntries(source)) {
        if (!this.piExtensionLoads.has(file)) {
          const web = file === webEntry;
          this.piExtensionLoads.set(file, loadPiExtensionTools(file, { models: this.models, runtime: this,
            replaySafe: web ? WEB_REPLAY_SAFE : [],
            env: web ? { PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR || this.piAgentDir } : {},
            ...(web ? { entries: path.join(this.piAgentDir || path.dirname(this.file), "extension-entries", "web.jsonl") } : {}) }));
        }
        loaded.push(await this.piExtensionLoads.get(file));
      }
      return loaded;
    };
    try {
      const tools = (await this.piExtensionFor(WEB_ACCESS)).flat();
      return defineExtension({ name: "web", tools, sections: [section("web", () => WEB_PROMPT, { tag: false })] });
    } catch (error) {
      console.warn("[conduit-runtime] web tools unavailable:", error?.message || error);
      return null;
    }
  }

  async commandsFor(templateId) {
    const template = this.templateFor(templateId);
    if (!template || (!template.extensions?.length && !template.promptTemplates?.length)) return [];
    await this.open();
    const loaded = new Set();
    for (const entry of template.extensions || []) {
      try { for (const tools of await this.piExtensionFor(entry)) loaded.add(tools); }
      catch (error) { console.warn("[conduit-runtime] extension commands unavailable:", entry, error?.message || error); }
    }
    const commands = [...loaded].flatMap((tools) => tools.commands);
    const counts = new Map();
    for (const command of commands) counts.set(command.name, (counts.get(command.name) || 0) + 1);
    const seen = new Map();
    const taken = new Set();
    const resolved = commands.map((command) => {
      const occurrence = (seen.get(command.name) || 0) + 1;
      seen.set(command.name, occurrence);
      let name = counts.get(command.name) > 1 ? `${command.name}:${occurrence}` : command.name;
      let suffix = occurrence;
      while (taken.has(name)) name = `${command.name}:${++suffix}`;
      taken.add(name);
      return { ...command, name };
    });
    const { loadPiPrompts } = await import("./pi-extension-bridge.js");
    const prompts = template.promptTemplates?.length ? await loadPiPrompts({ cwd: process.cwd(),
      agentDir: this.piAgentDir, promptPaths: template.promptTemplates, includeDefaults: false }) : [];
    return [...resolved, ...prompts];
  }

  /**
   * A conversation's agent under a template (Assistant when none is named,
   * which is also what the old "Conduit runtime" profile's chats become):
   * its extensions and tools, and its prompt -- the template's, or the one
   * edited in Settings -- with its skills inlined. Skills are short, and
   * inlined they are there for a device's workspace too, where the read tool
   * cannot reach this server's files.
   */
  templateFor(templateId) {
    return this.templates.find((item) => item.id === templateId)
      || this.templates.find((item) => item.id === "assistant") || this.templates[0] || null;
  }

  /** A template's skills: name, description and body (frontmatter stripped). */
  skillsFor(templateId) {
    return (this.templateFor(templateId)?.skills || []).map((folder) => {
      const text = fs.readFileSync(path.join(folder, "SKILL.md"), "utf8");
      const field = (key) => new RegExp(`^${key}:\\s*(.+)$`, "m").exec(text)?.[1]?.trim().replace(/^["']|["']$/g, "");
      return { name: field("name") || path.basename(folder), description: field("description") || "",
        body: text.replace(/^---\n[\s\S]*?\n---\n/, "").trim() };
    });
  }

  async agentFor(templateId, { roaming = false } = {}) {
    await this.open();
    const template = this.templateFor(templateId);
    if (!template) return {};
    const named = (file) => (file.includes("pi-web-access") ? "web" : CODEMODE_ONLY.test(file) ? "codemode" : null);
    // A conversation with no home device picks one per call: the same tools, placed.
    // Delegation comes with the persistent shape (decision 9), or a template that lists `subagent`.
    const delegates = roaming || template.tools.includes("subagent");
    const isAgent = template.internal && template.id === "agent";
    const extensions = ["conduit", roaming ? "device-tools" : "coding-tools", ...template.extensions.map(named).filter(Boolean),
      ...(delegates ? ["subagents"] : []), ...(roaming ? ["handoff"] : []), ...(isAgent ? ["codemode", "connectors", "agent"] : [])]
      .map((name) => this.extensions.get(name)).filter(Boolean);
    const wanted = new Set([...ALWAYS, ...template.tools, ...(roaming ? ["devices", "handoff"] : []), ...(delegates ? ["subagent"] : [])]);
    // Codemode's own helpers (`pi.codemode.*`) come with it: its scripts call them.
    const tools = extensions.flatMap((extension) => extension.tools || [])
      .filter((tool) => wanted.has(tool.name) || (wanted.has("codemode") && tool.name.startsWith("pi.codemode.")) || (isAgent && tool.name.startsWith("mcp__")));
    // Pi's "codemode only": the model is offered codemode (and the question card); scripts call the rest.
    const codemodeOnly = template.extensions.some((file) => CODEMODE_ONLY.test(file));
    const prompt = this.promptStore ? (await this.promptStore.read(template.id)).content : fs.readFileSync(template.systemPrompt, "utf8");
    const skills = this.skillsFor(template.id).map((skill) => `## Skill: ${skill.name}\n\n${skill.body}`);
    return {
      extensions, tools,
      modelTools: codemodeOnly ? tools.filter((tool) => tool.name === "codemode" || ALWAYS.includes(tool.name))
        : isAgent ? tools.filter((tool) => !tool.name.startsWith("mcp__")) : null,
      instructions: [prompt.trim(), ...(skills.length ? ["# Skills", ...skills] : [])].join("\n\n"),
    };
  }

  /**
   * Where a roaming conversation can work: this server and every paired
   * environment, each with the folders it shares. A device with several
   * environments (Windows and WSL, decision 25) is one entry per environment,
   * "Jask desktop · WSL", since each serves only its own folders.
   */
  async reachable() {
    if (!this.nodeHub) return [];
    return (await this.nodeHub.listDevices()).flatMap((device) => device.nodes.map((node) => ({
      name: device.nodes.length > 1 ? `${device.name} · ${node.name}` : device.name,
      local: Boolean(node.local), online: Boolean(node.online), nodeId: node.id, roots: node.roots || [] })));
  }

  envOn(conversationId, device, folder) { return deviceEnv(this, conversationId, device, folder); }

  /** A conversation's last answer, as text: what a subagent hands back. */
  async lastAnswer(conversationId) {
    const conversation = await this.harness.conversation(conversationId, this.context);
    let cursor;
    do {
      const page = await conversation.entries({ order: "descending" }, 50, cursor, this.context);
      for (const entry of page.items) {
        const message = entry.kind === "pi.assistant" ? entry.model?.[0] : null;
        const text = (Array.isArray(message?.content) ? message.content : []).filter((part) => part?.type === "text").map((part) => part.text).join("").trim();
        if (text) return text;
      }
      cursor = page.next;
    } while (cursor);
    return "";
  }

  /**
   * The models offered, scoped as classic Pi scoped them: the agent's enabled
   * list when it has one, else the templates' own `models`, else every model
   * with credentials. Patterns resolve as Pi resolves them (globs included).
   */
  async modelFilesSignature() {
    return (await Promise.all(["models.json", "models-store.json", "auth.json"].map((name) => fs.promises.stat(path.join(this.piAgentDir, name))
      .then((stat) => `${stat.ino}:${stat.size}:${stat.mtimeMs}`, () => "-")))).join("|");
  }

  /**
   * The model registry as its files are now. models.json (providers and
   * overrides), auth.json and the store were read once at open, so an edit
   * reached durable chats only after a restart; one changed (by inode, size
   * or mtime, as the settings catalogue checks) is read again here, into the
   * same registry the harness holds.
   */
  async freshModels() {
    await this.open();
    const signature = await this.modelFilesSignature();
    if (signature !== this.modelsSignature) {
      this.modelsSignature = signature;
      this.modelsRefresh ||= this.models.refresh({ allowNetwork: false }).finally(() => { this.modelsRefresh = null; });
      await this.modelsRefresh;
    }
    return this.models;
  }

  async availableModels() {
    await this.freshModels();
    const available = await this.models.getAvailable();
    let patterns = null;
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(this.piAgentDir, "settings.json"), "utf8"));
      if (Array.isArray(settings.enabledModels)) patterns = settings.enabledModels;
    } catch {}
    patterns ??= [...new Set(this.templates.flatMap((template) => template.models || []))];
    if (!patterns.length) return available;
    const { scopedModels } = await resolveModelScopeWithDiagnostics(patterns, this.models);
    return scopedModels.map(({ model }) => model);
  }

  async imageProcessor() {
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(this.piAgentDir, "settings.json"), "utf8"));
      if (settings.images?.autoResize === false) return null;
    } catch {}
    return createNodePhotonImages().catch((error) => {
      console.warn("[conduit-runtime] images will not be resized:", error?.message || error);
      return null;
    });
  }

  piSettings() {
    try {
      const file = path.join(this.piAgentDir, "settings.json");
      const mtime = fs.statSync(file).mtimeMs;
      if (this.piSettingsCache?.mtime === mtime) return this.piSettingsCache.settings;
      let settings = {};
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) settings = parsed;
      } catch {}
      this.piSettingsCache = { mtime, settings };
      return settings;
    } catch {
      this.piSettingsCache = null;
      return {};
    }
  }

  async defaultModel() {
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(this.piAgentDir, "settings.json"), "utf8"));
      if (settings.defaultProvider && settings.defaultModel) {
        return { provider: settings.defaultProvider, modelId: settings.defaultModel, thinkingLevel: settings.defaultThinkingLevel || "" };
      }
    } catch {}
    const [first] = await this.availableModels();
    return first ? { provider: first.provider, modelId: first.id, thinkingLevel: "" } : null;
  }

  async close() {
    const harness = this.harness;
    if (!harness) return;
    await harness.close(this.context);
  }
}
