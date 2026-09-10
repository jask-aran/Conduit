import test from "node:test";
import assert from "node:assert/strict";
import { MANIFESTS, manifestForImplementation, implementationsOf } from "../src/harnesses/index.js";
import { ChatBackendRegistry } from "../src/pi-rpc-adapter.js";
import { harnessCatalog } from "../src/server/routes/harnesses.js";
import { agentProfiles, profileSelection } from "../src/chat-backend.js";
import { SessionRecords } from "../src/harnesses/session-records.js";
import { unsupported } from "../src/harnesses/unsupported.js";
import { READY, UNAVAILABLE, detect } from "../src/harnesses/probe.js";

const config = { manager: {}, codexCommand: "codex", chatgptWebPython: "python3", chatgptWebScript: "x.py", chatgptWebDataDir: "/tmp/x" };
const allAvailable = () => new Map(MANIFESTS.map((manifest) => [manifest.id, READY("test")]));

test("every manifest declares the fields the server reads from it", () => {
  for (const manifest of MANIFESTS) {
    assert.ok(manifest.id, "id");
    assert.ok(manifest.label, `${manifest.id} label`);
    assert.ok(["pi_rpc", "acp", "native_api", "pty"].includes(manifest.protocol), `${manifest.id} protocol`);
    assert.ok(["machine", "folder", "none"].includes(manifest.discovery), `${manifest.id} discovery`);
    assert.equal(typeof manifest.probe, "function", `${manifest.id} probe`);
    assert.equal(typeof manifest.build, "function", `${manifest.id} build`);
    assert.ok(manifest.capabilities, `${manifest.id} capabilities`);
    // A harness that cannot enumerate threads cannot be driven from /computer.
    if (manifest.drive) assert.notEqual(manifest.discovery, "none", `${manifest.id} drives without discovery`);
  }
});

// The regression this file exists for: the same backend used to be spelled out
// in seven places, and nothing failed when one of them fell behind.
test("registration, catalog and profile selection all agree with the manifests", () => {
  const backends = ChatBackendRegistry.fromManifests(MANIFESTS, allAvailable(), config);
  for (const manifest of MANIFESTS) {
    for (const implementation of implementationsOf(manifest)) {
      assert.ok(backends.adapters.has(implementation), `${implementation} not registered`);
      assert.equal(backends.manifestFor(implementation), manifest);
      assert.equal(manifestForImplementation(implementation), manifest);
    }
  }
  const catalog = harnessCatalog(backends);
  for (const manifest of MANIFESTS.filter((item) => !item.builtIn)) {
    const row = catalog.find((item) => item.id === manifest.id);
    assert.ok(row, `${manifest.id} missing from the catalog`);
    assert.equal(row.available, true);
    assert.equal(row.discovery, manifest.discovery);
    assert.equal(row.sessions, manifest.discovery !== "none");
    assert.equal(row.drive, manifest.drive);
  }
  assert.equal(catalog.length, MANIFESTS.filter((item) => !item.builtIn).length);

  const profiles = agentProfiles([]);
  for (const manifest of MANIFESTS.filter((item) => item.profile)) {
    assert.ok(profiles.some((profile) => profile.id === manifest.id), `${manifest.id} is not offered as a profile`);
    assert.deepEqual(profileSelection({ profileId: manifest.id }), { profileId: manifest.id });
  }
});

test("an unavailable harness registers nothing but a built-in one always does", () => {
  const detection = new Map(MANIFESTS.map((manifest) => [manifest.id, UNAVAILABLE("not installed")]));
  const backends = ChatBackendRegistry.fromManifests(MANIFESTS, detection, config);
  for (const manifest of MANIFESTS) {
    for (const implementation of implementationsOf(manifest)) {
      assert.equal(backends.adapters.has(implementation), Boolean(manifest.builtIn), implementation);
    }
  }
  assert.deepEqual(harnessCatalog(backends).map((row) => row.available), [false, false]);
  assert.equal(agentProfiles([]).find((profile) => profile.id === "codex").disabled, false,
    "agentProfiles without an availability set treats every profile as usable");
});

test("re-probing registers a harness that appeared after startup", async () => {
  const detection = new Map(MANIFESTS.map((manifest) => [manifest.id, UNAVAILABLE()]));
  const backends = ChatBackendRegistry.fromManifests(MANIFESTS, detection, config);
  assert.equal(backends.adapters.has("codex"), false);
  backends.manifestList = MANIFESTS.map((manifest) =>
    manifest.id === "codex" ? { ...manifest, probe: () => READY("codex-cli 1.2.3") } : { ...manifest, probe: () => UNAVAILABLE() });
  await backends.refreshDetection();
  assert.equal(backends.adapters.has("codex"), true);
  assert.equal(backends.detection.get("codex").version, "codex-cli 1.2.3");
});

