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
    modelCatalog: { generateSessionName: async () => "Useful Name" },
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

test("a failed log append does not poison later writes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-session-names-"));
  const service = new SessionNameService({
    file: root,
    preferences: { get: () => ({}) },
    modelCatalog: {},
  });

  await assert.rejects(service.recordFallback({ chatId: "first", name: "First" }));
  service.file = path.join(root, "requests.jsonl");
  await service.recordFallback({ chatId: "second", name: "Second" });

  const entry = JSON.parse((await fs.readFile(service.file, "utf8")).trim());
  assert.equal(entry.chatId, "second");
  await fs.rm(root, { recursive: true, force: true });
});
