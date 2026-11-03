import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { placeProcesses } from "../src/nodes/place-processes.js";
import { nodeFixture } from "./helpers/nodes-fixture.js";

// remote-spawn.js: a device process has child-process streams and reports code or signal.
test("a process on a node streams stdout and stderr and returns its exit code", { timeout: 700 }, async (t) => {
  const { hub, place } = await nodeFixture(t);
  const output = "fixture output π";
  const error = "fixture diagnostic";
  const code = 23;
  const child = placeProcesses(hub, { nodeId: "fixture-node", place }).spawn("claude-code", process.execPath,
    ["-e", `process.stdout.write(${JSON.stringify(output)}); process.stderr.write(${JSON.stringify(error)}); process.exitCode = ${code}`]);
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = once(child, "exit");
  assert.deepEqual(await exited, [code, null]);
  assert.equal(stdout, output);
  assert.equal(stderr, error);
  assert.equal(child.exitCode, code);
});

// remote-spawn.js kill and node-processes.js kill: hub signals the device's child.
test("a kill from the hub ends the process running on the node", { timeout: 700 }, async (t) => {
  const { hub, place } = await nodeFixture(t);
  const child = placeProcesses(hub, { nodeId: "fixture-node", place }).spawn("claude-code", process.execPath,
    ["-e", 'process.stdin.resume(); process.stdout.write("ready")']);
  const exited = once(child, "exit");
  await once(child.stdout, "data");
  assert.equal(child.kill("SIGTERM"), true);
  assert.equal(child.killed, true);
  const [code, signal] = await exited;
  assert.ok(code !== 0 || signal, "the child did not finish normally");
  assert.equal(child.signalCode, signal);
});
