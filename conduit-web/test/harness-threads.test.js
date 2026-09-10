import test from "node:test";
import assert from "node:assert/strict";
import { displayPath, groupThreadsByFolder, trackedByThread } from "../src/harness-threads.js";

const home = "/home/tester";

test("renders paths relative to home without mangling siblings", () => {
  assert.equal(displayPath("/home/tester", home), "~");
  assert.equal(displayPath("/home/tester/Conduit", home), "~/Conduit");
  assert.equal(displayPath("/home/tester-other/Conduit", home), "/home/tester-other/Conduit");
  assert.equal(displayPath("/srv/build", home), "/srv/build");
});

test("groups threads by folder, newest folder first", () => {
  const groups = groupThreadsByFolder([
    { id: "a", cwd: "/home/tester/old", updatedAt: 10 },
    { id: "b", cwd: "/home/tester/new", updatedAt: 90 },
    { id: "c", cwd: "/home/tester/old", updatedAt: 50 },
  ], { home });
  assert.deepEqual(groups.map((group) => group.path), ["/home/tester/new", "/home/tester/old"]);
  assert.deepEqual(groups[1].threads.map((thread) => thread.id), ["c", "a"]);
  assert.equal(groups[1].updatedAt, 50);
  assert.equal(groups[0].display, "~/new");
});

test("falls back to creation time when a thread has never been updated", () => {
  const groups = groupThreadsByFolder([
    { id: "a", cwd: "/w", createdAt: 5 },
    { id: "b", cwd: "/w", createdAt: 9 },
  ], { home });
  assert.deepEqual(groups[0].threads.map((thread) => thread.id), ["b", "a"]);
  assert.equal(groups[0].updatedAt, 9);
});

test("badges adopted threads in place instead of listing them twice", () => {
  const tracked = trackedByThread([
    { id: "chat-1", backend: { implementation: "codex", opaqueSession: "b" } },
    { id: "chat-2", backend: { implementation: "codex", opaqueSession: { threadId: "c" } } },
    { id: "chat-3", backend: { implementation: "chatgpt-web", opaqueSession: "a" } },
  ], "codex");
  const [group] = groupThreadsByFolder([
    { id: "a", cwd: "/w", updatedAt: 3 },
    { id: "b", cwd: "/w", updatedAt: 2 },
    { id: "c", cwd: "/w", updatedAt: 1 },
  ], { tracked, home });
  assert.deepEqual(group.threads.map((thread) => [thread.id, thread.tracked, thread.chatId]), [
    ["a", false, null],
    ["b", true, "chat-1"],
    ["c", true, "chat-2"],
  ]);
});

test("carries repository identity onto the folder header", () => {
  const [group] = groupThreadsByFolder([
    { id: "a", cwd: "/w", updatedAt: 2, branch: "main", originUrl: "https://example.test/repo.git" },
  ], { home });
  assert.deepEqual(group.repository, { branch: "main", originUrl: "https://example.test/repo.git" });
});

test("skips threads a harness reports without an id or working directory", () => {
  assert.deepEqual(groupThreadsByFolder([
    { id: "a" },
    { cwd: "/w" },
    null,
  ], { home }), []);
});
