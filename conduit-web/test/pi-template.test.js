import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { buildPiArgs, PiManager } from "../src/pi-manager.js";
import { fileURLToPath } from "node:url";
import {
  buildPiEnvironment,
  listPiTemplates,
  loadPiModelPatterns,
  templatePublicView,
} from "../../scripts/pi-runtime.mjs";

test("repository templates are discoverable launch presets", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../templates");
  const templates = listPiTemplates(root);
  assert.ok(templates.some((template) => template.id === "chat"));
  assert.ok(templates.some((template) => template.id === "workspace"));
  assert.ok(templates.some((template) => template.id === "runtime"));
  const workspace = templates.find((template) => template.id === "workspace");
  const general = templates.find((template) => template.id === "chat");
  const view = templatePublicView(workspace);
  assert.equal(view.label, "Coding");
  assert.equal(view.defaultable, true);
  assert.ok(view.tools.includes("edit"));
  assert.ok(view.skillCount >= 1);
  assert.deepEqual(general.tools, ["read", "bash"]);
  assert.equal(view.extensionCount, 0);
  assert.equal(templatePublicView(templates.find((template) => template.id === "runtime")).defaultable, false);
});

test("listPiTemplates rejects duplicate template ids", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "conduit-dup-templates-"));
  for (const dir of ["one", "two"]) {
    const folder = path.join(root, dir);
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "SYSTEM.md"), "# x\n");
    fs.writeFileSync(path.join(folder, "template.json"), JSON.stringify({
      id: "shared",
      version: "1",
      tools: ["read"],
      models: [],
      extensions: [],
      skills: [],
      promptTemplates: [],
    }));
  }
  assert.throws(() => listPiTemplates(root), /Duplicate Pi template id "shared"/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("Pi launch arguments use native session storage and load only the selected template", () => {
  const template = {
    id: "chat",
    version: "1",
    systemPrompt: "/repo/templates/chat/SYSTEM.md",
    tools: ["read", "bash"],
    models: ["openai/gpt", "anthropic/claude"],
    extensions: ["/repo/templates/chat/extensions/example.ts"],
    skills: ["/repo/templates/chat/skills/example"],
    promptTemplates: [],
  };
  const args = buildPiArgs({ template, model: "openai/gpt", thinkingLevel: "high" });
  for (const flag of ["--no-approve", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files"]) {
    assert.ok(args.includes(flag), `missing ${flag}`);
  }
  assert.equal(args.includes("--session-dir"), false);
  assert.deepEqual(args.slice(args.indexOf("--system-prompt"), args.indexOf("--system-prompt") + 2), ["--system-prompt", template.systemPrompt]);
  assert.ok(args.includes("/repo/templates/chat/extensions/example.ts"));
  assert.ok(args.includes("/repo/templates/chat/skills/example"));
  assert.equal(args[args.indexOf("--tools") + 1], "read,bash");
  assert.equal(args[args.indexOf("--models") + 1], "openai/gpt,anthropic/claude");
  assert.equal(args[args.indexOf("--model") + 1], "openai/gpt");
  assert.equal(args[args.indexOf("--thinking") + 1], "high");
  assert.equal(args.includes(path.join(process.env.HOME || "", ".pi/agent/extensions")), false);
});

test("Pi runtime environment uses the Conduit-owned agent directory", () => {
  const env = buildPiEnvironment("/repo/data/pi", {
    PATH: "/bin",
    PI_CODING_AGENT_DIR: "/home/user/.pi/agent",
    PI_CODING_AGENT_SESSION_DIR: "/tmp/flat-sessions",
  });
  assert.equal(env.PI_CODING_AGENT_DIR, "/repo/data/pi");
  assert.equal("PI_CODING_AGENT_SESSION_DIR" in env, false);
  assert.equal(env.PATH, "/bin");
});

test("Pi launch arguments can narrow the template model scope", () => {
  const template = {
    id: "test",
    version: "1",
    systemPrompt: "/tmp/SYSTEM.md",
    tools: ["read"],
    models: ["openai/gpt", "anthropic/claude"],
    extensions: [],
    skills: [],
    promptTemplates: [],
  };

  const args = buildPiArgs({ template, models: ["anthropic/claude"] });

  assert.equal(args[args.indexOf("--models") + 1], "anthropic/claude");
});

test("terminal launcher model patterns prefer Pi's latest saved scope", () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "conduit-pi-models-"));
  fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({
    enabledModels: ["anthropic/haiku"],
  }));

  assert.deepEqual(loadPiModelPatterns(agentDir, ["openai/gpt"]), ["anthropic/haiku"]);
  assert.deepEqual(loadPiModelPatterns(path.join(agentDir, "missing"), ["openai/gpt"]), ["openai/gpt"]);
});

