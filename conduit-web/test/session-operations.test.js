import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { CHAT_CAPABILITY_KEYS, REQUIRED_CHAT_BACKEND_METHODS } from "../src/chat-backend-contract.js";
import { SessionRecords } from "../src/harnesses/session-records.js";
import { ChatBackendRegistry } from "../src/pi-rpc-adapter.js";
import { PiManager } from "../src/pi-manager.js";
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
  const children = [];
  const manager = new PiManager({
    agentDir: "/tmp/conduit-session-operations",
    reaperIntervalMs: 0,
    spawnImpl: () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = { write() {} };
      child.kill = (signal) => { queueMicrotask(() => child.emit("exit", 0, signal)); return true; };
      children.push(child);
      return child;
    },
    template: { id: "test", version: "1", models: [], tools: [], extensions: [], skills: [], promptTemplates: [] },
  });
  const project = { id: "project-a", slug: "a", workingRoot: "/tmp/project-a", sessionsDir: "/tmp/project-a/sessions" };
  const pi = manager.create({ project, chatId: "chat-a" });
  children[0].emit("spawn");
  const backends = new ChatBackendRegistry(manager);
  backends.adapters.set("codex", codex);

  await stopSessionProcesses(backends, { id: "chat-a" });
  assert.equal(pi.adapterImplementation, "conduit_pi");
  assert.equal(manager.get(pi.id), null);
  assert.deepEqual(closed, [["codex", "codex"]]);

  await stopProjectProcesses(backends, "project-a");
  assert.deepEqual(closed, [["codex", "codex"], ["codex", "orphan"]]);
});

test("a view cannot silently default to the Pi adapter", () => {
  const pi = adapter("conduit_pi", []);
  const backends = new ChatBackendRegistry(null, [["conduit_pi", pi]]);
  assert.throws(() => backends.adapterForRecord({ id: "view" }), { code: "backend_identity_missing" });
});
