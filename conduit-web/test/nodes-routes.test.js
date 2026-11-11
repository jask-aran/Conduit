import test from "node:test";
import assert from "node:assert/strict";
import { directAddresses } from "../src/nodes/direct.js";
import { isNodeAddress, isTailnetOrLoopback } from "../src/nodes/node-hub.js";
import { LOOPBACK_HOST, PRIVATE_HOST } from "../src/network-hosts.js";
import { nodeFixture } from "./helpers/nodes-fixture.js";

// Local/private peers, never public peers.
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

// 100.64/10 is not proof of a Tailscale adapter.
test("tailnet peers are recognised but direct routes require the Tailscale adapter", () => {
  const address = "100.80.2.3";
  assert.equal(isTailnetOrLoopback(address), true);
  assert.equal(isTailnetOrLoopback("fd7a:115c:a1e0::123"), true);
  assert.equal(isTailnetOrLoopback("203.0.113.2"), false);
  const nic = { address, family: "IPv4", internal: false };
  assert.deepEqual(directAddresses({ ethernet: [nic] }), []);
  assert.deepEqual(directAddresses({ tailscale0: [nic] }), [{ address, reach: "tailnet" }]);
});

// https anywhere; plain http only on loopback or a LAN.
test("hub route updates keep safe local and TLS routes and discard public plain HTTP", { timeout: 700 }, async (t) => {
  const stored = Promise.withResolvers();
  const node = await nodeFixture(t, { onRoutes: stored.resolve });
  const safe = ["http://127.0.0.1:4310", "http://192.168.2.3:4310", "https://fixture.ts.net"];
  node.send({ type: "routes", routes: [...safe, "http://203.0.113.2", "file:///tmp/hub", "https://fixture.ts.net/other"] });
  assert.deepEqual((await stored.promise).routes, safe);
});
