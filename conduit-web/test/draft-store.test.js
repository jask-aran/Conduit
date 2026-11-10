import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DraftStore } from "../src/draft-store.js";

const store = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-drafts-"));
  const instance = new DraftStore(path.join(root, "drafts.json"));
  await instance.load();
  return instance;
};

test("saving and reloading a draft round-trips through disk", async () => {
  const drafts = await store();
  await drafts.saveDraft("chat-1", { text: "half a prompt", attachmentIds: ["a1"] });
  const reloaded = new DraftStore(drafts.filePath);
  await reloaded.load();
  assert.equal(reloaded.draft("chat-1").text, "half a prompt");
  assert.deepEqual(reloaded.draft("chat-1").attachmentIds, ["a1"]);
});

test("retained attachment ids span drafts and stash", async () => {
  const drafts = await store();
  await drafts.saveDraft("chat-1", { text: "t", attachmentIds: ["draft-file"] });
  await drafts.pushStash({ chatId: "chat-2", text: "t", attachmentIds: ["stash-file"] });
  assert.deepEqual([...drafts.retainedAttachmentIds()].sort(), ["draft-file", "stash-file"]);
});

test("concurrent saves do not interleave writes", async () => {
  const drafts = await store();
  await Promise.all([...Array(25).keys()].map((index) => drafts.saveDraft(`chat-${index}`, { text: `t${index}`, attachmentIds: [] })));
  const reloaded = new DraftStore(drafts.filePath);
  await reloaded.load();
  assert.equal(Object.keys(reloaded.snapshot().drafts).length, 25);
});
