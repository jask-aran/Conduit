import test from "node:test";
import assert from "node:assert/strict";
import { signGrant, verifyGrant, keySecret, DIRECT_TTL_MS, DIRECT_PTY_TTL_MS,
  channelKey, nodeChannel, sealFrame, openFrame, SEAL_TO_NODE, SEAL_TO_CLIENT } from "../src/nodes/direct.js";

const now = 1000;
const secret = keySecret("fixture-node-key");
const readGrant = () => ({ place: { root: "fixture-root", path: "project" }, read: true, expires: now + DIRECT_TTL_MS });

// A token is accepted only by the node whose secret signed it.
test("a direct grant does not verify under another node key", () => {
  const grant = readGrant();
  const token = signGrant(secret, grant);
  assert.deepEqual(verifyGrant(secret, token, now), grant);
  assert.equal(verifyGrant(keySecret("different-node-key"), token, now), null);
});

// An expired or malformed token is refused.
test("direct grants expire at their deadline and malformed tokens are refused", () => {
  const grant = readGrant();
  const token = signGrant(secret, grant);
  assert.deepEqual(verifyGrant(secret, token, grant.expires - 1), grant);
  assert.equal(verifyGrant(secret, token, grant.expires), null);
  for (const malformed of [null, "", "not-a-token", `${token}.extra`, signGrant(secret, "not a grant")]) {
    assert.equal(verifyGrant(secret, malformed, now), null);
  }
});

// Neither kind of grant passes for the other.
test("a read grant cannot attach a terminal and a terminal grant cannot read files", () => {
  const read = readGrant();
  const pty = { pty: "fixture-terminal", nonce: "fixture-nonce", expires: now + DIRECT_PTY_TTL_MS };
  assert.deepEqual(verifyGrant(secret, signGrant(secret, pty), now, "pty"), pty);
  assert.equal(verifyGrant(secret, signGrant(secret, read), now, "pty"), null);
  assert.equal(verifyGrant(secret, signGrant(secret, pty), now, "read"), null);
});

// Direction and frame count prevent moving or replaying a frame.
test("a sealed terminal frame opens once and only in its intended direction", () => {
  const key = channelKey(secret, "fixture-nonce");
  const raw = Buffer.from(key, "base64url");
  const channel = nodeChannel(key);
  const kind = 7;
  const body = Buffer.from("fixture terminal input");
  const frame = sealFrame(raw, SEAL_TO_NODE, 0, kind, body);
  assert.deepEqual(channel.open(frame), { kind, body });
  assert.equal(channel.open(frame), null);
  assert.equal(channel.open(sealFrame(raw, SEAL_TO_CLIENT, 1, kind, body)), null);
  assert.deepEqual(openFrame(raw, SEAL_TO_CLIENT, 0, channel.seal(kind, body)), { kind, body });
});
