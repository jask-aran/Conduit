import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverSessions, findSession, messagesFromEntries, sessionIdFor } from "../src/session-store.js";

test("session IDs prefer Pi's native ID and otherwise remain stable", () => {
  assert.equal(sessionIdFor("/tmp/a.jsonl", "native-123"), "native-123");
  assert.equal(sessionIdFor("/tmp/a.jsonl"), sessionIdFor("/tmp/a.jsonl"));
  assert.notEqual(sessionIdFor("/tmp/a.jsonl"), sessionIdFor("/tmp/b.jsonl"));
});

test("discovers project Pi JSONL sessions and rejects path-like public IDs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-session-test-"));
  const sessionsDir = path.join(root, ".conduit/sessions");
  await fs.mkdir(sessionsDir, { recursive: true });
  const file = path.join(sessionsDir, "session.jsonl");
  await fs.writeFile(file, [
    JSON.stringify({ type: "session", id: "session-native-1", timestamp: "2026-01-01T00:00:00Z", cwd: root }),
    JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "Hello Pi" }] } }),
  ].join("\n"));
  const projects = [{ id: "project_chat", slug: "chat", path: root, sessionsDir }];
  const sessions = await discoverSessions(projects);
  assert.equal(sessions[0].title, "Hello Pi");
  assert.equal((await findSession(projects, sessions[0].id)).file, file);
  assert.equal(await findSession(projects, "../../etc/passwd"), null);
  assert.equal(messagesFromEntries(sessions[0].entries)[0].content, "Hello Pi");
  await fs.rm(root, { recursive: true, force: true });
});
