import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { PTY_REPLAY_PREFIX } from "../src/pty-manager.js";
import { startConduitHarness, waitFor } from "./helpers/conduit-harness.js";

function openTerminal(origin, id) {
  const socket = new WebSocket(`${origin.replace("http", "ws")}/v0/ptys/${id}/attach`);
  const messages = [];
  socket.on("message", (data, isBinary) => messages.push({ data: Buffer.from(data), isBinary }));
  return {
    socket,
    messages,
    opened: new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); }),
    async next(predicate) {
      let found;
      await waitFor(() => { found = messages.find(predicate); return Boolean(found); }, "Timed out waiting for terminal frame");
      return found;
    },
  };
}

function jsonFrame(frame) {
  return JSON.parse(frame.data.toString());
}

function replayPayload(frame) {
  const text = frame.data.toString();
  assert.equal(text.startsWith(PTY_REPLAY_PREFIX), true);
  return JSON.parse(text.slice(PTY_REPLAY_PREFIX.length));
}

test("PTY API streams binary terminal output over an authenticated server-owned socket", async () => {
  const harness = await startConduitHarness({ env: { SHELL: "sh" } });
  try {
    const workspacePath = path.join(harness.root, "terminal-workspace");
    await fs.mkdir(workspacePath);
    const linkedResponse = await harness.request("/v0/projects", { method: "POST", body: JSON.stringify({ mode: "linked", path: workspacePath }) });
    assert.equal(linkedResponse.status, 201);
    const project = await linkedResponse.json();
    const created = await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: project.id, cols: 100, rows: 30 }) });
    assert.equal(created.status, 201);
    const terminal = await created.json();
    const stream = openTerminal(harness.origin, terminal.id);
    await stream.opened;
    const replayStart = await stream.next((frame) => !frame.isBinary && jsonFrame(frame).type === "replay_start");
    assert.equal(jsonFrame(replayStart).complete, true);
    assert.equal(jsonFrame(replayStart).source, "state");
    const replay = await stream.next((frame) => frame.isBinary && frame.data.toString().startsWith(PTY_REPLAY_PREFIX));
    assert.deepEqual(replayPayload(replay)[0], { type: "resize", cols: 100, rows: 30 });
    await stream.next((frame) => !frame.isBinary && jsonFrame(frame).type === "replay_end");
    const status = await stream.next((frame) => !frame.isBinary && jsonFrame(frame).type === "status");
    assert.equal(jsonFrame(status).status, "running");
    assert.equal(jsonFrame(status).exitCode, null);
    const control = await stream.next((frame) => !frame.isBinary && jsonFrame(frame).type === "control");
    assert.equal(jsonFrame(control).writable, true);
    stream.socket.send(Buffer.from("printf 'conduit-pty-ready\\n'\n"));
    const output = await stream.next((frame) => frame.isBinary && frame.data.toString().includes("conduit-pty-ready"));
    assert.match(output.data.toString(), /conduit-pty-ready/);
    stream.socket.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
    const listed = await (await harness.request("/v0/ptys")).json();
    assert.equal(listed.ptys[0].status, "running");
    assert.equal((await harness.request(`/v0/ptys/${terminal.id}`, { method: "DELETE" })).status, 204);
    stream.socket.close();
  } finally {
    await harness.stop();
  }
});

test("PTY API supports multiple active Project terminals and scoped session discovery", async () => {
  const harness = await startConduitHarness({ env: { SHELL: "sh" } });
  try {
    const project = await harness.createProject("Multi-terminal project");
    const other = await harness.createProject("Other terminal project");
    const first = await (await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: project.id }) })).json();
    const second = await (await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: project.id }) })).json();
    await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: other.id }) });
    assert.notEqual(first.id, second.id);
    const scoped = await (await harness.request(`/v0/ptys?projectId=${encodeURIComponent(project.id)}`)).json();
    assert.deepEqual(scoped.ptys.map((item) => item.id).sort(), [first.id, second.id].sort());
    assert.equal(scoped.ptys.every((item) => item.projectId === project.id && item.status === "running"), true);
  } finally {
    await harness.stop();
  }
});

