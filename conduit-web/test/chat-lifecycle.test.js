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

test("different chats do not share a serialization permit", { timeout: 1_000 }, async () => {
  const lifecycle = new ChatLifecycle();
  const firstReady = deferred();
  const releaseFirst = deferred();
  const first = lifecycle.run("chat-a", async () => {
    firstReady.resolve();
    await releaseFirst.promise;
  });
  await firstReady.promise;

  // If chat keys accidentally collapse onto one global semaphore this await
  // cannot finish until chat-a is released, and the test times out.
  assert.equal(await lifecycle.run("chat-b", async () => "chat-b"), "chat-b");

  releaseFirst.resolve();
  await first;
});

test("registered chat work is busy before its callback starts", async () => {
  const lifecycle = new ChatLifecycle();
  const release = deferred();
  const running = lifecycle.run("chat-a", () => release.promise);

  await assert.rejects(
    lifecycle.runLaunch("chat-a", async () => assert.fail("launch must not start")),
    { code: "live_session_starting" },
  );

  release.resolve();
  await running;
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

test("concurrent launch requests reject different settings", async () => {
  const lifecycle = new ChatLifecycle();
  const ready = deferred();
  const release = deferred();
  const first = lifecycle.runLaunch("chat-a", async () => {
    ready.resolve();
    await release.promise;
  }, { model: "one" });
  await ready.promise;
  await assert.rejects(lifecycle.runLaunch("chat-a", async () => {}, { model: "two" }), {
    code: "live_session_start_mismatch",
  });
  release.resolve();
  await first;
});

test("a passive open joins a launch that already selected its model", async () => {
  const lifecycle = new ChatLifecycle();
  let release;
  let started;
  const running = new Promise((resolve) => { started = resolve; });
  const first = lifecycle.runLaunch("chat", async () => {
    await running;
    return new Promise((resolve) => { release = resolve; });
  }, {
    requestedProject: "project", model: "gpt", thinkingLevel: "high", forceModel: true,
  });
  started();
  while (!release) await Promise.resolve();
  const second = lifecycle.runLaunch("chat", () => assert.fail("duplicate launch"), {
    requestedProject: "project", model: "", thinkingLevel: "", forceModel: false,
  });
  release("live");
  assert.equal(await second, "live");
  await first;
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

test("project deletion blocks new launches and waits for an in-flight mapping commit", async () => {
  const lifecycle = new ChatLifecycle();
  const commitReady = deferred();
  const releaseCommit = deferred();
  const launch = lifecycle.runLaunch("chat-a", async () => lifecycle.withProjects(["project-a"], async () => {
    commitReady.resolve();
    await releaseCommit.promise;
  }));
  await commitReady.promise;
  const deletion = lifecycle.beginProjectDeletion("project-a");
  await assert.rejects(
    lifecycle.runLaunch("chat-b", async () => lifecycle.withProjects(["project-a"], async () => {})),
    { code: "project_deleting" },
  );
  releaseCommit.resolve();
  const finish = await deletion;
  finish();
  await launch;
});

test("project deletion captures the active drain before work can finish in the same turn", async () => {
  const lifecycle = new ChatLifecycle();
  const held = deferred();
  const work = lifecycle.withProjects(["project-a"], () => held.promise);

  // Resolve before Effect evaluates the timeout thunk. Deletion must keep the
  // active period's latch rather than re-reading state after the worker clears it.
  queueMicrotask(() => held.resolve());
  const finish = await lifecycle.beginProjectDeletion("project-a");
  finish();
  await work;

  assert.doesNotThrow(() => lifecycle.assertAvailable("chat-a", "project-a"));
});

test("project deletion releases its guard when active work does not drain", async () => {
  const lifecycle = new ChatLifecycle({ projectDrainTimeoutMs: 5 });
  const held = deferred();
  const work = lifecycle.withProjects(["project-a"], () => held.promise);
  await assert.rejects(lifecycle.beginProjectDeletion("project-a"), { code: "project_busy" });
  assert.doesNotThrow(() => lifecycle.assertAvailable("chat-a", "project-a"));
  held.resolve();
  await work;
});
