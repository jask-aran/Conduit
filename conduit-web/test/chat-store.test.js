import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ChatStore, chatDirectory } from "../src/chat-store.js";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-chat-store-"));
  const projectPath = path.join(root, "files");
  const project = { id: "project_test", slug: "test", path: path.join(root, "stale-files"), workingRoot: projectPath };
  return { root, project, registryFile: path.join(root, "sessions.json") };
}

test("creates invisible drafts and reveals them after a completed attachment", async () => {
  const { root, project, registryFile } = await fixture();
  const store = new ChatStore(registryFile);
  await store.initialize([project]);
  const chat = await store.create(project, { templateId: "workspace", templateVersion: "1" });
  assert.equal(chat.status, "draft");
  assert.equal(chat.templateId, "workspace");
  assert.equal(chat.templateVersion, "1");
  assert.equal(chat.backend.implementation, "conduit-runtime");
  await store.update(chat.id, { templateId: "chat", templateVersion: "3" });
  assert.equal(store.metadata(chat.id).templateId, "chat");
  assert.equal(store.metadata(chat.id).templateVersion, "3");
  assert.deepEqual(store.listProject(project.id), []);

  const bare = await store.create(project);
  assert.equal(bare.templateId, null);
  await store.update(bare.id, { templateId: "chat", templateVersion: "2" });
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

test("startup removes stale empty drafts and orphan partial files only", async () => {
  const { root, project, registryFile } = await fixture();
  const old = "550e8400-e29b-41d4-a716-446655440000";
  const kept = "550e8400-e29b-41d4-a716-446655440001";
  const rows = [old, kept].map((id) => ({
    id, projectId: project.id, status: "draft", title: "New chat",
    createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z",
  }));
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
  assert.ok(store.metadata(kept));
  await assert.rejects(fs.access(path.join(chatDirectory(project, kept), ".partial", "orphan.part")), { code: "ENOENT" });
  await fs.access(path.join(chatDirectory(project, kept), "attachments"));
  await fs.rm(root, { recursive: true, force: true });
});
