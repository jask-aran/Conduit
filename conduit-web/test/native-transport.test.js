import test from "node:test";
import assert from "node:assert/strict";
import {
  SERVER_ORIGIN_STORAGE_KEY,
  buildHttpUrl,
  buildWebSocketUrl,
  clearServerOrigin,
  configuredServerOrigin,
  normalizeServerOrigin,
  saveServerOrigin,
} from "../src/client/api/transport.js";

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test("native server origins accept only normalized HTTPS origins", () => {
  assert.equal(normalizeServerOrigin("  https://conduit.tailnet.ts.net/  "), "https://conduit.tailnet.ts.net");
  assert.equal(normalizeServerOrigin("conduit.tailnet.ts.net"), "https://conduit.tailnet.ts.net");
  for (const value of [
    "http://conduit.tailnet.ts.net",
    "https://user:pass@conduit.tailnet.ts.net",
    "https://conduit.tailnet.ts.net/path",
    "https://conduit.tailnet.ts.net?query=1",
    "https://conduit.tailnet.ts.net#fragment",
    "not a URL",
  ]) assert.throws(() => normalizeServerOrigin(value));
});

test("native server origin persists and clears without credentials", () => {
  const storage = memoryStorage();
  saveServerOrigin("https://conduit.tailnet.ts.net/", storage);
  assert.equal(storage.getItem(SERVER_ORIGIN_STORAGE_KEY), "https://conduit.tailnet.ts.net");
  assert.equal(configuredServerOrigin(storage), "https://conduit.tailnet.ts.net");
  clearServerOrigin(storage);
  assert.equal(configuredServerOrigin(storage), null);
});

test("transport builds every remote path from the configured origin", () => {
  const origin = "https://conduit.tailnet.ts.net";
  const paths = [
    "/v0/projects",
    "/v0/runtime/stream",
    "/login?after=%2Fchat%2F1",
    "/v0/auth/logout",
    "/v0/chats/chat-1/attachments/file-1?preview=1",
    "/v0/sessions/chat-1/transcript",
  ];
  for (const path of paths) assert.equal(buildHttpUrl(path, origin), `${origin}${path}`);
  assert.equal(buildWebSocketUrl("/v0/live-sessions/live-1/stream", origin), "wss://conduit.tailnet.ts.net/v0/live-sessions/live-1/stream");
  assert.equal(buildWebSocketUrl("/v0/ptys/pty-1/attach", origin), "wss://conduit.tailnet.ts.net/v0/ptys/pty-1/attach");
  assert.equal(buildWebSocketUrl("/v0/dictation/stream", origin), "wss://conduit.tailnet.ts.net/v0/dictation/stream");
});
