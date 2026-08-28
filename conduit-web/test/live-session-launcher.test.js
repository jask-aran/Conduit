import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadModelProfiles } from "../src/model-profiles.js";
import { ModelProfileRuntime } from "../src/model-profile-runtime.js";
import { createLiveSessionLauncher } from "../src/server/live-session-launcher.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("live session launcher selects and materializes the model profile before Pi starts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-launcher-"));
  const agentDir = path.join(root, "pi");
  const searchConfigFile = path.join(agentDir, "web-search.json");
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(path.join(agentDir, "auth.json"), "{}\n", { mode: 0o600 });
  await fs.writeFile(searchConfigFile, JSON.stringify({ braveApiKey: "BSA-test-key", webSearch: { enabled: true } }), { mode: 0o600 });

  const chatId = "a".repeat(24);
  const project = { id: "project_test", slug: "test", path: path.join(root, "workspace") };
  const chat = {
    id: chatId,
    status: "draft",
    runtime: { kind: "conduit_profile", installationId: "conduit-pinned", profileId: "chat", profileVersion: "7" },
    piSessionFile: null,
  };
  const template = {
    id: "chat",
    version: "7",
    runtimeOverlays: ["web-search"],
    systemPrompt: path.join(root, "SYSTEM.md"),
    tools: ["read", "web_search"],
    models: ["openai-codex/test-model", "anthropic/test-model"],
    extensions: [],
    skills: [],
    promptTemplates: [],
  };
  const launchCalls = [];
  const registryUpdates = [];
  const live = {
    id: "b".repeat(24),
    status: "running",
    sessionFile: path.join(root, "sessions", "chat.jsonl"),
    sessionId: "session-test",
  };
  const manager = {
    getByChatId: () => null,
    createWithCapacity: async (options) => {
      launchCalls.push(options);
      return live;
    },
    waitForSession: async () => {},
    stopAndWait: async () => {},
  };
  const lifecycle = {
    assertAvailable: () => {},
    runLaunch: (_id, work) => work(),
    withProjects: (_ids, work) => work(),
  };
  const launcher = createLiveSessionLauncher({
    catalogFor: () => ({
      list: async () => ({
        models: [
          { spec: "openai-codex/test-model", thinkingLevels: ["medium"] },
          { spec: "anthropic/test-model", thinkingLevels: ["medium"] },
        ],
        defaultModel: "openai-codex/test-model",
        defaultThinkingLevel: "medium",
      }),
      getLaunchModels: () => [...template.models],
    }),
    config: {
      bridgeSystemPrompt: path.join(root, "bridge-system.md"),
      bridgeSkill: path.join(root, "bridge-skill.md"),
      modelProfiles: loadModelProfiles(path.join(repositoryRoot, "templates", "model-profiles.json")),
      installations: {
        get: () => ({
          id: "conduit-pinned",
          available: true,
          command: "/opt/conduit/pi",
          commandArgs: [],
          agentDir,
          version: "0.84.1",
        }),
      },
    },
    findChatContext: async () => ({ chat, project }),
    lifecycle,
    manager,
    modelProfileRuntime: new ModelProfileRuntime({ agentDir, searchConfigFile }),
    nativePreflight: async () => ({ available: true }),
    registry: {
      update: async (id, mapping) => registryUpdates.push({ id, mapping }),
    },
    runtimeFor: () => chat.runtime,
    templateForChat: () => template,
  });

  try {
    const result = await launcher({ chatId });
    assert.equal(result.live, live);
    assert.equal(result.modelRecovery, null);
    assert.equal(launchCalls.length, 1);
    assert.equal(launchCalls[0].model, "openai-codex/test-model");
    assert.equal(launchCalls[0].launchSpec.env.PI_CODING_AGENT_DIR, path.join(agentDir, "model-profiles", "openai-search"));
    assert.equal(launchCalls[0].launchSpec.modelProfile.id, "openai-search");
    assert.equal(registryUpdates[0].mapping.piSessionFile, live.sessionFile);
    const derived = JSON.parse(await fs.readFile(path.join(agentDir, "model-profiles", "openai-search", "web-search.json"), "utf8"));
    assert.deepEqual(derived.searchRouting.providers, ["openai", "brave"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
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
  const project = { id: "project_recovery", slug: "recovery", path: workspace };
  const chat = {
    id: chatId,
    status: "active",
    runtime: { kind: "conduit_profile", installationId: "conduit-pinned", profileId: "chat", profileVersion: "7" },
    piSessionFile: sessionFile,
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
      modelProfiles: {},
      installations: { get: () => ({ id: "conduit-pinned", available: true, command: "/opt/conduit/pi", commandArgs: [], agentDir, version: "0.84.1" }) },
    },
    findChatContext: async () => ({ chat, project }),
    lifecycle: { assertAvailable: () => {}, runLaunch: (_id, work) => work(), withProjects: (_ids, work) => work() },
    manager,
    modelProfileRuntime: { materialize: async () => ({ agentDir }) },
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
  const project = { id: "project_recovery", slug: "recovery", path: workspace };
  const chat = {
    id: chatId,
    status: "active",
    runtime: { kind: "conduit_profile", installationId: "conduit-pinned", profileId: "chat", profileVersion: "7" },
    piSessionFile: sessionFile,
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
      modelProfiles: {},
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
    modelProfileRuntime: { materialize: async () => ({ agentDir }) },
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
