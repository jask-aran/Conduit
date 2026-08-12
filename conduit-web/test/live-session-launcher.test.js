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
    assert.equal(result, live);
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
