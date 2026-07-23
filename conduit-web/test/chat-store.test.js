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
  assert.equal(store.metadata("session-test").runtime.kind, "conduit_profile");
  assert.equal(store.metadata("session-test").runtime.installationId, "conduit-pinned");
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

test("stored session mappings fail closed when the JSONL cwd belongs to another workspace", async () => {
  const { root, project, registryFile } = await fixture();
  const sessionFile = path.join(project.sessionsDir, "foreign.jsonl");
  await fs.writeFile(sessionFile, `${JSON.stringify({ type: "session", id: "foreign-session", cwd: path.join(root, "elsewhere") })}\n`);
  await fs.writeFile(registryFile, `${JSON.stringify({ version: 2, chats: [{
    id: "chat-foreign", projectId: project.id, status: "active", title: "Foreign",
    piSessionId: "foreign-session", piSessionFile: sessionFile,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }] })}\n`);
  const store = new ChatStore(registryFile);
  await store.initialize([project]);
  assert.equal(store.metadata("chat-foreign"), null);
  await fs.rm(root, { recursive: true, force: true });
});

test("stored session mappings reject headerless JSONL", async () => {
  const { root, project, registryFile } = await fixture();
  const sessionFile = path.join(project.sessionsDir, "headerless.jsonl");
  await fs.writeFile(sessionFile, `${JSON.stringify({ type: "message", message: { role: "user", content: "No header" } })}\n`);
  await fs.writeFile(registryFile, `${JSON.stringify({ version: 3, chats: [{
    id: "chat-headerless", projectId: project.id, status: "active", title: "Broken",
    piSessionId: "missing-header", piSessionFile: sessionFile,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }] })}\n`);
  const store = new ChatStore(registryFile);
  await store.initialize([project]);
  assert.equal(store.metadata("chat-headerless"), null);
  await fs.rm(root, { recursive: true, force: true });
});

test("temporarily missing Native Pi files retain their durable chat mapping", async () => {
  const { root, project, registryFile } = await fixture();
  const missingFile = path.join(root, "host-pi", "missing.jsonl");
  await fs.writeFile(registryFile, `${JSON.stringify({ version: 3, chats: [{
    id: "chat-native-missing", projectId: project.id, status: "active", title: "Native",
    runtime: { kind: "native_pi", installationId: "host-pi", binaryVersion: "0.80.10" },
    piSessionId: "native-missing", piSessionFile: missingFile,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }] })}\n`);
  const store = new ChatStore(registryFile);
  await store.initialize([project]);
  assert.equal(store.metadata("chat-native-missing").piSessionFile, missingFile);
  assert.equal(store.metadata("chat-native-missing").runtime.kind, "native_pi");
  await fs.rm(root, { recursive: true, force: true });
});

test("creates invisible drafts before Pi and reveals them after a completed attachment", async () => {
  const { root, project, registryFile } = await fixture();
  const store = new ChatStore(registryFile);
  await store.initialize([project]);
  const chat = await store.create(project, { templateId: "workspace", templateVersion: "1" });
  assert.equal(chat.status, "draft");
  assert.equal(chat.templateId, "workspace");
  assert.equal(chat.templateVersion, "1");
  assert.equal(chat.piSessionId, null);
  assert.equal(chat.runtime.profileId, "workspace");
  await store.update(chat.id, { templateId: "chat", templateVersion: "3" });
  assert.equal(store.metadata(chat.id).runtime.profileId, "chat");
  assert.equal(store.metadata(chat.id).runtime.profileVersion, "3");
  assert.deepEqual(store.listProject(project.id), []);

  const bare = await store.create(project);
  assert.equal(bare.templateId, null);
  await store.ensureTemplate(bare.id, { templateId: "chat", templateVersion: "2" });
  assert.equal(store.metadata(bare.id).templateId, "chat");
  await store.ensureTemplate(bare.id, { templateId: "workspace", templateVersion: "9" });
  assert.equal(store.metadata(bare.id).templateId, "chat");

  const attachment = path.join(chatDirectory(project, chat.id), "attachments", `${crypto.randomUUID()}--note.txt`);
  await fs.writeFile(attachment, "hello");
  store.markAttachments(chat.id, true);
  assert.equal(store.listProject(project.id)[0].id, chat.id);

  const restored = new ChatStore(registryFile);
  await restored.initialize([project]);
  assert.equal(restored.listProject(project.id)[0].id, chat.id);
  await fs.rm(root, { recursive: true, force: true });
});

test("sidebar list keeps creation order when a rename bumps updatedAt", async () => {
  const { root, project, registryFile } = await fixture();
  const olderFile = path.join(project.sessionsDir, "older.jsonl");
  const newerFile = path.join(project.sessionsDir, "newer.jsonl");
  await fs.writeFile(olderFile, `${JSON.stringify({ type: "session", id: "session-older", cwd: project.path, timestamp: "2026-01-01T00:00:00Z" })}\n`);
  await fs.writeFile(newerFile, `${JSON.stringify({ type: "session", id: "session-newer", cwd: project.path, timestamp: "2026-02-01T00:00:00Z" })}\n`);
  await fs.writeFile(registryFile, `${JSON.stringify({ version: 2, chats: [{
    id: "chat-older", projectId: project.id, status: "active", title: "Older",
    piSessionId: "session-older", piSessionFile: olderFile,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  }, {
    id: "chat-newer", projectId: project.id, status: "active", title: "Newer",
    piSessionId: "session-newer", piSessionFile: newerFile,
    createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z",
  }] })}\n`);

  const store = new ChatStore(registryFile);
  await store.initialize([project]);
  assert.deepEqual(store.listProject(project.id).map((chat) => chat.id), ["chat-newer", "chat-older"]);

  // Simulate rename: title + fresh updatedAt (as commitSession does after appendSessionInfo).
  await store.commitSession("chat-older", {
    title: "Renamed older",
    nativeId: "session-older",
    id: "session-older",
    file: olderFile,
    updatedAt: "2026-07-18T12:00:00Z",
  });
  assert.equal(store.metadata("chat-older").title, "Renamed older");
  assert.equal(store.metadata("chat-older").updatedAt, "2026-07-18T12:00:00Z");
  assert.deepEqual(store.listProject(project.id).map((chat) => chat.id), ["chat-newer", "chat-older"]);
  await fs.rm(root, { recursive: true, force: true });
});

