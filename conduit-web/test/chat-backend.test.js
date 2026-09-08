import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ChatStore, chatView } from "../src/chat-store.js";
import { agentProfiles, profileSelection } from "../src/chat-backend.js";
import { startConduitHarness } from "./helpers/conduit-harness.js";

test("legacy Pi rows gain durable identity without changing JSONL or exposing paths", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-backend-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = { id: "project_test", workingRoot: root, sessionsDir: path.join(root, "sessions") };
  await fs.mkdir(project.sessionsDir);
  const file = path.join(project.sessionsDir, "session.jsonl");
  const transcript = JSON.stringify({ type: "session", id: "session-test", cwd: root }) + "\n";
  await fs.writeFile(file, transcript);
  const registry = path.join(root, "registry.json");
  const now = new Date().toISOString();
  await fs.writeFile(registry, JSON.stringify({ version: 3, chats: [{
    id: "chat-test", projectId: project.id, status: "active", title: "Existing",
    templateId: "assistant", templateVersion: "7", piSessionFile: file, piSessionId: "session-test",
    createdAt: now, updatedAt: now,
  }] }));
  const store = new ChatStore(registry);
  await store.initialize([project]);
  const backend = structuredClone(store.metadata("chat-test").backend);
  assert.deepEqual(backend, {
    profileId: "assistant", profileRevision: "7", management: "conduit",
    protocol: "pi_rpc", implementation: "conduit_pi", installationId: "conduit-pinned", opaqueSession: file,
  });
  await store.update("chat-test", { templateVersion: "8" });
  assert.deepEqual(store.metadata("chat-test").backend, backend);
  const restored = new ChatStore(registry);
  await restored.initialize([project]);
  assert.deepEqual(restored.metadata("chat-test").backend, backend);
  assert.equal((await restored.find([project], "chat-test")).file, file);
  assert.equal(await fs.readFile(file, "utf8"), transcript);
  assert.equal(JSON.stringify(chatView(restored.metadata("chat-test"))).includes(file), false);
  const neutralRow = structuredClone(restored.metadata("chat-test"));
  delete neutralRow.templateId;
  delete neutralRow.templateVersion;
  delete neutralRow.runtime;
  delete neutralRow.piSessionFile;
  await fs.writeFile(registry, JSON.stringify({ version: 4, chats: [neutralRow] }));
  const neutralStore = new ChatStore(registry);
  await neutralStore.initialize([project]);
  assert.equal(neutralStore.metadata("chat-test").templateId, "assistant");
  assert.equal((await neutralStore.find([project], "chat-test")).file, file);
  assert.deepEqual(neutralStore.metadata("chat-test").backend, backend);
  const fork = path.join(project.sessionsDir, "fork.jsonl");
  await restored.commitSession("chat-test", { file: fork, id: "fork-test" });
  assert.deepEqual(restored.metadata("chat-test").backend, { ...backend, opaqueSession: fork });
  assert.equal(JSON.parse(await fs.readFile(registry, "utf8")).version, 4);

  const native = await store.create(project, { runtime: { kind: "native_pi" } });
  assert.equal(native.backend.profileId, "host-pi");
  assert.equal(native.backend.management, "agent");
  assert.equal(native.backend.implementation, "native_pi");
  assert.equal(native.backend.installationId, "host-pi");
  const draft = await store.create(project, { templateId: "coding", templateVersion: "1" });
  await store.update(draft.id, { piSessionFile: file, templateVersion: "2" });
  await store.update(draft.id, { templateVersion: "2" });
  assert.equal(draft.backend.profileRevision, "1");
});

test("profile selection uses current names and rejects conflicting legacy fields", () => {
  assert.deepEqual(profileSelection({ profileId: "coding" }), {
    profileId: "coding", templateId: "coding", runtimeKind: "conduit_profile",
  });
  assert.throws(() => profileSelection({ profileId: "coding", templateId: "assistant" }), { code: "profile_conflict" });
  assert.throws(() => profileSelection({ profileId: "host-pi", runtimeKind: "conduit_profile" }), { code: "profile_conflict" });
  assert.throws(() => profileSelection({ profileId: {} }), { code: "invalid_profile" });
  assert.equal(agentProfiles([{ id: "assistant", label: "Assistant" }])[0].agent.implementation, "conduit_pi");
});

test("public profile selection and legacy chat creation keep the same Pi identity", async (t) => {
  const harness = await startConduitHarness();
  t.after(() => harness.stop());
  const profiles = await (await harness.request("/v0/profiles")).json();
  assert.ok(profiles.profiles.some((profile) => profile.id === "assistant"));
  for (const selection of [{ profileId: "assistant" }, { templateId: "assistant" }]) {
    const response = await harness.request("/v0/chats", { method: "POST", body: JSON.stringify(selection) });
    assert.equal(response.status, 201);
    const chat = await response.json();
    assert.equal(chat.profileId, "assistant");
    assert.equal(chat.backend.implementation, "conduit_pi");
    assert.equal("opaqueSession" in chat.backend, false);
    const changed = await harness.request(`/v0/chats/${chat.id}`, {
      method: "PATCH", body: JSON.stringify({ profileId: "code-mode" }),
    });
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).profileId, "code-mode");
  }
});
