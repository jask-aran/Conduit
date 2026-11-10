import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { terminalSocketName } from "../../scripts/terminal-lifecycle.mjs";
import { PTY_MAX_INPUT_BYTES } from "../src/pty-manager.js";
import { startConduitHarness, waitFor } from "./helpers/conduit-harness.js";

function tmuxAvailable() {
  try {
    const value = execFileSync("tmux", ["-V"], { encoding: "utf8" });
    const match = value.match(/tmux\s+(\d+)\.(\d+)/i);
    return Boolean(match && (Number(match[1]) > 3 || (Number(match[1]) === 3 && Number(match[2]) >= 3)));
  } catch { return false; }
}

const tmuxTest = tmuxAvailable() ? test : test.skip;

function openTerminal(origin, id, { cols = 100, rows = 30, takeover = false } = {}) {
  const socket = new WebSocket(`${origin.replace("http", "ws")}/v0/ptys/${id}/attach?cols=${cols}&rows=${rows}${takeover ? "&takeover=1" : ""}`);
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
    assert.equal(typeof listed.ptys[0].currentCommand, "string");
    assert.equal(Number.isNaN(Date.parse(listed.ptys[0].lastActivityAt)), false);
    const renamed = await (await harness.request(`/v0/ptys/${terminal.id}/rename`, {
      method: "POST",
      body: JSON.stringify({ title: "Renamed shell" }),
    })).json();
    assert.equal(renamed.title, "Renamed shell");
    const windowName = execFileSync("tmux", [
      "-L", terminalSocketName(path.join(harness.root, "remotes.json")),
      "-f", path.join(harness.root, "remotes.json.tmux.conf"),
      "display-message", "-p", "-t", `c_${terminal.id.replaceAll("-", "")}:0`, "#{window_name}",
    ], { encoding: "utf8" }).trim();
    assert.equal(windowName, "Renamed shell");
    const removed = await harness.request(`/v0/ptys/${terminal.id}`, { method: "DELETE" });
    assert.equal(removed.status, 204, await removed.text());
    stream.socket.close();
  } finally {
    await harness.stop();
  }
});

tmuxTest("the WebSocket parser rejects oversized terminal input without killing the tmux session", async () => {
  const harness = await startConduitHarness({ env: { SHELL: "sh" } });
  try {
    const project = await harness.createProject("Bounded terminal input");
    const created = await (await harness.request("/v0/ptys", {
      method: "POST",
      body: JSON.stringify({ projectId: project.id }),
    })).json();
    const stream = openTerminal(harness.origin, created.id);
    await stream.opened;
    await waitWritable(stream);
    stream.socket.send(Buffer.alloc(PTY_MAX_INPUT_BYTES + 1));
    assert.equal((await waitClosed(stream)).code, 1009);

    const replacement = await openWritableTerminal(harness.origin, created.id);
    replacement.socket.send(Buffer.from("printf 'oversize-recovered\\n'\n"));
    await replacement.outputIncludes("oversize-recovered");
    replacement.socket.close();
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

tmuxTest("PTY API uses each project's working root and never a browser path", async () => {
  const harness = await startConduitHarness({ env: { SHELL: "sh" } });
  try {
    const workspacePath = path.join(harness.root, "terminal-workspace");
    await fs.mkdir(workspacePath);
    const linked = await (await harness.request("/v0/projects", { method: "POST", body: JSON.stringify({ mode: "linked", path: workspacePath }) })).json();
    const ordinary = await (await harness.request("/v0/projects", { method: "POST", body: JSON.stringify({ name: "Ordinary project" }) })).json();
    const workspaceTerminal = await (await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: linked.id }) })).json();
    const managedTerminal = await (await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: ordinary.id, cwd: "/browser-supplied-path" }) })).json();
    assert.equal(workspaceTerminal.cwd, workspacePath);
    assert.equal(workspaceTerminal.cwd, linked.workingRoot);
    assert.equal(managedTerminal.cwd, ordinary.workingRoot);
    assert.notEqual(managedTerminal.cwd, harness.root);
    const workspaceStream = openTerminal(harness.origin, workspaceTerminal.id);
    const managedStream = openTerminal(harness.origin, managedTerminal.id);
    await Promise.all([workspaceStream.opened, managedStream.opened]);
    await Promise.all([waitWritable(workspaceStream), waitWritable(managedStream)]);
    workspaceStream.socket.send(Buffer.from("pwd\n"));
    managedStream.socket.send(Buffer.from("pwd\n"));
    await Promise.all([workspaceStream.outputIncludes(linked.workingRoot), managedStream.outputIncludes(ordinary.workingRoot)]);
    workspaceStream.socket.close();
    managedStream.socket.close();
  } finally {
    await harness.stop();
  }
});
