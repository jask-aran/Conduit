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

  detach();
  hub.publishProcess({ id: "p2", chatId: "c2", status: "running", activity: "idle" });
  assert.equal(writes.length, 3);
});
