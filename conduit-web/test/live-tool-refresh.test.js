import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AgentDoc as ConduitAgentDoc } from "../src/agent/agent-doc.js";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { AgentDoc, createRegistry, defineExtension, defineTask, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { DurableRuntime, ConduitNotices, ConduitWorkspace } from "../src/server/durable-runtime.js";
import { DurableAdapter } from "../src/durable-adapter.js";
import { Subagents } from "../src/server/subagents.js";
import { scriptedProvider } from "../src/server/scripted-model.js";
import { registerAgentRoutes } from "../src/server/routes/agent.js";
import { executeRoutine } from "../src/agent/routines.js";
import { runSource } from "../src/agent/feeds.js";
import { agentFixture } from "./helpers/agent-fixture.js";

const tool = (name) => ({ name, description: name, parameters: Type.Object({}), replay: "safe", connectorReadOnly: true,
  execute: async () => ({ output: [{ type: "text", text: "[]" }] }) });

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-tools-"));
  const runtime = new DurableRuntime({ dataRoot: root, piAgentDir: root,
    templates: [{ id: "agent", internal: true, tools: ["read", "ask_user", "codemode"], extensions: [] }],
    contextStore: { assemble: async (_name, { vars }) => `template ${vars?.name}` } });
  runtime.exists = () => false;
  runtime.agentVars = async () => ({ name: "dynamic" });
  const adapter = new DurableAdapter({ runtime });
  const registry = createRegistry();
  runtime.extensions = new Map();
  runtime.install = (extension) => { registry.install(extension); runtime.extensions.set(extension.name, extension); };
  runtime.install(defineExtension({ name: "conduit", tools: [tool("read"), tool("ask_user"), tool("codemode")] }));
  runtime.install(defineExtension({ name: "conduit-mcp", tools: [] }));
  runtime.install(defineExtension({ name: "device-tools", tools: [] }));
  runtime.install(defineExtension({ name: "browser", tools: [] }));
  runtime.install(Subagents(runtime));
  const hold = defineTask({ name: "fixture.hold", version: 1, initial: () => ({ phase: "hold" }),
    phases: { hold: async (_task, api) => { await new Promise((resolve) => api.signal.addEventListener("abort", resolve, { once: true })); } } });
  runtime.install(defineExtension({ name: "fixture", tasks: [hold] }));
  const models = createModels();
  models.setProvider(scriptedProvider());
  runtime.agent = { connectors: { tools: () => [] } };
  runtime.refreshConnectors();
  const harness = runtime.harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
  runtime.open = async () => harness;
  t.after(async () => { await harness.close(context); await fs.rm(root, { recursive: true, force: true }); });
  const settings = await runtime.agentFor("agent", { roaming: true, fixedVars: { name: "fixed" } });
  const home = await harness.createConversation({ ownership: { kind: "ownerless" }, agent: {
    ...settings, model: { provider: "conduit-test", modelId: "steady" }, thinkingLevel: "max",
  } }, context);
  await home.commit(async (tx) => {
    (await tx.doc(ConduitWorkspace, home.id)).roaming = true;
    (await tx.doc(ConduitNotices, home.id)).prompt = { name: "fixed" };
  }, context);
  adapter.records.set("home", { id: "home", conversationId: home.id, conversation: home, templateId: "agent" });
  const spawn = (options = {}) => home.commit((tx) => runtime.spawnBackground(new Proxy(tx, {
    get(target, key) {
      if (key === "createTask") return (_task, input, options) => target.createTask(hold, input, options);
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  }), home.id, { key: randomUUID(), task: "Read accounts", instructions: "child instructions", ...options }), context);
  return { runtime, adapter, harness, home, spawn };
}

test("late connectors reach live sessions, existing children and later runs without changing their prompts", async (t) => {
  const { runtime, harness, home, spawn } = await fixture(t);
  const before = await home.agent(context);
  const first = await spawn();
  const childConversation = await harness.conversation(first.child, context);
  const childStored = await harness.snapshot(AgentDoc, first.child, context);
  await childConversation.configure({ tools: [...childStored.tools, "temporarily_unavailable"].map((name) => ({ name })) }, context);
  const connector = tool("mcp__executor__execute");
  runtime.agent.connectors.tools = () => [connector];
  await runtime.refreshConnectors();
  const current = await home.agent(context);
  assert.deepEqual(current.callable.map((item) => item.name), [...before.callable.map((item) => item.name), connector.name]);
  assert.equal(current.instructions, "template fixed");
  assert.equal(current.tools.some((item) => item.name === connector.name), false);
  for (const child of [first, await spawn()]) {
    const agent = await (await harness.conversation(child.child, context)).agent(context);
    assert.ok(agent.callable.some((item) => item.name === connector.name));
    assert.equal(agent.instructions, "child instructions");
    assert.ok(!agent.callable.some((item) => ["ask_user", "subagent", "conduit_ui"].includes(item.name)));
    assert.ok(!agent.extensions.some((item) => item.name === "browser"));
  }
  assert.ok((await harness.snapshot(AgentDoc, first.child, context)).tools.includes("temporarily_unavailable"));
  const stored = await harness.snapshot(AgentDoc, home.id, context);
  await runtime.refreshConnectors();
  assert.deepEqual(await harness.snapshot(AgentDoc, home.id, context), stored);
  runtime.agent.connectors.tools = () => [];
  await runtime.refreshConnectors();
  assert.ok(!(await home.agent(context)).callable.some((item) => item.name === connector.name));
});

test("late browser tools refresh live sessions and preserve fixed prompt slots", async (t) => {
  const { runtime, adapter, home } = await fixture(t);
  const assemble = runtime.contextStore.assemble;
  runtime.contextStore.assemble = async (name, options) => {
    assert.equal(options.vars.name, "fixed");
    return assemble(name, options);
  };
  runtime.browserHost = { available: true, tools: async () => [tool("agent_browser_snapshot")] };
  await runtime.loadBrowserTools();
  assert.ok((await home.agent(context)).callable.some((item) => item.name === "agent_browser_snapshot"));
  assert.equal((await adapter.sessionSettings(home, { templateId: "agent" })).instructions, "template fixed");
});

test("Executor readiness is bounded, and routine gathering records a missing connector error", async (t) => {
  const { agent } = await agentFixture(t);
  agent.connectors.entry("executor").connecting = new Promise(() => {});
  await assert.rejects(agent.connectors.ready("executor", 1), /Executor isn't connected/);
  agent.connectors.entry("executor").connecting = null;
  assert.deepEqual(await runSource(agent, { kind: "executor", code: "return [];" }), { items: [], error: "Executor isn't connected" });
  const plan = { name: "accounts", title: "Accounts", tasks: [{ id: "mail", kind: "executor", code: "return [];" }], gate: "when-new" };
  const outcome = await executeRoutine(agent, plan, { state: await agent.state(), now: Date.now() });
  assert.equal(outcome.tasks[0].error, "Executor isn't connected");
  assert.equal(outcome.run, false);
});

test("GET /v0/agent raises the attention notice while Executor is down", async (t) => {
  const { agent } = await agentFixture(t);
  agent.view = async () => ({ enabled: true, home: null, sides: [], asks: [] });
  agent.runtime.harness = await agent.runtime.open();
  const routes = new Map();
  const app = Object.fromEntries(["get", "post", "put", "patch", "delete"].map((method) => [method, (route, handler) => routes.set(`${method} ${route}`, handler)]));
  registerAgentRoutes(app, { agent, backends: { getByChatId: () => null } });
  for (const status of ["off", "error", "needs-sign-in", "connecting", "on"]) {
    Object.assign(agent.connectors, { bootAt: 0 }).entry("executor").status = status; // down past the settle window
    let view;
    await routes.get("get /v0/agent")({}, { json: (value) => { view = value; } }, (error) => { throw error; });
    assert.equal(view.attention.needsYou.notices.some((item) => item.text === "Executor isn't connected"), status !== "on");
  }
});


test("a run started without Executor records a visible notice", async (t) => {
  const { runtime, harness, spawn } = await fixture(t);
  runtime.agent.connectors.troubled = () => true;
  await spawn({ gate: true, title: "Morning brief" });
  const state = await harness.snapshot(ConduitAgentDoc, context);
  assert.equal(state.notices.at(-1).text, "Morning brief: Executor isn't connected");
});

test("mid-turn refresh reaches the next model request without redeclaring existing tools", { timeout: 3000 }, async (t) => {
  const { runtime, home } = await fixture(t);
  let entered, release;
  const started = new Promise((resolve) => { entered = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  const snapshots = [];
  const read = { ...tool("read"), execute: async () => {
    entered();
    await held;
    return { output: [{ type: "text", text: "read result" }] };
  } };
  runtime.install(defineExtension({ name: "conduit", tools: [read, tool("ask_user"), tool("codemode")],
    sections: [{ key: "fixture-tools", render: ({ agent }) => { snapshots.push(agent.callable.map((item) => item.name)); return "Fixed section"; } }] }));
  const submission = await home.submit({ type: "input", content: "tool" }, context);
  await started;
  runtime.agent.connectors.tools = () => [tool("mcp__executor__execute")];
  await runtime.refreshConnectors();
  assert.equal(snapshots.length, 1);
  assert.ok(!snapshots[0].includes("mcp__executor__execute"));
  release();
  assert.equal((await submission.wait(context)).status, "done");
  assert.ok(snapshots[1].includes("mcp__executor__execute"));
  const entries = await home.entries({ order: "ascending" }, 100, undefined, context);
  const systems = entries.items.filter((item) => item.kind === "pi.system");
  assert.equal(systems.length, 1, "hidden connector addition preserves the existing model tool declarations");
});


test("reattached agent sessions keep their profile when launch options are absent", async (t) => {
  const { runtime, adapter, home } = await fixture(t);
  runtime.templates.unshift({ id: "assistant", tools: ["read"], extensions: [] });
  adapter.records.get("home").templateId = null;
  runtime.agent.connectors.tools = () => [tool("mcp__executor__execute")];
  await runtime.refreshConnectors();
  const agent = await home.agent(context);
  assert.ok(agent.callable.some((item) => item.name === "mcp__executor__execute"));
  assert.equal(agent.instructions, "template fixed");
});
