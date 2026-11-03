import test from "node:test";
import assert from "node:assert/strict";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, defineExtension, defineTask, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Subagents } from "../src/server/subagents.js";
import { scriptedProvider, SCRIPTED_MODELS } from "../src/server/scripted-model.js";

async function labels(t) {
  const context = BACKGROUND_CONTEXT;
  const models = createModels();
  models.setProvider(scriptedProvider());
  const runtime = { agentRunPrompt: async () => "You are a subagent working for another agent." };
  const extension = Subagents(runtime);
  const registry = createRegistry();
  registry.install(extension);
  // Keep background delivery outside this label test; no parent turn is submitted.
  const hold = defineTask({ name: "fixture.hold", version: 1, initial: () => ({ phase: "hold" }),
    phases: { hold: async (_task, api) => { await new Promise((resolve) => api.signal.addEventListener("abort", resolve, { once: true })); } } });
  registry.install(defineExtension({ name: "fixture", tasks: [hold] }));
  const harness = runtime.harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
  t.after(() => harness.close(context));
  const [provider, modelId] = SCRIPTED_MODELS[0].split("/");
  const root = await harness.root(context, { agent: { model: { provider, modelId }, thinkingLevel: "max", extensions: [extension] } });
  runtime.lastAnswer = async (id) => {
    const entries = await (await harness.conversation(id, context)).entries({}, 100, undefined, context);
    return entries.items.flatMap((entry) => entry.model || []).filter((message) => message.role === "assistant")
      .flatMap((message) => message.content).filter((part) => part.type === "text").map((part) => part.text).join("");
  };
  let serial = 0;
  return async (background, name, action = "spawn", id) => {
    const memo = new Map();
    let details;
    const api = {
      conversationId: root.id, taskId: await root.commit((tx) => tx.createTask(hold, { number: ++serial }, { ownership: { kind: "conversation" }, background: true }), context),
      getTask: async () => null,
      memo: async (key, value) => { if (value !== context) memo.set(key, value); return memo.get(key); },
      commit: (change) => root.commit((tx) => change(new Proxy(tx, {
        get(target, key) {
          if (key === "createTask") return (_task, input, options) => target.createTask(hold, input, options);
          const value = target[key];
          return typeof value === "function" ? value.bind(target) : value;
        },
      })), context),
      conversation: (id) => harness.conversation(id, context),
      snapshot: (doc, id) => harness.snapshot(doc, id, context),
      details: async (value) => { details = value; },
      waitForTask: (id) => harness.waitForTask(id, context),
      output() {},
    };
    await extension.tools[0].execute({ task: "Reply with the single word ready.", background, name, action, id }, api, context);
    return details;
  };
}

// persistent-agent.md, Agent ids and labels; subagents.js daily local counters.
test("foreground and background labels are distinct and restart at local midnight", { timeout: 700 }, async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2030, 5, 8, 23, 59, 59).getTime() });
  const spawn = await labels(t);
  const fg = await spawn(false);
  const bg = await spawn(true);
  assert.equal(fg.subagentId, "fg-1");
  assert.equal(bg.subagentId, "bg-1");
  assert.equal((await spawn(false)).subagentId, "fg-2");
  const busy = await spawn(true);
  assert.equal(busy.subagentId, "bg-2");
  await spawn(true, undefined, "stop", bg.subagentId);
  t.mock.timers.setTime(new Date(2030, 5, 9, 0, 0, 0).getTime());
  assert.equal((await spawn(false)).subagentId, fg.subagentId);
  assert.equal((await spawn(true)).subagentId, bg.subagentId);
  assert.equal((await spawn(true)).subagentId, "bg-3", "skip the label still running from yesterday");
});

// subagents.js: its name is the one the model gave it, else the task's first words.
test("a named subagent keeps the supplied name", { timeout: 700 }, async (t) => {
  const spawn = await labels(t);
  const name = "Fixture research";
  assert.equal((await spawn(false, name)).title, name);
  assert.equal((await spawn(true, name)).title, name);
});
