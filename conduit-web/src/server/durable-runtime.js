import { randomUUID } from "node:crypto";
import { hubBrowserTools } from "./browser-tools.js";
import { SCRIPTED_MODELS, scriptedProvider } from "./scripted-model.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prefixWatch } from "./prefix-watch.js";
import { SkillTool, skillNudges } from "./skill-tool.js";
import { SKILLS_INTRO } from "../context/context-store.js";
import { keepWarmPolicy, requestGaps, survivedLifetime } from "./keep-warm.js";
import { loadPiExtensionTools } from "./pi-extension-bridge.js";
import { placeProcesses } from "../nodes/place-processes.js";
import { DeviceTools, deviceEnv, reachableDevices } from "./device-tools.js";
import { Handoff, Subagents } from "./subagents.js";
import { UsageLedger } from "./usage-ledger.js";
import { ConduitMcp } from "./conduit-mcp.js";
import { AgentExtension } from "../agent/extension.js";
import { ApprovedTool, askOf, connectorWraps } from "../agent/policy.js";
import { awaitWithContext, BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import { createRegistry, defineDoc, defineExtension, defineTool, Harness, ProviderDoc, section } from "@earendil-works/pi-durable";
import { answerTo, isDismissal, questionRequest } from "../harnesses/questions.js";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools, createCodingTools } from "@earendil-works/pi-durable/tools";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import { createCodemodeExtension } from "@earendil-works/pi-durable/codemode";
import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import { ModelRuntime, resolveModelScopeWithDiagnostics } from "@earendil-works/pi-coding-agent";
import { buildManagedToolEnvironment } from "../../../scripts/pi-runtime.mjs";
// What each persistent-agent thread was last told (fixed slots, the time): the durable adapter keeps it per conversation.
export { ConduitNotices } from "../context/notices.js";

// What the web tools are for and how to use them; a template that asks for
// them also brings the web-research skill.
const WEB_PROMPT = fs.readFileSync(new URL("../../../templates/web-tools/WEB.md", import.meta.url), "utf8");
const WEB_ACCESS = fileURLToPath(new URL("../../node_modules/pi-web-access/index.ts", import.meta.url));
// A template's own extension that only asked Pi for its codemode, offered alone.
const CODEMODE_ONLY = /codemode-only\.js$/;
// Conduit's own tool, offered under every template.
const ALWAYS = ["ask_user", "skill"];
// Reads and searches: asking again after a restart costs a request, not a side effect.
const WEB_REPLAY_SAFE = ["web_search", "fetch_content", "get_search_content", "source_check"];
/** What every agent is told when the web tools did not load. */
const WEB_DOWN = "## Web research\n\nWeb search is not available on this hub right now (its web tools did not load). Do not look for another way to search or fetch the web (Executor, Bash, curl, a browser): tell the person web search is down and answer only what you can without it, marked as unverified.";

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
  tools: [askUser(runtime), SkillTool(runtime)],
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
  checkpointWhen: () => false, kind: "conduit.ids",
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
  checkpointWhen: () => false, kind: "conduit.workspace",
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

/**
 * A request's output limit is pi-ai's default, the model's catalogue `maxTokens`, unless asked: OpenRouter lists 943,718
 * for its 1M-context models and reserves credit for all of it, so a request failed (402) with a few dollars left. A
 * turn never writes near this many; a model whose own limit is lower keeps it.
 */
const OUTPUT_CAP = 64_000;
const cappedOutput = (models, onPayload) => new Proxy(models, {
  get(target, key) {
    if (key !== "streamSimple") { const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; }
    return (model, context, options = {}) => target.streamSimple(model, context,
      { ...options, maxTokens: Math.min(options.maxTokens ?? model.maxTokens ?? OUTPUT_CAP, OUTPUT_CAP),
        // Options pass through the task checkpoint, which keeps no functions: the payload hook is added here.
        // The session id rides along: a provider with no prompt_cache_key (OpenRouter) is still logged per conversation.
        ...(onPayload && !options.onPayload ? { onPayload: (params, payloadModel) => onPayload(params, payloadModel, options.sessionId) } : {}) });
  },
});

