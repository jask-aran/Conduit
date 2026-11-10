import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ChatStore, chatView } from "../src/chat-store.js";
import { agentProfiles, profileSelection } from "../src/chat-backend.js";

test("profile selection reads a template or a harness profile", () => {
  assert.deepEqual(profileSelection({ profileId: "coding" }), { profileId: "coding", templateId: "coding" });
  assert.throws(() => profileSelection({ profileId: {} }), { code: "invalid_profile" });
  assert.equal(agentProfiles([{ id: "assistant", label: "Assistant" }])[0].agent.implementation, "conduit-runtime");
  assert.deepEqual(profileSelection({ profileId: "codex" }), { profileId: "codex" });
  assert.deepEqual(profileSelection({ profileId: "chatgpt-web" }), { profileId: "chatgpt-web" });
  assert.equal(agentProfiles([]).find((profile) => profile.id === "chatgpt-web").agent.implementation, "chatgpt-web");
});

test("agent-managed Codex identity persists", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-codex-backend-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = { id: "project_codex", workingRoot: root };
  const registry = path.join(root, "registry.json");
  const backend = { profileId: "codex", profileRevision: null, management: "agent", protocol: "native_api",
    implementation: "codex", installationId: "host-codex", opaqueSession: "thread-1" };
  const store = new ChatStore(registry);
  const chat = await store.create(project, { backend });
  assert.equal(chatView(chat).harnessId, "codex");
  await store.update(chat.id, { status: "active", lastUserMessageAt: new Date().toISOString() });
  const restored = new ChatStore(registry);
  await restored.initialize([project]);
  assert.deepEqual(restored.metadata(chat.id).backend, backend);
});
