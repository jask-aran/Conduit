import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { startConduitHarness } from "./helpers/conduit-harness.js";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
}

function messageQueue(socket) {
  const queued = [];
  const waiting = [];
  socket.on("message", (data) => {
    const event = JSON.parse(String(data));
    const match = waiting.findIndex((item) => item.predicate(event));
    if (match >= 0) waiting.splice(match, 1)[0].resolve(event);
    else queued.push(event);
  });
  return (predicate, timeoutMs = 3_000) => {
    const existing = queued.findIndex(predicate);
    if (existing >= 0) return Promise.resolve(queued.splice(existing, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for dictation event")), timeoutMs);
      waiting.push({ predicate, resolve: (event) => { clearTimeout(timer); resolve(event); } });
    });
  };
}

test("authenticated Conduit dictation bridge forwards PCM, auth, explicit stop, and deadline metadata", async () => {
  const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await listen(upstream);
  const port = upstream.address().port;
  let authorization = null;
  let binaryBytes = 0;
  let stopCommand = null;
  upstream.on("connection", (socket, request) => {
    authorization = request.headers.authorization;
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        binaryBytes += data.length;
        socket.send(JSON.stringify({ type: "partial", text: "hello wor" }));
        return;
      }
      stopCommand = JSON.parse(String(data));
      socket.send(JSON.stringify({ type: "final", text: "hello world" }));
    });
  });
  const server = await startConduitHarness({ env: {
    CONDUIT_PARAKEET_STREAM_URL: `ws://127.0.0.1:${port}/ws`,
    CONDUIT_PARAKEET_API_KEY: "bridge-secret",
  } });
  const client = new WebSocket(`${server.origin.replace("http", "ws")}/v0/dictation/stream`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    assert.equal((await next((event) => event.type === "ready")).sampleRate, 16_000);
    client.send(Buffer.alloc(640), { binary: true });
    assert.equal((await next((event) => event.type === "partial")).text, "hello wor");
    client.send(JSON.stringify({ type: "stop" }));
    assert.equal((await next((event) => event.type === "final")).text, "hello world");
    const completed = await next((event) => event.type === "completed");
    assert.equal(completed.text, "hello world");
    assert.equal(completed.final, true);
    assert.equal(completed.finalWithinDeadline, true);
    assert.ok(completed.settlementMs >= 0 && completed.settlementMs <= 1_000);
    assert.equal(authorization, "Bearer bridge-secret");
    assert.equal(binaryBytes, 640);
    assert.deepEqual(stopCommand, { type: "stop" });
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    for (const socket of upstream.clients) socket.terminate();
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await server.stop();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
