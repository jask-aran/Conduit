import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PromptStore } from "../src/prompt-store.js";

test("prompt overrides save and reset without changing the shipped default", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-prompts-"));
  const defaultPath = path.join(root, "SYSTEM.md");
  await fs.writeFile(defaultPath, "Default prompt\n");
  const store = new PromptStore({ root: path.join(root, "overrides"), prompts: [{ id: "assistant", label: "Assistant", kind: "profile", defaultPath }] });

  assert.deepEqual(await store.read("assistant"), { id: "assistant", label: "Assistant", kind: "profile", content: "Default prompt\n", modified: false });
  await store.save("assistant", "Custom prompt\n");
  assert.equal((await store.read("assistant")).content, "Custom prompt\n");
  assert.equal(await fs.readFile(defaultPath, "utf8"), "Default prompt\n");
  assert.equal((await store.reset("assistant")).modified, false);

  await fs.rm(root, { recursive: true, force: true });
});
