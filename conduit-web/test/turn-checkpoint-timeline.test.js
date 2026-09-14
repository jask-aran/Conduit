import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TurnCheckpointStore } from "../src/turn-checkpoint-store.js";

const keyFor = (value) => crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32);
const CHAT = "chat-fork";

async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "turn-checkpoint-"));
  const store = path.join(root, "checkpoints");
  const files = path.join(root, "files");
  const sessions = path.join(root, "sessions");
  await Promise.all([
    fs.mkdir(path.join(store, keyFor(CHAT)), { recursive: true }),
    fs.mkdir(files, { recursive: true }),
    fs.mkdir(sessions, { recursive: true }),
  ]);
  return { root, store, files, sessions };
}

/** One checkpoint file, named the way the store names them so order is stable. */
async function writeCheckpoint(directory, { id, createdAt, anchorEntryId = null, sessionFile = null, workingRoot, entries = {} }) {
  await fs.writeFile(path.join(directory, keyFor(CHAT), `${createdAt.replace(/[:.]/g, "-")}-${id}.json`), JSON.stringify({
    version: 1, id, chatId: CHAT, projectId: "project", workingRoot, repository: false,
    turnId: null, createdAt, sequence: 0, anchorEntryId, sessionFile, head: null, entries,
  }));
}

const message = (id, parentId, role, text, timestamp) => JSON.stringify({
  type: "message", id, parentId, timestamp, message: { role, content: text },
});

/**
 * A regenerate forks the session: Pi keeps what came before the forked entry,
 * writes the rest to a new file, and the turn that follows gets entirely new
 * ids. The checkpoint taken for that turn anchors on the leaf of the branch it
 * forked from, which the new lineage does not contain - and a checkpoint with
 * no user message is a turn with no change badge.
 */
test("a turn whose anchor was left behind by a fork still carries its changes", async () => {
  const { store, files, sessions } = await workspace();
  const parentFile = path.join(sessions, "parent.jsonl");
  const forkedFile = path.join(sessions, "forked.jsonl");
  await fs.writeFile(parentFile, [
    JSON.stringify({ type: "session", id: "parent", cwd: files }),
    message("user-1", null, "user", "write note.txt", "2026-01-01T00:00:00.000Z"),
    message("assistant-1", "user-1", "assistant", "Done", "2026-01-01T00:00:10.000Z"),
  ].join("\n") + "\n");
  // The fork keeps nothing before the regenerated message, so the new lineage
  // holds neither the old turn nor the entry the second checkpoint anchored on.
  await fs.writeFile(forkedFile, [
    JSON.stringify({ type: "session", id: "forked", cwd: files, parentSession: parentFile }),
    message("user-2", null, "user", "write note.txt", "2026-01-01T00:01:00.000Z"),
    message("assistant-2", "user-2", "assistant", "Done again", "2026-01-01T00:01:10.000Z"),
  ].join("\n") + "\n");

  await writeCheckpoint(store, { id: "before-fork", createdAt: "2026-01-01T00:00:00.000Z", anchorEntryId: null, sessionFile: parentFile, workingRoot: files });
  await writeCheckpoint(store, { id: "after-fork", createdAt: "2026-01-01T00:00:59.000Z", anchorEntryId: "assistant-1", sessionFile: forkedFile, workingRoot: files });
  await fs.writeFile(path.join(files, "note.txt"), "one\ntwo\nthree\n");

  const timeline = await new TurnCheckpointStore(store).timeline(CHAT, files, forkedFile);
  assert.deepEqual(timeline.map((item) => item.messageId), ["user-2"]);
  assert.deepEqual(timeline[0].summary, { added: 3, removed: 0, preferredPath: "note.txt" });
});

/**
 * The other half of that: the abandoned branch's own checkpoint must not adopt
 * the regenerated turn. It was taken against the file the fork left behind, and
 * the turn it describes is no longer in the transcript.
 */
test("a checkpoint from the abandoned branch does not claim the turn that replaced it", async () => {
  const { store, files, sessions } = await workspace();
  const parentFile = path.join(sessions, "parent.jsonl");
  const forkedFile = path.join(sessions, "forked.jsonl");
  await fs.writeFile(parentFile, [
    JSON.stringify({ type: "session", id: "parent", cwd: files }),
    message("user-1", null, "user", "first", "2026-01-01T00:00:00.000Z"),
  ].join("\n") + "\n");
  await fs.writeFile(forkedFile, [
    JSON.stringify({ type: "session", id: "forked", cwd: files, parentSession: parentFile }),
    message("user-2", null, "user", "second", "2026-01-01T00:01:00.000Z"),
  ].join("\n") + "\n");
  // Anchored on an entry only the abandoned branch has, and taken against that
  // branch's file: nothing in the current lineage belongs to it.
  await writeCheckpoint(store, { id: "abandoned", createdAt: "2026-01-01T00:00:30.000Z", anchorEntryId: "user-1", sessionFile: parentFile, workingRoot: files });
  await fs.writeFile(path.join(files, "note.txt"), "one\n");

  const timeline = await new TurnCheckpointStore(store).timeline(CHAT, files, forkedFile);
  assert.deepEqual(timeline, []);
});
