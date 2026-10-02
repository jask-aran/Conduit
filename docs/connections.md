# Connections: what is still to build

Two pieces of unbuilt work about how clients connect to a server: proving that
an address really is your server, and knowing which clients are connected when
the server restarts. Both rest on the same idea: a connection should carry its
own identity rather than be taken on trust.

## 1. Proving the server by its connection

### Why

`/v0/server/prove` signs `<id>.<nonce>` with the server's Ed25519 identity, and
it answers without a session so a client can check an address before sending a
token. The signature proves the key exists somewhere reachable, not that the
thing at this address holds it. On a hostile network, something holding your
server's LAN address (`192.168.0.x` is the commonest home range) can forward
the nonce to the real server over any route, relay the answer, and receive the
client's bearer token. Signing the dialled origin does not help, because that
impostor really does hold the same address. Over cleartext HTTP there is no
channel to bind the proof to.

### The answer

TLS with a pinned leaf. The handshake becomes the proof: a relay cannot
complete it without the leaf's private key.

### Built

- **Server.** `src/server-tls.js` issues a self-signed ECDSA P-256 leaf (P-256
  because Chromium refuses Ed25519 certificates). It has IP SANs for the local
  addresses, lasts 398 days, is re-issued when the address set changes, and is
  kept in `data/leaf.json`. The identity key signs
  `conduit-leaf-spki-sha256.v1.<id>.<sha256 of SPKI>`. The server listens over
  TLS on `CONDUIT_TLS_PORT`, 4319 by default; that number is permanent once a
  client pins it. `/v0/server` reports `secure: { port, fingerprint,
  attestation }`, kept out of `paths` until clients can use it.
- **Android.** `ConduitWebViewClient` checks the leaf in
  `onReceivedSslError`, which also fires for `wss://` (measured). The page
  verifies the attestation with WebCrypto, falling back to `@noble/ed25519` on
  WebViews older than 137 (`client/platform/signatures.ts`), and hands the pin
  to `ConduitTlsPlugin` (`client/platform/certificate-pins.ts`).

### To build, in order

1. **Windows.** Handle WebView2's `ServerCertificateErrorDetected` in the Tauri
   shell. It is not yet known whether that event fires for WebSockets, and the
   only way to find out is to write the handler and run a debug build.
2. **Tests.** Both shells need a test that a *wrong* attestation is refused,
   not only that a right one is accepted. "Accept any certificate" is the
   natural bug, and it is worse than today.
3. **`https` origins in `paths()`.** Only once both shells can pin.
4. **Addresses as candidates.** With proof in the handshake, a wrong address
   just fails, so `paths()` becomes a list of candidates that the path
   selector races (like Tailscale, Syncthing or ICE). At the same time, revert
   `disableIPv6` in `lan-advertisement.js` and decide whether the attestation
   also travels in mDNS.

### Open

- A pinned leaf that legitimately changed, re-issued after the server moved
  networks: how a client re-trusts it without opening the relay again.
  Re-checking the identity attestation is the likely answer.
- Whether loopback needs a certificate at all.
- First contact. Before pairing there is nothing to pin, and an mDNS-advertised
  key vouches for itself. That needs a check a person can do, such as showing
  the identity id to match against the server's.

Browsers cannot pin, so they stay on what they have.

Until this lands, treat a cleartext route as checked against a passive
impostor and not against an active one.

## 2. Knowing who is connected at restart

### Today

Before a local restart, `start-conduit.sh restart` has the server tell open
browsers to fetch a changed service worker, then waits a fixed 20 seconds even
when every browser is ready. `RuntimeHub` holds open streams but knows nothing
about who they are. `conduit-server restart` on an installed server waits for
live turns but sends no pre-restart notice, so browsers on a released server
are not warned.

### To build

1. **Connection identity.** A short-lived ID per live connection, with the
   client's kind (browser, Windows, Android) and build. This is not a device
   registry, and it is scoped to the server.
2. **Readiness.** A restart attempt names the build it is moving to. A browser
   replies "ready" only once that build's service worker is installed and
   waiting, or it already runs that build. The reply is authenticated and tied
   to the attempt, and a stale reply does not count. The restart goes ahead
   when every eligible connected browser is ready, or at the timeout. Specify
   how late arrivals, reconnects and several tabs sharing one worker affect
   the waiting set. A tab with unsent work still does not reload.
3. **Native clients never hold a restart.** Desktop and Android report their
   build so the server can explain, or refuse, an incompatible protocol, but
   their own updates are separate and never delay the server.
4. **The same handoff in `conduit-server restart`.** Released servers then get
   it too, not only the dev script.
5. **Visibility.** Show which clients and builds a server sees, and why a
   restart waited.

### Decide first

- Is a participant one tab, or one service-worker registration shared by
  every tab in a browser profile?
- Should readiness be an HTTP reply alongside the one-way runtime stream, or
  should tracking move to a two-way transport?
- Does the 20-second cap stay fixed, or can the operator set it?
- What compatibility promise holds between an app build and a server release,
  when one app visits several servers?

### Related, separate

- **Android updates.** Android could download an APK ahead of time and hand it
  to the installer on request. Today it opens a remote APK URL.
- **Durable staging on Windows.** Windows already downloads its update in the
  background. Decide whether a ready package has to survive the app closing.
- **No app updates from servers.** Never accept an app update from whichever
  server happens to be selected. Serving updates from a server is only worth
  doing if GitHub delivery proves inadequate, and then from an explicitly
  chosen source.
