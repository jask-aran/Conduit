import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { startConduitHarness, waitFor } from "./helpers/conduit-harness.js";
import { sessionDirectoryFor } from "../src/session-store.js";

async function pauseLaunch(harness, chat) {
  const after = (await harness.pi.commands()).length;
  const launch = harness.request("/v0/live-sessions", {
    method: "POST",
    body: JSON.stringify({ chatId: chat.id, projectId: chat.projectId }),
  });
  const stateRequest = await harness.pi.waitForCommand("get_state", { after });
  return { launch, stateRequest };
}

async function completeState(harness, request, chat) {
  await harness.pi.reply(request, {
    sessionFile: path.join(harness.root, "pi", "sessions", `${chat.id}.jsonl`),
    sessionId: `session-${chat.id}`,
  });
}

async function createNativeChat(harness) {
  const workspace = path.join(harness.root, "host-workspace");
  await fs.mkdir(workspace);
  const created = await harness.request("/v0/projects", {
    method: "POST",
    body: JSON.stringify({ mode: "linked", name: "Host workspace", path: workspace }),
  });
  assert.equal(created.status, 201);
  const project = await created.json();
  const chatResponse = await harness.request("/v0/chats", {
    method: "POST",
    body: JSON.stringify({ projectId: project.id, runtimeKind: "native_pi" }),
  });
  assert.equal(chatResponse.status, 201);
  return { project, chat: await chatResponse.json() };
}

async function launchNativeChat(harness, chat, sessionFile) {
  const after = (await harness.pi.commands()).length;
  const launch = harness.request("/v0/live-sessions", {
    method: "POST",
    body: JSON.stringify({ chatId: chat.id, projectId: chat.projectId }),
  });
  const state = await harness.pi.waitForCommand("get_state", { after });
  await harness.pi.reply(state, { sessionFile, sessionId: `native-${chat.id}` });
  assert.equal((await launch).status, 201);
}

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

test("launch cannot outlive a concurrent chat or project deletion", async () => {
  const harness = await startConduitHarness();
  async function startThenDelete(chat, route) {
    const { launch, stateRequest } = await pauseLaunch(harness, chat);
    const deletion = harness.request(route, { method: "DELETE" });
    // The deletion reserves the chat before awaiting the launch's chat mutex.
    await new Promise((resolve) => setTimeout(resolve, 25));
    await completeState(harness, stateRequest, chat);
    assert.equal((await launch).status, 409);
    assert.equal((await deletion).status, 204);
    await waitFor(async () => (await harness.liveSessions()).length === 0, "deleted chat left a live Pi process behind");
  }

  try {
    const first = await harness.createChat();
    await startThenDelete(first, `/v0/sessions/${first.id}`);
    assert.equal((await harness.request(`/v0/chats/${first.id}`)).status, 404);

    const project = await harness.createProject("Lifecycle project");
    const second = await harness.createChat(project.id);
    await startThenDelete(second, `/v0/projects/${project.id}`);
    assert.equal((await harness.request(`/v0/projects/${project.id}`)).status, 404);

    const source = await harness.createProject("Move source");
    const target = await harness.createProject("Move target");
    const moving = await harness.createChat(source.id);
    const { launch, stateRequest } = await pauseLaunch(harness, moving);
    const move = harness.request(`/v0/sessions/${moving.id}/move`, {
      method: "POST",
      body: JSON.stringify({ projectId: target.id }),
    });
    await completeState(harness, stateRequest, moving);
    assert.equal((await launch).status, 201);
    assert.equal((await move).status, 200);
    const moved = await (await harness.request(`/v0/chats/${moving.id}`)).json();
    assert.equal(moved.projectId, target.id);
    await waitFor(async () => (await harness.liveSessions()).length === 0, "moved chat left its source Pi process alive");
  } finally {
    await harness.stop();
  }
});

