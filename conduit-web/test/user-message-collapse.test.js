import assert from "node:assert/strict";
import test from "node:test";
import {
  isUserMessageCollapseMode,
  selectedUserMessageCollapse,
  USER_MESSAGE_COLLAPSE_OPTIONS,
  userMessageCollapseLines,
} from "../src/client/chat/user-message-collapse.ts";

function withLocation(search, run) {
  const previous = globalThis.location;
  globalThis.location = { search };
  try {
    return run();
  } finally {
    if (previous === undefined) delete globalThis.location;
    else globalThis.location = previous;
  }
}

test("the fold defaults to ten lines and is expressed in lines, not characters", () => {
  withLocation("", () => {
    assert.equal(selectedUserMessageCollapse({ getItem: () => null }), "10");
  });
  assert.equal(userMessageCollapseLines("10"), 10);
  assert.equal(userMessageCollapseLines("25"), 25);
  assert.equal(userMessageCollapseLines("off"), 0);
});

test("a stored or overridden preset is honoured and anything else falls back", () => {
  withLocation("", () => {
    assert.equal(selectedUserMessageCollapse({ getItem: () => "6" }), "6");
    assert.equal(selectedUserMessageCollapse({ getItem: () => "off" }), "off");
    assert.equal(selectedUserMessageCollapse({ getItem: () => "7" }), "10");
  });
  withLocation("?userMessageCollapse=15", () => {
    assert.equal(selectedUserMessageCollapse({ getItem: () => "6" }), "15");
  });
});

test("every offered preset validates", () => {
  for (const option of USER_MESSAGE_COLLAPSE_OPTIONS) {
    assert.ok(isUserMessageCollapseMode(option.value), option.value);
  }
  assert.equal(isUserMessageCollapseMode("12"), false);
  assert.equal(isUserMessageCollapseMode(10), false);
});
