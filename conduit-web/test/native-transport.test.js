import test from "node:test";
import assert from "node:assert/strict";
import { addServer, learnIdentity, normalizeServerOrigin, pathsOf, scopeOf, servers, setActiveServer, sharedByDefault, trustedIdentities } from "../src/client/platform/servers.ts";
import { buildWebSocketUrl } from "../src/client/api/transport.js";

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

test("servers stay apart unless they have answered as the same id", () => {
  const home = "a".repeat(32);
  const vps = "b".repeat(32);
  // The list is module state shared with the test above, so this asserts on
  // the rows it touches rather than on the length of the whole list.
  addServer("https://conduit.tailnet.ts.net", "Home");
  addServer("http://127.0.0.1:4310", "Loopback");
  addServer("http://192.168.0.128:4310", "Desk");
  addServer("https://conduit.example.com", "Away");
  setActiveServer("https://conduit.tailnet.ts.net");

  // A remote server advertising 127.0.0.1 does not swallow the server already
  // held at that address, and that address is not a route to the remote one.
  learnIdentity("https://conduit.example.com", {
    id: vps,
    paths: [
      { origin: "http://127.0.0.1:4310", scope: "loopback" },
      { origin: "https://conduit.example.com", scope: "public" },
    ],
  });
  assert.equal(servers().find((item) => item.origin === "http://127.0.0.1:4310")?.name, "Loopback");
  const remote = servers().find((item) => item.origin === "https://conduit.example.com");
  assert.equal(remote.paths.some((path) => path.origin === "http://127.0.0.1:4310"), false);

  // The loopback row answers as Home. Now it is a route, not a second server.
  learnIdentity("http://127.0.0.1:4310", { id: home });
  learnIdentity("https://conduit.tailnet.ts.net", {
    id: home,
    paths: [
      { origin: "http://127.0.0.1:4310", scope: "loopback" },
      { origin: "http://192.168.0.128:4310", scope: "private" },
      { origin: "https://conduit.tailnet.ts.net", scope: "public" },
    ],
  });

  const entry = servers().find((item) => item.origin === "https://conduit.tailnet.ts.net");
  assert.equal(servers().some((item) => item.origin === "http://127.0.0.1:4310"), false,
    "the address that answered as this id is no longer a server of its own");
  assert.equal(servers().find((item) => item.origin === "http://192.168.0.128:4310")?.name, "Desk",
    "a shared LAN address is not an identity");
  assert.equal(entry.name, "Home", "the entry that answered keeps its name");
  assert.equal(entry.id, home);
  assert.deepEqual(pathsOf(entry).map((path) => path.origin), [
    "http://127.0.0.1:4310",
    "http://192.168.0.128:4310",
    "https://conduit.tailnet.ts.net",
  ]);

  assert.equal(entry.paths.some((path) => path.origin === "https://conduit.tailnet.ts.net"), false);

  // Scope is read off the address, so it means the same on every client.
  assert.equal(scopeOf("http://127.0.0.1:4310"), "loopback");
  assert.equal(scopeOf("http://192.168.0.128:4310"), "private");
  assert.equal(scopeOf("https://conduit.tailnet.ts.net"), "public");

  const before = JSON.stringify(servers());
  learnIdentity("https://conduit.tailnet.ts.net", {});
  assert.equal(JSON.stringify(servers()), before);
});

test("only a server whose identity key is held can vouch for a certificate", () => {
  const id = "d".repeat(32);
  const list = [
    { origin: "https://one.example", name: "One", shared: true, id },
    { origin: "https://two.example", name: "Two", shared: true, id, publicKey: "key" },
  ];
  assert.deepEqual(trustedIdentities(list), [{ id, publicKey: "key" }]);
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
