import test from "node:test";
import assert from "node:assert/strict";
import { AgentDoc } from "../src/agent/agent-doc.js";
import { appendEntry, ConduitInboxTool } from "../src/agent/inbox.js";
import { agentFixture } from "./helpers/agent-fixture.js";

const day = 86400_000;
const now = Date.UTC(2030, 0, 15, 12);
const entry = (key, status = "unhandled") => ({ key, status, title: key, headline: key, level: "fyi", kind: "task" });

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
