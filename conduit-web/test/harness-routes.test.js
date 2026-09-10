import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { harnessCatalog } from "../src/server/routes/harnesses.js";
import { startConduitHarness } from "./helpers/conduit-harness.js";

test("harness catalog exposes installed adapter capabilities", () => {
  const backends = { adapters: new Map([["codex", {}]]) };
  assert.deepEqual(harnessCatalog(backends), [
    { id: "codex", label: "Codex", available: true, sessions: true, drive: true, discovery: "machine" },
    { id: "chatgpt-web", label: "ChatGPT Web", available: false, sessions: false, drive: false, discovery: "none" },
  ]);
});

test("ephemeral Codex drive leaves the chat registry unchanged", async (t) => {
  const harness = await startConduitHarness();
  t.after(() => harness.stop());
  const project = await harness.createProject("Harness workspace");
  const before = (await (await harness.request("/v0/projects")).json()).projects
    .find((item) => item.id === project.id).sessions.length;
  const sessions = await (await harness.request(`/v0/harnesses/codex/sessions?projectId=${project.id}`)).json();
  assert.equal(sessions.sessions[0].id, "foreign-thread");
  assert.deepEqual(sessions.tracked, []);
  const opened = await (await harness.request("/v0/harnesses/codex/drive", {
    method: "POST", body: JSON.stringify({ projectId: project.id, sessionId: "foreign-thread" }),
  })).json();
  assert.equal(opened.nativeSessionId, "foreign-thread");
  assert.match(opened.streamUrl, new RegExp(opened.id));
  assert.equal((await (await harness.request("/v0/projects")).json()).projects
    .find((item) => item.id === project.id).sessions.length, before);
  assert.equal((await harness.request(`/v0/live-sessions/${opened.id}/process`, { method: "DELETE" })).status, 202);
  assert.equal((await (await harness.request("/v0/live-sessions")).json()).sessions.some((item) => item.id === opened.id), false);
  assert.equal((await harness.request(`/v0/projects/${project.id}/backend-sessions/foreign-thread/adopt`, { method: "POST" })).status, 201);
  const mounted = await (await harness.request(`/v0/harnesses/codex/sessions?projectId=${project.id}`)).json();
  assert.equal(mounted.tracked.length, 1);
  assert.equal(mounted.tracked[0].backend.opaqueSession, undefined);
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
  assert.equal(project.id.length > 0, true);
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
  const started = await (await harness.request("/v0/harnesses/codex/drive", {
    method: "POST", body: JSON.stringify({ path: folder, newThread: true }),
  })).json();
  assert.match(started.streamUrl, new RegExp(started.id));
  assert.equal(started.nativeSessionId, "thread-test");
  assert.equal((await (await harness.request("/v0/projects")).json()).projects.length, before, "no workspace was registered");
  assert.equal((await harness.request(`/v0/live-sessions/${started.id}/process`, { method: "DELETE" })).status, 202);
});

test("driving an unknown folder is rejected before a process is spawned", async (t) => {
  const harness = await startConduitHarness();
  t.after(() => harness.stop());
  const response = await harness.request("/v0/harnesses/codex/drive", {
    method: "POST", body: JSON.stringify({ path: "/definitely/not/here", newThread: true }),
  });
  assert.equal(response.status, 400);
});

test("a driven thread selects its model against the live record, without a chat", async (t) => {
  const harness = await startConduitHarness();
  t.after(() => harness.stop());
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-model-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const started = await (await harness.request("/v0/harnesses/codex/drive", {
    method: "POST", body: JSON.stringify({ path: folder, newThread: true }),
  })).json();

  const catalog = await (await harness.request(`/v0/live-sessions/${started.id}/models`)).json();
  assert.ok(catalog.models.some((model) => model.spec === "codex-test"), "the harness reports its own catalogue");

  const chosen = await (await harness.request(`/v0/live-sessions/${started.id}/models`, {
    method: "PATCH", body: JSON.stringify({ model: "codex-other", thinkingLevel: "high" }),
  })).json();
  assert.equal(chosen.model, "codex-other");
  assert.equal(chosen.thinkingLevel, "high");

  const rejected = await harness.request(`/v0/live-sessions/${started.id}/models`, {
    method: "PATCH", body: JSON.stringify({ model: "not-a-model" }),
  });
  assert.equal(rejected.status, 400);

  const badLevel = await harness.request(`/v0/live-sessions/${started.id}/models`, {
    method: "PATCH", body: JSON.stringify({ model: "codex-other", thinkingLevel: "medium" }),
  });
  assert.equal(badLevel.status, 400, "codex-other does not offer a medium effort");

  assert.equal((await harness.request(`/v0/live-sessions/${started.id}/process`, { method: "DELETE" })).status, 202);
  assert.equal((await harness.request("/v0/live-sessions/missing/models")).status, 404);
});
