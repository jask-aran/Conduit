import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import tls from "node:tls";
import { attestLeaf, issueLeafCertificate, leafFingerprint, ServerLeaf, verifyLeafAttestation } from "../src/server-tls.js";

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

test("a stored leaf is reused, and replaced when the addresses change", async () => {
  const file = await temporaryFile();
  const store = new ServerLeaf(file);
  const first = await store.ensure({ commonName: "Conduit test", hosts: ["127.0.0.1", "192.168.0.128"] });

  // A client pins the key it was attested, so a restart that mints a new one
  // asks every paired client to re-check, every boot.
  const reopened = await new ServerLeaf(file).ensure({ commonName: "Conduit test", hosts: ["192.168.0.128", "127.0.0.1"] });
  assert.ok(reopened.spki.equals(first.spki), "the same addresses in another order are the same addresses");

  const moved = await new ServerLeaf(file).ensure({ commonName: "Conduit test", hosts: ["127.0.0.1", "10.0.0.4"] });
  assert.ok(!moved.spki.equals(first.spki), "a leaf that does not name the address it is reached on is refused before our code sees it");
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test("a leaf near its expiry is replaced before it stops working", async () => {
  const file = await temporaryFile();
  const hosts = ["127.0.0.1"];
  const first = await new ServerLeaf(file).ensure({ commonName: "Conduit test", hosts });
  const later = new ServerLeaf(file, { now: () => first.notAfter - 24 * 60 * 60 * 1000 });
  const renewed = await later.ensure({ commonName: "Conduit test", hosts });
  assert.ok(!renewed.spki.equals(first.spki));
});
