import test from "node:test";
import assert from "node:assert/strict";
import { AgentDoc } from "../src/agent/agent-doc.js";
import { appendEntry, ConduitInboxTool, entryText, listInbox } from "../src/agent/inbox.js";
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

test("addressing and kind filters leave the person's full inbox visible", async (t) => {
  const { agent, api } = await agentFixture(t);
  await agent.update((doc) => {
    appendEntry(doc, entry("mail"), now);
    appendEntry(doc, { ...entry("empty-address"), for: [] }, now + 1);
    appendEntry(doc, { ...entry("correction"), kind: "feedback", for: ["reflect", "review"] }, now + 2);
    appendEntry(doc, { ...entry("other"), for: ["review"] }, now + 3);
  });
  const state = await agent.state();
  const keys = (options) => listInbox(state, options).map((item) => item.key);
  assert.deepEqual(keys(), ["other", "correction", "empty-address", "mail"]);
  assert.deepEqual(keys({ for: "heartbeat" }), ["empty-address", "mail"]);
  assert.deepEqual(keys({ for: "reflect" }), ["correction", "empty-address", "mail"]);
  assert.deepEqual(keys({ for: "reflect", addressed: "only", kinds: ["feedback"] }), ["correction"]);
  assert.deepEqual(keys({ for: "review", addressed: "only" }), ["other", "correction"]);
  assert.deepEqual(keys({ for: "review", kinds: ["task"] }), ["other", "empty-address", "mail"]);
  const correction = listInbox(state).find((item) => item.key === "correction");
  assert.match(entryText(correction, "UTC"), /for: reflect, review/);
  const tool = ConduitInboxTool(agent.runtime);
  const listed = await tool.execute({ action: "list" }, api);
  assert.match(listed.output[0].text, /for: reflect, review/);
  for (const key of keys()) assert.ok(listed.output[0].text.includes(key));
  const view = await agent.view();
  assert.equal(view.inbox.length, 4);
  assert.deepEqual(view.inbox.find((item) => item.id === correction.id).for, ["reflect", "review"]);
  assert.equal(view.inbox.find((item) => item.id === correction.id).headline, "correction");
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
  const tool = ConduitInboxTool(agent.runtime);
  await tool.execute({ action: "handle", ids: [id], outcome: "Added to brief" }, api);
  const state = await agent.state();
  assert.deepEqual(listInbox(state, { unhandled: true }), []);
  assert.equal(state.inbox[id].status, "handled");
  assert.equal(state.inbox[id].outcome, "Added to brief");
  assert.equal(state.inbox[id].handledBy, api.conversationId);
  await tool.execute({ action: "handle", ids: [id], outcome: "Replacement" }, api);
  assert.equal((await agent.state()).inbox[id].outcome, "Added to brief");
});

test("native inbox edits keep caller identity and support filters, addressing, reopening and dismissal", async (t) => {
  const { agent, api } = await agentFixture(t);
  const tool = ConduitInboxTool(agent.runtime);
  const call = async (args) => {
    const response = await tool.execute(args, api);
    assert.ok(!response.isError, response.output[0].text);
    return response.output[0].text;
  };
  const item = JSON.parse(await call({ action: "add", title: "Check", headline: "Agent context", body: "Detail", level: "attention", for: ["reflect"], author: "person" }));
  assert.equal(item.author, api.conversationId);
  assert.equal(item.kind, "note");
  assert.match(await call({ action: "read", id: item.id }), /Detail/);
  assert.match(await call({ action: "list", kind: "note", for: "reflect" }), /Agent context/);
  assert.doesNotMatch(await call({ action: "list", kind: "feedback" }), /Agent context/);
  assert.doesNotMatch(await call({ action: "list", for: "heartbeat" }), /Agent context/);
  await call({ action: "address", id: item.id, for: [] });
  assert.match(await call({ action: "list", for: "heartbeat" }), /Agent context/);
  await call({ action: "address", id: item.id, for: "reflect" });
  await call({ action: "handle", id: item.id, outcome: "Read" });
  assert.doesNotMatch(await call({ action: "list" }), /Agent context/);
  assert.match(await call({ action: "list", unhandled: false }), /Agent context/);
  await call({ action: "reopen", id: item.id });
  const reopened = (await agent.state()).inbox[item.id];
  assert.equal(reopened.status, "unhandled");
  for (const field of ["outcome", "handledAt", "handledBy"]) assert.equal(reopened[field], undefined);
  assert.equal(reopened.at, item.at);
  await call({ action: "dismiss", id: item.id });
  assert.equal((await agent.state()).inbox[item.id].outcome, "dismissed");
  for (const args of [{ action: "delete", id: item.id }, { action: "address", id: item.id },
    { action: "handle", id: item.id }, { action: "add", title: "No level", headline: "Missing" },
    { action: "dismiss", ids: [item.id, "missing"] }, { action: "reopen", id: "__proto__" }]) {
    assert.equal((await tool.execute(args, api)).isError, true);
  }
});

