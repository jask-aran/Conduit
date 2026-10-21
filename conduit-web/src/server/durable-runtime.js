import fs from "node:fs";
import path from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createRegistry, defineDoc, defineExtension, Harness, section } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { buildManagedToolEnvironment } from "../../../scripts/pi-runtime.mjs";

const SYSTEM_PROMPT = fs.readFileSync(new URL("../../../templates/conduit-runtime/SYSTEM.md", import.meta.url), "utf8");

/** What Conduit tells every runtime conversation, ahead of the tools' own sections. */
const Conduit = defineExtension({
  name: "conduit",
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

/** A prompt as Conduit placed it: the model sees `content`, the transcript keeps the browser's id. */
export const USER_ENTRY = "conduit.user";

export class DurableRuntime {
  constructor({ dataRoot, piAgentDir }) {
    this.file = path.join(dataRoot, "runtime", "conduit-runtime.sqlite");
    this.piAgentDir = piAgentDir;
    this.context = BACKGROUND_CONTEXT;
    this.harness = null;
    this.models = null;
    this.opening = null;
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
      registry.install(Conduit);
      registry.install(CodingTools);
      // Bash finds Conduit's managed Python first, as it does for Conduit Pi.
      const shellEnv = buildManagedToolEnvironment(process.env);
      this.harness = await Harness.open(await openNodeSqliteStorage(this.file), {
        models: this.models,
        registry,
        // Each call's files and processes are the conversation's working
        // directory: the project the chat belongs to.
        env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd || process.cwd(), shellEnv }),
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
