import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/client/state/active-chat.ts", import.meta.url), "utf8");

test("per-chat stores are selected from one place", () => {
  // Each of these holds one chat's answers until told to hold another's, so a
  // path into a chat that skips one leaves it answering for the chat before.
  // That failure is silent -- nothing throws, the UI is just wrong -- which is
  // why it is worth pinning structurally rather than trusting review. If you
  // are here because this failed, the fix is almost always to add the call to
  // chatScopes rather than to call the store from a second place.
  for (const store of ["models.select(", "permissions?.select(", "attachments.select(", "hydrateDraft("]) {
    const count = source.split(store).length - 1;
    assert.equal(count, 1, `${store} is called from exactly one place, found ${count}`);
  }
});

test("both ways into a chat go through the reconciler", () => {
  const calls = source.split("reconcileChatScope(").length - 1;
  // The boot path and the chat-switch path. The definition reads
  // "reconcileChatScope = (" and is not counted here.
  assert.equal(calls, 2, `reconcileChatScope is called from both entry points, found ${calls}`);
  assert.match(source, /const reconcileChatScope = \(/, "and is defined once");
});
