import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createLiveSessionLauncher } from "../src/server/live-session-launcher.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("native adapter restores its saved model unless a prompt changes it", async () => {
  const chatId = "n".repeat(24);
  const project = { id: "project_native", slug: "native", workingRoot: "/tmp/native" };
  const chat = {
    id: chatId, status: "draft", modelThinkingLevels: {},
    backend: { protocol: "native_api", implementation: "chatgpt-web", opaqueSession: null, model: "saved-model" },
  };
  const calls = [];
  const updates = [];
  const live = { id: "live-native", sessionId: { conversationId: "", parentMessageId: "" } };
  const adapter = {
    create: async (options) => { calls.push(options); return live; },
    async launch(context, request) {
      const selectedModel = request.forceModel ? request.model : context.chat.backend.model;
      const selectedThinkingLevel = request.forceModel ? request.thinkingLevel : "";
      const started = await this.create({ model: selectedModel, thinkingLevel: selectedThinkingLevel });
      return { live: started, mapping: {
        backend: { ...context.chat.backend, model: selectedModel, opaqueSession: started.sessionId },
        ...(selectedThinkingLevel ? { modelThinkingLevels: { [selectedModel]: selectedThinkingLevel } } : {}),
      }, modelRecovery: null };
    },
  };
  const launcher = createLiveSessionLauncher({
    backends: {
      forChat: () => adapter,
      getByChatId: () => null,
      manifestFor: () => ({ profile: { id: "chatgpt-web" } }),
    },
    findChatContext: async () => ({ chat, project }),
    lifecycle: { assertAvailable: () => {}, runLaunch: (_id, work) => work(), withProjects: (_ids, work) => work() },
    registry: { update: async (id, mapping) => updates.push({ id, mapping }) },
  });

  await launcher({ chatId, model: "stale-transcript-model", thinkingLevel: "off" });

  assert.equal(calls[0].model, "saved-model");

  await launcher({ chatId, model: "gpt-5-6", thinkingLevel: "high", forceModel: true });

  assert.equal(calls[1].model, "gpt-5-6");
  assert.equal(calls[1].thinkingLevel, "high");
  assert.equal(updates[1].mapping.backend.model, "gpt-5-6");
  assert.deepEqual(updates[1].mapping.modelThinkingLevels, { "gpt-5-6": "high" });
});

