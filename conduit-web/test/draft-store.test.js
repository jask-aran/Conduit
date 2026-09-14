import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DraftStore, DRAFT_LIMITS, normalizeDraftDocument } from "../src/draft-store.js";

const store = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-drafts-"));
  const instance = new DraftStore(path.join(root, "drafts.json"));
  await instance.load();
  return instance;
};

test("a missing file loads as an empty document", async () => {
  const drafts = await store();
  assert.deepEqual(drafts.snapshot(), { drafts: {}, stash: [] });
});

test("saving and reloading a draft round-trips through disk", async () => {
  const drafts = await store();
  await drafts.saveDraft("chat-1", { text: "half a prompt", attachmentIds: ["a1"] });
  const reloaded = new DraftStore(drafts.filePath);
  await reloaded.load();
  assert.equal(reloaded.draft("chat-1").text, "half a prompt");
  assert.deepEqual(reloaded.draft("chat-1").attachmentIds, ["a1"]);
});

test("an empty draft deletes the entry rather than storing blank text", async () => {
  const drafts = await store();
  await drafts.saveDraft("chat-1", { text: "something", attachmentIds: [] });
  await drafts.saveDraft("chat-1", { text: "   ", attachmentIds: [] });
  assert.equal(drafts.draft("chat-1"), null);
});

test("a draft with no text but an attachment is kept", async () => {
  const drafts = await store();
  await drafts.saveDraft("chat-1", { text: "", attachmentIds: ["a1"] });
  assert.deepEqual(drafts.draft("chat-1").attachmentIds, ["a1"]);
});

test("drafts evict by age past the cap; attachment ids are capped and deduplicated", async () => {
  const drafts = await store();
  for (let index = 0; index <= DRAFT_LIMITS.MAX_DRAFTS; index += 1) {
    await drafts.saveDraft(`chat-${index}`, { text: `draft ${index}`, attachmentIds: [] });
  }
  assert.equal(Object.keys(drafts.snapshot().drafts).length, DRAFT_LIMITS.MAX_DRAFTS);
  await drafts.saveDraft("chat-x", { text: "t", attachmentIds: [...Array(20).keys()].map(() => "same") });
  assert.deepEqual(drafts.draft("chat-x").attachmentIds, ["same"]);
});

test("oversized draft text is truncated to the byte cap", async () => {
  const drafts = await store();
  await drafts.saveDraft("chat-1", { text: "x".repeat(DRAFT_LIMITS.MAX_DRAFT_BYTES + 500), attachmentIds: [] });
  assert.equal(Buffer.byteLength(drafts.draft("chat-1").text, "utf8"), DRAFT_LIMITS.MAX_DRAFT_BYTES);
});

test("parking removes the chat's draft and returns an addressable entry", async () => {
  const drafts = await store();
  await drafts.saveDraft("chat-1", { text: "parked", attachmentIds: ["a1"] });
  const entry = await drafts.pushStash({ chatId: "chat-1", text: "parked", attachmentIds: ["a1"] });
  assert.match(entry.id, /^st_[a-z0-9]+$/);
  assert.equal(drafts.draft("chat-1"), null);
  assert.equal(drafts.snapshot().stash.length, 1);
});

test("parking nothing is refused", async () => {
  const drafts = await store();
  await assert.rejects(() => drafts.pushStash({ chatId: "c", text: "  ", attachmentIds: [] }), /Nothing to stash/);
});

test("a new stash replaces the previous prompt", async () => {
  const drafts = await store();
  await drafts.pushStash({ chatId: "c", text: "first", attachmentIds: [] });
  await drafts.pushStash({ chatId: "c", text: "second", attachmentIds: [] });
  assert.equal(drafts.snapshot().stash.length, DRAFT_LIMITS.MAX_STASH);
  assert.equal(drafts.snapshot().stash[0].text, "second");
});

test("removing a stash entry returns it and is refused twice", async () => {
  const drafts = await store();
  const entry = await drafts.pushStash({ chatId: "c", text: "parked", attachmentIds: [] });
  assert.equal((await drafts.removeStash(entry.id)).text, "parked");
  await assert.rejects(() => drafts.removeStash(entry.id), /Unknown stash entry/);
});

test("retained attachment ids span drafts and stash", async () => {
  const drafts = await store();
  await drafts.saveDraft("chat-1", { text: "t", attachmentIds: ["draft-file"] });
  await drafts.pushStash({ chatId: "chat-2", text: "t", attachmentIds: ["stash-file"] });
  assert.deepEqual([...drafts.retainedAttachmentIds()].sort(), ["draft-file", "stash-file"]);
});

test("a malformed document normalizes instead of throwing", () => {
  assert.deepEqual(normalizeDraftDocument(null), { version: 1, drafts: {}, stash: [] });
  assert.deepEqual(normalizeDraftDocument({ drafts: "nope", stash: 7 }), { version: 1, drafts: {}, stash: [] });
  const recovered = normalizeDraftDocument({
    drafts: { good: { text: "kept" }, bad: { text: "   " } },
    stash: [{ id: "not-an-id", text: "dropped" }, { id: "st_abcdefghij", text: "kept" }],
  });
  assert.deepEqual(Object.keys(recovered.drafts), ["good"]);
  assert.deepEqual(recovered.stash.map((entry) => entry.id), ["st_abcdefghij"]);
});

test("concurrent saves do not interleave writes", async () => {
  const drafts = await store();
  await Promise.all([...Array(25).keys()].map((index) => drafts.saveDraft(`chat-${index}`, { text: `t${index}`, attachmentIds: [] })));
  const reloaded = new DraftStore(drafts.filePath);
  await reloaded.load();
  assert.equal(Object.keys(reloaded.snapshot().drafts).length, 25);
});
