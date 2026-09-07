import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

test("the public component workbench reports registry status", async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-component-workbench-"));
  try {
    const result = spawnSync(
      path.join(root, ".devcontainer", "solid-components.sh"),
      ["status"],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, CONDUIT_STATE_DIR: stateRoot },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^solid-components mode: registry$/m);
    assert.match(result.stdout, /^version: \d+\.\d+\.\d+$/m);
  } finally {
    await fs.rm(stateRoot, { recursive: true, force: true });
  }
});