test("a stopped persisted session can be resumed in a fresh Pi process", async () => {
  const children = [];
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = { write() {} };
    child.kill = (signal) => {
      queueMicrotask(() => child.emit("exit", 0, signal));
      return true;
    };
    children.push(child);
    return child;
  };
  const manager = new PiManager({
    agentDir: "/tmp/conduit-pi-manager-test",
    spawnImpl,
    template: { id: "test", version: "1", models: [], tools: [], extensions: [], skills: [], promptTemplates: [] },
  });
  const project = { id: "project_test", slug: "test", path: "/tmp/project", sessionsDir: "/tmp/sessions" };
  const first = manager.create({ project, sessionFile: "/tmp/sessions/session.jsonl" });
  await manager.stopAndWait(first.id);
  const second = manager.create({ project, sessionFile: "/tmp/sessions/session.jsonl" });

  assert.equal(children.length, 2);
  assert.notEqual(second.child, first.child);
  assert.equal(manager.list().length, 1);
});

test("one Conduit chat cannot start two live Pi writers", () => {
  let spawns = 0;
  const manager = new PiManager({
    agentDir: "/tmp/conduit-pi-single-writer-test",
    spawnImpl: () => {
      spawns += 1;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = { write() {} };
      child.kill = () => true;
      return child;
    },
    template: { id: "test", version: "1", models: [], tools: [], extensions: [], skills: [], promptTemplates: [] },
  });
  const project = { id: "project_test", slug: "test", path: "/tmp/project", sessionsDir: "/tmp/sessions" };
  const first = manager.create({ project, chatId: "chat-stable" });
  const second = manager.create({ project, chatId: "chat-stable" });
  assert.equal(second, first);
  assert.equal(spawns, 1);
});

test("create can launch a non-default template and exposes it on the process view", () => {
  const manager = new PiManager({
    agentDir: "/tmp/conduit-pi-template-select-test",
    spawnImpl: () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = { write() {} };
      child.kill = () => true;
      return child;
    },
    template: {
      id: "chat",
      version: "1",
      label: "General",
      tools: ["read"],
      models: [],
      extensions: [],
      skills: [],
      promptTemplates: [],
      systemPrompt: "/tmp/SYSTEM.md",
    },
  });
  const project = { id: "project_test", slug: "test", path: "/tmp/project", sessionsDir: "/tmp/sessions" };
  const workspace = {
    id: "workspace",
    version: "1",
    label: "Workspace",
    posture: "read / edit / shell",
    tools: ["read", "bash", "edit", "write"],
    models: [],
    extensions: [],
    skills: [],
    promptTemplates: [],
    systemPrompt: "/tmp/WORKSPACE.md",
  };
  const record = manager.create({ project, chatId: "chat-workspace", template: workspace });
  const view = manager.view(record);
  assert.equal(view.template.id, "workspace");
  assert.equal(view.template.label, "Workspace");
  assert.deepEqual(view.template.tools, ["read", "bash", "edit", "write"]);
});

