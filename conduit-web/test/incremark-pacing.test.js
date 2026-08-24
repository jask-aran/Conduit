import assert from "node:assert/strict";
import test from "node:test";
import { saveIncremarkPacing, selectedIncremarkPacing } from "../src/client/chat/incremark-pacing.ts";

function withBrowserSettings(search, stored, run) {
  const previousLocation = globalThis.location;
  const previousStorage = globalThis.localStorage;
  const values = { ...stored };
  globalThis.location = { search };
  globalThis.localStorage = {
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => { values[key] = value; },
  };
  try {
    return run(values);
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
}

test("adaptive pacing defaults to Adaptive and persists the A/B choice", () => {
  withBrowserSettings("", {}, (values) => {
    assert.equal(selectedIncremarkPacing(), "adaptive");
    assert.equal(saveIncremarkPacing("fixed"), "fixed");
    assert.equal(values["conduit:incremark-pacing"], "fixed");
    assert.equal(selectedIncremarkPacing(), "fixed");
  });
});

test("adaptive pacing URL overrides are explicit and do not write storage", () => {
  withBrowserSettings("?incremarkPacing=fixed", { "conduit:incremark-pacing": "adaptive" }, (values) => {
    assert.equal(selectedIncremarkPacing(), "fixed");
    assert.equal(values["conduit:incremark-pacing"], "adaptive");
  });
  withBrowserSettings("?adaptivePacing=1", {}, () => {
    assert.equal(selectedIncremarkPacing(), "adaptive");
  });
});
