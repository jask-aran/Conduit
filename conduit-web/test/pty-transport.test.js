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

async function openWritableTerminal(origin, id, options) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stream = openTerminal(origin, id, options);
    await stream.opened;
    await waitFor(
      () => stream.messages.some((frame) => !frame.isBinary && jsonFrame(frame).type === "control" && jsonFrame(frame).writable === true)
        || stream.socket.readyState === WebSocket.CLOSED,
      "Timed out waiting for a writable terminal or attachment rejection",
    );
    if (stream.socket.readyState !== WebSocket.CLOSED) return stream;
    if (stream.socket._closeCode !== 4009) throw new Error(`Terminal attachment closed with ${stream.socket._closeCode}`);
    await new Promise((resolve) => setTimeout(resolve, 50 * (2 ** attempt)));
  }
  throw new Error("Terminal lease was not released after the previous browser detached");
}

async function waitClosed(stream) {
  if (stream.socket.readyState === WebSocket.CLOSED) return { code: stream.socket._closeCode };
  return new Promise((resolve) => stream.socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() })));
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
    const removed = await harness.request(`/v0/ptys/${terminal.id}`, { method: "DELETE" });
    assert.equal(removed.status, 204, await removed.text());
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
    await waitClosed(first);

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

tmuxTest("Conduit shutdown closes attached terminal sockets as a service restart", async () => {
  const harness = await startConduitHarness({ env: { SHELL: "sh" } });
  try {
    const project = await harness.createProject("Terminal shutdown");
    const created = await (await harness.request("/v0/ptys", {
      method: "POST",
      body: JSON.stringify({ projectId: project.id }),
    })).json();
    const stream = openTerminal(harness.origin, created.id);
    await stream.opened;
    await waitWritable(stream);

    const stopped = harness.terminate();
    assert.deepEqual(await waitClosed(stream), { code: 1012, reason: "Conduit is restarting" });
    await stopped;
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

tmuxTest("one browser owns a terminal while unrelated terminals may stream concurrently", async () => {
  const harness = await startConduitHarness({ env: { SHELL: "sh" } });
  try {
    const project = await harness.createProject("Exclusive terminal leases");
    const firstTerminal = await (await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: project.id }) })).json();
    const secondTerminal = await (await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: project.id }) })).json();

    const owner = openTerminal(harness.origin, firstTerminal.id);
    const unrelated = openTerminal(harness.origin, secondTerminal.id);
    await Promise.all([owner.opened, unrelated.opened]);
    await Promise.all([waitWritable(owner), waitWritable(unrelated)]);

    const blocked = openTerminal(harness.origin, firstTerminal.id);
    await blocked.opened;
    const inUse = await blocked.next((frame) => !frame.isBinary && jsonFrame(frame).type === "client_error" && jsonFrame(frame).code === "pty_in_use");
    assert.match(jsonFrame(inUse).message, /another Conduit client/i);
    assert.equal((await waitClosed(blocked)).code, 4009);

    owner.socket.send(Buffer.from("printf 'owner-terminal-input\\n'\n"));
    unrelated.socket.send(Buffer.from("printf 'unrelated-terminal-input\\n'\n"));
    await Promise.all([owner.outputIncludes("owner-terminal-input"), unrelated.outputIncludes("unrelated-terminal-input")]);

    owner.socket.close();
    await waitClosed(owner);
    const replacement = await openWritableTerminal(harness.origin, firstTerminal.id);
    replacement.socket.send(Buffer.from("printf 'replacement-owner-input\\n'\n"));
    await replacement.outputIncludes("replacement-owner-input");

    replacement.socket.close();
    unrelated.socket.close();
  } finally {
    await harness.stop();
  }
});

tmuxTest("tmux transport survives alternate-screen and modern TUI control sequences", async () => {
  const harness = await startConduitHarness({ env: { SHELL: "sh" } });
  try {
    const project = await harness.createProject("TUI control sequence test");
    const created = await (await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: project.id }) })).json();
    const stream = openTerminal(harness.origin, created.id, { cols: 140, rows: 50 });
    await stream.opened;
    await waitWritable(stream);

    stream.socket.send(Buffer.from("printf '\\033[?1049h\\033[2J\\033[H\\033[?1000h\\033[?1004hTUI-CONTROL-MARKER\\033[?1004l\\033[?1000l\\033[?1049l'\n"));
    await stream.outputIncludes("TUI-CONTROL-MARKER");
    stream.socket.send(JSON.stringify({ type: "resize", cols: 132, rows: 44 }));
    stream.socket.send(Buffer.from("printf 'TUI-AFTER-RESIZE\\n'\n"));
    await stream.outputIncludes("TUI-AFTER-RESIZE");
    stream.socket.close();
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
    assert.equal(removed.status, 204, await removed.text());
    const listed = await (await harness.request("/v0/ptys")).json();
    assert.equal(listed.ptys.some((item) => item.projectId === project.id), false);
  } finally {
    await harness.stop();
  }
});
