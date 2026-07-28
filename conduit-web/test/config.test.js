import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("default runtime paths are owned by the repository root", () => {
  const config = loadConfig({});
  assert.equal(config.piTemplate.id, "chat");
  assert.equal(config.piTemplate.version, "3");
  assert.equal(config.piTemplate.label, "General");
  assert.deepEqual(config.piTemplate.tools, ["read", "bash"]);
  assert.deepEqual(config.piTemplate.models, [
    "openai-codex/gpt-5.6-luna",
    "openai-codex/gpt-5.6-sol",
    "anthropic/claude-opus-4-8",
    "anthropic/claude-fable-5",
  ]);
  assert.equal(config.piTemplate.templateFile.endsWith(path.join("templates", "chat", "template.json")), true);
  assert.ok(config.piTemplates.some((template) => template.id === "chat"));
  assert.ok(config.piTemplates.some((template) => template.id === "workspace"));
  assert.ok(config.piTemplates.some((template) => template.id === "runtime"));
  assert.equal(config.piTemplateById.get("workspace")?.label, "Coding");
  assert.ok(config.piTemplateById.get("workspace")?.skills?.length >= 1);
  assert.ok(config.workspaceAllowlist.length >= 1);
  assert.equal(config.dataRoot.endsWith("data"), true);
  assert.equal(config.filesRoot.endsWith(path.join("data", "chat", "files")), true);
  assert.equal(config.catalogFile.endsWith(path.join("data", "conduit.json")), true);
  assert.equal(config.sessionRegistryFile.endsWith(path.join("data", "sessions.json")), true);
  assert.equal(config.preferencesFile.endsWith(path.join("data", "preferences.json")), true);
  assert.equal(config.remotesFile.endsWith(path.join("data", "remotes.json")), true);
  assert.equal(config.piAgentDir.endsWith(path.join("data", "pi")), true);
  assert.equal(config.installations.get("conduit-pinned").version, "0.80.6");
  assert.equal(path.isAbsolute(config.installations.get("conduit-pinned").command), true);
  assert.equal(config.enablePartialContinue, true);
  assert.equal(loadConfig({ ENABLE_PARTIAL_CONTINUE: "false" }).enablePartialContinue, false);
});

test("one data root relocates every durable Conduit path", () => {
  const dataRoot = path.resolve("/tmp/conduit-config-data");
  const config = loadConfig({
    CONDUIT_DATA_ROOT: dataRoot,
    CONDUIT_RELEASE: "0123456789abcdef",
    CONDUIT_WORKSPACE_SUGGESTION_ROOT: "/tmp/workspace-suggestions",
  });
  assert.equal(config.dataRoot, dataRoot);
  assert.equal(config.filesRoot, path.join(dataRoot, "chat", "files"));
  assert.equal(config.catalogFile, path.join(dataRoot, "conduit.json"));
  assert.equal(config.sessionRegistryFile, path.join(dataRoot, "sessions.json"));
  assert.equal(config.preferencesFile, path.join(dataRoot, "preferences.json"));
  assert.equal(config.runtimeSettingsFile, path.join(dataRoot, "runtime.json"));
  assert.equal(config.authFile, path.join(dataRoot, "auth.json"));
  assert.equal(config.piAgentDir, path.join(dataRoot, "pi"));
  assert.equal(config.release, "0123456789abcdef");
  assert.equal(config.workspaceSuggestionRoot, path.resolve("/tmp/workspace-suggestions"));
});
