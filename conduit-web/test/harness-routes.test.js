import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { startConduitHarness } from "./helpers/conduit-harness.js";

test("opening a thread in an unknown folder is rejected before a chat is made", async (t) => {
  const harness = await startConduitHarness();
  t.after(() => harness.stop());
  const response = await harness.request("/v0/harnesses/codex/threads/open", {
    method: "POST", body: JSON.stringify({ path: "/definitely/not/here", newThread: true }),
  });
  assert.equal(response.status, 400);
});
