import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { registerChatRoutes } from "../src/server/routes/chats.js";
import { loadModelProfiles } from "../src/model-profiles.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const profiles = loadModelProfiles(path.join(repositoryRoot, "templates", "model-profiles.json"));
const chatId = "c".repeat(24);
const runtime = { kind: "conduit_profile", installationId: "conduit-pinned" };
const template = { id: "chat", version: "7", runtimeOverlays: ["web-search"] };
const project = { id: "project_test", slug: "test", path: "/tmp/test" };

async function routeFixture({ busy = false } = {}) {
  const app = express();
  app.use(express.json());
  const context = {
    chat: { id: chatId, status: "active", templateId: "chat", runtime, modelThinkingLevels: {} },
    project,
  };
  let currentModel = "anthropic/test-model";
  let resident = { id: "resident-1", modelProfile: { id: "brave-search" } };
  const calls = [];
  const modelView = async () => ({
    models: [
      { spec: "anthropic/test-model", thinkingLevels: ["medium"] },
      { spec: "openai-codex/test-model", thinkingLevels: ["medium"] },
    ],
    model: currentModel,
    thinkingLevel: "medium",
    modelThinkingLevels: {},
  });
  registerChatRoutes(app, {
    catalogFor: () => ({ updateDefault: async () => {} }),
    chatModelView: modelView,
    config: { modelProfiles: profiles, piTemplates: [] },
    defaultTemplate: () => template,
    findChatContext: async () => context,
    launchLiveSession: async (options) => {
      calls.push({ type: "launch", options });
      currentModel = options.model;
      resident = { id: "resident-2", model: currentModel, modelProfile: { id: "openai-search" } };
      return resident;
    },
    lifecycle: { isBusy: () => false },
    manager: {
      getByChatId: () => resident,
      isBusy: () => busy,
      setModel: async (_id, spec) => {
        calls.push({ type: "set_model", spec });
        currentModel = spec;
      },
      stopAndWait: async (id) => {
        calls.push({ type: "stop", id });
        resident = null;
      },
      setThinkingLevel: async (id, level) => calls.push({ type: "set_thinking", id, level }),
    },
    modelCatalog: {},
    projects: {},
    registry: { update: async () => context.chat },
    runtimeFor: () => runtime,
    templateForChat: () => template,
  });
  app.use((error, _request, response, _next) => response.status(error.status || 500).json({ error: error.code, message: error.message }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    calls,
    async close() { await new Promise((resolve) => server.close(resolve)); },
    async patch() {
      return fetch(`http://127.0.0.1:${port}/v0/chats/${chatId}/models`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "openai-codex/test-model", thinkingLevel: "medium" }),
      });
    },
  };
}

test("idle cross-profile model changes replace the Pi process on the same chat", async () => {
  const fixture = await routeFixture();
  try {
    const response = await fixture.patch();
    assert.equal(response.status, 200);
    assert.deepEqual(fixture.calls.map((call) => call.type), ["set_model", "stop", "launch", "set_thinking"]);
    assert.equal((await response.json()).model, "openai-codex/test-model");
  } finally {
    await fixture.close();
  }
});

test("busy cross-profile model changes return the documented conflict", async () => {
  const fixture = await routeFixture({ busy: true });
  try {
    const response = await fixture.patch();
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: "model_profile_transition_busy",
      message: "Finish the current response before changing to a model with different runtime settings.",
    });
    assert.deepEqual(fixture.calls, []);
  } finally {
    await fixture.close();
  }
});
