import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { serializeAttachmentEnvelope } from "../src/attachment-envelope.js";
import { CONTINUE_PROMPT } from "../src/continuation.js";
import { discoverSessions, duplicateSession, findSession, messagesFromEntries, moveSession, moveSessions, pageSessionEntries, removeSession, renameSession, sessionDirectoryFor, sessionIdFor, settingsFromEntries, toolsFromEntries, transcriptFromEntries } from "../src/session-store.js";

test("session IDs prefer Pi's native ID and otherwise remain stable", () => {
  assert.equal(sessionIdFor("/tmp/a.jsonl", "native-123"), "native-123");
  assert.equal(sessionIdFor("/tmp/a.jsonl"), sessionIdFor("/tmp/a.jsonl"));
  assert.notEqual(sessionIdFor("/tmp/a.jsonl"), sessionIdFor("/tmp/b.jsonl"));
});

test("restores completed tool calls from persisted messages", () => {
  const entries = [{
    type: "message",
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id: "call_1", name: "write", arguments: { path: "note.md" } }],
    },
  }, {
    type: "message",
    timestamp: "2026-01-01T00:00:01.250Z",
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
    status: "done",
    result: "Successfully wrote note.md",
    timestamp: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.250Z",
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

test("presents attachment labels separately and merges hidden continuation turns", () => {
  const envelope = serializeAttachmentEnvelope({
    chatId: "550e8400-e29b-41d4-a716-446655440099",
    attachments: [{ id: "550e8400-e29b-41d4-a716-446655440000", name: "note.txt", storedName: "550e8400-e29b-41d4-a716-446655440000--note.txt" }],
    message: "Summarise this",
  });
  const messages = messagesFromEntries([
    { type: "message", id: "user", message: { role: "user", content: envelope } },
    { type: "message", id: "partial", message: { role: "assistant", content: "Part one", stopReason: "aborted" } },
    { type: "message", id: "hidden", message: { role: "user", content: CONTINUE_PROMPT } },
    { type: "message", id: "tool-call", message: { role: "assistant", content: [{ type: "toolCall", id: "call", name: "read", arguments: {} }] } },
    { type: "message", id: "tool-result", message: { role: "toolResult", toolCallId: "call", content: "context" } },
    { type: "message", id: "continued", message: { role: "assistant", content: "Part one and two", stopReason: "stop" } },
  ]);
  assert.equal(messages.filter((message) => message.role !== "toolResult").length, 2);
  assert.equal(messages[0].content, "Summarise this");
  assert.equal(messages[0].attachments[0].name, "note.txt");
  assert.equal(messages[1].content, "Part one and two");
  assert.equal(messages[1].continued, true);
  assert.equal(messages[1].stopped, false);
});

test("pages complete recent turns with a character soft limit", () => {
  const entries = Array.from({ length: 12 }, (_, index) => ([
    { type: "message", message: { role: "user", content: `Question ${index}` } },
    { type: "message", message: { role: "assistant", content: `Answer ${index}` } },
  ])).flat();
  const latest = pageSessionEntries(entries, { turnLimit: 10, characterLimit: 50_000 });
  assert.equal(latest.entries.length, 20);
  assert.equal(latest.start, 4);
  assert.equal(latest.hasMore, true);
  const older = pageSessionEntries(entries, { before: latest.start, turnLimit: 10, characterLimit: 50_000 });
  assert.equal(older.entries.length, 4);
  assert.equal(older.hasMore, false);

  const oversized = pageSessionEntries(entries, { turnLimit: 10, characterLimit: 5 });
  assert.equal(oversized.entries.length, 2, "the latest complete turn is retained even above the soft limit");

  const continued = pageSessionEntries([
    { type: "message", message: { role: "user", content: "Question" } },
    { type: "message", message: { role: "assistant", content: "Part", stopReason: "aborted" } },
    { type: "message", message: { role: "user", content: CONTINUE_PROMPT } },
    { type: "message", message: { role: "assistant", content: "Finish" } },
  ], { turnLimit: 1 });
  assert.equal(continued.start, 0);
  assert.equal(continued.entries.length, 4);
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

test("discoverSessions keeps creation order after rename updates mtime", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-session-order-test-"));
  const projectPath = path.join(root, "project");
  const sessionsDir = sessionDirectoryFor(projectPath, path.join(root, "pi"));
  const project = { id: "project_order", slug: "order", path: projectPath, sessionsDir };
  await fs.mkdir(sessionsDir, { recursive: true });
  const older = path.join(sessionsDir, "older.jsonl");
  const newer = path.join(sessionsDir, "newer.jsonl");
  await fs.writeFile(older, [
    JSON.stringify({ type: "session", version: 3, id: "session-older", timestamp: "2026-01-01T00:00:00Z", cwd: projectPath }),
    JSON.stringify({ type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:01Z", message: { role: "user", content: [{ type: "text", text: "Older chat" }] } }),
  ].join("\n") + "\n");
  await fs.writeFile(newer, [
    JSON.stringify({ type: "session", version: 3, id: "session-newer", timestamp: "2026-02-01T00:00:00Z", cwd: projectPath }),
    JSON.stringify({ type: "message", id: "u2", parentId: null, timestamp: "2026-02-01T00:00:01Z", message: { role: "user", content: [{ type: "text", text: "Newer chat" }] } }),
  ].join("\n") + "\n");

  const before = await discoverSessions([project]);
  assert.deepEqual(before.map((session) => session.id), ["session-newer", "session-older"]);

  const renamed = await renameSession(before.find((session) => session.id === "session-older"), project, "Renamed older");
  assert.equal(renamed.title, "Renamed older");
  // Rename appends session_info and advances mtime-backed updatedAt.
  assert.ok(renamed.updatedAt >= before.find((session) => session.id === "session-older").updatedAt);

  const after = await discoverSessions([project]);
  assert.deepEqual(after.map((session) => session.id), ["session-newer", "session-older"]);
  assert.equal(after.find((session) => session.id === "session-older").title, "Renamed older");
  await fs.rm(root, { recursive: true, force: true });
});

test("renames, duplicates, and moves sessions through Pi's native session manager", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-session-mutation-test-"));
  const piAgentDir = path.join(root, "pi");
  const source = {
    id: "project_source",
    slug: "source",
    path: path.join(root, "source"),
    sessionsDir: sessionDirectoryFor(path.join(root, "source"), piAgentDir),
  };
  const target = {
    id: "project_target",
    slug: "target",
    path: path.join(root, "target"),
    sessionsDir: sessionDirectoryFor(path.join(root, "target"), piAgentDir),
  };
  await fs.mkdir(source.sessionsDir, { recursive: true });
  await fs.mkdir(target.sessionsDir, { recursive: true });
  const file = path.join(source.sessionsDir, "session.jsonl");
  await fs.writeFile(file, [
    JSON.stringify({ type: "session", version: 3, id: "session-source", timestamp: "2026-01-01T00:00:00Z", cwd: source.path }),
    JSON.stringify({ type: "message", id: "entry-user", parentId: null, timestamp: "2026-01-01T00:00:01Z", message: { role: "user", content: [{ type: "text", text: "Original question" }] } }),
    JSON.stringify({ type: "message", id: "entry-assistant", parentId: "entry-user", timestamp: "2026-01-01T00:00:02Z", message: { role: "assistant", content: [{ type: "text", text: "Original answer" }] } }),
  ].join("\n") + "\n");

  const session = (await discoverSessions([source]))[0];
  const renamed = await renameSession(session, source, "Research notes");
  assert.equal(renamed.title, "Research notes");

  const duplicate = await duplicateSession(renamed, source, "Research notes copy");
  assert.notEqual(duplicate.id, renamed.id);
  assert.equal(duplicate.title, "Research notes copy");
  assert.equal(duplicate.cwd, source.path);

  const moved = await moveSession(renamed, target);
  assert.notEqual(moved.id, renamed.id);
  assert.equal(moved.title, "Research notes");
  assert.equal(moved.cwd, target.path);
  await assert.rejects(fs.access(file), { code: "ENOENT" });
  assert.equal((await discoverSessions([target]))[0].id, moved.id);
  assert.equal(transcriptFromEntries(moved.entries), "## User\n\nOriginal question\n\n## Assistant\n\nOriginal answer");

  const bulkMoved = await moveSessions([duplicate], target);
  assert.equal(bulkMoved.length, 1);
  assert.equal(bulkMoved[0].title, "Research notes copy");
  await assert.rejects(fs.access(duplicate.file), { code: "ENOENT" });
  assert.equal((await discoverSessions([target])).length, 2);
  await fs.rm(root, { recursive: true, force: true });
});
