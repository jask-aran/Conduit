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

  const renamed = await store.rename(project.id, "Conduit Platform");
  assert.equal(renamed.name, "Conduit Platform");
  assert.equal(renamed.slug, "conduit-core");
  assert.equal(renamed.path, project.path);

  const catalog = JSON.parse(await fs.readFile(catalogFile, "utf8"));
  assert.deepEqual(catalog.projects.map((item) => item.slug), ["chat", "conduit-core"]);
  assert.equal(catalog.projects[1].name, "Conduit Platform");
  await assert.rejects(store.rename("project_chat", "Inbox"), { code: "reserved_project" });
  await fs.rm(root, { recursive: true, force: true });
});

test("deletes named project files and catalog metadata without touching colliding session storage", async () => {
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
  assert.match(await fs.readFile(projectSession, "utf8"), /\"type\":\"session\"/);
  assert.equal(await fs.readFile(foreignSession, "utf8"), `${JSON.stringify({ type: "session", cwd: path.join(root, "foreign") })}\n`);
  assert.equal(await store.get(project.id), null);
  await assert.rejects(store.remove("project_chat"), { code: "reserved_project" });
  await fs.rm(root, { recursive: true, force: true });
});

test("links allow-listed directories without deleting them on unregister", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-link-"));
  const external = path.join(root, "external-repo");
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, "README.md"), "hello");
  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
  });
  await store.initialize();
  const linked = await store.create({ mode: "linked", name: "External", path: external });
  assert.equal(linked.origin, "linked");
  assert.equal(linked.path, external);
  assert.equal(linked.defaultTemplateId, "workspace");
  assert.equal(linked.deletesFilesOnRemove, false);
  await store.remove(linked.id);
  assert.equal(await fs.readFile(path.join(external, "README.md"), "utf8"), "hello");
  assert.equal(await store.get(linked.id), null);
  await assert.rejects(store.create({ mode: "linked", path: path.join(root, "nope") }), { code: "path_not_found" });
  await fs.rm(root, { recursive: true, force: true });
});

test("clones a repository into the managed files root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-clone-"));
  const source = path.join(root, "source");
  await fs.mkdir(source);
  const { spawnSync } = await import("node:child_process");
  const git = (args, cwd = source) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  git(["init"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  await fs.writeFile(path.join(source, "app.js"), "console.log(1)\n");
  git(["add", "."]);
  git(["commit", "-m", "init"]);

  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
  });
  await store.initialize();
  const cloned = await store.create({ mode: "cloned", name: "Cloned App", cloneUrl: source });
  assert.equal(cloned.origin, "cloned");
  assert.equal(cloned.path, path.join(root, "data/chat/files", "cloned-app"));
  assert.equal(await fs.readFile(path.join(cloned.path, "app.js"), "utf8"), "console.log(1)\n");
  await fs.rm(root, { recursive: true, force: true });
});
