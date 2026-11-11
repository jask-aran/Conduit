import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import tls from "node:tls";
import { attestLeaf, embeddedAttestation, issueLeafCertificate, leafFingerprint, ServerLeaf, verifyLeafAttestation } from "../src/server-tls.js";

const temporaryFile = async () => path.join(await fs.mkdtemp(path.join(os.tmpdir(), "conduit-leaf-")), "leaf.json");
const identityKeys = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return { privateKey, publicKey };
};

test("an attestation says this leaf is that identity's, and refuses one that is not", () => {
  const identity = identityKeys();
  const stranger = identityKeys();
  const id = crypto.randomBytes(16).toString("hex");
  const leaf = issueLeafCertificate({ commonName: "Conduit test", hosts: ["127.0.0.1"] });
  const other = issueLeafCertificate({ commonName: "Conduit test", hosts: ["127.0.0.1"] });
  const attestation = attestLeaf(id, leaf.spki, identity.privateKey);

  assert.ok(verifyLeafAttestation(id, leaf.spki, attestation, identity.publicKey));

  // Each of these is the relay this exists to stop, one substitution at a time.
  assert.equal(verifyLeafAttestation(id, other.spki, attestation, identity.publicKey), false, "a different leaf cannot borrow an attestation");
  assert.equal(verifyLeafAttestation(id, leaf.spki, attestation, stranger.publicKey), false, "another identity's key cannot vouch for it");
  assert.equal(verifyLeafAttestation(crypto.randomBytes(16).toString("hex"), leaf.spki, attestation, identity.publicKey), false, "the attestation names the server it is for");
  assert.equal(verifyLeafAttestation(id, leaf.spki, "not base64 at all", identity.publicKey), false);
  assert.ok(leafFingerprint(leaf.spki).length === 32);
});

const attested = (id, keys) => ({ identityId: id, attest: (spki) => attestLeaf(id, spki, keys.privateKey) });

test("a stored leaf is kept across restarts and address changes", async () => {
  const file = await temporaryFile();
  const identity = identityKeys();
  const id = crypto.randomBytes(16).toString("hex");
  const first = await new ServerLeaf(file).ensure({ commonName: "Conduit test", hosts: ["127.0.0.1", "192.168.0.128"], ...attested(id, identity) });

  // Trust comes from the attestation, not the names, so a laptop moving
  // networks keeps the leaf every paired client already accepts.
  const moved = await new ServerLeaf(file).ensure({ commonName: "Conduit test", hosts: ["127.0.0.1", "10.0.0.4"], ...attested(id, identity) });
  assert.ok(moved.spki.equals(first.spki));
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);

  const other = crypto.randomBytes(16).toString("hex");
  const reissued = await new ServerLeaf(file).ensure({ commonName: "Conduit test", hosts: ["127.0.0.1"], ...attested(other, identity) });
  assert.ok(!reissued.spki.equals(first.spki));
});

test("one port answers both plain HTTP and TLS, and the TLS leaf carries the attestation", async (t) => {
  const { startConduitHarness } = await import("./helpers/conduit-harness.js");
  const harness = await startConduitHarness();
  t.after(() => harness.stop());
  const { hostname, port } = new URL(harness.origin);

  assert.equal((await fetch(`${harness.origin}/healthz`)).status, 200);
  const { status, certificate } = await new Promise((resolve, reject) => {
    const socket = tls.connect({ host: hostname, port: Number(port), rejectUnauthorized: false }, () => {
      const peer = socket.getPeerX509Certificate();
      socket.write(`GET /healthz HTTP/1.1\r\nHost: ${hostname}\r\nConnection: close\r\n\r\n`);
      let body = "";
      socket.on("data", (chunk) => { body += chunk; });
      socket.on("end", () => resolve({ status: Number(body.split(" ")[1]), certificate: peer }));
    });
    socket.on("error", reject);
  });
  assert.equal(status, 200);
  assert.ok(embeddedAttestation(certificate.raw));
});

test("a leaf near its expiry is replaced before it stops working", async () => {
  const file = await temporaryFile();
  const options = { commonName: "Conduit test", hosts: ["127.0.0.1"], ...attested("a".repeat(32), identityKeys()) };
  const first = await new ServerLeaf(file).ensure(options);
  const later = new ServerLeaf(file, { now: () => first.notAfter - 24 * 60 * 60 * 1000 });
  const renewed = await later.ensure(options);
  assert.ok(!renewed.spki.equals(first.spki));
});