test("one manager launches a resolved Native Pi specification under shared process limits", () => {
  let invocation;
  const manager = new PiManager({
    agentDir: "/tmp/conduit-pi-native-manager-test",
    spawnImpl: (command, args, options) => {
      invocation = { command, args, options };
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = { write() {} };
      child.kill = () => true;
      return child;
    },
    template: { id: "chat", version: "3", models: [], tools: [], extensions: [], skills: [], promptTemplates: [] },
  });
  const project = { id: "project_workspace", slug: "workspace", path: "/tmp/workspace", sessionsDir: "/tmp/native-sessions" };
  const runtime = { kind: "native_pi", installationId: "host-pi", binaryVersion: "0.80.10" };
  const record = manager.create({
    project,
    chatId: "chat-native",
    launchSpec: {
      command: "/home/user/bin/pi",
      args: ["--mode", "rpc", "--no-approve"],
      cwd: project.path,
      env: { HOME: "/home/user" },
      sessionFile: null,
      runtime,
      binaryVersion: "0.80.10",
      trustPosture: "ignore_project_resources",
    },
  });
  assert.equal(invocation.command, "/home/user/bin/pi");
  assert.deepEqual(invocation.args, ["--mode", "rpc", "--no-approve"]);
  assert.equal(invocation.options.cwd, project.path);
  assert.equal(invocation.options.env.PI_CODING_AGENT_DIR, undefined);
  assert.equal(manager.view(record).runtime.kind, "native_pi");
  assert.equal(manager.view(record).binaryVersion, "0.80.10");
  record.sessionFile = "/home/user/.pi/agent/sessions/private.jsonl";
  assert.equal(manager.view(record).sessionFile, null);
});

test("an existing writer cannot be reused through a different runtime", () => {
  const manager = new PiManager({
    agentDir: "/tmp/conduit-runtime-conflict",
    spawnImpl: () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = { write() {} };
      child.kill = () => true;
      return child;
    },
    template: { id: "chat", version: "3", models: [], tools: [], extensions: [], skills: [], promptTemplates: [] },
  });
  const project = { id: "project_workspace", slug: "workspace", path: "/tmp/workspace", sessionsDir: "/tmp/sessions" };
  manager.create({
    project,
    chatId: "chat-runtime-conflict",
    launchSpec: {
      command: "/tmp/conduit-pi",
      args: [], cwd: project.path, env: {}, sessionFile: null,
      runtime: { kind: "conduit_profile" },
    },
  });
  assert.throws(() => manager.create({
    project,
    chatId: "chat-runtime-conflict",
    launchSpec: {
      command: "/tmp/native-pi",
      args: [], cwd: project.path, env: {}, sessionFile: null,
      runtime: { kind: "native_pi" },
    },
  }), { code: "session_writer_conflict" });
});

test("forwards each text delta immediately and preserves chunk ordering", () => {
  const manager = new PiManager({
    agentDir: "/tmp/conduit-pi-stream-test",
  });
  const record = {
    stream: { chunks: [], generationId: "g1" },
    generation: { id: "g1", closed: false },
    events: [],
    clients: new Set(),
    updatedAt: "",
  };

  manager.handleTextDelta(record, "Block\n");
  manager.handleTextDelta(record, "\nTail");
  assert.deepEqual(record.stream.chunks, ["Block\n", "\nTail"]);
  assert.deepEqual(record.events.map(({ type, delta }) => ({ type, delta })), [
    { type: "assistant_stream_delta", delta: "Block\n" },
    { type: "assistant_stream_delta", delta: "\nTail" },
  ]);
});

