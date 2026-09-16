import assert from "node:assert/strict";
import test from "node:test";
import { manifestForChat, resolveCapability, resolveHistory } from "../src/client/chat-capabilities.ts";

const PI = { approvals: true, permissionModes: false, attachments: true, toolUse: true };
const CODEX = { approvals: true, permissionModes: true, attachments: false, toolUse: true };
const harnesses = { conduit_pi: PI, codex: CODEX };
const chat = (implementation) => ({ backend: { implementation } });

test("a chat's capabilities come from the harness running it", () => {
  assert.equal(manifestForChat(harnesses, chat("codex")), CODEX);
  // Every Pi profile elects the same harness, so they all resolve to one
  // declaration rather than to four copies of it.
  assert.equal(manifestForChat(harnesses, chat("conduit_pi")), PI);
  assert.equal(manifestForChat(harnesses, { profileId: "assistant", ...chat("conduit_pi") }), PI);
});

test("an unknown harness gets no capabilities rather than the default one's", () => {
  // The picker falls back to a default so it always has something to show.
  // Doing that here would quietly answer a codex chat's questions with Pi's.
  assert.equal(manifestForChat(harnesses, chat("chatgpt_web")), null);
  assert.equal(manifestForChat(harnesses, chat(undefined)), null);
  assert.equal(manifestForChat(harnesses, null), null);
  assert.equal(manifestForChat({}, chat("conduit_pi")), null);
});

test("the manifest decides and a live record may only narrow it", () => {
  // Declared on, nothing reported: on immediately, with no process involved.
  assert.equal(resolveCapability(PI, null, "approvals"), true);
  // A process may take one away -- it can outlive the profile its chat names.
  assert.equal(resolveCapability(PI, { approvals: false }, "approvals"), false);
  // It may never add one. This is the flicker the manifest exists to prevent.
  assert.equal(resolveCapability(CODEX, { attachments: true }, "attachments"), false);
});

test("with no manifest the reported value stands, and the fallback behind it", () => {
  assert.equal(resolveCapability(null, { approvals: true }, "approvals"), true);
  assert.equal(resolveCapability(null, null, "approvals"), false);
  // attachments is asked with a fallback of true, so an unknown harness still
  // offers the paperclip rather than silently dropping it.
  assert.equal(resolveCapability(null, null, "attachments", true), true);
});

test("answering approvals and offering modes are asked separately", () => {
  // One flag used to answer both, which is why a Pi chat showed a permission
  // selector it had nothing to put in: Pi answers approval requests, so the
  // flag was true, and the UI read that as "has modes to choose between".
  assert.equal(resolveCapability(PI, null, "approvals"), true);
  assert.equal(resolveCapability(PI, null, "permissionModes"), false);
  assert.equal(resolveCapability(CODEX, null, "approvals"), true);
  assert.equal(resolveCapability(CODEX, null, "permissionModes"), true);
});

test("history comes from the manifest and a live record may only shallow it", () => {
  const tree = { history: "tree" };
  const linear = { history: "linear" };
  // Known the moment the chat is selected, so the History tab does not wait
  // for a process to appear and then pop in.
  assert.equal(resolveHistory(tree, null), "tree");
  assert.equal(resolveHistory(linear, null), "linear");
  // A running process may report less history than the harness claims.
  assert.equal(resolveHistory(tree, linear), "linear");
  assert.equal(resolveHistory(tree, { history: "none" }), "none");
  // It may not claim more, the same rule every other capability follows.
  assert.equal(resolveHistory(linear, tree), "linear");
  // Unknown harness: nothing to show rather than a tab that cannot load.
  assert.equal(resolveHistory(null, null), "none");
  assert.equal(resolveHistory(null, tree), "tree");
});
