import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { startConduitHarness, waitFor } from "./helpers/conduit-harness.js";

async function initGitRepo(directory) {
  await fs.mkdir(directory, { recursive: true });
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  git(["init"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  await fs.writeFile(path.join(directory, "app.js"), "console.log(1)\n");
  git(["add", "."]);
  git(["commit", "-m", "init"]);
}

test("opening a chat attaches to a live process but never starts one", async () => {
  const harness = await startConduitHarness();
  try {
    const chat = await harness.createChat();

    // No process yet: an open is told so rather than being handed a new one.
    // An open is a reconnect or a background fetch, and letting one start a
    // process is exactly how a retry timer would undo the reaper.
    const cold = await harness.request("/v0/live-sessions", {
      method: "POST",
      body: JSON.stringify({ chatId: chat.id, projectId: chat.projectId, intent: "open" }),
    });
    assert.equal(cold.status, 409);
    assert.equal((await cold.json()).error, "no_live_process");
    assert.deepEqual((await (await harness.request("/v0/live-sessions")).json()).sessions, []);

    // Real use may start one.
    const launch = await harness.request("/v0/live-sessions", {
      method: "POST", body: JSON.stringify({ chatId: chat.id, projectId: chat.projectId, intent: "prompt" }),
    });
    assert.equal(launch.status, 201);
    const live = await launch.json();

    // And now an open attaches to exactly that process instead of a second one.
    const warm = await harness.request("/v0/live-sessions", {
      method: "POST",
      body: JSON.stringify({ chatId: chat.id, projectId: chat.projectId, intent: "open" }),
    });
    assert.equal(warm.status, 201);
    assert.equal((await warm.json()).id, live.id);
  } finally {
    await harness.stop();
  }
});

test("selecting a chat reads it without starting an agent", async () => {
  const harness = await startConduitHarness();
  try {
    const chat = await harness.createChat();

    const selected = await harness.request("/v0/live-sessions", {
      method: "POST",
      body: JSON.stringify({ chatId: chat.id, projectId: chat.projectId, intent: "select" }),
    });
    assert.equal(selected.status, 409);
    assert.equal((await selected.json()).error, "no_live_process");
    assert.deepEqual((await (await harness.request("/v0/live-sessions")).json()).sessions, []);

    // The first action that needs the agent starts it.
    const launch = await harness.request("/v0/live-sessions", {
      method: "POST", body: JSON.stringify({ chatId: chat.id, projectId: chat.projectId, intent: "prompt" }),
    });
    assert.equal(launch.status, 201);
    const live = await launch.json();
    assert.ok(live.id);
    const prompt = await harness.request("/v0/live-sessions", {
      method: "POST",
      body: JSON.stringify({ chatId: chat.id, projectId: chat.projectId, intent: "prompt" }),
    });
    assert.equal(prompt.status, 201);
    assert.equal((await prompt.json()).id, live.id);
  } finally {
    await harness.stop();
  }
});

test("Codex app-server profile creates, streams, and reconnects through neutral events", async () => {
  const harness = await startConduitHarness();
  try {
    const created = await harness.request("/v0/chats", {
      method: "POST", body: JSON.stringify({ profileId: "codex" }),
    });
    assert.equal(created.status, 201);
    const chat = await created.json();
    const selected = await harness.request(`/v0/chats/${chat.id}/models`, {
      method: "PATCH", body: JSON.stringify({ model: "codex-other", thinkingLevel: "high" }),
    });
    assert.equal(selected.status, 200);
    const launched = await harness.request("/v0/live-sessions", {
      method: "POST", body: JSON.stringify({ chatId: chat.id, projectId: chat.projectId, intent: "prompt" }),
    });
    assert.equal(launched.status, 201);
    const live = await launched.json();
    assert.equal(live.backend.implementation, "codex");
    assert.equal(live.model, "codex-other");
    assert.equal(live.capabilities.steer, true);
    const switched = await harness.request(`/v0/chats/${chat.id}/models`, {
      method: "PATCH", body: JSON.stringify({ model: "codex-test", thinkingLevel: "low" }),
    });
    assert.equal(switched.status, 200);
    assert.equal((await switched.json()).model, "codex-test");
    const stream = harness.connectStream(live.id);
    await stream.opened;
    await stream.next((event) => event.type === "runtime_state");
    stream.socket.send(JSON.stringify({ type: "prompt", message: "Test Codex" }));
    // The turn narrates before it answers, so this waits for the answer rather
    // than the first thing the turn says.
    const answerDelta = (event) => event.type === "assistant_content" && event.phase === "delta" && event.delta.includes("works");
    assert.equal((await stream.next(answerDelta)).delta, "codex-test low works");
    await stream.next((event) => event.type === "status" && event.phase === "settled");
    stream.close();
    const reattached = harness.connectStream(live.id);
    await reattached.opened;
    assert.equal((await reattached.next(answerDelta)).delta, "codex-test low works");
  } finally {
    await harness.stop();
  }
});

test("a replaced cloned root cannot be inspected or launched, and unlink does not touch its replacement", async () => {
  const harness = await startConduitHarness();
  try {
    const source = path.join(harness.root, "source");
    const target = path.join(harness.root, "workspaces", "cloned");
    const displaced = path.join(harness.root, "displaced");
    const outside = path.join(harness.root, "outside");
    await initGitRepo(source);
    await fs.mkdir(path.dirname(target));
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "keep.txt"), "outside");
    const created = await harness.request("/v0/projects", {
      method: "POST",
      body: JSON.stringify({ mode: "cloned", cloneUrl: source, path: target }),
    });
    assert.equal(created.status, 202);
    const started = await created.json();
    const project = started.project;
    await waitFor(async () => {
      const response = await harness.request("/v0/projects");
      const listing = await response.json();
      return listing.projects.some((item) => item.id === project.id && item.state === "ready");
    }, "cloned Workspace did not become ready");
    const chat = await harness.createChat(project.id);
    await fs.rename(target, displaced);
    await fs.symlink(outside, target);

    const inspected = await harness.request(`/v0/projects/${project.id}/tree`);
    assert.equal(inspected.status, 409);
    assert.equal((await inspected.json()).error, "workspace_identity_changed");
    const launch = await harness.request("/v0/live-sessions", {
      method: "POST",
      body: JSON.stringify({ chatId: chat.id, projectId: project.id, intent: "prompt" }),
    });
    assert.equal(launch.status, 409);
    assert.deepEqual(await harness.liveSessions(), []);
    assert.equal((await harness.request(`/v0/projects/${project.id}`, { method: "DELETE" })).status, 204);
    assert.equal(await fs.readFile(path.join(outside, "keep.txt"), "utf8"), "outside");
  } finally {
    await harness.stop();
  }
});

