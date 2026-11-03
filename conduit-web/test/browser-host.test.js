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

test("selector tools, drag endpoints, coordinate mouse tools, and page scroll", async (t) => {
  const names = ["dblclick", "hover", "fill", "type", "check", "uncheck", "select", "drag", "mouse_move", "mouse_down", "mouse_up", "mouse_wheel", "scroll"];
  const { host, tools, messages, order } = await fixture(t, names);
  for (const name of names.slice(0, 7)) {
    await tools[name].execute({ selector: "@e1" });
    assert.equal(messages.at(-1).phase, name === "hover" ? "move" : ["fill", "type"].includes(name) ? "type" : "click");
  }
  messages.length = order.length = 0;
  host.run = async (command) => JSON.stringify({ success: true, data: { box: {
    x: command.at(-1) === "@source" ? 10 : 100, y: 20, width: 40, height: 60,
  } } });
  await tools.drag.execute({ source: "@source", target: "@target" });
  assert.deepEqual(order.map((item) => typeof item === "string" ? item : "action"), ["move", "down", "action", "move", "up"]);
  assert.deepEqual(messages.map(({ x, y }) => [x, y]), [[30, 50], [30, 50], [120, 50], [120, 50]]);
  messages.length = 0;
  await tools.mouse_move.execute({ x: 200, y: 300 });
  for (const name of ["mouse_down", "mouse_up", "mouse_wheel"]) await tools[name].execute({});
  assert.deepEqual(messages.map(({ phase }) => phase), ["move", "move", "down", "move", "up", "move", "scroll"]);
  assert.ok(messages.every(({ x, y }) => x === 200 && y === 300));
  await tools.scroll.execute({ direction: "down" });
  assert.deepEqual([messages.at(-1).x, messages.at(-1).y], [640, 360]);
  await tools.scroll.execute({ selector: "#panel" });
  assert.deepEqual([messages.at(-1).x, messages.at(-1).y], [120, 50]);
});

test("pane mouse input produces no agent announcements; other sessions bypass the wrapper", async (t) => {
  const { host, tools, messages, client } = await fixture(t);
  host.start = () => new Promise(() => {});
  host.sockets.handleUpgrade = (_request, _socket, _head, connected) => connected(client);
  host.handleUpgrade("hub", { url: "/v0/browsers/hub/stream" }, {}, Buffer.alloc(0));
  messages.length = 0; // The initial codec announcement is unrelated to input.
  client.emit("message", Buffer.from(JSON.stringify({ type: "input_mouse", eventType: "mouseMoved", x: 70, y: 80 })), false);
  assert.deepEqual(messages, []);
  assert.deepEqual(host.pointer, { x: 70, y: 80 });
  await tools.click.execute({ selector: "@e1", session: "other-session" });
  assert.deepEqual(messages, []);
});
