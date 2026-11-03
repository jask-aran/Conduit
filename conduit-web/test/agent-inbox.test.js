import test from "node:test";
import assert from "node:assert/strict";
import { AgentDoc } from "../src/agent/agent-doc.js";
import { appendEntry, InboxTools, listInbox } from "../src/agent/inbox.js";
import { agentFixture } from "./helpers/agent-fixture.js";

const day = 86400_000;
const now = Date.UTC(2030, 0, 15, 12);
const entry = (key, status = "unhandled") => ({ key, status, title: key, headline: key, level: "fyi", kind: "task" });

// inbox.js: appendEntry is idempotent by key; listInbox returns newest first.
test("reports stay discrete in arrival order and a replay adds no second entry", () => {
  const doc = AgentDoc.definition.initial();
  const first = appendEntry(doc, entry("first"), now);
  const second = appendEntry(doc, entry("second"), now + 1);
  assert.equal(appendEntry(doc, entry("first"), now + 2).id, first.id);
  assert.deepEqual(listInbox(doc).map((item) => item.key), [second.key, first.key]);
});

// inbox.js: "Prunes what has been handled a week."
test("handled context stays seven days while unhandled context does not expire", () => {
  const doc = AgentDoc.definition.initial();
  const old = appendEntry(doc, { ...entry("old", "handled"), handledAt: new Date(now - 7 * day - 1).toISOString() }, now - 8 * day);
  const boundary = appendEntry(doc, { ...entry("boundary", "handled"), handledAt: new Date(now - 7 * day).toISOString() }, now - 8 * day);
  const waiting = appendEntry(doc, entry("waiting"), now - 30 * day);
  appendEntry(doc, entry("arrival"), now);
  assert.equal(doc.inbox[old.id], undefined);
  assert.ok(doc.inbox[boundary.id]);
  assert.ok(doc.inbox[waiting.id]);
  appendEntry(doc, entry("later"), now + 1);
  assert.equal(doc.inbox[boundary.id], undefined);
});

// persistent-agent.md, Verbs: handle marks entries; inbox.js records who and the outcome.
test("handling context removes it from waiting without deleting its outcome", async (t) => {
  const { agent, api } = await agentFixture(t);
  const id = await agent.update((doc) => appendEntry(doc, entry("news"), now).id);
  const tool = InboxTools(agent.runtime).tools.find((tool) => tool.name === "inbox");
  await tool.execute({ action: "handle", ids: [id], outcome: "Added to brief" }, api);
  const state = await agent.state();
  assert.deepEqual(listInbox(state, { unhandled: true }), []);
  assert.equal(state.inbox[id].status, "handled");
  assert.equal(state.inbox[id].outcome, "Added to brief");
  assert.equal(state.inbox[id].handledBy, api.conversationId);
  await tool.execute({ action: "handle", ids: [id], outcome: "Replacement" }, api);
  assert.equal((await agent.state()).inbox[id].outcome, "Added to brief");
});
