import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ContextStore } from "../src/context/context-store.js";

test("prompt overrides save and reset without changing the shipped default", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-prompts-"));
  const defaultPath = path.join(root, "SYSTEM.md");
  await fs.writeFile(defaultPath, "Default prompt\n");
  const store = new ContextStore({ root: path.join(root, "overrides"), templates: [{ id: "assistant", label: "Assistant", systemPrompt: defaultPath, skills: [], extensions: [] }], agent: () => null, chatNamingPath: defaultPath, subagentPath: defaultPath });

  assert.equal((await store.get("assistant")).content, "Default prompt\n");
  await store.save("assistant", { content: "Custom prompt\n" });
  assert.equal((await store.get("assistant")).content, "Custom prompt\n");
  assert.equal(await fs.readFile(defaultPath, "utf8"), "Default prompt\n");
  assert.equal((await store.reset("assistant")).modified, false);

  await fs.rm(root, { recursive: true, force: true });
});
