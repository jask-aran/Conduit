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

test("a leaf is a certificate a TLS stack will complete a handshake with", async () => {
  const leaf = issueLeafCertificate({ commonName: "Conduit test", hosts: ["127.0.0.1", "192.168.0.128"] });
  const parsed = new crypto.X509Certificate(leaf.certificate);

  assert.equal(parsed.subjectAltName, "IP Address:127.0.0.1, IP Address:192.168.0.128");
  assert.ok(parsed.verify(parsed.publicKey), "the certificate has to carry its own signature");
  assert.ok(parsed.publicKey.export({ format: "der", type: "spki" }).equals(leaf.spki));

  // The point of the whole exercise: a real stack, checking the address it
  // dialled against the names in the certificate, accepts it.
  const authorized = await new Promise((resolve, reject) => {
    const server = tls.createServer({ cert: leaf.certificate, key: leaf.privateKey }, (socket) => socket.end("ok"));
    server.listen(0, "127.0.0.1", () => {
      const socket = tls.connect({ port: server.address().port, host: "127.0.0.1", ca: [leaf.certificate] }, () => {
        const result = socket.authorized;
        socket.end();
        server.close(() => resolve(result));
      });
      socket.on("error", (error) => { server.close(); reject(error); });
    });
  });
  assert.equal(authorized, true);
});

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

test("a leaf carries its identity's attestation, so the certificate alone can be checked", () => {
  const identity = identityKeys();
  const id = crypto.randomBytes(16).toString("hex");
  const leaf = issueLeafCertificate({ commonName: "Conduit test", hosts: ["127.0.0.1"], ...attested(id, identity) });
  const parsed = new crypto.X509Certificate(leaf.certificate);
  assert.ok(parsed.verify(parsed.publicKey), "the extension is inside what the leaf signs");

  const carried = embeddedAttestation(leaf.certificate);
  assert.ok(verifyLeafAttestation(id, leaf.spki, carried, identity.publicKey));
  assert.equal(embeddedAttestation(issueLeafCertificate({ commonName: "Conduit test", hosts: ["127.0.0.1"] }).certificate), null);
});

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

  // A leaf another identity attested is not this server's.
  const other = crypto.randomBytes(16).toString("hex");
  const reissued = await new ServerLeaf(file).ensure({ commonName: "Conduit test", hosts: ["127.0.0.1"], ...attested(other, identity) });
  assert.ok(!reissued.spki.equals(first.spki));
});

test("a leaf without an embedded attestation is replaced", async () => {
  const file = await temporaryFile();
  const legacy = issueLeafCertificate({ commonName: "Conduit test", hosts: ["127.0.0.1"] });
  await fs.writeFile(file, JSON.stringify({ ...legacy, attestedBy: "x".repeat(32) }));
  const replaced = await new ServerLeaf(file).ensure({ commonName: "Conduit test", hosts: ["127.0.0.1"], ...attested("x".repeat(32), identityKeys()) });
  assert.ok(!replaced.spki.equals(legacy.spki));
  assert.ok(embeddedAttestation(replaced.certificate));
});

test("a leaf near its expiry is replaced before it stops working", async () => {
  const file = await temporaryFile();
  const options = { commonName: "Conduit test", hosts: ["127.0.0.1"], ...attested("a".repeat(32), identityKeys()) };
  const first = await new ServerLeaf(file).ensure(options);
  const later = new ServerLeaf(file, { now: () => first.notAfter - 24 * 60 * 60 * 1000 });
  const renewed = await later.ensure(options);
  assert.ok(!renewed.spki.equals(first.spki));
});
