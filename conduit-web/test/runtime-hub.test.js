import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeHub } from "../src/runtime-hub.js";

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
