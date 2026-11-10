import assert from "node:assert/strict";
import test from "node:test";
import { PiModelCatalog } from "../src/pi-model-catalog.js";

test("model catalog reloads isolated credentials before refreshing models", async () => {
  const calls = [];
  const authStorage = { reload: () => calls.push("auth") };
  const modelRegistry = { refresh: () => calls.push("models"), getAvailable: () => [] };
  const settings = {
    getEnabledModels: () => undefined,
    getDefaultProvider: () => undefined,
    getDefaultModel: () => undefined,
    getDefaultThinkingLevel: () => undefined,
    drainErrors: () => [],
  };
  const catalog = new PiModelCatalog({ authStorage, modelRegistry, settingsFactory: () => settings });

  await catalog.list("/tmp/project");

  assert.deepEqual(calls, ["auth", "models"]);
});

test("model settings persist an allowed scope and replace a disabled default", async () => {
  const models = [
    { provider: "example", id: "reasoner", name: "Reasoner", reasoning: true },
    { provider: "example", id: "plain", name: "Plain", reasoning: false },
  ];
  const calls = [];
  let enabledModels;
  let defaultProvider = "example";
  let defaultModel = "reasoner";
  const settings = {
    getEnabledModels: () => enabledModels,
    setEnabledModels: (value) => { enabledModels = value; calls.push(["enabled", value]); },
    getDefaultProvider: () => defaultProvider,
    getDefaultModel: () => defaultModel,
    setDefaultModelAndProvider: (provider, model) => {
      defaultProvider = provider;
      defaultModel = model;
      calls.push(["default", provider, model]);
    },
    getDefaultThinkingLevel: () => "medium",
    flush: async () => calls.push(["flush"]),
    drainErrors: () => [],
  };
  const modelRegistry = { refresh() {}, getAvailable: () => models };
  const catalog = new PiModelCatalog({ modelRegistry, settingsFactory: () => settings });

  const result = await catalog.updateSettings("/tmp/project", { enabledModels: ["example/plain"] });

  assert.deepEqual(result.enabledModels, ["example/plain"]);
  assert.deepEqual(calls, [
    ["enabled", ["example/plain"]],
    ["default", "example", "plain"],
    ["flush"],
  ]);
});

test("Pi launches with the persisted scope even outside template fallback models", () => {
  const settings = { getEnabledModels: () => ["example/plain", "other/model"] };
  const catalog = new PiModelCatalog({
    modelPatterns: ["example/reasoner", "example/plain"],
    modelRegistry: { refresh() {}, getAvailable: () => [] },
    settingsFactory: () => settings,
  });

  assert.deepEqual(catalog.getLaunchModels("/tmp/project"), ["example/plain", "other/model"]);
});

