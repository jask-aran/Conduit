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
