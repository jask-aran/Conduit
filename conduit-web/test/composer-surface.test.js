import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = await fs.readFile(new URL("../src/client/chat/composer-surface.ts", import.meta.url), "utf8");
const compiled = stripTypeScriptTypes(source, { mode: "transform" });
const surface = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    snapshot: () => Object.fromEntries(values),
  };
}

test("Liquid Glass is fail-closed for current and legacy preferences", () => {
  for (const initial of [
    { "conduit:composer-surface": "liquid" },
    { "conduit:liquid-glass-surface": "true" },
  ]) {
    const storage = memoryStorage(initial);
    assert.equal(surface.liquidGlassRuntimeEnabled(storage), false);
    assert.equal(surface.selectedComposerSurface(storage), "frost");
    assert.equal(surface.saveComposerSurface("liquid", storage), "frost");
    assert.deepEqual(storage.snapshot(), {
      ...initial,
      "conduit:composer-surface": "frost",
      "conduit:liquid-glass-surface": "false",
    });
  }
});

test("Frosted Live keeps a separate renderer value", () => {
  assert.deepEqual(surface.COMPOSER_SURFACE_OPTIONS.map(({ value, label }) => ({ value, label })), [
    { value: "static", label: "Static" },
    { value: "frost", label: "Frosted" },
    { value: "frosted-live", label: "Frosted Live" },
    { value: "liquid", label: "Liquid Glass" },
  ]);
  assert.equal(surface.selectedComposerSurface(memoryStorage({
    "conduit:composer-surface": "frosted-live",
  })), "frosted-live");
});

test("Liquid Glass requires an explicit runtime opt-in", () => {
  const storage = memoryStorage({
    "conduit:liquid-glass-runtime": "enabled",
    "conduit:composer-surface": "liquid",
  });

  assert.equal(surface.liquidGlassRuntimeEnabled(storage), true);
  assert.equal(surface.selectedComposerSurface(storage), "liquid");
  assert.equal(surface.saveComposerSurface("liquid", storage), "liquid");
  assert.equal(storage.getItem("conduit:liquid-glass-surface"), "true");
});

test("enabling the runtime does not restore a stale Liquid selection", () => {
  const storage = memoryStorage({
    "conduit:composer-surface": "liquid",
    "conduit:liquid-glass-surface": "true",
  });

  assert.equal(surface.saveLiquidGlassRuntime(true, storage), true);
  assert.deepEqual(storage.snapshot(), {
    "conduit:liquid-glass-runtime": "enabled",
    "conduit:composer-surface": "frost",
    "conduit:liquid-glass-surface": "false",
  });
});

test("disabling Liquid Glass clears both surface keys and requests a live Frosted surface", () => {
  const storage = memoryStorage({
    "conduit:liquid-glass-runtime": "enabled",
    "conduit:composer-surface": "liquid",
    "conduit:liquid-glass-surface": "true",
  });
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
    assert.equal(surface.saveLiquidGlassRuntime(false, storage), false);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = originalCustomEvent;
  }

  assert.deepEqual(storage.snapshot(), {
    "conduit:liquid-glass-runtime": "disabled",
  });
  assert.deepEqual(events.map(({ type, detail }) => ({ type, detail })), [{
    type: "conduit:composer-surface-change",
    detail: "frost",
  }]);
});

test("the live Liquid import remains behind the runtime gate and disabling reloads", async () => {
  const [composer, settings] = await Promise.all([
    fs.readFile(new URL("../src/client/chat/composer.tsx", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/client/settings/settings.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(composer, /liquidGlassRuntimeEnabled\(\) && composerSurface\(\) === "liquid"/);
  assert.match(settings, /saveLiquidGlassRuntime\(enabled\)/);
  assert.match(settings, /window\.location\.reload\(\)/);
});
