import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ChatStore, chatDirectory } from "../src/chat-store.js";
import { sessionDirectoryFor } from "../src/session-store.js";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-chat-store-"));
  const projectPath = path.join(root, "files");
  const sessionsDir = sessionDirectoryFor(projectPath, path.join(root, "pi"));
  const project = { id: "project_test", slug: "test", path: projectPath, sessionsDir };
  await fs.mkdir(sessionsDir, { recursive: true });
  return { root, project, registryFile: path.join(root, "sessions.json") };
}

test("migrates Pi sessions behind stable Conduit chat metadata", async () => {
  const { root, project, registryFile } = await fixture();
  const sessionFile = path.join(project.sessionsDir, "session.jsonl");
  await fs.writeFile(sessionFile, [
    JSON.stringify({ type: "session", id: "session-test", cwd: project.path, timestamp: "2026-01-01T00:00:00Z" }),
    JSON.stringify({ type: "message", message: { role: "user", content: "Registry title" } }),
  ].join("\n"));
  await fs.writeFile(registryFile, `${JSON.stringify({ version: 1, sessions: [{
    id: "session-test", projectId: project.id, status: "persisted", title: "Registry title",
    file: sessionFile, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  }] })}\n`);

  const store = new ChatStore(registryFile);
  await store.initialize([project]);
  assert.equal(store.listProject(project.id)[0].id, "session-test");
  assert.equal(store.metadata("session-test").piSessionFile, sessionFile);
  assert.equal((await store.find([project], "session-test")).file, sessionFile);
  assert.equal((await fs.readFile(registryFile, "utf8")).includes('"entries"'), false);
  await fs.access(path.join(chatDirectory(project, "session-test"), "attachments"));
  await fs.rm(root, { recursive: true, force: true });
});

test("discovers sessions by canonical cwd when Pi directory encodings collide", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-chat-collision-"));
  const piAgentDir = path.join(root, "pi");
  const firstPath = path.join(root, "a-b/c");
  const secondPath = path.join(root, "a/b-c");
  const sessionsDir = sessionDirectoryFor(firstPath, piAgentDir);
  assert.equal(sessionsDir, sessionDirectoryFor(secondPath, piAgentDir));
  const projects = [
    { id: "project_first", slug: "first", path: firstPath, sessionsDir },
    { id: "project_second", slug: "second", path: secondPath, sessionsDir },
  ];
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(path.join(sessionsDir, "first.jsonl"), `${JSON.stringify({ type: "session", id: "session-first", cwd: firstPath })}\n`);
  await fs.writeFile(path.join(sessionsDir, "second.jsonl"), `${JSON.stringify({ type: "session", id: "session-second", cwd: secondPath })}\n`);

  const store = new ChatStore(path.join(root, "sessions.json"));
  await store.initialize(projects);
  assert.deepEqual(store.listProject("project_first").map((chat) => chat.id), ["session-first"]);
  assert.deepEqual(store.listProject("project_second").map((chat) => chat.id), ["session-second"]);
  await fs.rm(root, { recursive: true, force: true });
});

test("creates invisible drafts before Pi and reveals them after a completed attachment", async () => {
  const { root, project, registryFile } = await fixture();
  const store = new ChatStore(registryFile);
  await store.initialize([project]);
  const chat = await store.create(project);
  assert.equal(chat.status, "draft");
  assert.equal(chat.piSessionId, null);
  assert.deepEqual(store.listProject(project.id), []);

  const attachment = path.join(chatDirectory(project, chat.id), "attachments", `${crypto.randomUUID()}--note.txt`);
  await fs.writeFile(attachment, "hello");
  store.markAttachments(chat.id, true);
  assert.equal(store.listProject(project.id)[0].id, chat.id);

  const restored = new ChatStore(registryFile);
  await restored.initialize([project]);
  assert.equal(restored.listProject(project.id)[0].id, chat.id);
  await fs.rm(root, { recursive: true, force: true });
});

test("keeps a pre-prompt Pi mapping as a draft across startup", async () => {
  const { root, project, registryFile } = await fixture();
  const piSessionFile = path.join(project.sessionsDir, "draft.jsonl");
  await fs.writeFile(piSessionFile, `${JSON.stringify({ type: "session", id: "native-draft", cwd: project.path })}\n`);
  const id = "550e8400-e29b-41d4-a716-446655440090";
  await fs.writeFile(registryFile, `${JSON.stringify({ version: 2, chats: [{
    id, projectId: project.id, status: "draft", title: "New chat",
    piSessionId: "native-draft", piSessionFile,
    createdAt: "2026-07-16T00:00:00Z", updatedAt: "2026-07-16T00:00:00Z",
  }] })}\n`);

  const store = new ChatStore(registryFile);
  await store.initialize([project]);
  assert.equal(store.metadata(id).status, "draft");
  assert.equal(store.metadata(id).piSessionFile, piSessionFile);
  assert.deepEqual(store.listProject(project.id), []);
  await fs.rm(root, { recursive: true, force: true });
});

test("startup removes stale empty drafts and orphan partial files only", async () => {
  const { root, project, registryFile } = await fixture();
  const old = "550e8400-e29b-41d4-a716-446655440000";
  const kept = "550e8400-e29b-41d4-a716-446655440001";
  const stalePiFile = path.join(project.sessionsDir, "stale-draft.jsonl");
  const rows = [old, kept].map((id) => ({
    id, projectId: project.id, status: "draft", title: "New chat", piSessionId: null, piSessionFile: null,
    createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z",
  }));
  rows[0].piSessionId = "stale-native";
  rows[0].piSessionFile = stalePiFile;
  await fs.writeFile(stalePiFile, `${JSON.stringify({ type: "session", id: "stale-native", cwd: project.path })}\n`);
  await fs.writeFile(registryFile, `${JSON.stringify({ version: 2, chats: rows })}\n`);
  for (const id of [old, kept]) {
    await fs.mkdir(path.join(chatDirectory(project, id), "attachments"), { recursive: true });
    await fs.mkdir(path.join(chatDirectory(project, id), ".partial"), { recursive: true });
    await fs.writeFile(path.join(chatDirectory(project, id), ".partial", "orphan.part"), "partial");
  }
  await fs.writeFile(path.join(chatDirectory(project, kept), "attachments", `${crypto.randomUUID()}--keep.txt`), "keep");

  const store = new ChatStore(registryFile, { now: () => Date.parse("2026-07-16T00:00:00Z") });
  await store.initialize([project]);
  assert.equal(store.metadata(old), null);
  await assert.rejects(fs.access(stalePiFile), { code: "ENOENT" });
  assert.ok(store.metadata(kept));
  await assert.rejects(fs.access(path.join(chatDirectory(project, kept), ".partial", "orphan.part")), { code: "ENOENT" });
  await fs.access(path.join(chatDirectory(project, kept), "attachments"));
  await fs.rm(root, { recursive: true, force: true });
});
