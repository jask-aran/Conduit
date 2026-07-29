import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProjectStore, runCommand, writeJsonAtomically } from "../src/project-store.js";
import { sessionDirectoryFor } from "../src/session-store.js";

async function waitForReady(store, id) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const project = await store.get(id);
    if (project?.state === "ready") return project;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Clone ${id} did not become ready`);
}

test("atomic catalogue replacement preserves the prior catalogue when serialization fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-atomic-catalogue-"));
  const catalogFile = path.join(root, "data", "conduit.json");
  const previous = { version: 2, projects: [{ id: "project_chat", slug: "chat" }] };
  await writeJsonAtomically(catalogFile, previous);

  await assert.rejects(writeJsonAtomically(catalogFile, { version: 2, invalid: BigInt(1) }), TypeError);

  assert.deepEqual(JSON.parse(await fs.readFile(catalogFile, "utf8")), previous);
  assert.deepEqual(await fs.readdir(path.dirname(catalogFile)), ["conduit.json"]);
  await fs.rm(root, { recursive: true, force: true });
});

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

test("destructive Workspace removal deletes a validated folder and can forget an orphan", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-destroy-workspace-"));
  const external = path.join(root, "external-repo");
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, "README.md"), "delete me");
  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
  });
  await store.initialize();
  const linked = await store.create({ mode: "linked", path: external });
  await store.remove(linked.id, { deleteWorkspaceFiles: true });
  await assert.rejects(fs.access(external), { code: "ENOENT" });
  assert.equal(await store.get(linked.id), null);

  const orphanPath = path.join(root, "orphan");
  await fs.mkdir(orphanPath);
  const orphan = await store.create({ mode: "linked", path: orphanPath });
  await fs.rm(orphanPath, { recursive: true });
  await store.remove(orphan.id, { skipWorkingTree: true, deleteWorkspaceFiles: true });
  assert.equal(await store.get(orphan.id), null);
  await fs.rm(root, { recursive: true, force: true });
});

test("creates an external Workspace and preserves its directory when unlinked", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-create-"));
  const parent = path.join(root, "workspaces");
  await fs.mkdir(parent);
  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
  });
  await store.initialize();
  const preview = await store.previewWorkspace({ mode: "created", path: parent, directoryName: "new-app" });
  assert.equal(preview.path, path.join(parent, "new-app"));
  const created = await store.create({ mode: "created", name: "New App", path: parent, directoryName: "new-app" });
  assert.equal(created.origin, "created");
  assert.equal(created.path, path.join(parent, "new-app"));
  assert.equal(created.deletesFilesOnRemove, false);
  await fs.writeFile(path.join(created.path, "README.md"), "keep");
  await store.remove(created.id);
  assert.equal(await fs.readFile(path.join(parent, "new-app", "README.md"), "utf8"), "keep");
  await assert.rejects(store.create({ mode: "created", path: parent, directoryName: "new-app" }), { code: "workspace_path_exists" });
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
  const started = await store.create({ mode: "cloned", name: "Cloned App", cloneUrl: source, path: target });
  const cloned = await waitForReady(store, started.project.id);
  assert.equal(cloned.origin, "cloned");
  assert.equal(cloned.path, target);
  assert.equal(cloned.deletesFilesOnRemove, false);
  assert.equal(await fs.readFile(path.join(cloned.path, "app.js"), "utf8"), "console.log(1)\n");
  await store.remove(cloned.id);
  assert.equal(await fs.readFile(path.join(target, "app.js"), "utf8"), "console.log(1)\n");
  await fs.rm(root, { recursive: true, force: true });
});

test("cloned workspaces reject a symlink replacement before use or unregister", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-clone-identity-"));
  const source = path.join(root, "source");
  const target = path.join(root, "workspaces", "cloned-app");
  const displaced = path.join(root, "displaced-clone");
  const outside = path.join(root, "outside");
  await initGitRepo(source);
  await fs.mkdir(path.dirname(target));
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "keep.txt"), "outside");
  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
  });
  await store.initialize();
  const started = await store.create({ mode: "cloned", name: "Cloned App", cloneUrl: source, path: target });
  const cloned = await waitForReady(store, started.project.id);
  await fs.rename(target, displaced);
  await fs.symlink(outside, target);

  await assert.rejects(store.validate(cloned), { code: "workspace_identity_changed" });
  await assert.rejects(store.remove(cloned.id), { code: "workspace_identity_changed" });
  assert.equal(await fs.readFile(path.join(outside, "keep.txt"), "utf8"), "outside");
  assert.ok(await store.get(cloned.id));
  await fs.rm(root, { recursive: true, force: true });
});

test("clones into a repository-named child of an allow-listed parent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-clone-parent-"));
  const source = path.join(root, "Hello-World");
  await initGitRepo(source);
  const destinationParent = path.join(root, "destinations");
  await fs.mkdir(destinationParent);
  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
  });
  await store.initialize();
  const started = await store.create({ mode: "cloned", cloneUrl: source, cloneParentPath: destinationParent });
  const cloned = await waitForReady(store, started.project.id);
  assert.equal(cloned.path, path.join(destinationParent, "Hello-World"));
  assert.equal(await fs.readFile(path.join(cloned.path, "app.js"), "utf8"), "console.log(1)\n");
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

  const [firstStarted, secondStarted] = await Promise.all([
    store.create({ mode: "cloned", name: "Race", cloneUrl: source, path: firstTarget }),
    store.create({ mode: "cloned", name: "Race", cloneUrl: source, path: secondTarget }),
  ]);
  const [first, second] = await Promise.all([waitForReady(store, firstStarted.project.id), waitForReady(store, secondStarted.project.id)]);
  assert.notEqual(first.slug, second.slug);
  assert.equal(await fs.readFile(path.join(first.path, "app.js"), "utf8"), "console.log(1)\n");
  assert.equal(await fs.readFile(path.join(second.path, "app.js"), "utf8"), "console.log(1)\n");
  const listed = await store.list();
  assert.equal(listed.filter((item) => item.origin === "cloned").length, 2);
  await fs.rm(root, { recursive: true, force: true });
});

test("a clone reservation does not block unrelated mutations and protects its slug and target", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-clone-reservation-"));
  const workspaceRoot = path.join(root, "workspaces");
  const source = path.join(root, "source");
  await fs.mkdir(workspaceRoot);
  await fs.mkdir(source);
  let started;
  let release;
  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
    runCommand: async (_command, args) => {
      const staging = args.at(-1);
      await fs.mkdir(staging);
      started();
      await new Promise((resolve) => { release = resolve; });
    },
  });
  await store.initialize();
  const ready = new Promise((resolve) => { started = resolve; });
  const target = path.join(workspaceRoot, "reserved");
  const cloning = await store.create({ mode: "cloned", name: "Reserved", cloneUrl: source, path: target });
  await ready;

  const managed = await store.create({ mode: "managed", name: "Reserved" });
  assert.equal(managed.slug, "reserved-2");
  await assert.rejects(store.create({ mode: "cloned", name: "Other", cloneUrl: source, path: target }), { code: "clone_target_reserved" });

  release();
  const cloned = await waitForReady(store, cloning.project.id);
  assert.equal(cloned.slug, "reserved");
  assert.ok(await fs.stat(cloned.path));
  await fs.rm(root, { recursive: true, force: true });
});

test("clone cancellation cleans Conduit staging and releases its reservation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-clone-abort-"));
  const workspaceRoot = path.join(root, "workspaces");
  const source = path.join(root, "source");
  await fs.mkdir(workspaceRoot);
  await fs.mkdir(source);
  let started;
  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
    runCommand: async (_command, args, { signal, onOutput }) => {
      await fs.mkdir(args.at(-1));
      onOutput({ stream: "stderr", chunk: "Receiving objects: 42%\r" });
      started();
      await new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { code: "clone_aborted" })), { once: true }));
    },
  });
  await store.initialize();
  const ready = new Promise((resolve) => { started = resolve; });
  const target = path.join(workspaceRoot, "cancelled");
  const cloning = await store.create({ mode: "cloned", name: "Cancelled", cloneUrl: source, path: target });
  await ready;
  assert.equal((await store.get(cloning.project.id))?.state, "cloning");
  assert.deepEqual(store.getCloneOperation(cloning.operation.id), {
    id: cloning.operation.id,
    projectId: cloning.project.id,
    state: "cloning",
    error: null,
    diagnostic: "Preparing clone…\nReceiving objects: 42%\r",
  });
  await assert.rejects(store.validate(cloning.project), { code: "workspace_cloning" });
  assert.deepEqual(await store.cancelCloneOperation(cloning.operation.id), { id: cloning.operation.id, state: "cancelled" });
  await assert.rejects(fs.access(target), { code: "ENOENT" });
  assert.deepEqual((await fs.readdir(workspaceRoot)).filter((name) => name.startsWith(".conduit-clone-")), []);
  assert.deepEqual(await store.list().then((items) => items.filter((item) => item.origin === "cloned")), []);
  await fs.rm(root, { recursive: true, force: true });
});

test("a published clone retains its durable recovery marker when catalogue publication fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-clone-published-marker-"));
  const workspaceRoot = path.join(root, "workspaces");
  const source = path.join(root, "source");
  await fs.mkdir(workspaceRoot);
  await fs.mkdir(source);
  const catalogFile = path.join(root, "data", "conduit.json");
  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile,
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
    runCommand: async (_command, args) => { await fs.mkdir(args.at(-1)); },
  });
  await store.initialize();
  const writeCatalog = store.writeCatalog;
  let writes = 0;
  store.writeCatalog = async (...args) => {
    writes += 1;
    if (writes > 1) throw new Error("simulated catalogue write failure");
    return writeCatalog(...args);
  };
  const target = path.join(workspaceRoot, "published");

  const started = await store.create({ mode: "cloned", name: "Published", cloneUrl: source, path: target });
  for (let attempt = 0; attempt < 100 && store.getCloneOperation(started.operation.id); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));

  assert.ok(await fs.stat(target));
  assert.equal((await store.get(started.project.id))?.state, "cloning");
  const markers = await fs.readdir(path.join(root, "data", "clone-reservations"));
  assert.equal(markers.length, 1);
  const marker = JSON.parse(await fs.readFile(path.join(root, "data", "clone-reservations", markers[0]), "utf8"));
  assert.equal(marker.phase, "published");
  assert.equal(marker.target, target);
  assert.equal(marker.project.externalPath, target);
  await fs.rm(root, { recursive: true, force: true });
});

test("startup registers a published clone from its recovery marker exactly once", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-clone-recover-"));
  const workspaceRoot = path.join(root, "workspaces");
  const target = path.join(workspaceRoot, "published");
  const id = crypto.randomUUID();
  const project = {
    id: "project_recovered",
    slug: "recovered",
    name: "Recovered",
    kind: "workspace",
    origin: "cloned",
    externalPath: target,
    cloneUrl: "https://github.com/example/recovered.git",
    defaultTemplateId: null,
    createdAt: "2026-07-26T00:00:00.000Z",
  };
  const markerRoot = path.join(root, "data", "clone-reservations");
  await fs.mkdir(target, { recursive: true });
  await fs.mkdir(markerRoot, { recursive: true });
  await fs.writeFile(path.join(markerRoot, `${id}.json`), `${JSON.stringify({
    version: 1,
    id,
    phase: "published",
    target,
    staging: path.join(workspaceRoot, `.conduit-clone-${id}.part`),
    project,
  })}\n`);

  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
  });
  await store.initialize();
  await store.initialize();

  assert.equal((await store.get(project.id))?.path, target);
  assert.deepEqual(await fs.readdir(markerRoot), []);
  assert.equal((await store.list()).filter((item) => item.id === project.id).length, 1);
  await fs.rm(root, { recursive: true, force: true });
});

test("startup clears a published clone marker after catalogue publication already succeeded", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-clone-catalogued-recover-"));
  const workspaceRoot = path.join(root, "workspaces");
  const target = path.join(workspaceRoot, "catalogued");
  const id = crypto.randomUUID();
  const project = {
    id: "project_catalogued",
    slug: "catalogued",
    name: "Catalogued",
    kind: "workspace",
    origin: "cloned",
    externalPath: target,
    cloneUrl: "https://github.com/example/catalogued.git",
    defaultTemplateId: null,
    createdAt: "2026-07-26T00:00:00.000Z",
  };
  const markerRoot = path.join(root, "data", "clone-reservations");
  await fs.mkdir(target, { recursive: true });
  await fs.mkdir(markerRoot, { recursive: true });
  await fs.writeFile(path.join(root, "data", "conduit.json"), `${JSON.stringify({ version: 2, projects: [project] })}\n`);
  await fs.writeFile(path.join(markerRoot, `${id}.json`), `${JSON.stringify({
    version: 1,
    id,
    phase: "published",
    target,
    staging: path.join(workspaceRoot, `.conduit-clone-${id}.part`),
    project,
  })}\n`);
  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
  });

  await store.initialize();

  assert.equal((await store.list()).filter((item) => item.id === project.id).length, 1);
  assert.deepEqual(await fs.readdir(markerRoot), []);
  assert.ok(await fs.stat(target));
  await fs.rm(root, { recursive: true, force: true });
});

test("startup discards only an unpublished clone's staging directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-clone-reserved-recover-"));
  const workspaceRoot = path.join(root, "workspaces");
  const target = path.join(workspaceRoot, "reserved");
  const id = crypto.randomUUID();
  const staging = path.join(workspaceRoot, `.conduit-clone-${id}.part`);
  const markerRoot = path.join(root, "data", "clone-reservations");
  await fs.mkdir(staging, { recursive: true });
  await fs.mkdir(markerRoot, { recursive: true });
  await fs.writeFile(path.join(markerRoot, `${id}.json`), `${JSON.stringify({
    version: 1,
    id,
    phase: "reserved",
    target,
    staging,
    project: {
      id: "project_reserved",
      slug: "reserved",
      name: "Reserved",
      kind: "workspace",
      origin: "cloned",
      externalPath: target,
      cloneUrl: "https://github.com/example/reserved.git",
      defaultTemplateId: null,
      createdAt: "2026-07-26T00:00:00.000Z",
    },
  })}\n`);
  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
  });

  await store.initialize();

  await assert.rejects(fs.access(staging), { code: "ENOENT" });
  await assert.rejects(fs.access(target), { code: "ENOENT" });
  assert.deepEqual(await fs.readdir(markerRoot), []);
  await fs.rm(root, { recursive: true, force: true });
});

test("startup retains an unsafe published target and its recovery marker", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-clone-unsafe-recover-"));
  const workspaceRoot = path.join(root, "workspaces");
  const outside = path.join(root, "outside");
  const target = path.join(workspaceRoot, "unsafe");
  const id = crypto.randomUUID();
  const markerRoot = path.join(root, "data", "clone-reservations");
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(outside);
  await fs.mkdir(markerRoot, { recursive: true });
  await fs.symlink(outside, target);
  await fs.writeFile(path.join(markerRoot, `${id}.json`), `${JSON.stringify({
    version: 1,
    id,
    phase: "published",
    target,
    staging: path.join(workspaceRoot, `.conduit-clone-${id}.part`),
    project: {
      id: "project_unsafe",
      slug: "unsafe",
      name: "Unsafe",
      kind: "workspace",
      origin: "cloned",
      externalPath: target,
      cloneUrl: "https://github.com/example/unsafe.git",
      defaultTemplateId: null,
      createdAt: "2026-07-26T00:00:00.000Z",
    },
  })}\n`);
  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
    logger: { error() {} },
  });

  await store.initialize();

  assert.equal((await fs.lstat(target)).isSymbolicLink(), true);
  assert.equal((await fs.readdir(markerRoot)).length, 1);
  assert.equal(await store.get("project_unsafe"), null);
  await fs.rm(root, { recursive: true, force: true });
});

test("startup retains an unreadable clone recovery marker without blocking the catalogue", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-clone-corrupt-recover-"));
  const markerRoot = path.join(root, "data", "clone-reservations");
  const marker = path.join(markerRoot, "corrupt.json");
  await fs.mkdir(markerRoot, { recursive: true });
  await fs.writeFile(marker, "not json\n");
  const store = new ProjectStore({
    filesRoot: path.join(root, "data/chat/files"),
    catalogFile: path.join(root, "data/conduit.json"),
    piAgentDir: path.join(root, "data/pi"),
    workspaceAllowlist: [root],
    logger: { error() {} },
  });

  await store.initialize();

  assert.equal((await store.get("chat"))?.name, "Chats");
  assert.equal(await fs.readFile(marker, "utf8"), "not json\n");
  await fs.rm(root, { recursive: true, force: true });
});

test("clone commands time out and retain only bounded diagnostics", async () => {
  await assert.rejects(runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 25 }), { code: "clone_timeout" });
  const result = await runCommand(process.execPath, ["-e", "process.stdout.write('x'.repeat(4096))"], { maxOutputBytes: 128 });
  assert.ok(Buffer.byteLength(result.stdout) <= 128);
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
