import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writePrivateJson } from "../src/private-file.js";
import { ProjectStore } from "../src/project-store.js";

test("atomic catalogue replacement preserves the prior catalogue when serialization fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-atomic-catalogue-"));
  const catalogFile = path.join(root, "data", "conduit.json");
  const previous = { version: 2, projects: [{ id: "project_chat", slug: "chat" }] };
  await writePrivateJson(catalogFile, previous);

  await assert.rejects(writePrivateJson(catalogFile, { version: 2, invalid: BigInt(1) }), TypeError);

  assert.deepEqual(JSON.parse(await fs.readFile(catalogFile, "utf8")), previous);
  assert.deepEqual(await fs.readdir(path.dirname(catalogFile)), ["conduit.json"]);
  await fs.rm(root, { recursive: true, force: true });
});

test("managed roots reject replacement symlinks and terminals may recreate only missing managed roots", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-project-managed-root-"));
  const filesRoot = path.join(root, "data/chat/files");
  const store = new ProjectStore({ filesRoot, catalogFile: path.join(root, "data/conduit.json"), piAgentDir: path.join(root, "data/pi") });
  await store.initialize();
  const project = await store.create({ name: "Managed" });
  const outside = path.join(root, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "keep.txt"), "outside");
  await fs.rename(project.workingRoot, path.join(root, "displaced"));
  await fs.symlink(outside, project.workingRoot);
  await assert.rejects(store.validate(project), { code: "workspace_identity_changed" });
  assert.equal(await fs.readFile(path.join(outside, "keep.txt"), "utf8"), "outside");
  await fs.unlink(project.workingRoot);

  const missing = await store.create({ name: "Missing terminal root" });
  await fs.rmdir(missing.workingRoot);
  await assert.rejects(store.validate(missing), { code: "workspace_identity_changed" });
  await store.validate(missing, { createManaged: true });
  const stat = await fs.lstat(missing.workingRoot);
  assert.equal(stat.isDirectory(), true);
  assert.equal(stat.isSymbolicLink(), false);
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
  for (let attempt = 0; attempt < 100 && store.getCloneOperation(started.operation.id)?.state === "cloning"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));

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
