import assert from "node:assert/strict";
import test from "node:test";
import { projectBackendSessions } from "../src/server/routes/chats.js";

test("backend discovery excludes every session that already has a transcript owner", () => {
  const backend = (threadId) => ({ implementation: "codex", opaqueSession: { threadId } });
  const chats = [
    { id: "chat-a", projectId: "project-a", status: "active", title: "A", backend: backend("thread-a") },
    { id: "chat-b", projectId: "project-b", status: "active", title: "B", backend: backend("thread-b") },
    { id: "pi", projectId: "project-a", status: "active", title: "Pi", backend: { implementation: "conduit_pi" } },
  ];
  const sessions = [{ id: "thread-a" }, { id: "thread-b" }, { id: "thread-c" }];
  const result = projectBackendSessions({ chats, sessions, projectId: "project-a", implementation: "codex" });
  assert.deepEqual(result.tracked.map((chat) => chat.id), ["chat-a"]);
  assert.deepEqual(result.adoptable.map((session) => session.id), ["thread-c"]);
});