test("PTY API uses a linked Workspace root or the server home directory, never a browser path", async () => {
  const harness = await startConduitHarness({ env: { SHELL: "sh" } });
  try {
    const workspacePath = path.join(harness.root, "terminal-workspace");
    await fs.mkdir(workspacePath);
    const linked = await (await harness.request("/v0/projects", { method: "POST", body: JSON.stringify({ mode: "linked", path: workspacePath }) })).json();
    const ordinary = await (await harness.request("/v0/projects", { method: "POST", body: JSON.stringify({ name: "Ordinary project" }) })).json();
    const workspaceTerminal = await (await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: linked.id }) })).json();
    const homeTerminal = await (await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: ordinary.id, cwd: "/browser-supplied-path" }) })).json();
    const workspaceStream = openTerminal(harness.origin, workspaceTerminal.id);
    const homeStream = openTerminal(harness.origin, homeTerminal.id);
    await Promise.all([workspaceStream.opened, homeStream.opened]);
    await Promise.all([
      workspaceStream.next((frame) => !frame.isBinary && jsonFrame(frame).type === "control" && jsonFrame(frame).writable === true),
      homeStream.next((frame) => !frame.isBinary && jsonFrame(frame).type === "control" && jsonFrame(frame).writable === true),
    ]);
    workspaceStream.socket.send(Buffer.from("pwd\n"));
    homeStream.socket.send(Buffer.from("pwd\n"));
    const [workspaceOutput, homeOutput] = await Promise.all([
      workspaceStream.next((frame) => frame.isBinary && frame.data.toString().includes(workspacePath)),
      homeStream.next((frame) => frame.isBinary && frame.data.toString().includes(harness.root)),
    ]);
    assert.match(workspaceOutput.data.toString(), new RegExp(workspacePath));
    assert.match(homeOutput.data.toString(), new RegExp(harness.root));
    workspaceStream.socket.close();
    homeStream.socket.close();
  } finally {
    await harness.stop();
  }
});

test("only one attached browser controls PTY input and resize at a time", async () => {
  const harness = await startConduitHarness({ env: { SHELL: "sh" } });
  try {
    const project = await harness.createProject("Controller ownership");
    const created = await (await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: project.id }) })).json();
    const first = openTerminal(harness.origin, created.id);
    await first.opened;
    await first.next((frame) => !frame.isBinary && jsonFrame(frame).type === "control" && jsonFrame(frame).writable === true);

    const second = openTerminal(harness.origin, created.id);
    await second.opened;
    await second.next((frame) => !frame.isBinary && jsonFrame(frame).type === "control" && jsonFrame(frame).writable === false);
    second.socket.send(Buffer.from("printf 'must-not-run\\n'\n"));
    const denied = await second.next((frame) => !frame.isBinary && jsonFrame(frame).type === "client_error");
    assert.equal(jsonFrame(denied).code, "pty_read_only");

    const controlsBeforePromotion = second.messages.filter((frame) => !frame.isBinary && jsonFrame(frame).type === "control").length;
    first.socket.close();
    await waitFor(() => second.messages
      .filter((frame) => !frame.isBinary && jsonFrame(frame).type === "control")
      .slice(controlsBeforePromotion)
      .some((frame) => jsonFrame(frame).writable === true), "Second terminal client was not promoted");
    second.socket.send(Buffer.from("printf 'promoted-controller\\n'\n"));
    const output = await second.next((frame) => frame.isBinary && frame.data.toString().includes("promoted-controller"));
    assert.match(output.data.toString(), /promoted-controller/);
    second.socket.close();
  } finally {
    await harness.stop();
  }
});

test("deleting a Project tears down and removes its resident PTY", async () => {
  const harness = await startConduitHarness({ env: { SHELL: "sh" } });
  try {
    const project = await harness.createProject("Disposable terminal project");
    const terminal = await (await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: project.id }) })).json();
    assert.equal(terminal.status, "running");
    const removed = await harness.request(`/v0/projects/${project.id}`, { method: "DELETE" });
    assert.equal(removed.status, 204);
    const listed = await (await harness.request("/v0/ptys")).json();
    assert.equal(listed.ptys.some((item) => item.projectId === project.id), false);
  } finally {
    await harness.stop();
  }
});
