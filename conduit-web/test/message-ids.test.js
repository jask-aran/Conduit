import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MessageIds, entryMessageRows } from "../src/message-ids.js";

const chat = { id: "3f0c0f0e-3a1e-4f5a-9c2b-6d7e8f901234", backend: { implementation: "conduit_pi" } };
const project = async () => ({ workingRoot: await fs.mkdtemp(path.join(os.tmpdir(), "message-ids-")) });
const rows = (...pairs) => pairs.map(([id, role]) => ({ id, role }));

test("a turn's prompt and answer take the names claimed for them", async () => {
  const ids = new MessageIds();
  const root = await project();
  const user = await ids.claim(root, chat, "user", "m_user");
  const assistant = await ids.mint(root, chat, "assistant", user);
  await ids.bind(root, chat, rows(["e1", "user"], ["e2", "assistant"]));
  const idFor = await ids.resolver(root, chat);
  assert.deepEqual([idFor("e1"), idFor("e2")], ["m_user", assistant]);
});

test("an extra answer in one turn takes its entry's name, not the next turn's", async () => {
  // What an interrupted tool call leaves behind: the call, and an "aborted"
  // message after it. One claim, two entries.
  const ids = new MessageIds();
  const root = await project();
  const first = await ids.claim(root, chat, "user", "m_u1");
  const answer = await ids.mint(root, chat, "assistant", first);
  await ids.bind(root, chat, rows(["e1", "user"], ["e2", "assistant"], ["e3", "assistant"]));
  const second = await ids.claim(root, chat, "user", "m_u2");
  const reply = await ids.mint(root, chat, "assistant", second);
  await ids.bind(root, chat, rows(["e1", "user"], ["e2", "assistant"], ["e3", "assistant"],
    ["e4", "user"], ["e5", "assistant"]));
  const idFor = await ids.resolver(root, chat);
  assert.deepEqual([idFor("e2"), idFor("e3"), idFor("e5")], [answer, "pi:e3", reply]);
});

test("a claim waits for an entry the harness has not written yet", async () => {
  // A cancelled turn is checkpointed before Pi writes its answer. Sweeping the
  // claim away there left the entry to be named by the next turn's claim.
  const ids = new MessageIds();
  const root = await project();
  const user = await ids.claim(root, chat, "user", "m_u1");
  const answer = await ids.mint(root, chat, "assistant", user);
  await ids.bind(root, chat, rows(["e1", "user"]));
  await ids.bind(root, chat, rows(["e1", "user"], ["e2", "assistant"]));
  assert.equal((await ids.resolver(root, chat))("e2"), answer);
});

test("a released claim never names a later message", async () => {
  const ids = new MessageIds();
  const root = await project();
  const user = await ids.claim(root, chat, "user", "m_lost");
  await ids.release(root, chat, { user, assistant: await ids.mint(root, chat, "assistant", user) });
  await ids.claim(root, chat, "user", "m_real");
  await ids.bind(root, chat, rows(["e1", "user"]));
  assert.equal((await ids.resolver(root, chat))("e1"), "m_real");
});

test("a ledger read back from disk does not re-queue what it already bound", async () => {
  const root = await project();
  const writer = new MessageIds();
  const user = await writer.claim(root, chat, "user", "m_u1");
  await writer.mint(root, chat, "assistant", user);
  await writer.bind(root, chat, rows(["e1", "user"], ["e2", "assistant"]));
  const reader = new MessageIds();
  await reader.bind(root, chat, rows(["e1", "user"], ["e2", "assistant"], ["e3", "user"]));
  assert.equal((await reader.resolver(root, chat))("e3"), "pi:e3");
});

test("entryMessageRows keeps only what a message wrote, in order", () => {
  assert.deepEqual(entryMessageRows([
    { type: "message", id: "e1", message: { role: "user" } },
    { type: "tool_call", id: "t1" },
    { type: "message", id: "e2", message: { role: "system" } },
    { type: "message", id: "e3", message: { role: "assistant" } },
  ]), [{ id: "e1", role: "user" }, { id: "e3", role: "assistant" }]);
});

/**
 * Regenerate re-asks a prompt, and the row on screen is the same row.
 *
 * The harness abandons the entry and writes another, so the name has to survive
 * that. Without it the replacement was minted a fresh name and the browser drew
 * a second, identical message where the first had just been removed.
 */
test("a name whose entry a fork abandoned can be claimed again", async () => {
  const workspace = await project();
  const ledger = new MessageIds();

  const first = await ledger.claim(workspace, chat, "user", "m_11111111-1111-1111-1111-111111111111");
  await ledger.bind(workspace, chat, rows(["entry-1", "user"]));
  assert.equal(await ledger.entryIdFor(workspace, chat, first), "entry-1");

  // The fork abandons entry-1. The name goes back, and the prompt re-sent in
  // its place claims it rather than minting a new one.
  assert.equal(await ledger.reclaim(workspace, chat, first), first);
  assert.equal(await ledger.claim(workspace, chat, "user", first), first);
  await ledger.bind(workspace, chat, rows(["entry-2", "user"]));
  assert.equal(await ledger.entryIdFor(workspace, chat, first), "entry-2");

  // And it survives a reload: the file has to replay to the same answer, or a
  // restart would resurrect the binding the fork threw away.
  const reloaded = new MessageIds();
  assert.equal(await reloaded.entryIdFor(workspace, chat, first), "entry-2");

  // A name Conduit never minted is the entry's own, and that entry is what the
  // fork abandoned, so there is nothing to keep.
  assert.equal(await ledger.reclaim(workspace, chat, "pi:entry-2"), null);
});
