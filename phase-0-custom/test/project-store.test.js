import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProjectStore } from "../src/project-store.js";

test("creates the default chat project and a PI WEB compatible registry", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-test-"));
  const filesRoot = path.join(root, "files");
  const piWebProjectsFile = path.join(root, "state/projects.json");
  const store = new ProjectStore({ filesRoot, piWebProjectsFile });
  await store.initialize();
  const chat = await store.get("chat");
  assert.equal(chat.name, "Chats");
  const settings = JSON.parse(await fs.readFile(path.join(chat.path, ".pi/settings.json"), "utf8"));
  assert.equal(settings.sessionDir, chat.sessionsDir);
  const project = await store.create({ name: "Conduit Core" });
  assert.equal(project.slug, "conduit-core");
  const registry = JSON.parse(await fs.readFile(piWebProjectsFile, "utf8"));
  assert.deepEqual(registry.projects.map((item) => item.path).sort(), [chat.path, project.path].sort());
  await fs.rm(root, { recursive: true, force: true });
});
