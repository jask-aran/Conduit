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
