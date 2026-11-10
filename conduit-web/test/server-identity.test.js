import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ServerIdentity } from "../src/server-identity.js";

const temporaryFile = async () => path.join(await fs.mkdtemp(path.join(os.tmpdir(), "conduit-identity-")), "identity.json");

test("a server keeps the same identity and key across restarts", async () => {
  const file = await temporaryFile();
  const first = await new ServerIdentity(file, { port: 4310, name: "Home workstation" }).load();
  const second = await new ServerIdentity(file, { port: 4310 }).load();
  assert.match(first.id, /^[0-9a-f]{32}$/);
  assert.equal(second.id, first.id, "two addresses cannot be recognised as one server if the id moves");
  assert.equal(second.publicKeyValue(), first.publicKeyValue(), "a client that paired once can still check it");

  assert.equal(second.name, "Home workstation");
  assert.equal(second.describe().name, "Home workstation");
  // The configured name only seeds: a saved name, renamed from a client, wins.
  assert.equal(await second.rename("Development"), true);
  const renamed = await new ServerIdentity(file, { name: "Home workstation" }).load();
  assert.equal(renamed.describe().name, "Development");
  assert.equal(await renamed.rename("\u0007"), false, "a control character is not a name");
  assert.equal(renamed.id, first.id, "renaming does not change identity");
  assert.equal(renamed.publicKeyValue(), first.publicKeyValue(), "renaming preserves pairing");

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