export class DurableRuntime {
  constructor({ dataRoot, piAgentDir, nodeHub = null, templates = [], contextStore = null }) {
    this.nodeHub = nodeHub;
    // The profiles (Assistant, Coding, Runtime) this agent runs: Conduit's templates.
    this.templates = templates;
    this.contextStore = contextStore;
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
  /**
   * Keep jbot's home thread's prompt cache warm between wakes (keep-warm.js): after each real request its last request
   * is sent again at 90% of the model's cache lifetime, read from cache, as many times as the policy reckons pays over
   * the thread's past gaps. A ping that finds the cache gone stops it. Pings count toward jbot's day and the usage ledger.
   */
  keepWarm(params, model) {
    const key = params?.prompt_cache_key;
    if (!key || params.__warm) return;
    void this.homeCacheKey().then((home) => {
      if (home?.key !== key) return;
      const policy = this.keepWarmPolicyFor(home, model);
      if (policy.pings > 0) this.armKeepWarm(home, Date.now(), 0, policy);
      else clearTimeout(this.keepWarmTimer);
    }).catch(() => {});
  }

  /** The policy for the home thread on this model, from its gaps; worked out again at most every ten minutes. */
  keepWarmPolicyFor(home, model) {
    const cached = this.keepWarmCached;
    if (cached && cached.key === home.key && cached.model === `${model?.provider}/${model?.id}` && Date.now() - cached.at < 600_000) return cached.policy;
    const id = /^\d+$/.test(String(home.conversationId)) ? Number(home.conversationId) : home.conversationId;
    // Its own pings, so a gap they kept alive is not taken for how long the provider keeps a cache.
    const pinged = (() => { try { return fs.readFileSync(path.join(this.dataRoot, "runtime", "prefix-watch.jsonl"), "utf8").split("\n")
      .filter((line) => line.includes('"keepWarm":')).map((line) => JSON.parse(line)).filter((line) => line.key === home.key).map((line) => Date.parse(line.t)); } catch { return []; } })();
    const policy = keepWarmPolicy({ model, gaps: requestGaps(this.file, id, 14, pinged), survivedMs: survivedLifetime(this.file, model, 14, id, pinged) });
    this.keepWarmCached = { at: Date.now(), key: home.key, model: `${model?.provider}/${model?.id}`, policy };
    const shown = JSON.stringify(policy);
    if (shown !== this.keepWarmShown) { this.keepWarmShown = shown; this.prefixWatch.note({ key: home.key, keepWarmPolicy: { model: `${model?.provider}/${model?.id}`, ...policy } }); }
    return policy;
  }

  /** The home thread's conversation and cache key (its provider session), looked up at most once a minute. */
  async homeCacheKey() {
    if (this.homeKey && Date.now() - this.homeKey.at < 60_000) return this.homeKey;
    const conversationId = (await this.agent?.state())?.home?.conversationId;
    const provider = conversationId && await this.harness.snapshot(ProviderDoc, conversationId);
    this.homeKey = { at: Date.now(), conversationId, key: provider?.sessionId };
    return this.homeKey;
  }

  armKeepWarm(home, from, pings, policy) {
    clearTimeout(this.keepWarmTimer);
    this.keepWarmTimer = setTimeout(() => void this.pingCache(home.key, pings, policy).catch((error) => console.warn("[cache] keep-warm failed", error?.message || error)),
      Math.max(0, from + policy.intervalMs - Date.now()));
    this.keepWarmTimer.unref?.();
  }

  async pingCache(key, pings, policy) {
    const home = await this.homeCacheKey();
    const saved = this.prefixWatch.last(key);
    if (home?.key !== key || !saved || !this.agent?.enabled() || pings >= policy.pings) return;
    let usage = null;
    const events = this.models.streamSimple(saved.model, { messages: [] }, { sessionId: key, cacheRetention: "long",
      onPayload: () => this.prefixWatch({ ...saved.params, __warm: true, max_output_tokens: 16 }, saved.model) });
    for await (const event of events) {
      if (event?.type === "error") console.warn("[cache] keep-warm failed", event.error?.errorMessage || "");
      if (event?.type === "done") usage = event.message?.usage;
    }
    const input = (usage?.input || 0) + (usage?.cacheRead || 0) + (usage?.cacheWrite || 0);
    const cost = usage?.cost?.total || 0;
    this.prefixWatch.note({ key, keepWarm: pings + 1, input, cacheRead: usage?.cacheRead || 0, cost });
    // What it cost is jbot's: its day (the budget) and the usage ledger, as the pings' own line.
    if (usage) {
      this.usage?.append({ t: "spend", d: this.usage.day(), c: "keep-warm", k: "tool:keep-warm",
        v: [usage.input || 0, usage.output || 0, usage.cacheRead || 0, usage.cacheWrite || 0, cost] });
      if (cost) await this.agent.update((doc) => { const day = this.agentDay?.() || new Date().toISOString().slice(0, 10); doc.spend[day] = (doc.spend[day] || 0) + cost; }).catch(() => {});
    }
    if (usage && usage.cacheRead >= 0.5 * input) this.armKeepWarm(home, Date.now(), pings + 1, policy);
  }

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
      this.models.registerNativeProvider(scriptedProvider());
      const registry = createRegistry();
      // Every extension a template may select, by name; a conversation selects its template's.
      this.extensions = new Map();
      // What the last harness had installed is not in this registry: a reopen after a storage failure installs again.
      this.connectorShape = this.browserShape = undefined;
      const install = this.install = (extension) => { registry.install(extension); this.extensions.set(extension.name, extension); };
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
      // The conduit MCP server's tools, in-process (conduit-mcp.js): the same ones another harness calls over HTTP.
      install(ConduitMcp(this));
      const web = await this.webTools();
      if (web) install(web);
      const codemode = createCodemodeExtension({ sandbox: new CodemodeSandbox(), namespaces: [{ name: "executor", prefix: "mcp__executor__", description: "Executor: the person’s connected accounts (mail, calendar, docs…)",
        instructions: "Find actions with search, read their signatures with describe, then run them with call: one action, or an array of independent ones. Anything that only reads (get, list, search…) goes ahead; anything that sends, creates, changes or deletes asks the person first, so batch reads together and keep each write its own call. Use execute only when one result must feed the next; name each action directly in it (tools.<path>(…) or tools[\"<path>\"](…), never a computed name), or it asks before running." }, { name: "browser", prefix: "agent_browser_", // The description is what the prompt shows of a namespace (its instructions are read only on describeNamespace), so
        // the way to work the browser is said here: an agent that never saw its tools named reached for another browser.
        description: "The hub's web browser: yours to browse in, with no permission needed, and the default for any browsing a web search or fetch cannot do. "
          + "tools.agent_browser_open({ url }) opens a page; tools.agent_browser_snapshot({ interactive: true }) lists what can be acted on, each with a ref such as @e3; "
          + "act by ref with agent_browser_click({ selector: \"@e3\" }), agent_browser_fill({ selector, text }), agent_browser_press({ key: \"Enter\" }); read with agent_browser_get_text. "
          + "After acting, take a snapshot to see what changed before saying it worked; if a control did nothing, try another way (its URL, another control). "
          + "The person sees it in a Browser pane once you show it (conduit_ui open, view browser:hub, beside: true): show it when they asked you to browse for them.",
        instructions: "describeNamespace(\"browser\") lists every tool. Act by snapshot refs rather than coordinates; a ref goes stale when the page changes, so snapshot again. The page is the person's too: leave it where they can follow." }] });
      install(defineExtension({ ...codemode, sections: [...codemode.sections,
        section("connector-instructions", () => this.contextStore?.connectorInstructions() || undefined, { tag: false }),
      ] }));
      this.refreshConnectors();
      // The hub's browser (browser-host.js): agent-browser's own MCP tools, from codemode, once its server answers.
      install(defineExtension({ name: "browser", tools: [] }));
      // The skill nudges (skill-tool.js), as pi-durable wraps on the tools a skill's `nudge` names; selected everywhere.
      const nudged = [...new Set((await this.skillsAvailable().catch(() => [])).flatMap((skill) => (skill.nudge || [])
        .map((entry) => typeof entry === "string" ? entry : Object.keys(entry || {})[0]).filter(Boolean)))];
      install(defineExtension({ name: "skills", tools: [], wraps: skillNudges(this, nudged) }));
      void this.loadBrowserTools();
      // Bash finds Conduit's managed Python first, as it does for Conduit Pi.
      const shellEnv = this.shellEnv = buildManagedToolEnvironment(process.env);
      this.prefixWatch = prefixWatch(path.join(this.dataRoot, "runtime", "prefix-watch.jsonl"));
      // A restart drops the keep-warm timer: picked up again from the home thread's last request, once jbot is loaded.
      setTimeout(() => void this.homeCacheKey().then((home) => {
        const saved = home?.key && this.prefixWatch.last(home.key);
        const policy = saved && this.keepWarmPolicyFor(home, saved.model);
        if (policy?.pings > 0 && Date.now() - saved.at < policy.intervalMs) this.armKeepWarm(home, saved.at, 0, policy);
      }).catch(() => {}), 30_000).unref?.();
      this.harness = await Harness.open(await openNodeSqliteStorage(this.file), {
        models: cappedOutput(this.models, (params, model, sessionId) => { this.keepWarm(params, model); return this.prefixWatch(params, model, sessionId); }),
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
          // Ask providers to keep the prompt cache long: 24 h on OpenAI models before GPT-5.6 (no extra charge), 1 h on
          // Anthropic; on GPT-5.6 and later "long" is the 30-minute default (a ChatGPT sign-in takes no cache option at
          // all: signed-in accounts keep their cache server-side). The prefix is only ever appended to, so what is cached
          // stays usable.
          stream: { cacheRetention: "long" },
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
          // Everything waiting in a turn joins it at its next pause, together: the person's messages as soon as the agent
          // can take them, and reports from agents that finished together read in one reply. pi's steeringMode is one
          // mode for every steer, so it is not read: one at a time would also hold reports back a request each.
          steeringMode: "all",
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
      // What its agents spend, per day (usage-ledger.js): following commits from before anything resumes.
      try { this.usage = await UsageLedger.open({ file: path.join(this.dataRoot, "usage", "ledger.jsonl"), harness: this.harness }); }
      catch (error) { console.error("[usage] ledger not opened", error); this.usage = null; }
      this.harness.closed.then((end) => {
        if (end.reason === "failed") console.error("[conduit-runtime] closed after a storage failure", end.error);
        this.usage?.close();
        this.usage = null;
        this.harness = null;
        this.opening = null;
        clearTimeout(this.keepWarmTimer);
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
      const missing = WEB_REPLAY_SAFE.filter((name) => !tools.some((tool) => tool.name === name));
      if (missing.length) throw new Error(`it loaded without ${missing.join(", ")}`);
      this.webToolsError = null;
      return defineExtension({ name: "web", tools, sections: [section("web", async () => this.contextStore ? this.contextStore.text("web-tools") : WEB_PROMPT, { tag: false })] });
    } catch (error) {
      // Loud, not a warning in the log: Needs you and /healthz say so (webToolsError), and every agent is told, so it
      // says search is down rather than hunting its tools for another way (it found Executor's, and gave up).
      this.webToolsError = String(error?.message || error).slice(0, 300);
      console.error("[conduit-runtime] web tools unavailable:", this.webToolsError);
      return defineExtension({ name: "web", tools: [], sections: [section("web", async () => WEB_DOWN, { tag: false })] });
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

  /** The chat a tool call was made from (conduit-mcp.js callingChat). */
  async chatOf(api, context) {
    return (await api.snapshot(ConduitIds, api.conversationId, context))?.chatId || null;
  }

  async subagentSettings(conversationId, context) {
    const identity = await this.harness.snapshot(ConduitIds, conversationId, context);
    const chat = identity?.chatId && this.agent?.registry.metadata(identity.chatId);
    if (!chat || chat.backend?.agentThread || chat.templateId === "agent") return null;
    const template = this.templateFor(chat.templateId || chat.backend?.profileId);
    if (!template || template.internal || !this.contextStore) return null;
    const settings = (await this.contextStore.document(`profile:${template.id}`)).subagents;
    if (!settings) return null;
    const slash = settings.model.indexOf("/");
    return { model: { provider: settings.model.slice(0, slash), modelId: settings.model.slice(slash + 1) }, thinkingLevel: settings.thinkingLevel };
  }

  /** A template's skills: name, description and body (frontmatter stripped). */
  /** Every skill `skill` may load: the context store's (shipped and installed, enabled), else the templates'. */
  async skillsAvailable() {
    if (this.contextStore) return this.contextStore.skillsAvailable();
    const seen = new Map();
    for (const template of this.templates) for (const skill of this.skillsFor(template.id)) seen.set(skill.name, skill);
    return [...seen.values()];
  }

  skillsFor(templateId) {
    return (this.templateFor(templateId)?.skills || []).map((folder) => {
      const text = fs.readFileSync(path.join(folder, "SKILL.md"), "utf8");
      const field = (key) => new RegExp(`^${key}:\\s*(.+)$`, "m").exec(text)?.[1]?.trim().replace(/^["']|["']$/g, "");
      return { name: field("name") || path.basename(folder), description: field("description") || "", folder, text,
        body: text.replace(/^---\n[\s\S]*?\n---\n/, "").trim() };
    });
  }

  /** Reinstall connector tools only when their declarations change. */
  refreshConnectors() {
    if (!this.extensions) return;
    try {
      // In name order, and only when something about them changed: a reconnect that lists the same tools in another
      // order, or the same tools again, would otherwise re-declare them and break every thread's prompt cache (pi#11529).
      const tools = [...(this.agent?.connectors.tools() || [])].sort((a, b) => a.name.localeCompare(b.name));
      const shape = JSON.stringify(tools.map((tool) => [tool.name, tool.description, tool.parameters]));
      if (shape === this.connectorShape) return;
      this.connectorShape = shape;
      // A connector's tools ask before they write, and `approved` runs what was allowed, in whichever chat selects them.
      this.install(defineExtension({ name: "connectors", tools: [...tools, ApprovedTool(this)], wraps: connectorWraps(this, tools) }));
      // conduit_inbox is the conduit MCP server's, and under the agent's policy as when it was the agent's own.
      const inbox = this.extensions.get("conduit-mcp").tools.filter((tool) => tool.name === "conduit_inbox");
      this.install(AgentExtension(this, [...this.extensions.get("device-tools").tools, ...tools, ...inbox]));
      return this.refreshLiveTools?.("connectors");
    } catch (error) { console.warn("[tools] connector refresh failed", error); }
  }

  /** agent-browser's tools into the `browser` extension whenever the host returns. */
  async loadBrowserTools() {
    if (!this.extensions || !this.browserHost?.available) return;
    try {
      // As connectors' (refreshConnectors): in name order, and declared again only when they change, so a reload with
      // the same tools never breaks a thread's prompt cache.
      const tools = [...await this.browserHost.tools()].sort((a, b) => a.name.localeCompare(b.name));
      const shape = JSON.stringify(tools.map((tool) => [tool.name, tool.description, tool.parameters]));
      if (shape === this.browserShape) return;
      this.browserShape = shape;
      this.install(defineExtension({ name: "browser", tools: hubBrowserTools(this, tools) }));
      await this.refreshLiveTools?.("browser");
    }
    catch (error) { console.warn("[browser] agent-browser's tools could not be loaded:", error?.message || error); }
  }

  /** A profile's tools as a chat of it is given them, without its prompt: `{ template, isAgent, extensions, tools, modelTools }`. */
  selectionFor(templateId, { roaming = false } = {}) {
    const template = this.templateFor(templateId);
    if (!template) return null;
    const named = (file) => (file.includes("pi-web-access") ? "web" : CODEMODE_ONLY.test(file) ? "codemode" : null);
    // A conversation with no home device picks one per call: the same tools, placed.
    // Delegation comes with the persistent shape (decision 9), or a template that lists `subagent`.
    const delegates = roaming || template.tools.includes("subagent");
    const isAgent = template.internal && template.id === "agent";
    // The person's connected accounts (Executor), reached from codemode, each write asked first: the agent's threads,
    // and a template that asks for them (`"connectors": true`, the Assistant).
    const connects = isAgent || template.connectors === true;
    // Codemode comes with the connected accounts, or with a template that lists it.
    const codes = connects || template.tools.includes("codemode");
    const extensions = [...new Set(["conduit", "conduit-mcp", "skills", roaming ? "device-tools" : "coding-tools", ...template.extensions.map(named).filter(Boolean),
      ...(delegates ? ["subagents"] : []), ...(roaming ? ["handoff"] : []), ...(codes ? ["codemode", "browser"] : []), ...(connects ? ["connectors"] : []), ...(isAgent ? ["agent"] : [])])]
      .map((name) => this.extensions.get(name)).filter(Boolean);
    const wanted = new Set([...ALWAYS, "conduit_ui", ...template.tools, ...(roaming ? ["devices", "handoff"] : []), ...(delegates ? ["subagent"] : []),
      ...(connects ? ["codemode", "approved"] : [])]);
    // Codemode's own helpers (`pi.codemode.*`) come with it: its scripts call them.
    const tools = extensions.flatMap((extension) => extension.tools || [])
      .filter((tool) => wanted.has(tool.name) || (wanted.has("codemode") && (tool.name.startsWith("pi.codemode.") || tool.name.startsWith("agent_browser_") || tool.name === "conduit_browser")) || (connects && tool.name.startsWith("mcp__")));
    // Pi's "codemode only": the model is offered codemode (and the question card); scripts call the rest.
    const codemodeOnly = template.extensions.some((file) => CODEMODE_ONLY.test(file));
    // A connector's tools and the browser's are many and large: codemode reaches them (its namespaces), the model does not.
    const behindCodemode = (tool) => tool.name.startsWith("mcp__") || tool.name.startsWith("agent_browser_") || tool.name === "conduit_browser";
    const ordered = this.inToolOrder(tools);
    const modelTools = codemodeOnly ? ordered.filter((tool) => tool.name === "codemode" || ALWAYS.includes(tool.name))
      : codes ? ordered.filter((tool) => !behindCodemode(tool)) : null;
    return { template, isAgent, extensions, tools: ordered, modelTools };
  }

  /**
   * Tools in Conduit's one append-only order (runtime/tool-order.json): a tool keeps the place it first had, and one
   * new to the hub goes after all the others. pi-durable then sees a conversation's tool list only grow at its end and
   * declares just what was added; a reordered list would make it declare the whole set again (harness/prompt.js
   * planTools). The order starts as the registry's, so nothing moves when it is first written.
   */
  inToolOrder(tools) {
    const file = path.join(this.dataRoot, "runtime", "tool-order.json");
    if (!this.toolOrder) {
      let saved = [];
      try { saved = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* first run */ }
      const registered = [...this.extensions.values()].flatMap((extension) => (extension.tools || []).map((tool) => tool.name));
      this.toolOrder = Array.isArray(saved) && saved.length ? saved.filter((name) => typeof name === "string") : registered;
    }
    const before = this.toolOrder.length;
    const known = new Set(this.toolOrder);
    for (const tool of tools) if (!known.has(tool.name)) { this.toolOrder.push(tool.name); known.add(tool.name); }
    if (this.toolOrder.length !== before || !fs.existsSync(file)) {
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(this.toolOrder, null, 1)}\n`); }
      catch (error) { console.warn("[tools] order not saved", error?.message || error); }
    }
    const place = new Map(this.toolOrder.map((name, index) => [name, index]));
    return [...tools].sort((a, b) => place.get(a.name) - place.get(b.name));
  }

  /**
   * Settings › AI › Tools, read-only: each profile's tools as its chats get them (jbot's threads roam; other profiles
   * as a chat in a folder), where each comes from, whether the model calls it or only codemode scripts do, and whether
   * it asks first (`askOf`). A chat that works on any device has its file tools placed per call, plus devices and handoff.
   */
  async toolsView() {
    await this.open();
    const SOURCES = { web: "extension", browser: "extension", codemode: "codemode", connectors: "connector" };
    const first = (text) => String(text || "").split(/(?<=[.!?])\s/)[0].trim();
    // What a tool is for, by the extension that brings it: how Settings › Tools files it.
    const GROUPS = { "coding-tools": "Files and shell", "device-tools": "Files and shell", web: "Web", "conduit-mcp": "Conduit", agent: "jbot's own", browser: "Hub browser" };
    const groupOf = (name, extension) => name.startsWith("pi.codemode.models.") ? "Models" : /^mcp__(.+?)__/.test(name) ? /^mcp__(.+?)__/.exec(name)[1].replace(/^./, (letter) => letter.toUpperCase()) : GROUPS[extension] || "The thread";
    return this.templates.map((template) => {
      const selection = this.selectionFor(template.id, { roaming: template.internal && template.id === "agent" });
      const sourceOf = new Map(selection.extensions.flatMap((extension) => (extension.tools || []).map((tool) => [tool.name, extension.name])));
      const direct = selection.modelTools ? new Set(selection.modelTools.map((tool) => tool.name)) : null;
      return {
        id: template.id, label: template.label || template.id, internal: Boolean(template.internal), agent: selection.isAgent,
        tools: selection.tools.map((tool) => {
          const extension = sourceOf.get(tool.name);
          const source = tool.name.startsWith("pi.codemode.") ? "codemode" : tool.name === "approved" ? "built-in" : SOURCES[extension] || "built-in";
          // text and parameters: what the model is told of it, whole (Settings › Tools shows it as the tool's pane).
          return { name: tool.name, description: first(tool.description), text: String(tool.description || ""), parameters: tool.parameters ?? null, source, extension, group: groupOf(tool.name, extension),
            reach: (!direct || direct.has(tool.name)) && (!tool.callers || tool.callers.includes("model")) ? "model" : "codemode", ...askOf(tool, { guarded: selection.isAgent }) };
        }),
      };
    });
  }

  async agentFor(templateId, { roaming = false, fixedVars = null } = {}) {
    await this.open();
    const selection = this.selectionFor(templateId, { roaming });
    if (!selection) return {};
    const { template, isAgent, extensions, tools, modelTools } = selection;
    const vars = isAgent && this.agentVars ? fixedVars || await this.agentVars().catch(() => ({})) : undefined;
    let instructions;
    if (this.contextStore) instructions = await this.contextStore.assemble(isAgent ? "agent" : `profile:${template.id}`, { vars });
    else {
      const skills = this.skillsFor(template.id);
      instructions = [fs.readFileSync(template.systemPrompt, "utf8").trim(), ...(template.basePrompt ? [fs.readFileSync(template.basePrompt, "utf8").trim()] : []), ...(skills.length ? [`${SKILLS_INTRO}\n\n${skills.map((skill) => `- **${skill.name}**: ${skill.description}`).join("\n")}`] : [])].filter(Boolean).join("\n\n");
    }
    return { extensions, tools, modelTools, instructions };
  }

  /**
   * Where a roaming conversation can work: this server and every paired
   * environment, each with the folders it shares. A device with several
   * environments (Windows and WSL, decision 25) is one entry per environment,
   * "Jask desktop · WSL", since each serves only its own folders.
   */
  async reachable() { return reachableDevices(this.nodeHub); }

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
    // The signature is kept once its refresh has succeeded (a failed one is tried again), and a caller arriving
    // during one waits for it rather than taking models not yet read.
    if (signature !== this.modelsSignature) {
      this.modelsRefresh ||= this.models.refresh({ allowNetwork: false }).then(() => { this.modelsSignature = signature; })
        .finally(() => { this.modelsRefresh = null; });
    }
    await this.modelsRefresh;
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
    patterns = [...patterns, ...SCRIPTED_MODELS];
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
    const first = (await this.availableModels()).find((model) => model.provider !== "conduit-test");
    return first ? { provider: first.provider, modelId: first.id, thinkingLevel: "" } : null;
  }

  async close() {
    this.prefixWatch?.flush();
    const harness = this.harness;
    if (!harness) return;
    await harness.close(this.context);
  }
}