test("keeps a pre-prompt Pi mapping as a draft across startup", async () => {
  const { root, project, registryFile } = await fixture();
  const piSessionFile = path.join(project.sessionsDir, "draft.jsonl");
  await fs.writeFile(piSessionFile, `${JSON.stringify({ type: "session", id: "native-draft", cwd: project.path })}\n`);
  const id = "550e8400-e29b-41d4-a716-446655440090";
  const now = new Date().toISOString();
  await fs.writeFile(registryFile, `${JSON.stringify({ version: 2, chats: [{
    id, projectId: project.id, status: "draft", title: "New chat",
    piSessionId: "native-draft", piSessionFile,
    createdAt: now, updatedAt: now,
  }] })}\n`);

  const store = new ChatStore(registryFile);
  await store.initialize([project]);
  assert.equal(store.metadata(id).status, "draft");
  assert.equal(store.metadata(id).piSessionFile, piSessionFile);
  assert.deepEqual(store.listProject(project.id), []);
  await fs.rm(root, { recursive: true, force: true });
});

test("waits for a newly reported fork file before checkpointing it", async () => {
  const { root, project, registryFile } = await fixture();
  const store = new ChatStore(registryFile);
  await store.initialize([project]);
  const chat = await store.create(project);
  const forkFile = path.join(project.sessionsDir, "delayed-fork.jsonl");
  const write = new Promise((resolve, reject) => setTimeout(() => {
    fs.writeFile(forkFile, `${JSON.stringify({
      type: "session",
      id: "delayed-native",
      cwd: project.path,
      timestamp: "2026-07-16T00:00:00Z",
    })}\n`).then(resolve, reject);
  }, 50));

  const session = await store.syncFile(chat.id, forkFile, project, { waitForFileMs: 500 });
  await write;
  assert.equal(session.nativeId, "delayed-native");
  assert.equal(store.metadata(chat.id).piSessionFile, forkFile);
  await fs.rm(root, { recursive: true, force: true });
});

test("startup keeps regenerated branches attached to their durable Conduit chat", async () => {
  const { root, project, registryFile } = await fixture();
  const chatId = "550e8400-e29b-41d4-a716-446655440099";
  const originalFile = path.join(project.sessionsDir, "original.jsonl");
  const firstForkFile = path.join(project.sessionsDir, "first-fork.jsonl");
  const currentForkFile = path.join(project.sessionsDir, "current-fork.jsonl");
  await fs.writeFile(originalFile, [
    JSON.stringify({ type: "session", id: "session-original", cwd: project.path, timestamp: "2026-07-23T12:00:00Z" }),
    JSON.stringify({ type: "message", message: { role: "user", content: "Tell me about this repo" } }),
  ].join("\n"));
  await fs.writeFile(firstForkFile, [
    JSON.stringify({
      type: "session",
      id: "session-first-fork",
      cwd: project.path,
      timestamp: "2026-07-23T12:01:00Z",
      parentSession: originalFile,
    }),
  ].join("\n"));
  await fs.writeFile(currentForkFile, [
    JSON.stringify({
      type: "session",
      id: "session-current-fork",
      cwd: project.path,
      timestamp: "2026-07-23T12:02:00Z",
      parentSession: originalFile,
    }),
  ].join("\n"));
  await fs.writeFile(registryFile, `${JSON.stringify({ version: 3, chats: [{
    id: chatId,
    projectId: project.id,
    status: "active",
    title: "Tell me about this repo",
    piSessionId: "session-current-fork",
    piSessionFile: currentForkFile,
    createdAt: "2026-07-23T12:00:00Z",
    updatedAt: "2026-07-23T12:02:00Z",
  }, {
    id: "session-first-fork",
    projectId: project.id,
    status: "active",
    title: "Tell me about this repo",
    piSessionId: "session-first-fork",
    piSessionFile: firstForkFile,
    createdAt: "2026-07-23T12:01:00Z",
    updatedAt: "2026-07-23T12:01:00Z",
  }] })}\n`);

  const store = new ChatStore(registryFile);
  await store.initialize([project]);
  assert.deepEqual(store.listProject(project.id).map((chat) => chat.id), [chatId]);
  assert.equal(store.metadata(chatId).piSessionFile, currentForkFile);
  await fs.access(originalFile);
  await fs.access(firstForkFile);
  await fs.access(currentForkFile);
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

test("persists thinking levels per model on the stable chat record", async () => {
  const { root, project, registryFile } = await fixture();
  const store = new ChatStore(registryFile);
  await store.initialize([project]);
  const chat = await store.create(project);
  await store.update(chat.id, {
    modelThinkingLevels: {
      "deepseek/v4-flash": "max",
      "luna/default": "minimal",
      ignored: "",
    },
  });

  const reopened = new ChatStore(registryFile);
  await reopened.initialize([project]);
  assert.deepEqual(reopened.metadata(chat.id).modelThinkingLevels, {
    "deepseek/v4-flash": "max",
    "luna/default": "minimal",
  });
  await fs.rm(root, { recursive: true, force: true });
});
