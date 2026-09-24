import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_SERVER_STORAGE_KEY,
  LEGACY_ORIGIN_STORAGE_KEY,
  defaultServerName,
  migrateLegacyServer,
  normalizeServerOrigin,
  activeOrigin,
  activePath,
  addServer,
  clearActivePath,
  learnIdentity,
  pathIsPinned,
  pathsOf,
  pinnedFingerprints,
  scopeOf,
  servers,
  pathGeneration,
  readServers,
  setActivePath,
  setActiveServer,
  sharedByDefault,
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
  // Nor does one on the network in front of the person: no public authority
  // will certify a private address, so refusing HTTP there refuses the server.
  for (const origin of ["http://192.168.0.128:4310", "http://10.1.2.3:4310", "http://172.16.0.9:4310", "http://169.254.1.1:4310"]) {
    assert.equal(normalizeServerOrigin(origin), origin);
    assert.equal(sharedByDefault(origin), false, `${origin} names a different machine on a different network`);
  }
  // Just outside the private ranges, and so still only reachable over HTTPS.
  for (const origin of ["http://172.32.0.1:4310", "http://11.0.0.1:4310", "http://192.169.0.1:4310"]) {
    assert.throws(() => normalizeServerOrigin(origin), new RegExp("HTTPS"), origin);
  }
  assert.equal(sharedByDefault("https://conduit.tailnet.ts.net"), true);
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
    { origin: "https://conduit.tailnet.ts.net", name: "Home", shared: true },
    // Unnamed servers answer to their host, so two addresses tell themselves
    // apart without anyone typing a label -- and loopback starts unshared,
    // since it names a different machine on every device that reads it.
    { origin: "http://127.0.0.1:4310", name: "127.0.0.1:4310", shared: false },
  ]);
  assert.equal(defaultServerName("https://conduit.tailnet.ts.net"), "conduit.tailnet.ts.net");
  assert.deepEqual(readServers(memoryStorage()), []);
});

test("the one server an older client held becomes the first of the list", () => {
  const storage = memoryStorage();
  storage.setItem(LEGACY_ORIGIN_STORAGE_KEY, "https://conduit.tailnet.ts.net");
  migrateLegacyServer(storage);
  assert.deepEqual(readServers(storage), [{ origin: "https://conduit.tailnet.ts.net", name: "conduit.tailnet.ts.net", shared: true }]);
  assert.equal(storage.getItem(ACTIVE_SERVER_STORAGE_KEY), "https://conduit.tailnet.ts.net");
  // Left in place: the token for that server is still filed under the old name
  // too, and this is the only record of which server it belongs to.
  assert.equal(storage.getItem(LEGACY_ORIGIN_STORAGE_KEY), "https://conduit.tailnet.ts.net");

  // A list that already exists is never overwritten by a stale single server.
  writeServers(storage, [{ origin: "http://127.0.0.1:4310", name: "Local" }]);
  migrateLegacyServer(storage);
  assert.deepEqual(readServers(storage), [{ origin: "http://127.0.0.1:4310", name: "Local", shared: false }]);
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
      { name: "Conduit_0.7.2_x64-setup.exe", browser_download_url: "https://example.invalid/exe" },
    ],
  }), { status: 200 }));
  assert.deepEqual(release, { tag: "v0.7.2", version: "0.7.2", apkUrl: "https://example.invalid/apk", windowsUrl: "https://example.invalid/exe" });
  assert.equal(await latestRelease(async () => new Response("", { status: 404 })), null);
});

test("a path is chosen underneath the server, and changing server drops it", () => {
  addServer("https://conduit.tailnet.ts.net", "Home");
  addServer("http://192.168.0.128:4310", "Desk");
  setActiveServer("https://conduit.tailnet.ts.net");

  // With no path chosen, requests go to the server's own address.
  clearActivePath();
  assert.equal(activePath(), "https://conduit.tailnet.ts.net");

  const before = pathGeneration();
  setActivePath("http://192.168.0.128:4310");
  assert.equal(activePath(), "http://192.168.0.128:4310", "requests follow the path");
  assert.equal(activeOrigin(), "https://conduit.tailnet.ts.net", "the server in use has not changed");
  assert.equal(pathGeneration(), before + 1, "connections are told to move");

  // Choosing the path already in use is not a move, or a probe that keeps
  // picking the same winner would reconnect everything on every pass.
  setActivePath("http://192.168.0.128:4310");
  assert.equal(pathGeneration(), before + 1);

  // A path belongs to the server it reaches. Going somewhere else drops it
  // rather than addressing the new server by the old one's route.
  addServer("http://10.0.0.5:4310", "Other");
  setActiveServer("http://10.0.0.5:4310");
  assert.equal(activeOrigin(), "http://10.0.0.5:4310");
  assert.equal(activePath(), "http://10.0.0.5:4310", "not the route to the server we left");
});

