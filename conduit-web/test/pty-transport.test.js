import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { startConduitHarness, waitFor } from "./helpers/conduit-harness.js";

function openTerminal(origin, id) {
  const socket = new WebSocket(`${origin.replace("http", "ws")}/v0/ptys/${id}/attach`);
  const messages = [];
  socket.on("message", (data, isBinary) => messages.push({ data: Buffer.from(data), isBinary }));
  return {
    socket,
    opened: new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); }),
    async next(predicate) {
      let found;
      await waitFor(() => { found = messages.find(predicate); return Boolean(found); }, "Timed out waiting for terminal frame");
      return found;
    },
  };
}

test("PTY API streams binary terminal output over an authenticated server-owned socket", async () => {
  const harness = await startConduitHarness();
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
    const status = await stream.next((frame) => !frame.isBinary && JSON.parse(frame.data.toString()).type === "status");
    assert.equal(JSON.parse(status.data.toString()).exitCode, null);
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
