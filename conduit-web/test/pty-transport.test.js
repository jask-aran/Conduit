import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { startConduitHarness, waitFor } from "./helpers/conduit-harness.js";

function tmuxAvailable() {
  try {
    const value = execFileSync("tmux", ["-V"], { encoding: "utf8" });
    const match = value.match(/tmux\s+(\d+)\.(\d+)/i);
    return Boolean(match && (Number(match[1]) > 3 || (Number(match[1]) === 3 && Number(match[2]) >= 3)));
  } catch { return false; }
}

const tmuxTest = tmuxAvailable() ? test : test.skip;

function openTerminal(origin, id, { cols = 100, rows = 30 } = {}) {
  const socket = new WebSocket(`${origin.replace("http", "ws")}/v0/ptys/${id}/attach?cols=${cols}&rows=${rows}`);
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
    async outputIncludes(value) {
      await waitFor(
        () => messages.filter((frame) => frame.isBinary).map((frame) => frame.data.toString()).join("").includes(value),
        `Timed out waiting for terminal output: ${value}`,
      );
    },
  };
}

function jsonFrame(frame) {
  return JSON.parse(frame.data.toString());
}

async function waitWritable(stream) {
  return stream.next((frame) => !frame.isBinary && jsonFrame(frame).type === "control" && jsonFrame(frame).writable === true);
}

tmuxTest("PTY API attaches a thin binary WebSocket to a tmux-owned terminal session", async () => {
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
    const status = await stream.next((frame) => !frame.isBinary && jsonFrame(frame).type === "status");
    assert.equal(jsonFrame(status).status, "running");
    await waitWritable(stream);
    assert.equal(stream.messages.some((frame) => !frame.isBinary && ["replay_start", "replay_end"].includes(jsonFrame(frame).type)), false);

    stream.socket.send(Buffer.from("printf 'conduit-tmux-ready\\n'\n"));
    await stream.outputIncludes("conduit-tmux-ready");
    stream.socket.send(Buffer.from("printf '%s\\n' \"$TERM\"\n"));
    await stream.outputIncludes("tmux-256color");
    stream.socket.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));

    const listed = await (await harness.request("/v0/ptys")).json();
    assert.equal(listed.ptys[0].status, "running");
    assert.equal((await harness.request(`/v0/ptys/${terminal.id}`, { method: "DELETE" })).status, 204);
    stream.socket.close();
  } finally {
    await harness.stop();
  }
});

tmuxTest("detaching and reattaching a browser preserves the tmux-owned current terminal screen", async () => {
  const harness = await startConduitHarness({ env: { SHELL: "sh" } });
  try {
    const project = await harness.createProject("Persistent tmux terminal");
    const created = await (await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: project.id }) })).json();
    const first = openTerminal(harness.origin, created.id);
    await first.opened;
    await waitWritable(first);
    first.socket.send(Buffer.from("printf 'reattach-screen-marker\\n'\n"));
    await first.outputIncludes("reattach-screen-marker");
    first.socket.close();
    await new Promise((resolve) => first.socket.once("close", resolve));

    const listed = await (await harness.request(`/v0/ptys?projectId=${encodeURIComponent(project.id)}`)).json();
    assert.equal(listed.ptys.find((item) => item.id === created.id)?.status, "running");

    const second = openTerminal(harness.origin, created.id);
    await second.opened;
    await waitWritable(second);
    await second.outputIncludes("reattach-screen-marker");
    second.socket.send(Buffer.from("printf 'reattach-input-ready\\n'\n"));
    await second.outputIncludes("reattach-input-ready");
    second.socket.close();
  } finally {
    await harness.stop();
  }
});

tmuxTest("PTY API supports multiple active Project terminals and scoped session discovery", async () => {
  const harness = await startConduitHarness({ env: { SHELL: "sh" } });
  try {
    const project = await harness.createProject("Multi-terminal project");
    const other = await harness.createProject("Other terminal project");
    const first = await (await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: project.id }) })).json();
    const second = await (await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: project.id }) })).json();
    await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: other.id }) });
    assert.notEqual(first.id, second.id);
    assert.equal(second.title, "Shell 2");
    const scoped = await (await harness.request(`/v0/ptys?projectId=${encodeURIComponent(project.id)}`)).json();
    assert.deepEqual(scoped.ptys.map((item) => item.id).sort(), [first.id, second.id].sort());
    assert.equal(scoped.ptys.every((item) => item.projectId === project.id && item.status === "running"), true);
  } finally {
    await harness.stop();
  }
});

tmuxTest("PTY API uses a linked Workspace root or the server home directory, never a browser path", async () => {
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
    await Promise.all([waitWritable(workspaceStream), waitWritable(homeStream)]);
    workspaceStream.socket.send(Buffer.from("pwd\n"));
    homeStream.socket.send(Buffer.from("pwd\n"));
    await Promise.all([workspaceStream.outputIncludes(workspacePath), homeStream.outputIncludes(harness.root)]);
    workspaceStream.socket.close();
    homeStream.socket.close();
  } finally {
    await harness.stop();
  }
});

tmuxTest("multiple attached browser clients can observe and write the same tmux terminal", async () => {
  const harness = await startConduitHarness({ env: { SHELL: "sh" } });
  try {
    const project = await harness.createProject("Shared tmux terminal");
    const created = await (await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: project.id }) })).json();
    const first = openTerminal(harness.origin, created.id);
    const second = openTerminal(harness.origin, created.id);
    await Promise.all([first.opened, second.opened]);
    await Promise.all([waitWritable(first), waitWritable(second)]);

    first.socket.send(Buffer.from("printf 'first-browser-input\\n'\n"));
    await Promise.all([first.outputIncludes("first-browser-input"), second.outputIncludes("first-browser-input")]);
    second.socket.send(Buffer.from("printf 'second-browser-input\\n'\n"));
    await Promise.all([first.outputIncludes("second-browser-input"), second.outputIncludes("second-browser-input")]);

    first.socket.close();
    second.socket.send(Buffer.from("printf 'survives-first-detach\\n'\n"));
    await second.outputIncludes("survives-first-detach");
    second.socket.close();
  } finally {
    await harness.stop();
  }
});

tmuxTest("deleting a Project tears down and removes its resident tmux sessions", async () => {
  const harness = await startConduitHarness({ env: { SHELL: "sh" } });
  try {
    const project = await harness.createProject("Disposable terminal project");
    const first = await (await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: project.id }) })).json();
    const second = await (await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: project.id }) })).json();
    assert.equal(first.status, "running");
    assert.equal(second.status, "running");
    const removed = await harness.request(`/v0/projects/${project.id}`, { method: "DELETE" });
    assert.equal(removed.status, 204);
    const listed = await (await harness.request("/v0/ptys")).json();
    assert.equal(listed.ptys.some((item) => item.projectId === project.id), false);
  } finally {
    await harness.stop();
  }
});
