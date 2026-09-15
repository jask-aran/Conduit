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
  const registry = new PiInstallationRegistry({ conduitAgentDir: path.join(root, "agent"), conduitCommand: override });
  const installation = registry.get("conduit-pinned");
  assert.equal(installation.source, "override");
  assert.equal(installation.label, "Conduit Pi override");
  assert.equal(installation.version, "9.9.9");
  const publicInstallation = registry.publicList().find((item) => item.id === "conduit-pinned");
  assert.equal(publicInstallation.executablePath, override);
  assert.equal(publicInstallation.agentHome.path, path.join(root, "agent"));
  assert.equal("environment" in publicInstallation, false);
  assert.equal("command" in publicInstallation, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("the installation registry exposes only Conduit's pinned Pi", () => {
  const registry = new PiInstallationRegistry({ conduitAgentDir: "/tmp/conduit-pi" });
  assert.deepEqual(registry.list().map((item) => item.id), ["conduit-pinned"]);
});
