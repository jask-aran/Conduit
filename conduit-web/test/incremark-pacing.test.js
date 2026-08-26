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

test("buffered pacing is the default and all three modes persist", () => {
  withBrowserSettings("", {}, (values) => {
    assert.equal(selectedIncremarkPacing(), "buffered");
    for (const mode of ["adaptive", "fixed", "buffered"]) {
      assert.equal(saveIncremarkPacing(mode), mode);
      assert.equal(values["conduit:incremark-pacing"], mode);
      assert.equal(selectedIncremarkPacing(), mode);
    }
  });
});

test("URL pacing overrides are explicit and do not write storage", () => {
  withBrowserSettings("?incremarkPacing=fixed", { "conduit:incremark-pacing": "adaptive" }, (values) => {
    assert.equal(selectedIncremarkPacing(), "fixed");
    assert.equal(values["conduit:incremark-pacing"], "adaptive");
  });
  withBrowserSettings("?incremarkPacing=buffered", {}, () => {
    assert.equal(selectedIncremarkPacing(), "buffered");
  });
  withBrowserSettings("?adaptivePacing=1", {}, () => {
    assert.equal(selectedIncremarkPacing(), "adaptive");
  });
});

test("legacy boolean pacing values map to the old A/B choices", () => {
  withBrowserSettings("", { "conduit:incremark-pacing": "1" }, () => {
    assert.equal(selectedIncremarkPacing(), "adaptive");
  });
  withBrowserSettings("", { "conduit:incremark-pacing": "0" }, () => {
    assert.equal(selectedIncremarkPacing(), "fixed");
  });
});
