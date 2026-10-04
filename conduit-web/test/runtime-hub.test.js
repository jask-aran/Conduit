import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeHub } from "../src/runtime-hub.js";

test("runtime hub sends snapshot on attach and process updates to all clients", () => {
  const views = [{ id: "p1", chatId: "c1", status: "running", activity: "idle" }];
  const hub = new RuntimeHub({ listViews: () => views });
  const writes = [];
  const client = {
    kind: "sse",
    response: {
      writableEnded: false,
      write(chunk) { writes.push(chunk); },
    },
  };
  const detach = hub.attach(client);
  assert.equal(writes.length, 1);
  assert.match(writes[0], /runtime_global_snapshot/);
  assert.match(writes[0], /"chatId":"c1"/);

  hub.publishProcess({ id: "p1", chatId: "c1", status: "running", activity: "working" }, "state");
  assert.equal(writes.length, 2);
  assert.match(writes[1], /runtime_process/);
  assert.match(writes[1], /"working"/);

  hub.publishProcessRemoved("p1", "c1");
  assert.equal(writes.length, 3);
  assert.match(writes[2], /runtime_process_removed/);

  hub.publishTerminal({ id: "t1", projectId: "project", status: "exited" }, "exit");
  assert.equal(writes.length, 4);
  assert.match(writes[3], /terminal_changed/);
  assert.match(writes[3], /"status":"exited"/);

  hub.publishTerminalRemoved("t1", "project");
  assert.equal(writes.length, 5);
  assert.match(writes[4], /terminal_removed/);

  hub.prepareRestart({ attempt: "a1", target: "h1" });
  assert.match(writes[5], /pwa_restart_prepared/);
  hub.prepareRestart({ attempt: "a1", target: "h1" });
  assert.equal(writes.length, 6);
  assert.equal(hub.snapshot().restartPrepared, true);

  detach();
  hub.publishProcess({ id: "p2", chatId: "c2", status: "running", activity: "idle" });
  assert.equal(writes.length, 6);
});

test("a restart waits for each browser registration once, and never for a native client", () => {
  const hub = new RuntimeHub();
  const client = () => ({ kind: "sse", response: { writableEnded: false, write() {} } });
  hub.attach(client(), { kind: "browser", registration: "reg-one" });
  const tab = hub.attach(client(), { kind: "browser", registration: "reg-one" });
  const other = hub.attach(client(), { kind: "browser", registration: "reg-two" });
  hub.attach(client(), { kind: "android", build: "0.7.10" });

  const status = hub.prepareRestart({ attempt: "a1", target: "h1" });
  assert.deepEqual(status.waiting.sort(), ["reg-one", "reg-two"], "two tabs of one registration count once; Android is not waited on");

  // An acknowledgement counts only for this attempt and target.
  assert.equal(hub.acknowledgeRestart({ attempt: "stale", target: "h1", registration: "reg-one" }), false);
  assert.equal(hub.acknowledgeRestart({ attempt: "a1", target: "old", registration: "reg-one" }), false);
  assert.equal(hub.acknowledgeRestart({ attempt: "a1", target: "h1", registration: "reg-one" }), true);
  assert.deepEqual(hub.restartStatus().waiting, ["reg-two"]);

  // A late arrival is told but not waited on; a disconnected one stops holding.
  hub.attach(client(), { kind: "browser", registration: "reg-late" });
  other();
  tab();
  assert.deepEqual(hub.restartStatus().waiting, []);
});
