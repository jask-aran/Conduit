import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import tls from "node:tls";
import { once } from "node:events";
import { attestedLeaf } from "../src/nodes/find-hub.js";
import { attestLeaf, issueLeafCertificate } from "../src/server-tls.js";
import { nodeFixture } from "./helpers/nodes-fixture.js";

const identity = () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  return { id: crypto.randomUUID(), key: keys.publicKey.export({ type: "spki", format: "der" }).toString("base64"), privateKey: keys.privateKey };
};
const publicIdentity = ({ id, key }) => ({ id, key });

// find-hub.js attestedLeaf: a candidate counts only if the kept identity attested its leaf.
test("a pinned hub is accepted and another identity at the same address and name is refused", { timeout: 700 }, async (t) => {
  const hub = identity();
  const stranger = identity();
  const leaf = (owner) => issueLeafCertificate({ commonName: "same-hub", hosts: ["127.0.0.1"],
    attest: (spki) => attestLeaf(owner.id, spki, owner.privateKey) });
  const accepted = leaf(hub);
  const rejected = leaf(stranger);
  const server = tls.createServer({ cert: accepted.certificate, key: accepted.privateKey }, (socket) => socket.end());
  t.after(() => new Promise((resolve) => server.close(resolve)));
  server.on("tlsClientError", () => {});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  assert.equal(await attestedLeaf("127.0.0.1", port, publicIdentity(hub), 50), accepted.certificate);
  server.setSecureContext({ cert: rejected.certificate, key: rejected.privateKey });
  assert.equal(await attestedLeaf("127.0.0.1", port, publicIdentity(hub), 50), null);
});

// BUG: node-agent.js replaces the kept identity without checking it against the pin.
test("an existing pairing refuses a replacement hub identity", { todo: "routes.hub overwrites the saved identity without a comparison" }, async (t) => {
  const hub = publicIdentity(identity());
  const stored = Promise.withResolvers();
  const node = await nodeFixture(t, { hub, onRoutes: stored.resolve });
  node.send({ type: "routes", routes: [], hub: publicIdentity(identity()) });
  assert.deepEqual((await stored.promise).hub, hub);
});
