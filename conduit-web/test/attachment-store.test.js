import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { AttachmentStore, safeAttachmentName } from "../src/attachment-store.js";
import { ChatStore, chatDirectory } from "../src/chat-store.js";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-attachments-"));
  const project = { id: "project_test", slug: "test", path: path.join(root, "files"), sessionsDir: path.join(root, "sessions") };
  const chats = new ChatStore(path.join(root, "registry.json"));
  await chats.initialize([project]);
  const chat = await chats.create(project);
  return { root, project, chat, chats, store: new AttachmentStore(chats) };
}

test("streams same-named files through partials into collision-free final files", async () => {
  const { root, project, chat, store } = await fixture();
  const firstId = crypto.randomUUID();
  const secondId = crypto.randomUUID();
  await store.write(project, chat.id, firstId, "../same.json", Readable.from(['{"first":true}']));
  await store.write(project, chat.id, secondId, "same.json", Readable.from(['{"second":true}']));
  const items = await store.list(project, chat.id);
  assert.deepEqual(items.map((item) => item.name), ["same.json", "same.json"]);
  assert.notEqual(items[0].storedName, items[1].storedName);
  assert.equal((await store.open(project, chat.id, firstId)).type, "application/json");
  await assert.rejects(store.write(project, chat.id, firstId, "replacement.json", Readable.from(["replace"])), { code: "EEXIST" });
  assert.deepEqual(await fs.readdir(path.join(chatDirectory(project, chat.id), ".partial")), []);
  await fs.rm(root, { recursive: true, force: true });
});

test("failed streams remove partial data and never publish a final attachment", async () => {
  const { root, project, chat, store } = await fixture();
  const id = crypto.randomUUID();
  const broken = new Readable({
    read() { this.push("partial"); this.destroy(Object.assign(new Error("disk failed"), { code: "ENOSPC" })); },
  });
  await assert.rejects(store.write(project, chat.id, id, "broken.txt", broken), { code: "ENOSPC" });
  assert.deepEqual(await store.list(project, chat.id), []);
  assert.deepEqual(await fs.readdir(path.join(chatDirectory(project, chat.id), ".partial")), []);
  await fs.rm(root, { recursive: true, force: true });
});

test("large generated uploads remain ordinary streamed files and symlinks fail closed", async () => {
  const { root, project, chat, store } = await fixture();
  const id = crypto.randomUUID();
  const chunk = Buffer.alloc(1024 * 1024, 7);
  await store.write(project, chat.id, id, "large.bin", Readable.from(Array.from({ length: 32 }, () => chunk)));
  assert.equal((await store.resolve(project, chat.id, id)).size, 32 * 1024 * 1024);
  const directory = path.join(chatDirectory(project, chat.id), "attachments");
  const symlinkId = crypto.randomUUID();
  await fs.symlink("/etc/passwd", path.join(directory, `${symlinkId}--passwd`));
  assert.equal(await store.resolve(project, chat.id, symlinkId), null);
  await fs.rm(root, { recursive: true, force: true });
});

test("attachment access is scoped to one chat and rejects symlinked owned parents", async () => {
  const { root, project, chat, chats, store } = await fixture();
  const other = await chats.create(project);
  const id = crypto.randomUUID();
  await store.write(project, other.id, id, "private.txt", Readable.from(["other chat"]));
  assert.equal(await store.open(project, chat.id, id), null);

  const outside = path.join(root, "outside");
  await fs.mkdir(outside);
  const attachmentDirectory = path.join(chatDirectory(project, chat.id), "attachments");
  await fs.rmdir(attachmentDirectory);
  await fs.symlink(outside, attachmentDirectory);
  await assert.rejects(store.list(project, chat.id), { code: "unsafe_conduit_path" });
  await fs.rm(root, { recursive: true, force: true });
});

test("first attachment keeps Conduit metadata out of Git status locally", async () => {
  const { root, project, chat, store } = await fixture();
  const { spawnSync } = await import("node:child_process");
  const initialized = spawnSync("git", ["init"], { cwd: project.path, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  await store.write(project, chat.id, crypto.randomUUID(), "note.txt", Readable.from(["hello"]));
  const excluded = await fs.readFile(path.join(project.path, ".git", "info", "exclude"), "utf8");
  assert.match(excluded, /# Conduit chat attachments\n\.conduit\//);
  await fs.rm(root, { recursive: true, force: true });
});

test("sanitizes separators, controls, dot-only names, and UTF-8 byte length", () => {
  assert.equal(safeAttachmentName("../../\u0000\u0085secret.txt"), "secret.txt");
  assert.equal(safeAttachmentName("..."), "attachment");
  assert.ok(Buffer.byteLength(safeAttachmentName("é".repeat(200)), "utf8") <= 180);
  assert.ok(Buffer.byteLength(safeAttachmentName("😀".repeat(100)), "utf8") <= 180);
  assert.equal(safeAttachmentName("😀".repeat(100)).includes("�"), false);
});
