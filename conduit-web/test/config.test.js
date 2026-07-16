import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("default runtime paths are owned by the repository root", () => {
  const config = loadConfig({});
  assert.equal(config.piTemplate.id, "chat");
  assert.equal(config.piTemplate.version, "1");
  assert.deepEqual(config.piTemplate.models, [
    "openai-codex/gpt-5.6-luna",
    "openai-codex/gpt-5.6-sol",
    "anthropic/claude-opus-4-8",
    "anthropic/claude-fable-5",
  ]);
  assert.equal(config.piTemplate.templateFile.endsWith(path.join("templates", "chat", "template.json")), true);
  assert.equal(config.filesRoot.endsWith(path.join("data", "chat", "files")), true);
  assert.equal(config.catalogFile.endsWith(path.join("data", "conduit.json")), true);
  assert.equal(config.sessionRegistryFile.endsWith(path.join("data", "sessions.json")), true);
  assert.equal(config.piAgentDir.endsWith(path.join("data", "pi")), true);
  assert.equal(config.enablePartialContinue, true);
  assert.equal(loadConfig({ ENABLE_PARTIAL_CONTINUE: "false" }).enablePartialContinue, false);
});
