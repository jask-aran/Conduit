import test from "node:test";
import assert from "node:assert/strict";
import { harnessCatalog } from "../src/server/routes/harnesses.js";

test("harness catalog exposes installed adapter capabilities", () => {
  const backends = { adapters: new Map([["codex", {}]]) };
  assert.deepEqual(harnessCatalog(backends), [
    { id: "codex", label: "Codex", available: true, sessions: true, drive: true },
    { id: "chatgpt-web", label: "ChatGPT Web", available: false, sessions: false, drive: false },
  ]);
});
