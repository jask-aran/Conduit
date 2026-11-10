import test from "node:test";
import assert from "node:assert/strict";
import { capabilitiesOf } from "../src/place.js";

// place.js capabilitiesOf: remote Git and Git checkpoints require the root's shell grant.
test("device Git and checkpoints follow the shared root shell grant", async () => {
  const project = { nodeId: "fixture-node", place: { root: "shared", path: "project" }, kind: "workspace" };
  const root = { id: project.place.root, shell: false };
  const hub = { live: new Map([[project.nodeId, { ready: true, roots: [root] }]]),
    get: async () => ({ deviceId: "fixture-device" }), listDevices: async () => [] };
  const options = { hub, backends: { adapters: new Map() } };
  for (const shell of [false, true]) {
    root.shell = shell;
    const capabilities = await capabilitiesOf(project, options);
    assert.equal(capabilities.git, shell);
    assert.equal(capabilities.checkpoints, shell);
    assert.equal(capabilities.deleteFiles, false);
  }
  assert.equal((await capabilitiesOf({ ...project, kind: "folder" }, options)).checkpoints, false);
});
