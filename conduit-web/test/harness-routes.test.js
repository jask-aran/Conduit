import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { startConduitHarness } from "./helpers/conduit-harness.js";

test("an untracked thread runs as a chat no list shows, until it is tracked", async (t) => {
  const harness = await startConduitHarness();
  t.after(() => harness.stop());
  const project = await harness.createProject("Harness workspace");
  const listed = async () => (await (await harness.request("/v0/projects")).json()).projects
    .find((item) => item.id === project.id).sessions.map((chat) => chat.id);
  const before = await listed();
  const opened = await (await harness.request("/v0/harnesses/codex/threads/open", {
    method: "POST", body: JSON.stringify({ path: project.workingRoot, sessionId: "foreign-thread" }),
  })).json();
  assert.equal(opened.tracked, false);
  assert.equal(opened.chat.untracked, true);
  assert.equal(opened.chat.projectId, project.id);
  assert.deepEqual(await listed(), before);
  const sessions = await (await harness.request(`/v0/harnesses/codex/sessions?projectId=${project.id}`)).json();
  assert.deepEqual(sessions.tracked, [], "an untracked chat does not count as tracking the thread");
  const again = await (await harness.request("/v0/harnesses/codex/threads/open", {
    method: "POST", body: JSON.stringify({ path: project.workingRoot, sessionId: "foreign-thread" }),
  })).json();
  assert.equal(again.chat.id, opened.chat.id, "opening it again reuses its chat");
  const tracked = await (await harness.request(`/v0/chats/${opened.chat.id}/track`, {
    method: "POST", body: JSON.stringify({ projectId: project.id }),
  })).json();
  assert.equal(tracked.untracked, false);
  assert.deepEqual(await listed(), [opened.chat.id, ...before]);
  const mounted = await (await harness.request(`/v0/harnesses/codex/sessions?projectId=${project.id}`)).json();
  assert.equal(mounted.tracked.length, 1);
  assert.deepEqual(mounted.sessions, []);
});

test("thread discovery lists every folder the harness reports, not only workspaces", async (t) => {
  const elsewhere = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "conduit-elsewhere-")));
  t.after(() => fs.rm(elsewhere, { recursive: true, force: true }));
  const harness = await startConduitHarness({ env: { CONDUIT_TEST_ELSEWHERE: elsewhere } });
  t.after(() => harness.stop());
  const project = await harness.createProject("Discovery workspace");
  const discovered = await (await harness.request("/v0/harnesses/codex/threads")).json();
  assert.equal(discovered.scope, "machine");
  assert.ok(discovered.groups.length >= 2, "machine scope spans more than one folder");
  const folders = discovered.groups.map((group) => group.path);
  assert.ok(folders.includes(elsewhere), "a folder outside any workspace is listed");
  const newest = discovered.groups[0];
  assert.ok(newest.updatedAt >= discovered.groups[discovered.groups.length - 1].updatedAt, "folders are newest first");
  assert.equal(newest.threads.every((thread) => thread.tracked === false), true);

  const scoped = await (await harness.request(`/v0/harnesses/codex/threads?path=${encodeURIComponent(elsewhere)}`)).json();
  assert.equal(scoped.scope, "folder");
  assert.deepEqual(scoped.groups.map((group) => group.path), [elsewhere]);
  assert.deepEqual(scoped.groups[0].threads.map((thread) => thread.id), ["elsewhere-thread"]);
});

test("adopted threads are badged in place rather than listed twice", async (t) => {
  const harness = await startConduitHarness();
  t.after(() => harness.stop());
  const project = await harness.createProject("Adoption workspace");
  assert.equal((await harness.request(`/v0/projects/${project.id}/backend-sessions/foreign-thread/adopt`, { method: "POST" })).status, 201);
  const discovered = await (await harness.request("/v0/harnesses/codex/threads")).json();
  const threads = discovered.groups.flatMap((group) => group.threads);
  const adopted = threads.filter((thread) => thread.id === "foreign-thread");
  assert.equal(adopted.length, 1, "the thread appears once");
  assert.equal(adopted[0].tracked, true);
  assert.match(adopted[0].chatId, /.+/);
});

test("a thread can be started in any folder without registering a workspace", async (t) => {
  const harness = await startConduitHarness();
  t.after(() => harness.stop());
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-adhoc-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const before = (await (await harness.request("/v0/projects")).json()).projects.length;
  const started = await (await harness.request("/v0/harnesses/codex/threads/open", {
    method: "POST", body: JSON.stringify({ path: folder, newThread: true }),
  })).json();
  assert.match(started.chat.projectId, /^computer:/);
  assert.equal(started.chat.untracked, true);
  assert.equal((await (await harness.request("/v0/projects")).json()).projects.length, before, "no workspace was registered");
  assert.equal((await harness.request(`/v0/sessions/${started.chat.id}`, { method: "DELETE" })).status, 204);
});

test("opening a thread in an unknown folder is rejected before a chat is made", async (t) => {
  const harness = await startConduitHarness();
  t.after(() => harness.stop());
  const response = await harness.request("/v0/harnesses/codex/threads/open", {
    method: "POST", body: JSON.stringify({ path: "/definitely/not/here", newThread: true }),
  });
  assert.equal(response.status, 400);
});
