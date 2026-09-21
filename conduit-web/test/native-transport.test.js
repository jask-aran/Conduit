import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_SERVER_STORAGE_KEY,
  LEGACY_ORIGIN_STORAGE_KEY,
  defaultServerName,
  migrateLegacyServer,
  normalizeServerOrigin,
  readServers,
  writeServers,
} from "../src/client/platform/servers.ts";
import { buildHttpUrl, buildWebSocketUrl } from "../src/client/api/transport.js";

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
  // A server on this machine is reached over loopback, which no network
  // carries, so it does not have to present a certificate to be addressed.
  assert.equal(normalizeServerOrigin("http://127.0.0.1:4310"), "http://127.0.0.1:4310");
  assert.equal(normalizeServerOrigin("http://localhost:4310/"), "http://localhost:4310");
  assert.equal(buildWebSocketUrl("/v0/dictation/stream", "http://127.0.0.1:4310"),
    "ws://127.0.0.1:4310/v0/dictation/stream");
});

test("a stored server list keeps only addresses it would accept", () => {
  const storage = memoryStorage();
  writeServers(storage, [
    { origin: "https://conduit.tailnet.ts.net", name: "Home" },
    { origin: "http://127.0.0.1:4310", name: "" },
    { origin: "https://conduit.tailnet.ts.net", name: "Duplicate" },
    { origin: "http://insecure.example.com", name: "Refused" },
  ]);
  assert.deepEqual(readServers(storage), [
    { origin: "https://conduit.tailnet.ts.net", name: "Home" },
    // Unnamed servers answer to their host, so two addresses tell themselves
    // apart without anyone typing a label.
    { origin: "http://127.0.0.1:4310", name: "127.0.0.1" },
  ]);
  assert.equal(defaultServerName("https://conduit.tailnet.ts.net"), "conduit.tailnet.ts.net");
  assert.deepEqual(readServers(memoryStorage()), []);
});

test("the one server an older client held becomes the first of the list", () => {
  const storage = memoryStorage();
  storage.setItem(LEGACY_ORIGIN_STORAGE_KEY, "https://conduit.tailnet.ts.net");
  migrateLegacyServer(storage);
  assert.deepEqual(readServers(storage), [{ origin: "https://conduit.tailnet.ts.net", name: "conduit.tailnet.ts.net" }]);
  assert.equal(storage.getItem(ACTIVE_SERVER_STORAGE_KEY), "https://conduit.tailnet.ts.net");
  // Left in place: the token for that server is still filed under the old name
  // too, and this is the only record of which server it belongs to.
  assert.equal(storage.getItem(LEGACY_ORIGIN_STORAGE_KEY), "https://conduit.tailnet.ts.net");

  // A list that already exists is never overwritten by a stale single server.
  writeServers(storage, [{ origin: "http://127.0.0.1:4310", name: "Local" }]);
  migrateLegacyServer(storage);
  assert.deepEqual(readServers(storage), [{ origin: "http://127.0.0.1:4310", name: "Local" }]);
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

test("a published release is newer only when its version is", async () => {
  const { isNewerVersion, latestRelease } = await import("../src/client/platform/github-release.ts");
  assert.equal(isNewerVersion("v0.7.2", "0.7.1"), true);
  assert.equal(isNewerVersion("0.7.1", "v0.7.1"), false, "the running version is not an update");
  assert.equal(isNewerVersion("0.7.1", "0.10.0"), false, "versions compare as numbers, not as text");
  assert.equal(isNewerVersion("1.0.0", "0.99.99"), true);

  const release = await latestRelease(async () => new Response(JSON.stringify({
    tag_name: "v0.7.2",
    assets: [
      { name: "conduit-v0.7.2.apk.sha256", browser_download_url: "https://example.invalid/sum" },
      { name: "conduit-v0.7.2.apk", browser_download_url: "https://example.invalid/apk" },
    ],
  }), { status: 200 }));
  assert.deepEqual(release, { tag: "v0.7.2", version: "0.7.2", apkUrl: "https://example.invalid/apk" });
  assert.equal(await latestRelease(async () => new Response("", { status: 404 })), null);
});
