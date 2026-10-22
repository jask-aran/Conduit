import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_CAPABILITY_KEYS, REQUIRED_CHAT_BACKEND_METHODS } from "../src/chat-backend-contract.js";
import { SessionRecords } from "../src/harnesses/session-records.js";
import { ChatBackendRegistry } from "../src/chat-backend-registry.js";
import { stopProjectProcesses, stopSessionProcesses } from "../src/session-operations.js";

const capabilities = { history: "none", ...Object.fromEntries(CHAT_CAPABILITY_KEYS.map((key) => [key, false])) };

function adapter(implementation, closed) {
  const records = new SessionRecords({ capabilities, backend: { implementation } });
  const value = {};
  for (const method of REQUIRED_CHAT_BACKEND_METHODS) value[method] = () => null;
  Object.assign(value, {
    getCapabilities: () => capabilities,
    get: (id) => records.get(id),
    getByChatId: (id) => records.getByChatId(id),
    list: () => records.list(),
    rawRecords: () => records.rawRecords(),
    view: (record) => records.view(record),
    close: async (id) => { closed.push([implementation, id]); records.remove(id); },
    records,
  });
  return value;
}

test("chat and project teardown resolve views back to real adapter records", async () => {
  const closed = [];
  const codex = adapter("codex", closed);
  codex.records.add({ id: "codex", chatId: "chat-a", projectId: "project-a", adapterImplementation: "codex" });
  codex.records.add({ id: "orphan", chatId: "chat-b", projectId: "project-a", adapterImplementation: "codex" });
  codex.records.add({ id: "stopped", chatId: "chat-a", projectId: "project-a", adapterImplementation: "codex", status: "stopped" });
  const backends = new ChatBackendRegistry();
  backends.adapters.set("codex", codex);

  await stopSessionProcesses(backends, { id: "chat-a" });
  assert.deepEqual(closed, [["codex", "codex"]]);

  await stopProjectProcesses(backends, "project-a");
  assert.deepEqual(closed, [["codex", "codex"], ["codex", "orphan"]]);
});

test("backend registry closes each adapter alias once and cleans its resources", async () => {
  const events = [];
  const backend = {
    records: [{ id: "one" }, { id: "two" }],
    rawRecords() { return this.records; },
    async close(id) {
      events.push(`close:${id}`);
      this.records = this.records.filter((record) => record.id !== id);
      return true;
    },
    shutdownResources() { events.push("cleanup"); },
  };
  const registry = new ChatBackendRegistry();
  registry.adapters.set("primary", backend);
  registry.adapters.set("alias", backend);

  const stopped = await registry.shutdown();

  assert.deepEqual(events, ["close:one", "close:two", "cleanup"]);
  assert.equal(stopped.get(backend), 2);
  assert.equal(backend.records.length, 0);
});
