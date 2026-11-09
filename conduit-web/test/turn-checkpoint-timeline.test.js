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
  await Promise.all([
    fs.mkdir(path.join(store, keyFor(CHAT)), { recursive: true }),
    fs.mkdir(files, { recursive: true }),
  ]);
  return { root, store, files };
}

/** One checkpoint file, named the way the store names them so order is stable. */
async function writeCheckpoint(directory, { id, createdAt, messageId = null, sourceCheckpointId = null, workingRoot, entries = {} }) {
  await fs.writeFile(path.join(directory, keyFor(CHAT), `${createdAt.replace(/[:.]/g, "-")}-${id}.json`), JSON.stringify({
    version: 1, id, chatId: CHAT, projectId: "project", workingRoot, repository: false,
    turnId: null, messageId, createdAt, sequence: 0, sourceCheckpointId, head: null, entries,
  }));
}

test("neutral timeline keeps a checkpoint before the adapter supplies a message id", async () => {
  const { store, files } = await workspace();
  await writeCheckpoint(store, { id: "accepted-generation", createdAt: "2026-01-01T00:00:00.000Z", workingRoot: files });
  await fs.writeFile(path.join(files, "note.txt"), "one\ntwo\n");

  const checkpoints = new TurnCheckpointStore(store);
  const timeline = await checkpoints.timeline(CHAT, files);
  assert.deepEqual(timeline.map(({ id, messageId }) => ({ id, messageId })), [
    { id: "accepted-generation", messageId: null },
  ]);
  assert.deepEqual(timeline[0].summary, { added: 2, removed: 0, preferredPath: "note.txt" });
  const review = await checkpoints.review(CHAT, files, "turn", "accepted-generation");
  assert.deepEqual(review.files.map((file) => file.path), ["note.txt"]);
});

test("a settled turn's changes end where it ended, and a turn that ran no tools has none", async () => {
  const { store, files } = await workspace();
  const checkpoints = new TurnCheckpointStore(store);
  const turn = async (messageId, work, unchanged = false) => {
    const start = await checkpoints.capture({ chatId: CHAT, projectId: "project", projectKind: "project", workingRoot: files });
    await checkpoints.assignTurn(start, `generation-${messageId}`, messageId);
    await work();
    await checkpoints.close({ chatId: CHAT, workingRoot: files, turnId: `generation-${messageId}`, unchanged });
  };
  await turn("u1", () => fs.writeFile(path.join(files, "note.txt"), "one\n"));
  // Written by something else between the turns, and during a turn that ran no tools: neither turn's.
  await fs.writeFile(path.join(files, "other.txt"), "elsewhere\n");
  await turn("u2", () => fs.writeFile(path.join(files, "other.txt"), "elsewhere\nagain\n"), true);

  const timeline = await checkpoints.timeline(CHAT, files);
  assert.deepEqual(timeline.map(({ messageId, sequence, targetSequence, summary }) => ({ messageId, sequence, targetSequence, summary })), [
    { messageId: "u2", sequence: 2, targetSequence: 2, summary: null },
    { messageId: "u1", sequence: 1, targetSequence: 1, summary: { added: 1, removed: 0, preferredPath: "note.txt" } },
  ]);
  const review = await checkpoints.review(CHAT, files, "turn", timeline[1].id);
  assert.deepEqual(review.files.map((file) => file.path), ["note.txt"]);
});

/**
 * The same, for a backend with no session file of its own.
 *
 * Codex keeps its transcript in the app-server, not on a path Conduit can
 * read, so its checkpoints carry the message id the prompt was sent under and
 * the timeline is built from those alone.
 */
test("a backend that keeps no session file still ties each turn to its own changes", async () => {
  const { store, files } = await workspace();
  const note = (text) => ({ "note.txt": { kind: "file", mode: 0o644, content: Buffer.from(text).toString("base64") } });
  await writeCheckpoint(store, { id: "before-one", createdAt: "2026-01-01T00:00:00.000Z", messageId: "u1", workingRoot: files });
  await writeCheckpoint(store, { id: "before-two", createdAt: "2026-01-01T00:02:00.000Z", messageId: "u2", workingRoot: files, entries: note("one\n") });
  await writeCheckpoint(store, { id: "before-three", createdAt: "2026-01-01T00:04:00.000Z", messageId: "u3", workingRoot: files, entries: note("one\n") });
  await fs.writeFile(path.join(files, "note.txt"), "one\ntwo\n");

  const timeline = await new TurnCheckpointStore(store).timeline(CHAT, files);
  // Turn 2 changed nothing, so it keeps no checkpoint; 1 and 3 keep theirs,
  // each still named by the message its prompt was sent under.
  assert.deepEqual(timeline.map(({ messageId, sequence }) => ({ messageId, sequence })), [
    { messageId: "u3", sequence: 3 },
    { messageId: "u1", sequence: 1 },
  ]);
  assert.deepEqual(timeline.map((item) => item.summary), [
    { added: 1, removed: 0, preferredPath: "note.txt" },
    { added: 1, removed: 0, preferredPath: "note.txt" },
  ]);
});
