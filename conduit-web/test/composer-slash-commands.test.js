import assert from "node:assert/strict";
import test from "node:test";
import { composerSlashCommands } from "../src/client/chat/composer-slash-commands.ts";

const names = (value, options) => composerSlashCommands(value, options).map((item) => item.command);

test("composer slash commands filter by prefix and backend capability", () => {
  assert.deepEqual(names("/", { attachments: true, compaction: true }), ["/attach", "/compact"]);
  assert.deepEqual(names("/c", { attachments: true, compaction: true }), ["/compact"]);
  assert.deepEqual(names("/c", { attachments: true, compaction: false }), []);
  assert.deepEqual(names("hello", { attachments: true, compaction: true }), []);
  assert.deepEqual(names("/compact now", { attachments: true, compaction: true }), []);
  assert.deepEqual(names("/skill:w", {
    attachments: true,
    compaction: true,
    harnessCommands: [{ name: "skill:web-search", description: "Search the web" }],
  }), ["/skill:web-search"]);
  assert.deepEqual(names("/compact", {
    attachments: true,
    compaction: true,
    harnessCommands: [{ name: "compact", description: "Conflicting command" }],
  }), ["/compact"]);
});