test("two addresses that answer with the same id become one server", () => {
  const id = "a".repeat(32);
  // The list is module state shared with the test above, so this asserts on
  // the rows it touches rather than on the length of the whole list.
  addServer("https://conduit.tailnet.ts.net", "Home");
  addServer("http://127.0.0.1:4310", "Loopback");
  addServer("http://192.168.0.128:4310", "Desk");
  setActiveServer("https://conduit.tailnet.ts.net");

  learnIdentity("https://conduit.tailnet.ts.net", {
    id,
    paths: [
      { origin: "http://127.0.0.1:4310", scope: "loopback" },
      { origin: "http://192.168.0.128:4310", scope: "private" },
      { origin: "https://conduit.tailnet.ts.net", scope: "public" },
    ],
  });

  // Three rows the person added separately are one server with three routes.
  const entry = servers().find((item) => item.origin === "https://conduit.tailnet.ts.net");
  for (const absorbed of ["http://127.0.0.1:4310", "http://192.168.0.128:4310"]) {
    assert.equal(servers().some((item) => item.origin === absorbed), false,
      `${absorbed} is no longer a server of its own`);
  }
  assert.equal(entry.name, "Home", "the entry that answered keeps its name");
  assert.equal(entry.id, id);
  assert.deepEqual(pathsOf(entry).map((path) => path.origin), [
    // Nearest first, so the menu reads in the order the paths cost.
    "http://127.0.0.1:4310",
    "http://192.168.0.128:4310",
    "https://conduit.tailnet.ts.net",
  ]);

  // The server's own address is not repeated as one of its paths.
  assert.equal(entry.paths.some((path) => path.origin === "https://conduit.tailnet.ts.net"), false);

  // Scope is read off the address, so it means the same on every client.
  assert.equal(scopeOf("http://127.0.0.1:4310"), "loopback");
  assert.equal(scopeOf("http://192.168.0.128:4310"), "private");
  assert.equal(scopeOf("https://conduit.tailnet.ts.net"), "public");

  // A server with nothing to say leaves the list alone.
  const before = JSON.stringify(servers());
  learnIdentity("https://conduit.tailnet.ts.net", {});
  assert.equal(JSON.stringify(servers()), before);
});

test("automatic selection looks nearer than the route in use, and a chosen route stops it", async () => {
  const { nearerThan } = await import("../src/client/platform/path-selector.ts");
  const routes = [
    { origin: "http://127.0.0.1:4310", scope: "loopback" },
    { origin: "http://192.168.0.128:4310", scope: "private" },
    { origin: "https://conduit.tailnet.ts.net", scope: "public" },
  ];

  // On the tunnel, both local routes are worth asking about.
  assert.deepEqual(nearerThan(routes, "https://conduit.tailnet.ts.net").map((path) => path.origin),
    ["http://127.0.0.1:4310", "http://192.168.0.128:4310"]);
  // On the LAN, only loopback would be an improvement.
  assert.deepEqual(nearerThan(routes, "http://192.168.0.128:4310").map((path) => path.origin),
    ["http://127.0.0.1:4310"]);
  // Already nearest: nothing to ask, so nothing is asked.
  assert.deepEqual(nearerThan(routes, "http://127.0.0.1:4310"), []);
  // A route that is not one of this server's is the worst case, not the best.
  assert.deepEqual(nearerThan(routes, null).length, 3);

  // A route chosen by hand is a decision, and selection stands down until it
  // is handed back.
  addServer("https://pinning.example.com", "Pinned");
  setActiveServer("https://pinning.example.com");
  assert.equal(pathIsPinned(), false, "a fresh server chooses for itself");
  setActivePath("http://10.0.0.7:4310", { manual: true });
  assert.equal(pathIsPinned(), true);
  setActivePath("http://10.0.0.8:4310");
  assert.equal(pathIsPinned(), true, "the client moving the route does not un-choose it");
  clearActivePath({ manual: false });
  assert.equal(pathIsPinned(), false);
});