test("PiManager reduces structured generation state while retaining compatibility events", () => {
  const { manager, child, record } = rpcFixture();
  const published = [];
  manager.on("event", ({ event }) => published.push(event));
  const generationId = manager.prompt(record.id, "Hello");
  const partial = {
    role: "assistant",
    content: [{ type: "text", text: "Hello" }],
    stopReason: "stop",
  };
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "message_start", message: { role: "assistant", content: [] } })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: { ...partial, content: [{ type: "text", text: "" }] } },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hello", partial },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_end",
    message: { ...partial, usage: { input: 1, output: 1 } },
  })}\n`);

  assert.equal(record.activeGeneration.id, generationId);
  assert.equal(record.activeGeneration.status, "running");
  assert.deepEqual(record.activeGeneration.assistantMessages[0], {
    id: "m1",
    status: "complete",
    stopReason: "stop",
    errorMessage: null,
    blocks: [{
      type: "text",
      contentIndex: 0,
      text: "Hello",
      status: "complete",
      identity: `${generationId}:m1:0`,
    }],
  });
  assert.ok(published.some((event) => event.type === "content_block_delta" && event.delta === "Hello"));
  assert.equal(record.events.some((event) => event.type === "content_block_delta"), false);
  assert.ok(record.events.some((event) => event.type === "assistant_stream_delta" && event.delta === "Hello"));
  assert.ok(record.events.some((event) => event.type === "assistant_stream_final" && event.content === "Hello"));
  assert.equal("activeGeneration" in manager.view(record), false);
  assert.equal(manager.currentGenerationResume(record).generation.assistantMessages[0].blocks[0].text, "Hello");

  child.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  assert.equal(record.activeGeneration.status, "complete");
  assert.equal(manager.currentGenerationResume(record), null);
});

test("attach returns complete reduced Resume State independent of the capped event ring", () => {
  const { manager, child, record } = rpcFixture();
  const generationId = manager.prompt(record.id, "Long answer");
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "message_start", message: { role: "assistant", content: [] } })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_start",
      contentIndex: 0,
      partial: { role: "assistant", content: [{ type: "text", text: "" }] },
    },
  })}\n`);
  for (let index = 0; index < 520; index += 1) {
    child.stdout.write(`${JSON.stringify({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "x",
        partial: { role: "assistant", content: [{ type: "text", text: "x".repeat(index + 1) }] },
      },
    })}\n`);
  }
  const socket = new EventEmitter();
  socket.OPEN = 1;
  socket.readyState = 1;
  socket.send = () => {};

  const resume = manager.attach(record.id, socket);

  assert.equal(record.events.length, 500);
  assert.equal(resume.type, "generation_resume");
  assert.equal(resume.generationId, generationId);
  assert.equal(resume.seq, record.activeGeneration.lastSeq);
  assert.equal(resume.generation.assistantMessages[0].blocks[0].text.length, 520);
});

test("coalesces adjacent block deltas for each connected client", async () => {
  const { manager, record } = rpcFixture();
  const socket = deliverySocket();
  manager.attach(record.id, socket);

  manager.deliver(record, { type: "content_block_delta", generationId: "g1", seq: 3, messageId: "m1", blockType: "text", contentIndex: 0, delta: "Hel" });
  manager.deliver(record, { type: "content_block_delta", generationId: "g1", seq: 4, messageId: "m1", blockType: "text", contentIndex: 0, delta: "lo" });
  assert.equal(socket.events.length, 0);
  await wait(30);
  assert.deepEqual(socket.events, [{ type: "content_block_delta", generationId: "g1", seq: 4, messageId: "m1", blockType: "text", contentIndex: 0, delta: "Hello" }]);
});

