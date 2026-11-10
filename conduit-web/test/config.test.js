import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";

const configEnv = (overrides = {}) => ({ ...overrides });

test("default durable paths use ~/.conduit/data and the default template is discoverable", () => {
  const config = loadConfig(configEnv());
  const templateFile = path.join(config.repositoryRoot, "templates", "assistant", "template.json");
  const declared = JSON.parse(fs.readFileSync(templateFile, "utf8"));
  assert.equal(config.piTemplate.templateFile, templateFile);
  assert.equal(config.piTemplate.id, declared.id);
  assert.equal(config.piTemplate.label, declared.label);
  assert.deepEqual(config.piTemplate.tools, declared.tools);
  assert.deepEqual(config.piTemplate.models, declared.models);
  assert.deepEqual(config.piTemplates.find((template) => template.id === declared.id), config.piTemplate);
  for (const id of ["assistant"]) {
    assert.ok(config.piTemplates.some((template) => template.id === id));
  }
  assert.deepEqual(config.piTemplateById.get("assistant"), config.piTemplates.find((template) => template.id === "assistant"));
  assert.ok(config.piTemplateById.get("assistant")?.skills?.length >= 1);
  assert.ok(config.workspaceAllowlist.length >= 1);
  assert.equal(config.dataRoot, path.join(os.homedir(), ".conduit", "data"));
  for (const key of [
    "filesRoot", "terminalPasteRoot", "catalogFile", "sessionRegistryFile", "sessionNameLogFile",
    "promptOverridesRoot", "preferencesFile", "draftsFile", "piAgentDir", "searchConfigFile",
    "voiceConfigFile", "voiceModelRoot", "voiceRecordingsRoot", "runtimeSettingsFile",
    "identityFile", "leafFile", "remotesFile", "authFile",
  ]) {
    const relative = path.relative(config.dataRoot, config[key]);
    assert.ok(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), key);
  }
  assert.equal(config.maxAttachmentBytes, 100 * 1024 * 1024);
  assert.equal(config.voiceFinalizationBaseMs, 30_000);
  assert.equal(config.voiceFinalizationMaxMs, 600_000);
  assert.equal(config.voiceFinalizationDefaultMultiplier, 12);
  assert.equal(config.workspaceDefaultRoot, os.homedir());
});

test("one data root relocates every durable Conduit path", () => {
  const dataRoot = path.resolve("/tmp/conduit-config-data");
  const config = loadConfig(configEnv({
    CONDUIT_DATA_ROOT: dataRoot,
    CONDUIT_RELEASE: "0123456789abcdef",
    CONDUIT_WORKSPACE_SUGGESTION_ROOT: "/tmp/workspace-suggestions",
  }));
  assert.equal(config.dataRoot, dataRoot);
  assert.equal(config.filesRoot, path.join(dataRoot, "chat", "files"));
  assert.equal(config.catalogFile, path.join(dataRoot, "conduit.json"));
  assert.equal(config.sessionRegistryFile, path.join(dataRoot, "sessions.json"));
  assert.equal(config.preferencesFile, path.join(dataRoot, "preferences.json"));
  assert.equal(config.runtimeSettingsFile, path.join(dataRoot, "runtime.json"));
  assert.equal(config.remotesFile, path.join(dataRoot, "remotes.json"));
  assert.equal(config.authFile, path.join(dataRoot, "auth.json"));
  assert.equal(config.piAgentDir, path.join(dataRoot, "pi"));
  assert.equal(config.searchConfigFile, path.join(dataRoot, "pi", "web-search.json"));
  assert.equal(config.voiceConfigFile, path.join(dataRoot, "voice.json"));
  assert.equal(config.voiceModelRoot, path.join(dataRoot, "voice", "models"));
  assert.equal(config.voiceRecordingsRoot, path.join(dataRoot, "voice", "recordings"));
  assert.equal(config.release, "0123456789abcdef");
  assert.equal(loadConfig(configEnv({ CONDUIT_MAX_ATTACHMENT_BYTES: "2048" })).maxAttachmentBytes, 2048);
  assert.equal(loadConfig(configEnv({
    CONDUIT_VOICE_FINALIZATION_BASE_MS: "45000",
    CONDUIT_VOICE_FINALIZATION_MAX_MS: "900000",
    CONDUIT_VOICE_FINALIZATION_DEFAULT_MULTIPLIER: "20",
  })).voiceFinalizationBaseMs, 45_000);
  assert.equal(loadConfig(configEnv({
    CONDUIT_VOICE_FINALIZATION_BASE_MS: "45000",
    CONDUIT_VOICE_FINALIZATION_MAX_MS: "900000",
    CONDUIT_VOICE_FINALIZATION_DEFAULT_MULTIPLIER: "20",
  })).voiceFinalizationMaxMs, 900_000);
  assert.equal(loadConfig(configEnv({
    CONDUIT_VOICE_FINALIZATION_BASE_MS: "45000",
    CONDUIT_VOICE_FINALIZATION_MAX_MS: "900000",
    CONDUIT_VOICE_FINALIZATION_DEFAULT_MULTIPLIER: "20",
  })).voiceFinalizationDefaultMultiplier, 20);
  assert.equal(config.workspaceSuggestionRoot, path.resolve("/tmp/workspace-suggestions"));
  assert.equal(config.workspaceDefaultRoot, path.resolve("/tmp/workspace-suggestions"));
  assert.equal(loadConfig(configEnv({
    CONDUIT_WORKSPACE_SUGGESTION_ROOT: "/tmp/workspace-suggestions",
    CONDUIT_WORKSPACE_DEFAULT_ROOT: "/tmp/workspace-default",
  })).workspaceDefaultRoot, path.resolve("/tmp/workspace-default"));
});
