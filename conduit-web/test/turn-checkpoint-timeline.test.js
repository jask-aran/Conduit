import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TurnCheckpointStore } from "../src/turn-checkpoint-store.js";

const CHAT = "chat-fork";

async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "turn-checkpoint-"));
  const store = path.join(root, "checkpoints");
  const files = path.join(root, "files");
  await fs.mkdir(files, { recursive: true });
  return { root, store, files };
}

test("a settled turn's changes end where it ended, and a turn that ran no tools has none", async () => {
  const { store, files } = await workspace();
  const checkpoints = new TurnCheckpointStore(store);
  const turn = async (messageId, work, unchanged = false) => {
    const start = await checkpoints.capture({ chatId: CHAT, projectId: "project", workingRoot: files });
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
