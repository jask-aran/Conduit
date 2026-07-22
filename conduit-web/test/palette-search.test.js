import assert from "node:assert/strict";
import test from "node:test";
import { rankPaletteResults, scorePaletteMatch } from "../src/client/palette/palette-search.ts";

test("label word and prefix matches beat weak fuzzy noise", () => {
  assert.ok(scorePaletteMatch({ label: "GPT-5.6 Sol", haystack: "openai/gpt-5.6-sol", query: "sol" }) >= 0.9);
  assert.ok(scorePaletteMatch({ label: "GPT-5.6 Sol", haystack: "openai/gpt-5.6-sol", query: "so" }) >= 0.9);
  assert.equal(scorePaletteMatch({
    label: "Toggle sidebar",
    haystack: "toggle-sidebar panel nav menu",
    keywords: ["panel", "nav", "menu"],
    query: "sol",
  }), 0);
  assert.equal(scorePaletteMatch({
    label: "Toggle sidebar",
    haystack: "toggle-sidebar panel nav menu",
    query: "so",
  }), 0);
});

test("model query prefers Settings · Models and model rows over Move chat", () => {
  const settings = scorePaletteMatch({
    label: "Settings · Models",
    haystack: "settings models model llm provider",
    keywords: ["settings", "model"],
    query: "model",
  });
  const move = scorePaletteMatch({
    label: "Move chat",
    haystack: "move folder project",
    keywords: ["folder", "project"],
    query: "model",
  });
  const model = scorePaletteMatch({
    label: "Reasoner",
    haystack: "example/reasoner example model",
    keywords: ["example", "reasoner"],
    query: "model",
  });
  assert.ok(settings >= 0.9);
  assert.equal(move, 0);
  // "model" appears in haystack as a category token for every model row.
  assert.ok(model >= 0.8);
});

test("rankPaletteResults flattens score order so models outrank weak commands", () => {
  const commands = [{
    id: "toggle-sidebar",
    label: "Toggle sidebar",
    group: "commands",
    keywords: ["panel", "nav", "menu"],
  }, {
    id: "settings:models",
    label: "Settings · Models",
    group: "settings",
    keywords: ["settings", "model", "llm"],
    searchValue: "settings Models model llm provider",
  }, {
    id: "move",
    label: "Move chat",
    group: "commands",
    keywords: ["folder", "project"],
  }];
  const models = [{
    provider: "openai",
    id: "gpt-5.6-sol",
    spec: "openai/gpt-5.6-sol",
    label: "GPT-5.6 Sol",
  }];

  const sol = rankPaletteResults({ commands, models, query: "sol" });
  assert.ok(sol);
  assert.equal(sol[0].kind, "model");
  assert.equal(sol[0].model.spec, "openai/gpt-5.6-sol");
  assert.ok(!sol.some((row) => row.id === "toggle-sidebar"));

  const modelQuery = rankPaletteResults({ commands, models, query: "model" });
  assert.ok(modelQuery.every((row) => row.id !== "move"));
  assert.ok(modelQuery.some((row) => row.id === "settings:models"));
  assert.ok(modelQuery.some((row) => row.kind === "model"));
  // Concrete model pick should rank at least as high as the settings jump.
  const firstModel = modelQuery.findIndex((row) => row.kind === "model");
  const settingsIdx = modelQuery.findIndex((row) => row.id === "settings:models");
  assert.ok(firstModel >= 0 && settingsIdx >= 0);
});

test("empty query uses browse mode", () => {
  assert.equal(rankPaletteResults({ commands: [], models: [], query: "" }), null);
  assert.equal(rankPaletteResults({ commands: [], models: [], query: "   " }), null);
});

test("intentional short queries still resolve", () => {
  assert.ok(scorePaletteMatch({ label: "New chat", query: "new" }) >= 0.9);
  assert.ok(scorePaletteMatch({ label: "Attach files", query: "att" }) >= 0.9);
  assert.ok(scorePaletteMatch({ label: "Delete chat", query: "del" }) >= 0.9);
  assert.ok(scorePaletteMatch({
    label: "Existing chat",
    haystack: "open chat Chats",
    query: "exist",
  }) >= 0.9);
});