test("slow clients discard superseded deltas and recover from Resume State", async () => {
  const { manager, child, record } = rpcFixture();
  manager.socketHighWaterMark = 1_024;
  manager.socketLowWaterMark = 512;
  const socket = deliverySocket({ bufferedAmount: 2_048 });
  manager.attach(record.id, socket);
  const generationId = manager.prompt(record.id, "Long answer");
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "message_start", message: { role: "assistant", content: [] } })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_start",
      contentIndex: 0,
      partial: { role: "assistant", content: [{ type: "text", text: "" }] },
    },
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 0,
      delta: "Complete state",
      partial: { role: "assistant", content: [{ type: "text", text: "Complete state" }] },
    },
  })}\n`);

  assert.equal(socket.events.length, 0);
  socket.bufferedAmount = 0;
  await wait(70);
  assert.equal(socket.events[0].type, "generation_resume");
  assert.equal(socket.events[0].generationId, generationId);
  assert.equal(socket.events[0].generation.assistantMessages[0].blocks[0].text, "Complete state");
  assert.equal(socket.events.some((event) => event.type === "content_block_delta"), false);
});

function deliverySocket({ bufferedAmount = 0 } = {}) {
  const socket = new EventEmitter();
  socket.OPEN = 1;
  socket.readyState = 1;
  socket.bufferedAmount = bufferedAmount;
  socket.events = [];
  socket.send = (payload) => socket.events.push(JSON.parse(payload));
  return socket;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function rpcFixture(onCommand) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = { write(line) { onCommand?.(JSON.parse(line), child); } };
  child.kill = (signal) => { queueMicrotask(() => child.emit("exit", 0, signal)); return true; };
  const manager = new PiManager({
    agentDir: "/tmp/conduit-pi-rpc-test",
    spawnImpl: () => child,
    template: { id: "test", version: "1", models: [], tools: [], extensions: [], skills: [], promptTemplates: [] },
  });
  const project = { id: "project_test", slug: "test", path: "/tmp/project", sessionsDir: "/tmp/sessions" };
  const record = manager.create({ project, chatId: "chat-test", sessionFile: "/tmp/sessions/original.jsonl" });
  child.emit("spawn");
  return { manager, child, record };
}

test("model RPC methods correlate catalog and state changes", async () => {
  const selected = { provider: "example", id: "reasoner", name: "Reasoner", reasoning: true };
  const { manager, record } = rpcFixture((command, process) => {
    if (!command.id) return;
    const data = command.type === "get_available_models"
      ? { models: [selected] }
      : command.type === "get_state" ? { model: selected, thinkingLevel: "high", sessionFile: "/tmp/sessions/original.jsonl" }
        : command.type === "set_model" ? selected : {};
    queueMicrotask(() => process.stdout.write(`${JSON.stringify({
      id: command.id, type: "response", command: command.type, success: true, data,
    })}\n`));
  });

  assert.deepEqual(await manager.getAvailableModels(record.id), [selected]);
  assert.deepEqual(await manager.setModel(record.id, "example/reasoner"), {
    model: "example/reasoner",
    thinkingLevel: "high",
  });
  assert.equal(manager.view(record).model, "example/reasoner");
});

test("normal abort closes the generation before late deltas can be published", async () => {
  const { manager, child, record } = rpcFixture((command, process) => {
    if (command.type === "abort") queueMicrotask(() => process.stdout.write(`${JSON.stringify({
      id: command.id, type: "response", command: "abort", success: true,
    })}\n`));
  });
  const generationId = manager.prompt(record.id, "Hello");
  const stopping = manager.abortGeneration(record.id, generationId);
  child.stdout.write(`${JSON.stringify({ type: "message_start", message: { role: "assistant" } })}\n`);
  child.stdout.write(`${JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "too late" } })}\n`);
  const result = await stopping;

  assert.equal(result.processTerminated, false);
  assert.equal(record.events.some((event) => event.type === "message_start"), false);
  assert.equal(record.activeGeneration.status, "stopped");
  assert.equal(record.activeGeneration.assistantMessages.length, 0);
  assert.equal(record.generation.closed, true);
});

test("a new prompt cannot race an in-flight abort", async () => {
  const { manager, record } = rpcFixture((command, process) => {
    if (command.type === "abort") setTimeout(() => process.stdout.write(`${JSON.stringify({
      id: command.id, type: "response", command: "abort", success: true,
    })}\n`), 50);
  });
  const generationId = manager.prompt(record.id, "Hello");
  const stopping = manager.abortGeneration(record.id, generationId);
  assert.throws(() => manager.prompt(record.id, "Too soon"), { code: "generation_stopping" });
  await stopping;
  assert.equal(manager.prompt(record.id, "After stop"), "g2");
});

test("correlated prompt rejection restores generation state before activation", async () => {
  const { manager, record } = rpcFixture((command, process) => {
    if (command.type === "prompt" && command.id) queueMicrotask(() => process.stdout.write(`${JSON.stringify({
      id: command.id,
      type: "response",
      command: "prompt",
      success: false,
      error: "prompt rejected",
    })}\n`));
  });
  await assert.rejects(manager.promptAccepted(record.id, "Hello"), /prompt rejected/);
  assert.equal(record.generation, null);
  assert.equal(record.events.some((event) => event.type === "generation_started"), false);
});

test("a hung abort terminates Pi at the deadline and leaves the persisted file resumable", async () => {
  const { manager, record } = rpcFixture(() => {});
  const generationId = manager.prompt(record.id, "Hello");
  const result = await manager.abortGeneration(record.id, generationId);
  assert.equal(result.processTerminated, true);
  assert.equal(record.status, "stopped");
  assert.equal(manager.bySessionFile.has(path.resolve("/tmp/sessions/original.jsonl")), false);
});

test("fork uses Pi's public RPC and updates the live native session mapping", async () => {
  const nextFile = "/tmp/sessions/forked.jsonl";
  const { manager, record } = rpcFixture((command, process) => {
    if (command.type === "fork") queueMicrotask(() => process.stdout.write(`${JSON.stringify({
      id: command.id, type: "response", command: "fork", success: true,
      data: { text: "Original question", cancelled: false },
    })}\n`));
    if (command.type === "get_state" && command.id) queueMicrotask(() => process.stdout.write(`${JSON.stringify({
      id: command.id, type: "response", command: "get_state", success: true,
      data: { sessionFile: nextFile, sessionId: "forked-native" },
    })}\n`));
  });
  const forked = await manager.fork(record.id, "entry-user");
  assert.equal(forked.text, "Original question");
  assert.equal(record.sessionFile, path.resolve(nextFile));
  assert.equal(record.sessionId, "forked-native");
  assert.equal(manager.bySessionFile.has(path.resolve("/tmp/sessions/original.jsonl")), false);
});

test("process view exposes chatId, activity, and host UI for global runtime", async () => {
  const { manager, child, record } = rpcFixture((command, process) => {
    if (command.type === "get_session_stats" && command.id) {
      queueMicrotask(() => process.stdout.write(`${JSON.stringify({
        id: command.id,
        type: "response",
        command: "get_session_stats",
        success: true,
        data: { contextUsage: { tokens: 1000, contextWindow: 128000, percent: 78 } },
      })}\n`));
    }
  });
  child.stdout.write(`${JSON.stringify({
    type: "extension_ui_request",
    id: "ui1",
    method: "confirm",
    title: "Allow?",
    message: "Write file",
  })}\n`);
  const view = manager.view(record);
  assert.equal(view.chatId, "chat-test");
  assert.equal(view.activity, "waiting_for_user");
  assert.equal(view.hostUiRequests.length, 1);
  assert.equal(view.hostUiRequests[0].kind, "confirm");

  await manager.refreshContextUsage(record.id);
  assert.equal(record.contextUsage.contextWindow, 128000);
  assert.equal(record.contextUsage.tokens, 1000);
  assert.equal(record.contextUsage.percent, 78);
  assert.ok(record.events.some((event) => event.type === "context_usage"));
});

test("tool and compaction events update coarse activity and publish state", () => {
  const { manager, child, record } = rpcFixture();
  child.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  assert.equal(record.active, true);
  assert.equal(manager.view(record).activity, "working");

  child.stdout.write(`${JSON.stringify({
    type: "tool_execution_start",
    toolCallId: "t1",
    toolName: "read",
    args: { path: "a.js" },
  })}\n`);
  assert.match(record.activityDetail || "", /read/);
  assert.ok(record.events.some((event) => event.type === "runtime_state"
    && event.session?.activityDetail?.includes("read")));

  child.stdout.write(`${JSON.stringify({ type: "compaction_start", reason: "threshold" })}\n`);
  assert.equal(manager.view(record).activity, "compacting");

  child.stdout.write(`${JSON.stringify({
    type: "compaction_end",
    reason: "threshold",
    aborted: false,
    willRetry: false,
  })}\n`);
  assert.equal(record.compacting, false);
});
