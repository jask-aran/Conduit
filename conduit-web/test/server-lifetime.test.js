import assert from "node:assert/strict";
import test from "node:test";
import { ServerLifetime } from "../src/server/server-lifetime.js";

const quiet = { warn: () => {}, error: () => {} };

test("the server lets go in reverse, past a release that fails or hangs", async () => {
  const lifetime = new ServerLifetime({ log: quiet });
  const released = [];
  lifetime.own("first", "a", (name) => { released.push(name); });
  lifetime.own("hangs", "b", () => new Promise(() => {}), { timeoutMs: 20 });
  lifetime.own("fails", "c", () => { released.push("c"); throw new Error("boom"); });
  lifetime.own("last", "d", async (name) => { released.push(name); });
  await Promise.all([lifetime.close(), lifetime.close()]);
  assert.deepEqual(released, ["d", "c", "a"]);
});
