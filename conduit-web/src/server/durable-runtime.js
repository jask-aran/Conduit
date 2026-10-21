import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPiExtensionTools } from "./pi-extension-bridge.js";
import { RemoteExecutionEnv } from "../nodes/remote-env.js";
import { awaitWithContext, BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import { createRegistry, defineDoc, defineExtension, defineTool, Harness, section } from "@earendil-works/pi-durable";
import { answerTo, isDismissal, questionRequest } from "../harnesses/questions.js";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { buildManagedToolEnvironment } from "../../../scripts/pi-runtime.mjs";

const SYSTEM_PROMPT = fs.readFileSync(new URL("../../../templates/conduit-runtime/SYSTEM.md", import.meta.url), "utf8");
// The Assistant's web section, with the web-research skill it names inlined:
// the runtime loads no skills, and this one is short.
const WEB_PROMPT = [
  fs.readFileSync(new URL("../../../templates/conduit-runtime/WEB.md", import.meta.url), "utf8"),
  fs.readFileSync(new URL("../../../templates/coding/skills/web-research/SKILL.md", import.meta.url), "utf8").replace(/^---\n[\s\S]*?\n---\n/, ""),
].join("\n");
const WEB_ACCESS = fileURLToPath(new URL("../../node_modules/pi-web-access/index.ts", import.meta.url));
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
    section("preamble", () => SYSTEM_PROMPT, { tag: false }),
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
  initial: () => ({ messages: {} }),
});

/** Which paired device a conversation's tools run on: `null` is this server. */
export const ConduitWorkspace = defineDoc({
  kind: "conduit.workspace",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  // `place` is `{ root, path }` on that node: a shared root by id, never a path.
  initial: () => ({ nodeId: null, place: null }),
});

/** A prompt as Conduit placed it: the model sees `content`, the transcript keeps the browser's id. */
export const USER_ENTRY = "conduit.user";

export class DurableRuntime {
  constructor({ dataRoot, piAgentDir, nodeHub = null }) {
    this.nodeHub = nodeHub;
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
      this.models = await ModelRuntime.create({
        authPath: agent("auth.json"), modelsPath: agent("models.json"), modelsStorePath: agent("models-store.json"),
      });
      const registry = createRegistry();
      registry.install(Conduit(this));
      registry.install(CodingTools);
      await this.installWebTools(registry);
      // Bash finds Conduit's managed Python first, as it does for Conduit Pi.
      const shellEnv = buildManagedToolEnvironment(process.env);
      this.harness = await Harness.open(await openNodeSqliteStorage(this.file), {
        models: this.models,
        registry,
        // Each call's files and processes are the conversation's working
        // directory: the project the chat belongs to, on whichever device holds it.
        env: async ({ conversationId, cwd, read }, context) => {
          const { nodeId, place } = (await read.snapshot(ConduitWorkspace, conversationId, context)) || {};
          // A conversation on a node never falls back to this machine's disk.
          if (nodeId && (!place || !this.nodeHub)) throw new Error("This conversation's device folder is not known; open it from its workspace again");
          if (nodeId) {
            return new RemoteExecutionEnv({ hub: this.nodeHub, nodeId, place, cwd,
              onWait: (device) => this.emitWaiting(conversationId, device) });
          }
          return new NodeExecutionEnv({ cwd: cwd || process.cwd(), shellEnv });
        },
        settings: {
          // A partial is committed, and so drawn, this often. The default 100ms
          // reads as a stutter; a frame at 30Hz is as often as is worth a write.
          progress: { partialIntervalMs: 33, outputIntervalMs: 100 },
        },
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
  async installWebTools(registry) {
    process.env.PI_CODING_AGENT_DIR ??= this.piAgentDir;
    try {
      const tools = await loadPiExtensionTools(WEB_ACCESS, { models: this.models, replaySafe: WEB_REPLAY_SAFE });
      registry.install(defineExtension({ name: "web", tools, sections: [section("web", () => WEB_PROMPT, { tag: false })] }));
    } catch (error) {
      console.warn("[conduit-runtime] web tools unavailable:", error?.message || error);
    }
  }

  /** The models the Conduit Pi agent offers: its enabled list when it has one, else every model with credentials. */
  async availableModels() {
    await this.open();
    const available = await this.models.getAvailable();
    let enabled = null;
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(this.piAgentDir, "settings.json"), "utf8"));
      if (Array.isArray(settings.enabledModels) && settings.enabledModels.length) enabled = new Set(settings.enabledModels);
    } catch {}
    return enabled ? available.filter((model) => enabled.has(`${model.provider}/${model.id}`)) : available;
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
