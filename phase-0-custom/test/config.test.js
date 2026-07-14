import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("default runtime paths are owned by the repository root", () => {
  const config = loadConfig({});
  assert.equal(config.piProfile.id, "chat");
  assert.equal(config.piProfile.version, "1");
  assert.deepEqual(config.piProfile.models, [
    "openai-codex/gpt-5.6-luna",
    "openai-codex/gpt-5.6-sol",
    "anthropic/claude-opus-4-8",
    "anthropic/claude-fable-5",
  ]);
  assert.equal(config.piProfile.profileFile.endsWith(path.join(".pi", "experiences", "chat", "profile.json")), true);
  assert.equal(config.piAgentDir, path.join(config.stateDir, "pi-agent"));
});
