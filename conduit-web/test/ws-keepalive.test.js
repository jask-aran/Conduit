import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { startWebSocketKeepalive } from "../src/server/ws-keepalive.js";

class FakeSocket extends EventEmitter {
  constructor(readyState = 1) {
    super();
    this.OPEN = 1;
    this.readyState = readyState;
    this.pings = 0;
  }
  ping() { this.pings += 1; }
}

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("pings an open socket so an idle connection keeps carrying frames", async () => {
  const ws = new FakeSocket();
  const stop = startWebSocketKeepalive(ws, 5);
  await tick(26);
  stop();
  assert.ok(ws.pings >= 3, `expected repeated pings, saw ${ws.pings}`);
});

test("stops pinging once the socket closes", async () => {
  const ws = new FakeSocket();
  startWebSocketKeepalive(ws, 5);
  await tick(26);
  const sent = ws.pings;
  ws.readyState = 3;
  ws.emit("close");
  await tick(26);
  assert.equal(ws.pings, sent);
});

test("skips a socket that is not open yet and survives a ping that throws", async () => {
  const connecting = new FakeSocket(0);
  startWebSocketKeepalive(connecting, 5);
  await tick(26);
  assert.equal(connecting.pings, 0);

  const failing = new FakeSocket();
  failing.ping = () => { throw new Error("socket went away"); };
  const stop = startWebSocketKeepalive(failing, 5);
  await tick(26);
  stop();
});
