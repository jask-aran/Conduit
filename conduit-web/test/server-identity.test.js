import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { localPaths, originOfRequest, ServerIdentity, scopeForHost } from "../src/server-identity.js";
import { issueLeafCertificate, verifyLeafAttestation } from "../src/server-tls.js";

const temporaryFile = async () => path.join(await fs.mkdtemp(path.join(os.tmpdir(), "conduit-identity-")), "identity.json");
const request = (headers, protocol = "http") => ({ headers, protocol });

test("a server keeps the same identity and key across restarts", async () => {
  const file = await temporaryFile();
  const first = await new ServerIdentity(file, { port: 4310 }).load();
  const second = await new ServerIdentity(file, { port: 4310 }).load();
  assert.match(first.id, /^[0-9a-f]{32}$/);
  assert.equal(second.id, first.id, "two addresses cannot be recognised as one server if the id moves");
  assert.equal(second.publicKeyValue(), first.publicKeyValue(), "a client that paired once can still check it");

  // The file holds the private half, so it is the owner's alone.
  const mode = (await fs.stat(file)).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("a proof answers the nonce it was given, and only this server can make one", async () => {
  const identity = await new ServerIdentity(await temporaryFile(), { port: 4310 }).load();
  const nonce = crypto.randomBytes(24).toString("base64url");
  const proof = identity.prove(nonce);

  assert.equal(proof.id, identity.id);
  assert.equal(proof.nonce, nonce, "a signature over a nonce nobody chose proves nothing about now");

  const key = crypto.createPublicKey({ key: Buffer.from(identity.publicKeyValue(), "base64"), format: "der", type: "spki" });
  const signed = (value) => Buffer.from(`${identity.id}.${value}`, "utf8");
  assert.equal(crypto.verify(null, signed(nonce), key, Buffer.from(proof.signature, "base64")), true);

  // The same signature is worthless for the next question.
  const other = crypto.randomBytes(24).toString("base64url");
  assert.equal(crypto.verify(null, signed(other), key, Buffer.from(proof.signature, "base64")), false);

  // Another server's answer does not pass for this one's.
  const stranger = await new ServerIdentity(await temporaryFile(), { port: 4310 }).load();
  const impostor = stranger.prove(nonce);
  assert.equal(crypto.verify(null, signed(nonce), key, Buffer.from(impostor.signature, "base64")), false);

  // Nonsense is refused rather than signed.
  for (const value of ["", "short", "x".repeat(200), "not base64url!!", null]) {
    assert.equal(identity.prove(value), null, String(value));
  }
});

test("a server offers the addresses it holds, and the ones it has answered on", async () => {
  const identity = await new ServerIdentity(await temporaryFile(), { port: 4310 }).load();

  // Loopback and the LAN are derived. Link-local is not: it is a private
  // address that almost never reaches anything, and would be a dead row in
  // every client's menu.
  const derived = localPaths(4310, {
    lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    eth0: [{ address: "192.168.0.128", family: "IPv4", internal: false }],
    eth1: [{ address: "169.254.83.107", family: "IPv4", internal: false }],
    wan: [{ address: "203.0.113.9", family: "IPv4", internal: false }],
    v6: [{ address: "fe80::1", family: "IPv6", internal: false }],
  });
  assert.deepEqual(derived, ["http://127.0.0.1:4310", "http://192.168.0.128:4310"]);

  // The public address cannot be worked out from the machine. It arrives by
  // being used: a client that got here through it proves it works by arriving.
  assert.equal(identity.paths().some((path) => path.scope === "public"), false);
  identity.observe(request({ host: "localconduit.jask-aran.com", "x-forwarded-proto": "https" }));
  assert.deepEqual(
    identity.paths().filter((path) => path.scope === "public").map((path) => path.origin),
    ["https://localconduit.jask-aran.com"],
  );

  // This machine's own view of itself adds nothing the interfaces did not.
  identity.observe(request({ host: "127.0.0.1:4310" }));
  assert.equal(identity.paths().filter((path) => path.origin === "http://127.0.0.1:4310").length, 1);

  // A Host header is written by whoever sends it, so a malformed one is
  // dropped rather than stored for every client to read.
  for (const host of ["", "evil.com/path", "a b", "<script>"]) {
    identity.observe(request({ host }));
    assert.equal(identity.paths().some((path) => path.origin.includes(host) && host), false, host);
  }

  assert.equal(scopeForHost("127.0.0.1"), "loopback");
  assert.equal(scopeForHost("localhost"), "loopback");
  assert.equal(scopeForHost("192.168.0.128"), "private");
  assert.equal(scopeForHost("conduit.example.com"), "public");
  assert.equal(originOfRequest(request({ host: "conduit.example.com" }, "https")), "https://conduit.example.com");
  assert.equal(originOfRequest(request({})), null);
});

test("an attested leaf is reported beside the paths, never among them", async () => {
  const identity = await new ServerIdentity(await temporaryFile(), { port: 4310 }).load();
  const leaf = issueLeafCertificate({ commonName: `Conduit ${identity.id}`, hosts: ["127.0.0.1"] });

  assert.equal(identity.describe().secure, undefined, "a server with no TLS listener claims none");

  identity.attestLeaf(leaf.spki, 4311);
  const described = identity.describe();
  assert.equal(described.secure.port, 4311);
  assert.ok(verifyLeafAttestation(identity.id, leaf.spki, described.secure.attestation, identity.publicKey));

  // No shell can pin a certificate yet, so an https origin in this list would
  // be a route every client refuses.
  assert.ok(described.paths.every((path) => path.origin.startsWith("http://")));
});