test("detection never throws and reports a failing probe as unavailable", async () => {
  const detection = await detect([
    { id: "boom", probe: () => { throw new Error("no binary"); } },
    { id: "fine", probe: () => READY("9") },
  ]);
  assert.equal(detection.get("boom").available, false);
  assert.match(detection.get("boom").detail, /no binary/);
  assert.equal(detection.get("fine").version, "9");
});

test("session records index, broadcast and replay to a late socket", () => {
  const records = new SessionRecords({
    capabilities: { replay: true }, backend: { implementation: "test" },
    extras: (record) => ({ title: record.title }),
  });
  const record = { id: "live-1", chatId: "chat-1", status: "running", activity: "idle", active: false,
    stopping: false, generation: null, model: "m", title: "Hello", clients: new Set(), events: [] };
  records.add(record);
  assert.equal(records.get("live-1"), record);
  assert.equal(records.getByChatId("chat-1"), record);
  assert.equal(records.view(record).title, "Hello");
  assert.equal(records.view(record).backend.implementation, "test");

  const sent = [];
  const open = { readyState: 1, send: (text) => sent.push(JSON.parse(text)), once: () => {} };
  records.publish(record, { type: "status", status: "working" });
  const state = records.attach("live-1", open);
  assert.deepEqual(sent.map((event) => event.type), ["status"], "a late socket replays the buffer");
  assert.equal(state.type, "runtime_state");
  records.publish(record, { type: "status", status: "idle" });
  assert.equal(sent.length, 2, "an attached socket receives live events");

  assert.equal(records.list().length, 1);
  records.remove("live-1");
  assert.equal(records.get("live-1"), null);
  assert.equal(records.getByChatId("chat-1"), null);
});

test("a closed socket is never written to", () => {
  const records = new SessionRecords({ capabilities: {}, backend: {} });
  const record = { id: "a", chatId: "c", clients: new Set(), events: [] };
  records.add(record);
  let writes = 0;
  record.clients.add({ readyState: 3, send: () => { writes += 1; } });
  records.publish(record, { type: "status" });
  assert.equal(writes, 0);
  assert.equal(record.events.length, 1, "the replay buffer still records it");
});

test("refusals are derived from the capability flags, not hand-written", () => {
  const capable = unsupported(
    { permissions: true, steer: true, followUpQueue: true, modelSwitch: true, thinkingLevels: true, usage: true },
    { label: "Full", protocol: "pi_rpc" },
  );
  assert.deepEqual(Object.keys(capable), ["fork"], "only forks, which no flag covers, are refused");

  const limited = unsupported(
    { permissions: false, steer: false, followUpQueue: false, modelSwitch: false, thinkingLevels: false, usage: false },
    { label: "Thin" },
  );
  for (const method of ["respondHostUi", "queue", "setModel", "setThinkingLevel", "fork", "sendPi"]) {
    assert.throws(() => limited[method](), { code: "unsupported_interaction", status: 400 }, method);
  }
  assert.throws(() => limited.queue(), /Thin does not support steering or follow-up queues/);
});

test("a backend without usage reports no context rather than failing the chat", async () => {
  const limited = unsupported({ usage: false }, { label: "Thin" });
  assert.equal(await limited.refreshContext(), null);
});

test("the migrated adapters expose exactly the refusals their flags imply", async () => {
  const { CodexAppServerAdapter, CODEX_CAPABILITIES } = await import("../src/codex-app-server-adapter.js");
  const codex = new CodexAppServerAdapter({ command: "codex" });
  // Codex answers approval requests, so respondHostUi must be real rather than
  // a refusal - the flag and the method have to agree.
  assert.equal(CODEX_CAPABILITIES.permissions, true);
  assert.throws(() => codex.respondHostUi("missing-session", {}), { code: "backend_unavailable" },
    "it fails on the missing session, not because the interaction is unsupported");
  // Codex steers and queues, so `queue` must be real rather than a refusal.
  assert.equal(CODEX_CAPABILITIES.steer, true);
  assert.rejects(() => codex.queue("missing-session", "steer", "hi"), { code: "backend_unavailable" });
  assert.equal(CODEX_CAPABILITIES.modelSwitch, true);
  assert.equal(typeof codex.setModel, "function");
  assert.equal(await codex.refreshContext(), null);
});
