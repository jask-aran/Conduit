import test from "node:test";
import assert from "node:assert/strict";
import { MANIFESTS, manifestForImplementation, implementationsOf } from "../src/harnesses/index.js";
import { ChatBackendRegistry } from "../src/chat-backend-registry.js";
import { harnessCatalog } from "../src/server/routes/harnesses.js";
import { agentProfiles, profileSelection } from "../src/chat-backend.js";
import { SessionRecords } from "../src/harnesses/session-records.js";
import { unsupported } from "../src/harnesses/unsupported.js";
import { READY } from "../src/harnesses/probe.js";

const config = { manager: {}, dataRoot: "/tmp/conduit-manifests-test", codexCommand: "codex", chatgptWebPython: "python3", chatgptWebScript: "x.py", chatgptWebDataDir: "/tmp/x" };
const allAvailable = () => new Map(MANIFESTS.map((manifest) => [manifest.id, READY("test")]));

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
  // The stream sends the catch-up frame itself, from the adapter's view, so
  // attach does not return a thinner second one for it to send first.
  assert.equal(state, null);
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

