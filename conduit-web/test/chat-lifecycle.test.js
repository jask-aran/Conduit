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

test("chat deletion prevents a concurrent launch before process inspection", async () => {
  const lifecycle = new ChatLifecycle();
  const deleting = deferred();
  const removal = lifecycle.deleteChat("chat-a", async () => {
    await deleting.promise;
  });
  await assert.rejects(
    lifecycle.runLaunch("chat-a", async () => {}),
    { code: "live_session_starting" },
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
