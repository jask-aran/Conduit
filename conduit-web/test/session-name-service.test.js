import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionNameService } from "../src/session-name-service.js";

test("session naming records request identity and terminal outcome without prompt content", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-session-names-"));
  const file = path.join(root, "requests.jsonl");
  const times = [1_000, 1_025];
  const service = new SessionNameService({
    file,
    preferences: { get: () => ({ sessionNameModel: "example/cheap", sessionNameThinkingLevel: "low" }) },
    contextStore: { assemble: async () => "Name the chat" },
    modelCatalog: { generateSessionName: async (_cwd, _model, _thinking, _message, prompt) => prompt === "Name the chat" ? "Useful Name" : "" },
    now: () => times.shift(),
  });

  await service.run({
    chatId: "chat-12345678",
    cwd: "/tmp/project",
    source: "first_prompt",
    message: "private prompt",
    apply: async () => "applied",
  });

  const entries = (await fs.readFile(file, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].event, "requested");
  assert.equal(entries[1].outcome, "applied");
  assert.equal(entries[1].durationMs, 25);
  assert.equal(entries[0].requestId, entries[1].requestId);
  assert.equal(entries[0].chatId, "chat-12345678");
  assert.equal(entries[0].model, "example/cheap");
  assert.equal(JSON.stringify(entries).includes("private prompt"), false);
  await fs.rm(root, { recursive: true, force: true });
});

