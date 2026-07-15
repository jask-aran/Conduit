import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverSessions, findSession, messagesFromEntries, removeSession, sessionDirectoryFor, sessionIdFor, settingsFromEntries, toolsFromEntries } from "../src/session-store.js";

test("session IDs prefer Pi's native ID and otherwise remain stable", () => {
  assert.equal(sessionIdFor("/tmp/a.jsonl", "native-123"), "native-123");
  assert.equal(sessionIdFor("/tmp/a.jsonl"), sessionIdFor("/tmp/a.jsonl"));
  assert.notEqual(sessionIdFor("/tmp/a.jsonl"), sessionIdFor("/tmp/b.jsonl"));
});

test("restores completed tool calls from persisted messages", () => {
  const entries = [{
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id: "call_1", name: "write", arguments: { path: "note.md" } }],
    },
  }, {
    type: "message",
    message: {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "write",
      content: [{ type: "text", text: "Successfully wrote note.md" }],
    },
  }];

  assert.deepEqual(toolsFromEntries(entries), [{
    id: "call_1",
    name: "write",
    args: { path: "note.md" },
    done: true,
    result: "Successfully wrote note.md",
    timestamp: null,
  }]);
});

test("restores the latest model and thinking level from a session", () => {
  const entries = [
    { type: "model_change", provider: "anthropic", modelId: "haiku" },
    { type: "thinking_level_change", thinkingLevel: "low" },
    { type: "message", message: { role: "assistant", provider: "openai-codex", model: "gpt-5.6-luna" } },
    { type: "thinking_level_change", thinkingLevel: "high" },
  ];

  assert.deepEqual(settingsFromEntries(entries), {
    model: "openai-codex/gpt-5.6-luna",
    thinkingLevel: "high",
  });
});

test("discovers cwd-matched sessions in Pi's native agent-home layout", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-session-test-"));
  const projectRoot = path.join(root, "data/chat/files/example");
  const sessionsDir = sessionDirectoryFor(projectRoot, path.join(root, "data/pi"));
  await fs.mkdir(sessionsDir, { recursive: true });
  const file = path.join(sessionsDir, "session.jsonl");
  await fs.writeFile(file, [
    JSON.stringify({ type: "session", id: "session-native-1", timestamp: "2026-01-01T00:00:00Z", cwd: projectRoot }),
    JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "Hello Pi" }] } }),
  ].join("\n"));
  const projects = [{ id: "project_example", slug: "example", path: projectRoot, sessionsDir }];
  const sessions = await discoverSessions(projects);
  assert.equal(sessions[0].title, "Hello Pi");
  assert.equal((await findSession(projects, sessions[0].id)).file, file);
  assert.equal(await findSession(projects, "../../etc/passwd"), null);
  assert.equal(messagesFromEntries(sessions[0].entries)[0].content, "Hello Pi");
  await fs.rm(root, { recursive: true, force: true });
});

test("filters cwd collisions from Pi's encoded session directories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-session-collision-test-"));
  const firstPath = path.join(root, "a-b/c");
  const secondPath = path.join(root, "a/b-c");
  const piAgentDir = path.join(root, "pi");
  const sessionsDir = sessionDirectoryFor(firstPath, piAgentDir);
  assert.equal(sessionsDir, sessionDirectoryFor(secondPath, piAgentDir));
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(path.join(sessionsDir, "first.jsonl"), `${JSON.stringify({ type: "session", id: "session-first", cwd: firstPath })}\n`);
  await fs.writeFile(path.join(sessionsDir, "second.jsonl"), `${JSON.stringify({ type: "session", id: "session-second", cwd: secondPath })}\n`);

  const projects = [{ id: "project_first", slug: "first", path: firstPath, sessionsDir }];
  const sessions = await discoverSessions(projects);
  assert.deepEqual(sessions.map((session) => session.id), ["session-first"]);
  await fs.rm(root, { recursive: true, force: true });
});

test("deletes a discovered native session file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-session-delete-test-"));
  const file = path.join(root, "session.jsonl");
  await fs.writeFile(file, "{}\n");
  await removeSession({ file });
  await assert.rejects(fs.access(file), { code: "ENOENT" });
  await fs.rm(root, { recursive: true, force: true });
});
