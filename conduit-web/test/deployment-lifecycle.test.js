import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { startConduitHarness } from "./helpers/conduit-harness.js";

test("health identifies the release and SIGTERM drains resident Pi", async () => {
  const release = "0123456789abcdef";
  const harness = await startConduitHarness({ env: { CONDUIT_RELEASE: release } });
  try {
    const health = await (await harness.request("/healthz")).json();
    assert.deepEqual(health, { ok: true, status: "ready", release });

    const chat = await harness.createChat();
    const sessionFile = path.join(harness.root, "pi", "sessions", `${chat.id}.jsonl`);
    await fs.mkdir(path.dirname(sessionFile), { recursive: true });
    await fs.writeFile(sessionFile, `${JSON.stringify({
      type: "session",
      id: `session-${chat.id}`,
      cwd: path.join(harness.root, "files"),
    })}\n`);
    const launch = harness.request("/v0/live-sessions", {
      method: "POST",
      body: JSON.stringify({ chatId: chat.id, projectId: chat.projectId }),
    });
    const state = await harness.pi.waitForCommand("get_state");
    await harness.pi.reply(state, { sessionFile, sessionId: `session-${chat.id}` });
    assert.equal((await launch).status, 201);

    const stopped = await harness.terminate();
    assert.equal(stopped.exitCode, 0);
    assert.match(stopped.output, /received SIGTERM; stopping/);
    assert.match(stopped.output, /stopped 1 Pi process/);
  } finally {
    await harness.stop();
  }
});
