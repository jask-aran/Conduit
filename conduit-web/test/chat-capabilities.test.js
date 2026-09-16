import assert from "node:assert/strict";
import test from "node:test";
import { manifestForChat, resolveCapability } from "../src/client/chat-capabilities.ts";

const PI = { permissions: true, attachments: true, toolUse: true };
const CODEX = { permissions: true, attachments: false, toolUse: true };
const profiles = [
  { id: "assistant", capabilities: PI },
  { id: "codex", capabilities: CODEX },
  { id: "picker-only" },
];

test("a chat's manifest comes from its own profile, by its own id", () => {
  assert.equal(manifestForChat(profiles, { profileId: "codex" }), CODEX);
  // profileId is authoritative; templateId is the older spelling of the same
  // thing and only answers when there is no profileId.
  assert.equal(manifestForChat(profiles, { profileId: "codex", templateId: "assistant" }), CODEX);
  assert.equal(manifestForChat(profiles, { templateId: "assistant" }), PI);
});

test("an unknown profile gets no capabilities rather than the default harness's", () => {
  // The picker falls back to a default so it always has something to show.
  // Doing that here would quietly answer a codex chat's questions with Pi's.
  assert.equal(manifestForChat(profiles, { profileId: "chatgpt-web" }), null);
  assert.equal(manifestForChat(profiles, { profileId: "picker-only" }), null);
  assert.equal(manifestForChat(profiles, null), null);
  assert.equal(manifestForChat([], { profileId: "assistant" }), null);
});

test("the manifest decides and a live record may only narrow it", () => {
  // Declared on, nothing reported: on immediately, with no process involved.
  assert.equal(resolveCapability(PI, null, "permissions"), true);
  // A process may take one away -- it can outlive the profile its chat names.
  assert.equal(resolveCapability(PI, { permissions: false }, "permissions"), false);
  // It may never add one. This is the flicker the manifest exists to prevent.
  assert.equal(resolveCapability(CODEX, { attachments: true }, "attachments"), false);
});

test("with no manifest the reported value stands, and the fallback behind it", () => {
  assert.equal(resolveCapability(null, { permissions: true }, "permissions"), true);
  assert.equal(resolveCapability(null, null, "permissions"), false);
  // attachments is asked with a fallback of true, so an unknown harness still
  // offers the paperclip rather than silently dropping it.
  assert.equal(resolveCapability(null, null, "attachments", true), true);
});
