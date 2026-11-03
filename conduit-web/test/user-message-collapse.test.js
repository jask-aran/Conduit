import assert from "node:assert/strict";
import test from "node:test";
import {
  isUserMessageCollapseMode,
  selectedUserMessageCollapse,
  USER_MESSAGE_COLLAPSE_OPTIONS,
  USER_MESSAGE_COLLAPSE_DEFAULT,
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

test("the fold defaults to an offered preset expressed in lines", () => {
  assert.ok(USER_MESSAGE_COLLAPSE_OPTIONS.some((option) => option.value === "off"));
  assert.ok(USER_MESSAGE_COLLAPSE_OPTIONS.some((option) => option.value !== "off"));
  assert.ok(USER_MESSAGE_COLLAPSE_OPTIONS.some((option) => option.value === USER_MESSAGE_COLLAPSE_DEFAULT));
  withLocation("", () => {
    assert.equal(selectedUserMessageCollapse({ getItem: () => null }), USER_MESSAGE_COLLAPSE_DEFAULT);
  });
  for (const { value } of USER_MESSAGE_COLLAPSE_OPTIONS) {
    assert.equal(userMessageCollapseLines(value), value === "off" ? 0 : Number(value));
    if (value !== "off") assert.ok(Number.isInteger(Number(value)) && Number(value) > 0);
  }
  assert.equal(userMessageCollapseLines("off"), 0);
});

test("a stored or overridden preset is honoured and anything else falls back", () => {
  assert.ok(USER_MESSAGE_COLLAPSE_OPTIONS.some((option) => option.value === "off"));
  assert.ok(USER_MESSAGE_COLLAPSE_OPTIONS.some((option) => option.value !== "off"));
  const invalidNumber = String(Math.max(...USER_MESSAGE_COLLAPSE_OPTIONS.filter((option) => option.value !== "off").map((option) => Number(option.value))) + 1);
  withLocation("", () => {
    for (const { value } of USER_MESSAGE_COLLAPSE_OPTIONS) {
      assert.equal(selectedUserMessageCollapse({ getItem: () => value }), value);
    }
    assert.equal(selectedUserMessageCollapse({ getItem: () => "off" }), "off");
    assert.equal(selectedUserMessageCollapse({ getItem: () => "unknown-collapse" }), USER_MESSAGE_COLLAPSE_DEFAULT);
    assert.equal(selectedUserMessageCollapse({ getItem: () => invalidNumber }), USER_MESSAGE_COLLAPSE_DEFAULT);
  });
  for (const { value } of USER_MESSAGE_COLLAPSE_OPTIONS) {
    const other = USER_MESSAGE_COLLAPSE_OPTIONS.find((option) => option.value !== value).value;
    withLocation(`?userMessageCollapse=${encodeURIComponent(value)}`, () => {
      assert.equal(selectedUserMessageCollapse({ getItem: () => other }), value);
    });
    withLocation("?userMessageCollapse=unknown-collapse", () => {
      assert.equal(selectedUserMessageCollapse({ getItem: () => value }), value);
    });
  }
});

test("every offered preset validates", () => {
  const numeric = USER_MESSAGE_COLLAPSE_OPTIONS.filter((option) => option.value !== "off");
  assert.ok(numeric.length > 0);
  const invalidNumber = String(Math.max(...numeric.map((option) => Number(option.value))) + 1);
  assert.equal(isUserMessageCollapseMode(invalidNumber), false);
  for (const option of USER_MESSAGE_COLLAPSE_OPTIONS) {
    assert.ok(isUserMessageCollapseMode(option.value), option.value);
    if (option.value !== "off") assert.equal(isUserMessageCollapseMode(Number(option.value)), false);
  }
  assert.equal(isUserMessageCollapseMode("unknown-collapse"), false);
});
