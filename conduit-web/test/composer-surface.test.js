import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

import fs from "node:fs/promises";

const source = await fs.readFile(new URL("../src/client/chat/composer-surface.ts", import.meta.url), "utf8");
const compiled = stripTypeScriptTypes(source);
const surface = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    snapshot: () => Object.fromEntries(values),
  };
}

test("the composer exposes only Static and Frosted Live", () => {
  assert.deepEqual(surface.COMPOSER_SURFACE_OPTIONS.map(({ value, label }) => ({ value, label })), [
    { value: "static", label: "Static" },
    { value: "frosted-live", label: "Frosted Live" },
  ]);
});

test("missing and unsupported persisted values use Frosted Live", () => {
  assert.equal(surface.selectedComposerSurface(memoryStorage()), "frosted-live");
  assert.equal(surface.selectedComposerSurface(memoryStorage({ "conduit:composer-surface": "removed" })), "frosted-live");
});

test("surface selection persists and dispatches the shared change event", () => {
  const storage = memoryStorage();
  const events = [];
  const originalWindow = globalThis.window;
  const originalCustomEvent = globalThis.CustomEvent;
  globalThis.window = { dispatchEvent: (event) => events.push(event) };
  globalThis.CustomEvent = class {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };

  try {
    assert.equal(surface.saveComposerSurface("static", storage), "static");
    assert.equal(surface.saveComposerSurface("frosted-live", storage), "frosted-live");
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = originalCustomEvent;
  }

  assert.deepEqual(storage.snapshot(), { "conduit:composer-surface": "frosted-live" });
  assert.deepEqual(events.filter(({ type }) => type === "conduit:composer-surface-change").map(({ type, detail }) => ({ type, detail })), [
    { type: "conduit:composer-surface-change", detail: "static" },
    { type: "conduit:composer-surface-change", detail: "frosted-live" },
  ]);
});
