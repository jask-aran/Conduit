import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PiInstallationRegistry } from "../src/pi-installations.js";

function executable(root, name, source) {
  const file = path.join(root, name);
  fs.writeFileSync(file, `#!/bin/sh\n${source}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

test("explicit Conduit overrides report their actual version", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "conduit-installation-"));
  const override = executable(root, "override-pi", 'if [ "$1" = "--version" ]; then echo 9.9.9; exit 0; fi\nif [ "$1" = "--help" ]; then echo "--mode --session --append-system-prompt --skill --approve --no-approve"; exit 0; fi');
  const registry = new PiInstallationRegistry({ conduitAgentDir: path.join(root, "agent"), conduitCommand: override, nativeCommand: override });
  const installation = registry.get("conduit-pinned");
  assert.equal(installation.source, "override");
  assert.equal(installation.label, "Isolated Pi override");
  assert.equal(installation.version, "9.9.9");
  fs.rmSync(root, { recursive: true, force: true });
});

test("host Pi requires the RPC flags used by Native Workspace launches", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "conduit-native-compat-"));
  const incompatible = executable(root, "old-pi", 'if [ "$1" = "--version" ]; then echo 0.1.0; exit 0; fi\nif [ "$1" = "--help" ]; then echo "--mode --session"; exit 0; fi');
  const registry = new PiInstallationRegistry({
    conduitAgentDir: path.join(root, "agent"),
    nativeCommand: incompatible,
    nativeAgentDir: path.join(root, "native-agent"),
  });
  const installation = registry.get("host-pi");
  assert.equal(installation.version, "0.1.0");
  assert.equal(installation.compatible, false);
  assert.equal(installation.available, false);
  assert.match(installation.error, /required RPC capabilities/);
  fs.rmSync(root, { recursive: true, force: true });
});