test("a replaced managed root rejects every root-consuming action", async () => {
  const harness = await startConduitHarness();
  try {
    const project = await harness.createProject("Managed root");
    const chat = await harness.createChat(project.id);
    const outside = path.join(harness.root, "outside");
    const displaced = path.join(harness.root, "displaced");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "keep.txt"), "outside");
    await fs.rename(project.workingRoot, displaced);
    await fs.symlink(outside, project.workingRoot);

    const attachmentId = "550e8400-e29b-41d4-a716-446655440000";
    const responses = await Promise.all([
      harness.request(`/v0/projects/${project.id}/tree`),
      harness.request(`/v0/projects/${project.id}/diff`),
      harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: project.id }) }),
      harness.request(`/v0/models?projectId=${project.id}`),
      harness.request(`/v0/settings?projectId=${project.id}`),
      harness.request(`/v0/chats/${chat.id}/models`),
      harness.request(`/v0/chats/${chat.id}/attachments/${attachmentId}?name=blocked.txt`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: "blocked",
      }),
      harness.request("/v0/live-sessions", {
        method: "POST",
        body: JSON.stringify({ chatId: chat.id, projectId: project.id, intent: "prompt" }),
      }),
    ]);
    for (const response of responses) assert.equal(response.status, 409);
    assert.deepEqual(await harness.liveSessions(), []);
    assert.equal(await fs.readFile(path.join(outside, "keep.txt"), "utf8"), "outside");
    await assert.rejects(fs.access(path.join(outside, ".conduit")), { code: "ENOENT" });
  } finally {
    await harness.stop();
  }
});
