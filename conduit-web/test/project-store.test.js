import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProjectStore } from "../src/project-store.js";
import { sessionDirectoryFor } from "../src/session-store.js";

test("stores project metadata centrally and keeps working directories clean", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-test-"));
  const filesRoot = path.join(root, "data/chat/files");
  const catalogFile = path.join(root, "data/conduit.json");
  const piAgentDir = path.join(root, "data/pi");
  const store = new ProjectStore({ filesRoot, catalogFile, piAgentDir });
  await store.initialize();

  const chat = await store.get("chat");
  assert.equal(chat.name, "Chats");
  assert.equal(chat.path, filesRoot);
  assert.equal(chat.sessionsDir, sessionDirectoryFor(filesRoot, piAgentDir));

  const project = await store.create({ name: "Conduit Core" });
  assert.equal(project.slug, "conduit-core");
  assert.equal(project.path, path.join(filesRoot, "conduit-core"));
  assert.deepEqual(await fs.readdir(project.path), []);

  const catalog = JSON.parse(await fs.readFile(catalogFile, "utf8"));
  assert.deepEqual(catalog.projects.map((item) => item.slug), ["chat", "conduit-core"]);
  await fs.rm(root, { recursive: true, force: true });
});

test("deletes named project files, native sessions, and catalog metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-delete-test-"));
  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
  });
  await store.initialize();
  const project = await store.create({ name: "Disposable" });
  await fs.writeFile(path.join(project.path, "work.txt"), "temporary");
  await fs.mkdir(project.sessionsDir, { recursive: true });
  const projectSession = path.join(project.sessionsDir, "session.jsonl");
  await fs.writeFile(projectSession, `${JSON.stringify({ type: "session", cwd: project.path })}\n`);
  const foreignSession = path.join(project.sessionsDir, "collision.jsonl");
  await fs.writeFile(foreignSession, `${JSON.stringify({ type: "session", cwd: path.join(root, "foreign") })}\n`);

  await store.remove(project.id);

  await assert.rejects(fs.access(project.path), { code: "ENOENT" });
  await assert.rejects(fs.access(projectSession), { code: "ENOENT" });
  assert.equal(await fs.readFile(foreignSession, "utf8"), `${JSON.stringify({ type: "session", cwd: path.join(root, "foreign") })}\n`);
  assert.equal(await store.get(project.id), null);
  await assert.rejects(store.remove("project_chat"), { code: "reserved_project" });
  await fs.rm(root, { recursive: true, force: true });
});
