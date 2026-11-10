import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { BrowserHost } from "../src/server/browser-host.js";

async function fixture(t, names = ["click"]) {
  const host = new BrowserHost({ binary: "unused" });
  const order = [];
  const messages = [];
  const result = { content: [{ type: "text", text: "unchanged tool result" }], isError: false };
  const client = new EventEmitter();
  client.readyState = 1;
  client.send = (data) => {
    const message = JSON.parse(data);
    messages.push(message);
    order.push(message.phase || message.type);
  };
  host.sockets.clients.add(client);
  t.after(() => { host.sockets.clients.clear(); host.close(); });
  host.client = async () => ({
    listTools: async () => names.map((name) => ({ name: `agent_browser_${name}`, inputSchema: {} })),
    callTool: async (name, args) => { order.push({ name, args }); return result; },
  });
  host.run = async () => JSON.stringify({ success: true, data: { box: { x: 10, y: 20, width: 40, height: 60 } } });
  host.viewport = { width: 1280, height: 720 };
  const tools = Object.fromEntries((await host.tools()).map((tool) => [tool.name.replace("agent_browser_", ""), tool]));
  return { host, tools, messages, order, result, client };
}

test("pointer moves and announces before the action; arguments and result stay unchanged; all viewers receive it", async (t) => {
  const { host, tools, messages, order, result } = await fixture(t);
  const other = [];
  host.sockets.clients.add({ readyState: 1, send: (data) => other.push(JSON.parse(data)) });
  const args = { selector: "@e1" };
  host.run = async (command, options) => {
    assert.deepEqual(command, ["--json", "get", "box", "@e1"]);
    assert.equal(options.timeout, 250);
    return JSON.stringify({ success: true, data: { box: { x: 10, y: 20, width: 40, height: 60 } } });
  };
  assert.deepEqual(await tools.click.execute(args), { output: result.content, isError: false });
  assert.deepEqual(order, ["move", "click", { name: "agent_browser_click", args }]);
  assert.deepEqual(other, messages);
  for (const message of messages) {
    assert.equal(typeof message.at, "number");
    assert.deepEqual(message.viewport, { width: 1280, height: 720 });
    assert.equal(message.x, 30);
    assert.equal(message.y, 50);
  }
  assert.deepEqual(messages.map(({ at, ...message }) => message), [
    { type: "pointer", phase: "move", x: 30, y: 50, viewport: { width: 1280, height: 720 } },
    { type: "pointer", phase: "click", x: 30, y: 50, by: "agent", label: "Click", viewport: { width: 1280, height: 720 } },
  ]);
});

test("failed, invalid, and slow box lookups still run the action without an announcement", async (t) => {
  const { host, tools, messages, order, result } = await fixture(t);
  for (const lookup of [
    async () => { throw new Error("missing ref"); },
    async () => JSON.stringify({ success: true, data: { box: null } }),
    () => new Promise(() => {}),
  ]) {
    host.run = lookup;
    const start = performance.now();
    assert.deepEqual(await tools.click.execute({ selector: "#missing" }), { output: result.content, isError: false });
    assert.ok(performance.now() - start < 300, "box lookup must stop waiting before 300 ms");
  }
  assert.equal(order.length, 3);
  assert.deepEqual(messages, []);
});