test("a certificate is pinned only when this server's own key attested it", async () => {
  const { verifyLeaf } = await import("../src/client/platform/server-proof.ts");
  const { attestLeaf, issueLeafCertificate, leafFingerprint } = await import("../src/server-tls.js");
  const crypto = await import("node:crypto");
  const identity = crypto.generateKeyPairSync("ed25519");
  const stranger = crypto.generateKeyPairSync("ed25519");
  const id = "b".repeat(32);
  const publicKey = identity.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const leaf = issueLeafCertificate({ commonName: `Conduit ${id}`, hosts: ["192.168.0.128"] });
  const fingerprint = leafFingerprint(leaf.spki).toString("base64");
  const claim = { port: 4319, fingerprint, attestation: attestLeaf(id, leaf.spki, identity.privateKey) };

  assert.deepEqual(await verifyLeaf(id, publicKey, claim), { port: 4319, fingerprint });

  // Each of these is the relay the whole arrangement exists to stop, and a
  // fingerprint kept without this check is one the shell would then accept on
  // every network it ever met that certificate on.
  const strangerKey = stranger.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  assert.equal(await verifyLeaf(id, strangerKey, claim), null, "another identity cannot vouch for it");
  assert.equal(await verifyLeaf("c".repeat(32), publicKey, claim), null, "the attestation names the server it is for");
  assert.equal(await verifyLeaf(id, publicKey, { ...claim, fingerprint: `A${fingerprint.slice(1)}` }), null,
    "a different certificate cannot borrow an attestation");
  assert.equal(await verifyLeaf(id, publicKey, { ...claim, port: 0 }), null);
  assert.equal(await verifyLeaf(id, publicKey, undefined), null);
});

test("a verified certificate is kept with its server, and a tampered one is not read back", () => {
  const storage = memoryStorage();
  const id = "d".repeat(32);
  const fingerprint = "sFgA8zKSQJFABJl0G606Rt6oHMBJ0CXYmOav8GMUnbA=";
  writeServers(storage, [
    { origin: "https://one.example", name: "One", shared: true, id, secure: { port: 4319, fingerprint } },
    // The store is a file another process can edit, and it cannot be
    // re-verified without the server, so the shape is all that stands in the
    // way of a pin nobody attested.
    { origin: "https://two.example", name: "Two", shared: true, secure: { port: 4319, fingerprint: "not-a-hash" } },
    { origin: "https://three.example", name: "Three", shared: true, secure: { port: 70000, fingerprint } },
  ]);
  const list = readServers(storage);

  assert.deepEqual(list[0].secure, { port: 4319, fingerprint });
  assert.equal(list[1].secure, undefined, "a fingerprint of the wrong shape is not a fingerprint");
  assert.equal(list[2].secure, undefined, "nor is a port that is not one");
  assert.deepEqual(pinnedFingerprints(list), [fingerprint]);
});

test("a signature is checked without asking the platform for the curve", async () => {
  const { verifyEd25519 } = await import("../src/client/platform/signatures.ts");
  const crypto = await import("node:crypto");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const message = "5abbb638e71e73e663ec3e1e4f902997.a-nonce";
  const signature = crypto.sign(null, Buffer.from(message, "utf8"), privateKey).toString("base64");

  assert.equal(await verifyEd25519(spki, message, signature), true);
  assert.equal(await verifyEd25519(spki, `${message}x`, signature), false, "a signature is over one message");
  assert.equal(await verifyEd25519(spki, message, crypto.randomBytes(64).toString("base64")), false);
  // A key this client cannot read is not one it has been shown anything by.
  assert.equal(await verifyEd25519("not base64 at all!!", message, signature), false);
  assert.equal(await verifyEd25519(Buffer.from("short").toString("base64"), message, signature), false);
  assert.equal(await verifyEd25519("", message, signature), false);
});

test("a webview with no Ed25519 still checks the signature", async () => {
  /*
   * The case this dependency exists for, and the one Node would otherwise
   * never take: its WebCrypto knows the curve, so the path above tests the
   * platform rather than the fallback. Hiding the algorithm is the only way
   * to reach the code every WebView below Chromium 137 will be running.
   */
  const node = await import("node:crypto");
  const platform = globalThis.crypto.subtle.importKey.bind(globalThis.crypto.subtle);
  globalThis.crypto.subtle.importKey = async (...args) => {
    if (args[2]?.name === "Ed25519") throw new Error("Unrecognized name");
    return platform(...args);
  };
  try {
    // A fresh instance, because whether the page can verify is asked once.
    const { verifyEd25519 } = await import("../src/client/platform/signatures.ts?no-ed25519");
    const keys = node.generateKeyPairSync("ed25519");
    const spki = keys.publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const message = "conduit-leaf-spki-sha256.v1.ffff.AAAA";
    const signature = node.sign(null, Buffer.from(message, "utf8"), keys.privateKey).toString("base64");

    assert.equal(await verifyEd25519(spki, message, signature), true);
    assert.equal(await verifyEd25519(spki, `${message}x`, signature), false);
    const stranger = node.generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).toString("base64");
    assert.equal(await verifyEd25519(stranger, message, signature), false);
    // An SPKI header that is not Ed25519's describes some other key, and
    // taking its last 32 bytes would turn it into one.
    const p256 = node.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "der", type: "spki" }).toString("base64");
    assert.equal(await verifyEd25519(p256, message, signature), false);
  } finally {
    globalThis.crypto.subtle.importKey = platform;
  }
});