test("person inbox routes share edits, return current entries and reject invalid input", async (t) => {
  const { agent, api } = await agentFixture(t);
  const { registerAgentRoutes } = await import("../src/server/routes/agent.js");
  const { personWords } = await import("../src/agent/person-words.js");
  // Give personWords a real, empty conversation to scan.
  api.conversationId = await agent.update(async (doc, tx) => {
    const home = await tx.createConversation({ ownership: { kind: "ownerless" } });
    doc.home.conversationId = home.id;
    return home.id;
  });
  const routes = new Map();
  const app = Object.fromEntries(["get", "post", "patch", "delete", "put"].map((verb) => [verb, (path, handler) => routes.set(`${verb} ${path}`, handler)]));
  registerAgentRoutes(app, { agent });
  const request = async (verb, body, id) => {
    let status = 200, payload;
    const response = { status(value) { status = value; return this; }, json(value) { payload = value; return this; }, end() {} };
    await routes.get(`${verb} /v0/agent/inbox${verb === "post" ? "" : "/:id"}`)({ body, params: { id } }, response, (error) => { throw error; });
    return { status, body: payload };
  };
  const added = await request("post", { title: "Person note", headline: "Context only", level: "fyi", author: "impostor", handledBy: 42 });
  assert.equal(added.status, 201);
  const id = added.body.id;
  assert.equal(added.body.author, "person");
  assert.equal(added.body.by, "person");
  assert.equal(added.body.handledBy, undefined);
  assert.ok((await agent.view()).inbox.some((entry) => entry.id === id));
  assert.deepEqual((await personWords(agent, api.conversationId)).messages, []);
  const tool = ConduitInboxTool(agent.runtime);
  await tool.execute({ action: "add", title: "Agent note", headline: "Not intent", level: "fyi", author: "person" }, api);
  assert.deepEqual((await personWords(agent, api.conversationId)).messages, []);
  for (const body of [undefined, {}, { title: "", headline: "x", level: "fyi" }, { title: "x", headline: "x", level: "failed" },
    { title: "x", headline: "x", level: "fyi", body: 2 }, { title: "x", headline: "x", level: "fyi", for: ["Bad Name"] }]) {
    assert.equal((await request("post", body)).status, 400);
  }
  assert.equal((await request("patch", { action: "handle" }, id)).status, 400);
  assert.equal((await request("patch", { action: "delete" }, id)).status, 400);
  assert.equal((await request("patch", { action: "address", for: [2] }, id)).status, 400);
  for (const action of ["reopen", "dismiss", "address", "handle"]) {
    assert.equal((await request("patch", { action, outcome: "Done", for: [] }, "missing")).status, 404);
  }
  for (const body of [{ action: "address", for: ["reflect"] }, { action: "address", for: null },
    { action: "handle", outcome: "Used" }, { action: "reopen" }, { action: "dismiss" }]) {
    const response = await request("patch", body, id);
    assert.equal(response.status, 200);
    assert.equal(response.body.id, id);
    // The view adds where the entry's text is kept as a file (inbox-files.js).
    const { file, ...shown } = (await agent.view()).inbox.find((entry) => entry.id === id);
    assert.match(file, /^inbox\/\d{4}-\d{2}-\d{2}-i-1-person-note\.md$/);
    assert.deepEqual(shown, response.body);
  }
  assert.equal((await agent.state()).inbox[id].outcome, "dismissed");
  assert.equal((await request("delete", undefined, id)).status, 204);
  assert.equal((await request("delete", undefined, id)).status, 404);
  assert.ok(!(await agent.view()).inbox.some((entry) => entry.id === id));
});
