import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createMcpEndpoint } from "../src/server/mcp-endpoint.js";
import { mcpAccess } from "../src/server/mcp-access.js";
import { UiTool } from "../src/server/ui-control.js";
import { agentFixture } from "./helpers/agent-fixture.js";

// Dispatch through the real router without a socket or a live Conduit process.
function request(router, path, body, { method = "POST", bearer } = {}) {
  return new Promise((resolve, reject) => {
    const wire = JSON.stringify(body ?? {});
    const req = Readable.from([Buffer.from(wire)]);
    Object.assign(req, { method, url: path, body, headers: bearer ? {
      authorization: `Bearer ${bearer}`, "content-type": "application/json", "content-length": String(Buffer.byteLength(wire)),
    } : {} });
    let status = 200;
    const response = {
      status(value) { status = value; return this; },
      set() { return this; },
      json(value) { resolve({ status, body: value }); return this; },
      end() { resolve({ status }); },
    };
    router.handle(req, response, (error) => error ? reject(error) : resolve({ status: 404 }));
  });
}

test("conduit MCP exposes both named tools at the canonical path and old alias", async (t) => {
  const { agent } = await agentFixture(t);
  const endpoint = createMcpEndpoint({ runtime: agent.runtime, token: "test-only", version: "test" });
  for (const path of ["/v0/mcp", "/v0/mcp/ui"]) {
    const initialized = await request(endpoint.afterAuth, path, { id: 1, method: "initialize" });
    assert.equal(initialized.body.result.serverInfo.name, "conduit");
    assert.match(initialized.body.result.instructions, /conduit_ui/);
    assert.match(initialized.body.result.instructions, /conduit_inbox/);
    const listed = await request(endpoint.afterAuth, path, { id: 2, method: "tools/list" });
    assert.deepEqual(listed.body.result.tools.map((tool) => tool.name), ["conduit_ui", "conduit_inbox", "conduit_browser"]);
    assert.ok(!Object.hasOwn(listed.body.result.tools[1].inputSchema.properties, "client"));
    assert.equal((await request(endpoint.afterAuth, path, null, { method: "GET" })).status, 405);
    assert.equal((await request(endpoint.beforeAuth, path, { id: 3, method: "ping" }, { bearer: "wrong" })).status, 404);
    const accepted = await request(endpoint.beforeAuth, path, { id: 4, method: "ping" }, { bearer: "test-only" });
    assert.deepEqual(accepted.body.result, {});
  }
  const previous = { ...mcpAccess };
  t.after(() => Object.assign(mcpAccess, previous));
  Object.assign(mcpAccess, { url: "http://example.test/v0/mcp", token: "test-only" });
  const access = await request(endpoint.afterAuth, "/v0/mcp/access", null, { method: "GET" });
  assert.equal(access.body.url, mcpAccess.url);
  assert.match(access.body.codex, /\[mcp_servers\.conduit\]/);
});

test("MCP inbox needs no conversation and records mcp identity for all edits", async (t) => {
  const { agent } = await agentFixture(t);
  const endpoint = createMcpEndpoint({ runtime: agent.runtime, token: "test-only" });
  const call = async (args, name = "conduit_inbox") => (await request(endpoint.afterAuth, "/v0/mcp", {
    id: 1, method: "tools/call", params: { name, arguments: args },
  })).body;
  const added = await call({ action: "add", title: "MCP note", headline: "Shared context", level: "fyi", author: "person" });
  assert.ok(!added.error, JSON.stringify(added));
  const entry = JSON.parse(added.result.content[0].text);
  assert.equal(entry.author, "mcp");
  assert.equal(entry.by, "mcp");
  assert.match((await call({ action: "read", id: entry.id })).result.content[0].text, /Shared context/);
  for (const action of ["handle", "reopen", "address", "dismiss"]) {
    const response = await call({ action, id: entry.id, outcome: "Read", for: ["reflect"] });
    assert.equal(response.result.isError, false);
    const changed = (await agent.state()).inbox[entry.id];
    assert.equal(changed.by, "mcp");
    assert.equal(changed.handledBy, undefined);
  }
  assert.equal((await call({ action: "delete", id: entry.id })).error.code, -32602);
  for (const name of ["ui", "inbox"]) assert.equal((await call({}, name)).error.code, -32602);
  assert.equal((await call({ action: "handle", id: entry.id })).result.isError, true);
  assert.equal((await call({ action: "read", id: "missing" })).result.isError, true);
});

test("conduit_ui keeps client targeting and commands", async () => {
  const sent = [];
  const tool = UiTool({ uiControl: { look: () => [], command: async (...args) => { sent.push(args); return { client: "tab", result: "Done" }; } } });
  assert.equal(tool.name, "conduit_ui");
  await tool.execute({ action: "open", view: "page:agent", client: "chosen", beside: true });
  await tool.execute({ action: "focus", pane: "main" });
  assert.deepEqual(sent, [[{ action: "open", view: "page:agent", beside: true }, "chosen", null], [{ action: "focus", pane: "main" }, null, null]]);
});
