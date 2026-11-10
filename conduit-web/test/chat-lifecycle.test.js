import assert from "node:assert/strict";
import test from "node:test";
import { ChatLifecycle } from "../src/chat-lifecycle.js";

function deferred() {
  let resolve;
  return { promise: new Promise((next) => { resolve = next; }), resolve };
}

test("chat lifecycle serializes a move behind launch work", async () => {
  const lifecycle = new ChatLifecycle();
  const launchReady = deferred();
  const releaseLaunch = deferred();
  const order = [];
  const launch = lifecycle.runLaunch("chat-a", async () => {
    order.push("launch");
    launchReady.resolve();
    await releaseLaunch.promise;
    order.push("launch-complete");
  });
  await launchReady.promise;
  const move = lifecycle.run("chat-a", async () => { order.push("move"); });
  await Promise.resolve();
  assert.deepEqual(order, ["launch"]);
  releaseLaunch.resolve();
  await Promise.all([launch, move]);
  assert.deepEqual(order, ["launch", "launch-complete", "move"]);
});

test("chat serialization releases the mutex when earlier work fails", async () => {
  const lifecycle = new ChatLifecycle();
  const ready = deferred();
  const release = deferred();
  const failure = Object.assign(new Error("failed"), { code: "expected_failure" });
  const order = [];
  const first = lifecycle.run("chat-a", async () => {
    order.push("first");
    ready.resolve();
    await release.promise;
    throw failure;
  });
  await ready.promise;
  const second = lifecycle.run("chat-a", async () => {
    order.push("second");
    return "ok";
  });

  release.resolve();
  await assert.rejects(first, (error) => {
    assert.equal(error, failure, "Effect preserves the original rejected Error");
    return true;
  });
  assert.equal(await second, "ok");
  assert.deepEqual(order, ["first", "second"]);
});

test("concurrent launch requests join the chat creation launch", async () => {
  const lifecycle = new ChatLifecycle();
  const ready = deferred();
  const release = deferred();
  let starts = 0;
  const first = lifecycle.runLaunch("chat-a", async () => {
    starts += 1;
    ready.resolve();
    await release.promise;
    return "live-a";
  });
  await ready.promise;
  const second = lifecycle.runLaunch("chat-a", async () => {
    starts += 1;
    return "live-b";
  });
  release.resolve();
  assert.deepEqual(await Promise.all([first, second]), ["live-a", "live-a"]);
  assert.equal(starts, 1);
});

test("chat deletion prevents a concurrent launch before process inspection", async () => {
  const lifecycle = new ChatLifecycle();
  const deleting = deferred();
  const removal = lifecycle.deleteChat("chat-a", async () => {
    await deleting.promise;
  });
  await assert.rejects(
    lifecycle.runLaunch("chat-a", async () => {}),
    { code: "chat_deleting" },
  );
  deleting.resolve();
  await removal;
});