test("the harness attaches a real client stream to a live Pi process", async () => {
  const harness = await startConduitHarness();
  try {
    const runtime = harness.connectRuntimeStream();
    await runtime.opened;
    assert.deepEqual((await runtime.next((event) => event.type === "runtime_global_snapshot")).processes, []);
    const chat = await harness.createChat();
    const { launch, stateRequest } = await pauseLaunch(harness, chat);
    await completeState(harness, stateRequest, chat);
    const live = await (await launch).json();
    assert.equal((await runtime.next((event) => event.type === "runtime_process" && event.process.id === live.id)).process.chatId, chat.id);
    const stream = harness.connectStream(live.id);
    await stream.opened;
    assert.equal((await stream.next((event) => event.type === "runtime_state")).session.chatId, chat.id);
  } finally {
    await harness.stop();
  }
});

test("a replaced cloned root cannot be inspected, launched, or unregistered", async () => {
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
    assert.equal(created.status, 201);
    const project = await created.json();
    const chat = await harness.createChat(project.id);
    await fs.rename(target, displaced);
    await fs.symlink(outside, target);

    const inspected = await harness.request(`/v0/projects/${project.id}/tree`);
    assert.equal(inspected.status, 409);
    assert.equal((await inspected.json()).error, "workspace_identity_changed");
    const launch = await harness.request("/v0/live-sessions", {
      method: "POST",
      body: JSON.stringify({ chatId: chat.id, projectId: project.id }),
    });
    assert.equal(launch.status, 409);
    assert.equal((await harness.pi.commands()).length, 0);
    assert.equal((await harness.request(`/v0/projects/${project.id}`, { method: "DELETE" })).status, 409);
    assert.equal(await fs.readFile(path.join(outside, "keep.txt"), "utf8"), "outside");
  } finally {
    await harness.stop();
  }
});

test("Host Pi chat deletion removes its runtime-owned transcript", async () => {
  const harness = await startConduitHarness();
  try {
    const { project, chat } = await createNativeChat(harness);
    const sessionsDir = sessionDirectoryFor(project.path, path.join(harness.root, "native-agent"));
    const sessionFile = path.join(sessionsDir, "host-single.jsonl");
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(sessionFile, `${JSON.stringify({ type: "session", id: "host-single", cwd: project.path })}\n`);
    await launchNativeChat(harness, chat, sessionFile);
    assert.equal((await harness.request(`/v0/sessions/${chat.id}`, { method: "DELETE" })).status, 204);
    await assert.rejects(fs.access(sessionFile), { code: "ENOENT" });
  } finally {
    await harness.stop();
  }
});

test("Host Pi chat deletion removes its fork family without touching siblings", async () => {
  const harness = await startConduitHarness();
  try {
    const { project, chat } = await createNativeChat(harness);
    const sessionsDir = sessionDirectoryFor(project.path, path.join(harness.root, "native-agent"));
    const original = path.join(sessionsDir, "host-original.jsonl");
    const branch = path.join(sessionsDir, "host-branch.jsonl");
    const sibling = path.join(sessionsDir, "host-sibling.jsonl");
    const unrelated = path.join(sessionsDir, "host-unrelated.jsonl");
    const header = (id, parentSession = null) => `${JSON.stringify({ type: "session", id, cwd: project.path, ...(parentSession ? { parentSession } : {}) })}\n`;
    await fs.mkdir(sessionsDir, { recursive: true });
    await Promise.all([
      fs.writeFile(original, header("host-original")),
      fs.writeFile(branch, header("host-branch", original)),
      fs.writeFile(sibling, header("host-sibling", original)),
      fs.writeFile(unrelated, header("host-unrelated")),
    ]);
    await launchNativeChat(harness, chat, branch);
    assert.equal((await harness.request(`/v0/sessions/${chat.id}`, { method: "DELETE" })).status, 204);
    await Promise.all([original, branch, sibling].map((file) => assert.rejects(fs.access(file), { code: "ENOENT" })));
    await fs.access(unrelated);
  } finally {
    await harness.stop();
  }
});
