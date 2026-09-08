import test from "node:test";
import assert from "node:assert/strict";
import { harnessCatalog } from "../src/server/routes/harnesses.js";
import { startConduitHarness } from "./helpers/conduit-harness.js";

test("harness catalog exposes installed adapter capabilities", () => {
  const backends = { adapters: new Map([["codex", {}]]) };
  assert.deepEqual(harnessCatalog(backends), [
    { id: "codex", label: "Codex", available: true, sessions: true, drive: true },
    { id: "chatgpt-web", label: "ChatGPT Web", available: false, sessions: false, drive: false },
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
