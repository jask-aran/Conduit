import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";

const configEnv = (overrides = {}) => ({ ...overrides });

test("default durable paths use ~/.conduit/data", () => {
  const config = loadConfig(configEnv());
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
});
