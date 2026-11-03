import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { directAddresses } from "../src/nodes/direct.js";
import { isNodeAddress, isTailnetOrLoopback } from "../src/nodes/node-hub.js";
import { LOOPBACK_HOST, PRIVATE_HOST } from "../src/network-hosts.js";
import { nodeFixture } from "./helpers/nodes-fixture.js";

// network-hosts.js and distributed nodes decision 4: local/private peers, never public peers.
test("loopback and private LAN peers are local while public peers are refused", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.2.3", "192.168.2.3"]) {
    assert.equal(isNodeAddress(address), true, address);
    assert.equal(LOOPBACK_HOST.test(address) || PRIVATE_HOST.test(address), true, address);
  }
  for (const address of ["203.0.113.2", "172.32.2.3", "192.169.2.3"]) {
    assert.equal(isNodeAddress(address), false, address);
    assert.equal(LOOPBACK_HOST.test(address) || PRIVATE_HOST.test(address), false, address);
  }
});

// Distributed nodes security review: 100.64/10 is not proof of a Tailscale adapter.
test("tailnet peers are recognised but direct routes require the Tailscale adapter", () => {
  const address = "100.80.2.3";
  assert.equal(isTailnetOrLoopback(address), true);
  assert.equal(isTailnetOrLoopback("fd7a:115c:a1e0::123"), true);
  assert.equal(isTailnetOrLoopback("203.0.113.2"), false);
  const nic = { address, family: "IPv4", internal: false };
  assert.deepEqual(directAddresses({ ethernet: [nic] }), []);
  assert.deepEqual(directAddresses({ tailscale0: [nic] }), [{ address, reach: "tailnet" }]);
});

// node-agent.js routes comment: https anywhere; plain http only on loopback or a LAN.
test("hub route updates keep safe local and TLS routes and discard public plain HTTP", { timeout: 700 }, async (t) => {
  const stored = Promise.withResolvers();
  const node = await nodeFixture(t, { onRoutes: stored.resolve });
  const safe = ["http://127.0.0.1:4310", "http://192.168.2.3:4310", "https://fixture.ts.net"];
  node.send({ type: "routes", routes: [...safe, "http://203.0.113.2", "file:///tmp/hub", "https://fixture.ts.net/other"] });
  assert.deepEqual((await stored.promise).routes, safe);
});

// node-agent.js connection comment: a failed attempt tries the next way at once.
test("a failed hub route does not block the next working route", { timeout: 700 }, async (t) => {
  const dialled = [];
  const connected = Promise.withResolvers();
  const working = new EventEmitter();
  working.readyState = 1;
  working.ping = () => working.emit("pong");
  working.send = (raw) => { if (JSON.parse(raw).type === "hello") connected.resolve(); };
  working.close = () => working.emit("close", 1000);
  const routes = ["http://127.0.0.1:1", "https://fixture.ts.net"];
  await nodeFixture(t, { mainUrl: routes[0], routes, dial: (url) => {
    dialled.push(url.origin);
    if (dialled.length === 1) {
      const refused = new EventEmitter();
      refused.close = () => {};
      queueMicrotask(() => refused.emit("close", 1006));
      return refused;
    }
    queueMicrotask(() => working.emit("open"));
    return working;
  } });
  await connected.promise;
  assert.deepEqual(dialled, ["ws://127.0.0.1:1", "wss://fixture.ts.net"]);
});

// direct-files.ts nearest: ask every address at once; take the nearest that proves its identity.
test("direct probes run together and a failed nearer route permits the working route", { timeout: 700 }, async (t) => {
  const { importClient } = await import("./helpers/client-module.js");
  const { proofOf } = await import("../src/nodes/direct.js");
  const location = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { configurable: true, value: { protocol: "http:", origin: "http://localhost" } });
  t.after(() => { if (location) Object.defineProperty(globalThis, "location", location); else delete globalThis.location; });
  const { directRoute } = await importClient('export { directRoute } from "../src/client/workspace/direct-files.ts";');
  const near = "http://127.0.0.1:1111";
  const far = "http://192.168.2.3:2222";
  const grant = { nodeId: "fixture-route-node", nonce: "fixture-nonce", proof: "fixture-proof",
    routes: [{ url: near, reach: "loopback" }, { url: far, reach: "private" }] };
  const nearer = Promise.withResolvers();
  const bothAsked = Promise.withResolvers();
  const asked = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    asked.push(url.origin);
    if (asked.length === grant.routes.length) bothAsked.resolve();
    if (url.origin === near) return nearer.promise;
    assert.equal(url.origin, far);
    return Response.json({ proof: proofOf(grant.proof, url.searchParams.get("c")) });
  });
  const selected = directRoute(grant);
  await bothAsked.promise;
  nearer.resolve(new Response(null, { status: 503 }));
  assert.equal(await selected, far);
  assert.deepEqual(new Set(asked), new Set(grant.routes.map((route) => route.url)));
});
