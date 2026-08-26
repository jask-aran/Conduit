import assert from "node:assert/strict";
import test from "node:test";
import { resetPwaAppCache } from "../src/client/pwa-update.ts";

test("app cache reset unregisters workers and deletes only Workbox precaches", async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const cachesDescriptor = Object.getOwnPropertyDescriptor(globalThis, "caches");
  const calls = [];
  const registrations = [
    { unregister: async () => { calls.push("unregister-one"); return true; } },
    { unregister: async () => { calls.push("unregister-two"); return true; } },
  ];

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { serviceWorker: { getRegistrations: async () => registrations } },
  });
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      keys: async () => [
        "workbox-precache-v2-http://127.0.0.1:4310/",
        "conduit-runtime",
        "unrelated",
      ],
      delete: async (cacheName) => { calls.push(`delete:${cacheName}`); return true; },
    },
  });

  try {
    await resetPwaAppCache(() => calls.push("reload"));
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete globalThis.navigator;
    if (cachesDescriptor) Object.defineProperty(globalThis, "caches", cachesDescriptor);
    else delete globalThis.caches;
  }

  assert.deepEqual(calls.sort(), [
    "delete:workbox-precache-v2-http://127.0.0.1:4310/",
    "reload",
    "unregister-one",
    "unregister-two",
  ].sort());
});
