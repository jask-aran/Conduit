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
