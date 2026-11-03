import test from "node:test";
import assert from "node:assert/strict";
import { placeOf, remoteNode, capabilitiesOf } from "../src/place.js";

// Design: Architecture > Making it general; only transport differs for the hub.
test("a workspace keeps its owning environment and relative place", () => {
  const project = { nodeId: "fixture-wsl", place: { root: "fixture-root", path: "app" } };
  assert.deepEqual(placeOf(project), {
    device: project.nodeId, nodeId: project.nodeId, root: project.place.root, path: project.place.path, local: false,
  });
  assert.equal(remoteNode(project), project.nodeId);
  assert.equal(remoteNode({ ...project, local: true }), null);
  assert.equal(placeOf({ ...project, local: true }).local, true);
});

// Design decision 21; place.js capabilitiesOf: device says whose it is and whether it is online.
test("an offline workspace stays on its device instead of becoming a hub workspace", async () => {
  const project = { nodeId: "fixture-away", place: { root: "shared", path: "project" }, kind: "workspace" };
  const node = { deviceId: "fixture-device", name: "Fixture environment", roots: [{ id: project.place.root, shell: false }] };
  const hub = { live: new Map(), get: async (id) => { assert.equal(id, project.nodeId); return node; },
    listDevices: async () => [{ id: node.deviceId, name: "Fixture laptop" }] };
  const capabilities = await capabilitiesOf(project, {
    hub, backends: { local: ["hub-only"], adapters: new Map([["hub-only", {}]]) },
  });
  assert.equal(capabilities.device.id, project.nodeId);
  assert.equal(capabilities.device.local, false);
  assert.equal(capabilities.device.online, false);
  assert.equal(capabilities.deleteFiles, false);
  assert.deepEqual(capabilities.harnesses, []);
});

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
