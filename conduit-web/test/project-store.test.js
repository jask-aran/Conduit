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
  assert.equal(linked.defaultTemplateId, null);
  assert.equal((await store.update(linked.id, { defaultTemplateId: "workspace" })).defaultTemplateId, "workspace");
  assert.equal((await store.update(linked.id, { defaultTemplateId: "host-pi" })).defaultTemplateId, "host-pi");
  assert.equal((await store.update(linked.id, { defaultTemplateId: null })).defaultTemplateId, null);
  assert.equal(linked.deletesFilesOnRemove, false);
  await fs.writeFile(path.join(external, ".conduit", "user-owned.txt"), "keep");
  await store.remove(linked.id);
  assert.equal(await fs.readFile(path.join(external, "README.md"), "utf8"), "hello");
  assert.equal(await fs.readFile(path.join(external, ".conduit", "user-owned.txt"), "utf8"), "keep");
  assert.equal(await store.get(linked.id), null);
  await assert.rejects(store.create({ mode: "linked", path: path.join(root, "nope") }), { code: "path_not_found" });
  await fs.rm(root, { recursive: true, force: true });
});

test("migrates implicit Workspace profile defaults to global inheritance", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-default-migration-"));
  const external = path.join(root, "external");
  const catalogFile = path.join(root, "data/conduit.json");
  await fs.mkdir(external);
  await fs.mkdir(path.dirname(catalogFile), { recursive: true });
  await fs.writeFile(catalogFile, `${JSON.stringify({
    version: 1,
    projects: [{
      id: "project_external",
      slug: "external",
      name: "External",
      kind: "workspace",
      origin: "linked",
      externalPath: external,
      defaultTemplateId: "workspace",
      createdAt: "2026-01-01T00:00:00.000Z",
    }],
  })}\n`);
  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile,
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
  });

  await store.initialize();

  assert.equal((await store.get("project_external")).defaultTemplateId, null);
  assert.equal(JSON.parse(await fs.readFile(catalogFile, "utf8")).version, 2);
  await fs.rm(root, { recursive: true, force: true });
});

test("linked workspace cannot alias an existing managed working root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-alias-"));
  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
  });
  await store.initialize();
  const managed = await store.create({ name: "Existing" });
  await assert.rejects(store.create({ mode: "linked", path: managed.path }), { code: "workspace_already_linked" });
  await fs.rm(root, { recursive: true, force: true });
});

test("linking rejects a pre-existing symlinked Conduit metadata root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-symlink-"));
  const external = path.join(root, "external");
  const outside = path.join(root, "outside");
  await fs.mkdir(external);
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(external, ".conduit"));
  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
  });
  await store.initialize();
  await assert.rejects(store.create({ mode: "linked", path: external }), { code: "unsafe_conduit_path" });
  await fs.rm(root, { recursive: true, force: true });
});

test("missing linked workspaces can be forgotten without touching a replacement path", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-forget-"));
  const external = path.join(root, "external");
  await fs.mkdir(external);
  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
  });
  await store.initialize();
  const linked = await store.create({ mode: "linked", path: external });
  await fs.rm(external, { recursive: true });
  await store.remove(linked.id, { skipWorkingTree: true });
  assert.equal(await store.get(linked.id), null);
  await fs.rm(root, { recursive: true, force: true });
});

test("managed create never reuses a linked workspace with the same slug", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-slug-"));
  const external = path.join(root, "api");
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, "secret.txt"), "external");
  const filesRoot = path.join(root, "data/chat/files");
  const store = new ProjectStore({
    filesRoot,
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
  });
  await store.initialize();
  const linked = await store.create({ mode: "linked", name: "api", path: external });
  assert.equal(linked.slug, "api");
  assert.equal(linked.path, external);

  const managed = await store.create({ mode: "managed", name: "api" });
  assert.equal(managed.origin, "managed");
  assert.notEqual(managed.id, linked.id);
  assert.equal(managed.slug, "api-2");
  assert.equal(managed.path, path.join(filesRoot, "api-2"));
  assert.equal(await fs.readFile(path.join(external, "secret.txt"), "utf8"), "external");
  assert.deepEqual(await fs.readdir(managed.path), []);

  const again = await store.create({ mode: "managed", name: "api" });
  assert.equal(again.slug, "api-3");
  assert.equal(again.origin, "managed");
  await fs.rm(root, { recursive: true, force: true });
});

async function initGitRepo(source) {
  await fs.mkdir(source, { recursive: true });
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
}

test("clones a repository into a user-selected non-owning workspace path", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-clone-"));
  const source = path.join(root, "source");
  await initGitRepo(source);

  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
  });
  await store.initialize();
  const target = path.join(root, "workspaces", "cloned-app");
  await fs.mkdir(path.dirname(target));
  const cloned = await store.create({ mode: "cloned", name: "Cloned App", cloneUrl: source, path: target });
  assert.equal(cloned.origin, "cloned");
  assert.equal(cloned.path, target);
  assert.equal(cloned.deletesFilesOnRemove, false);
  assert.equal(await fs.readFile(path.join(cloned.path, "app.js"), "utf8"), "console.log(1)\n");
  await store.remove(cloned.id);
  assert.equal(await fs.readFile(path.join(target, "app.js"), "utf8"), "console.log(1)\n");
  await fs.rm(root, { recursive: true, force: true });
});

test("concurrent clones with the same name get distinct slugs and keep both trees", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-clone-race-"));
  const source = path.join(root, "source");
  await initGitRepo(source);
  const filesRoot = path.join(root, "data/chat/files");
  const store = new ProjectStore({
    filesRoot,
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
  });
  await store.initialize();
  const firstTarget = path.join(root, "workspace-one");
  const secondTarget = path.join(root, "workspace-two");

  const [first, second] = await Promise.all([
    store.create({ mode: "cloned", name: "Race", cloneUrl: source, path: firstTarget }),
    store.create({ mode: "cloned", name: "Race", cloneUrl: source, path: secondTarget }),
  ]);
  assert.notEqual(first.slug, second.slug);
  assert.equal(await fs.readFile(path.join(first.path, "app.js"), "utf8"), "console.log(1)\n");
  assert.equal(await fs.readFile(path.join(second.path, "app.js"), "utf8"), "console.log(1)\n");
  const listed = await store.list();
  assert.equal(listed.filter((item) => item.origin === "cloned").length, 2);
  await fs.rm(root, { recursive: true, force: true });
});

test("clone requires an absolute user-selected target and rejects git protocol", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-clone-policy-"));
  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
  });
  await store.initialize();
  await assert.rejects(store.create({ mode: "cloned", cloneUrl: "https://github.com/org/repo.git" }), {
    code: "workspace_path_required",
  });
  await assert.rejects(store.create({ mode: "cloned", cloneUrl: "git://github.com/org/repo.git", path: path.join(root, "repo") }), {
    code: "clone_url_not_allowed",
  });
  await fs.rm(root, { recursive: true, force: true });
});
