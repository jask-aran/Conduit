import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverSessions, findSession, sessionIdFor } from "../src/session-store.js";

test("session IDs are stable and path-derived", () => {
  assert.equal(sessionIdFor("/tmp/a.jsonl"), sessionIdFor("/tmp/a.jsonl"));
  assert.notEqual(sessionIdFor("/tmp/a.jsonl"), sessionIdFor("/tmp/b.jsonl"));
});

test("discovers nested Pi JSONL sessions and resolves only stable IDs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-test-"));
  await fs.mkdir(path.join(root, "project"));
  const file = path.join(root, "project", "session.jsonl");
  await fs.writeFile(file, "{}\n");
  const sessions = await discoverSessions(root);
  assert.equal(sessions.length, 1);
  assert.equal((await findSession(root, sessions[0].id)).file, file);
  assert.equal(await findSession(root, "../../etc/passwd"), null);
  await fs.rm(root, { recursive: true, force: true });
});