test("live session launcher repairs an obsolete persisted thinking level", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-launcher-recovery-"));
  const agentDir = path.join(root, "pi");
  const workspace = path.join(root, "workspace");
  const sessionFile = path.join(root, "sessions", "chat.jsonl");
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(path.dirname(sessionFile), { recursive: true });
  await fs.writeFile(sessionFile, [
    { type: "session", id: "session-recovery", cwd: workspace },
    { type: "model_change", provider: "example", modelId: "reasoner" },
    { type: "thinking_level_change", thinkingLevel: "off" },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");

  const chatId = "r".repeat(24);
  const project = { id: "project_recovery", slug: "recovery", path: workspace, workingRoot: workspace };
  const chat = {
    id: chatId,
    status: "active",
    runtime: { kind: "conduit_profile", installationId: "conduit-pinned", profileId: "chat", profileVersion: "7" },
    backend: { implementation: "conduit_pi", opaqueSession: sessionFile },
    modelThinkingLevels: {},
  };
  const template = {
    id: "chat",
    version: "7",
    systemPrompt: path.join(root, "SYSTEM.md"),
    tools: ["read"],
    models: ["example/reasoner"],
    extensions: [],
    skills: [],
    promptTemplates: [],
  };
  const launchCalls = [];
  const registryUpdates = [];
  const live = { id: "live-recovery", status: "running", sessionFile, sessionId: "session-recovery" };
  const manager = {
    getByChatId: () => null,
    createWithCapacity: async (options) => { launchCalls.push(options); return live; },
    waitForSession: async () => {},
    stopAndWait: async () => {},
  };
  const launcher = createLiveSessionLauncher({
    catalogFor: () => ({
      list: async () => ({
        models: [{ spec: "example/reasoner", thinkingLevels: ["medium", "high", "max"] }],
        defaultModel: "example/reasoner",
        defaultThinkingLevel: "medium",
      }),
      getLaunchModels: () => [...template.models],
    }),
    config: {
      bridgeSystemPrompt: path.join(root, "bridge-system.md"),
      bridgeSkill: path.join(root, "bridge-skill.md"),
      installations: { get: () => ({ id: "conduit-pinned", available: true, command: "/opt/conduit/pi", commandArgs: [], agentDir, version: "0.84.1" }) },
    },
    findChatContext: async () => ({ chat, project }),
    lifecycle: { assertAvailable: () => {}, runLaunch: (_id, work) => work(), withProjects: (_ids, work) => work() },
    manager,
    nativePreflight: async () => ({ available: true }),
    registry: { update: async (id, mapping) => registryUpdates.push({ id, mapping }) },
    runtimeFor: () => chat.runtime,
    templateForChat: () => template,
  });

  try {
    await assert.doesNotReject(() => launcher({ chatId }));
    assert.equal(launchCalls[0].thinkingLevel, "medium");
    assert.deepEqual(registryUpdates[0].mapping.modelThinkingLevels, { "example/reasoner": "medium" });
    await assert.rejects(
      () => launcher({ chatId, model: "example/reasoner", thinkingLevel: "off", forceModel: true }),
      { code: "invalid_thinking_level" },
    );
    assert.equal(launchCalls.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("live session launcher recovers an out-of-scope persisted model", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-launcher-model-recovery-"));
  const agentDir = path.join(root, "pi");
  const workspace = path.join(root, "workspace");
  const sessionFile = path.join(root, "sessions", "chat.jsonl");
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(path.dirname(sessionFile), { recursive: true });
  await fs.writeFile(sessionFile, [
    { type: "session", id: "session-recovery", cwd: workspace },
    { type: "model_change", provider: "example", modelId: "retired" },
    { type: "thinking_level_change", thinkingLevel: "high" },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");

  const chatId = "m".repeat(24);
  const project = { id: "project_recovery", slug: "recovery", path: workspace, workingRoot: workspace };
  const chat = {
    id: chatId,
    status: "active",
    runtime: { kind: "conduit_profile", installationId: "conduit-pinned", profileId: "chat", profileVersion: "7" },
    backend: { implementation: "conduit_pi", opaqueSession: sessionFile },
    modelThinkingLevels: {},
  };
  const template = {
    id: "chat",
    version: "7",
    systemPrompt: path.join(root, "SYSTEM.md"),
    tools: ["read"],
    models: ["example/reasoner"],
    extensions: [],
    skills: [],
    promptTemplates: [],
  };
  const launchCalls = [];
  const modelChanges = [];
  const live = { id: "live-recovery", status: "running", sessionFile, sessionId: "session-recovery" };
  const launcher = createLiveSessionLauncher({
    catalogFor: () => ({
      list: async () => ({
        models: [{ spec: "example/reasoner", thinkingLevels: ["medium", "high"] }],
        defaultModel: "example/reasoner",
        defaultThinkingLevel: "medium",
      }),
      getLaunchModels: () => [...template.models],
    }),
    config: {
      bridgeSystemPrompt: path.join(root, "bridge-system.md"),
      bridgeSkill: path.join(root, "bridge-skill.md"),
      installations: { get: () => ({ id: "conduit-pinned", available: true, command: "/opt/conduit/pi", commandArgs: [], agentDir, version: "0.84.1" }) },
    },
    findChatContext: async () => ({ chat, project }),
    lifecycle: { assertAvailable: () => {}, runLaunch: (_id, work) => work(), withProjects: (_ids, work) => work() },
    manager: {
      getByChatId: () => null,
      createWithCapacity: async (options) => { launchCalls.push(options); return live; },
      waitForSession: async () => {},
      setModel: async (id, spec) => modelChanges.push({ id, spec }),
      stopAndWait: async () => {},
    },
    nativePreflight: async () => ({ available: true }),
    registry: { update: async () => {} },
    runtimeFor: () => chat.runtime,
    templateForChat: () => template,
  });

  try {
    const result = await launcher({ chatId });
    assert.equal(launchCalls[0].model, "example/reasoner");
    assert.equal(launchCalls[0].thinkingLevel, "high");
    assert.deepEqual(modelChanges, [{ id: live.id, spec: "example/reasoner" }]);
    assert.deepEqual(result.modelRecovery, {
      from: "example/retired",
      to: "example/reasoner",
      reason: "outside_scope",
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
