import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PtyManager } from "../src/pty-manager.js";
import { TerminalState } from "../src/terminal-state.js";

test("headless terminal generates protocol replies while detached", async () => {
  const replies = [];
  const state = new TerminalState({ onData: (data) => replies.push(data) });
  try {
    await state.write("\x1b[6n");
    assert.match(replies.join(""), /\x1b\[1;1R/);
  } finally {
    state.dispose();
  }
});

test("canonical terminal state bounds pending output and invalidates snapshots", async () => {
  const pauses = [];
  const invalid = [];
  const state = new TerminalState({
    highWaterBytes: 3,
    lowWaterBytes: 1,
    maxPendingBytes: 4,
    onBackpressure: (paused) => pauses.push(paused),
    onInvalid: (error) => invalid.push(error.message),
  });
  try {
    const first = state.write("1234");
    const overflow = await state.write("5");
    await first;
    assert.equal(overflow, false);
    assert.equal(state.isValid(), false);
    assert.deepEqual(pauses, [true, false]);
    assert.equal(invalid.length, 1);
    await assert.rejects(state.snapshot(), /backlog exceeded/);
  } finally {
    state.dispose();
  }
});

test("PtyManager hands protocol-response ownership between headless state and browser", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-terminal-state-"));
  const writes = [];
  let stateOptions;
  const handle = {
    onData() { return { dispose() {} }; },
    onExit() { return { dispose() {} }; },
    write(data) { writes.push(String(data)); },
    resize() {},
    pause() {},
    resume() {},
    kill() {},
  };
  const manager = new PtyManager({
    filePath: path.join(root, "ptys.json"),
    pty: { spawn: () => handle },
    stateFactory: (options) => {
      stateOptions = options;
      return {
        isValid: () => true,
        write: async () => true,
        resize: async () => true,
        snapshot: async () => ({ cols: 80, rows: 24, data: "" }),
        dispose() {},
      };
    },
  });
  try {
    const record = await manager.create({ project: { id: "workspace" }, cwd: root });
    stateOptions.onData("detached-reply");
    assert.deepEqual(writes, ["detached-reply"]);
    assert.equal(manager.setProtocolResponder(record.id, false), true);
    stateOptions.onData("browser-owned-reply");
    assert.deepEqual(writes, ["detached-reply"]);
    assert.equal(manager.setProtocolResponder(record.id, true), true);
    stateOptions.onData("detached-again");
    assert.deepEqual(writes, ["detached-reply", "detached-again"]);
  } finally {
    await manager.stopAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});
