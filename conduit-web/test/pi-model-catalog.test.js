import assert from "node:assert/strict";
import test from "node:test";
import { PiModelCatalog } from "../src/pi-model-catalog.js";

test("model catalog exposes Pi-native thinking levels and configured defaults", async () => {
  const models = [
    { provider: "example", id: "reasoner", name: "Reasoner", reasoning: true, thinkingLevelMap: { max: "max" } },
    { provider: "example", id: "plain", name: "Plain", reasoning: false },
  ];
  const settings = {
    getEnabledModels: () => undefined,
    getDefaultProvider: () => "example",
    getDefaultModel: () => "reasoner",
    getDefaultThinkingLevel: () => "max",
    drainErrors: () => [],
  };
  const modelRegistry = {
    refresh() {},
    getAvailable: () => models,
  };

  const catalog = new PiModelCatalog({ modelRegistry, modelPatterns: [], settingsFactory: () => settings });
  const result = await catalog.list("/tmp/project");

  assert.equal(result.defaultModel, "example/reasoner");
  assert.equal(result.defaultThinkingLevel, "max");
  assert.equal(result.requiresAuthentication, false);
  assert.deepEqual(result.models[0].thinkingLevels, ["off", "minimal", "low", "medium", "high", "max"]);
  assert.deepEqual(result.models[1].thinkingLevels, ["off"]);
});

test("empty isolated credentials report that authentication is required", async () => {
  const settings = {
    getEnabledModels: () => undefined,
    getDefaultProvider: () => undefined,
    getDefaultModel: () => undefined,
    getDefaultThinkingLevel: () => undefined,
    drainErrors: () => [],
  };
  const modelRegistry = { refresh() {}, getAvailable: () => [] };
  const catalog = new PiModelCatalog({ modelRegistry, settingsFactory: () => settings });

  const result = await catalog.list("/tmp/project");

  assert.equal(result.requiresAuthentication, true);
  assert.deepEqual(result.models, []);
});

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

test("model settings persist an explicitly selected default", async () => {
  const models = [
    { provider: "example", id: "reasoner", reasoning: true },
    { provider: "example", id: "plain", reasoning: false },
  ];
  let defaultProvider = "example";
  let defaultModel = "reasoner";
  const settings = {
    getEnabledModels: () => ["example/reasoner", "example/plain"],
    setEnabledModels() {},
    getDefaultProvider: () => defaultProvider,
    getDefaultModel: () => defaultModel,
    setDefaultModelAndProvider: (provider, model) => {
      defaultProvider = provider;
      defaultModel = model;
    },
    getDefaultThinkingLevel: () => "medium",
    flush: async () => {},
    drainErrors: () => [],
  };
  const catalog = new PiModelCatalog({
    modelRegistry: { refresh() {}, getAvailable: () => models },
    settingsFactory: () => settings,
  });

  const result = await catalog.updateSettings("/tmp/project", {
    enabledModels: ["example/reasoner", "example/plain"],
    defaultModel: "example/plain",
  });

  assert.equal(result.defaultModel, "example/plain");
});

test("model settings reject empty and unknown scopes", async () => {
  const settings = {
    getEnabledModels: () => undefined,
    getDefaultProvider: () => undefined,
    getDefaultModel: () => undefined,
    getDefaultThinkingLevel: () => undefined,
    drainErrors: () => [],
  };
  const modelRegistry = {
    refresh() {},
    getAvailable: () => [{ provider: "example", id: "plain", reasoning: false }],
  };
  const catalog = new PiModelCatalog({ modelRegistry, settingsFactory: () => settings });

  await assert.rejects(() => catalog.updateSettings("/tmp/project", { enabledModels: [] }), { code: "enabled_models_required" });
  await assert.rejects(() => catalog.updateSettings("/tmp/project", { enabledModels: ["example/missing"] }), { code: "invalid_enabled_model" });
  await assert.rejects(() => catalog.updateSettings("/tmp/project", {
    enabledModels: ["example/plain"],
    defaultModel: "example/missing",
  }), { code: "invalid_default_model" });
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

test("saved Pi scope replaces template fallback in the web catalog", async () => {
  const models = [
    { provider: "example", id: "template", name: "Template", reasoning: false },
    { provider: "example", id: "terminal", name: "Terminal", reasoning: false },
  ];
  const settings = {
    getEnabledModels: () => ["example/terminal"],
    getDefaultProvider: () => "example",
    getDefaultModel: () => "terminal",
    getDefaultThinkingLevel: () => "off",
    drainErrors: () => [],
  };
  const catalog = new PiModelCatalog({
    modelPatterns: ["example/template"],
    modelRegistry: { refresh() {}, getAvailable: () => models },
    settingsFactory: () => settings,
  });

  const result = await catalog.getSettings("/tmp/project");

  assert.deepEqual(result.enabledModels, ["example/terminal"]);
  assert.deepEqual(result.models.map((model) => model.spec), ["example/template", "example/terminal"]);
});
