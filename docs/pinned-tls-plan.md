# Proving a server by the connection, not beside it

Status: in progress for 0.7.5. The server half is built -- see "What is built"
at the end; the shell half is not. This records an investigation
run on 2026-09-22, the attack it found, the two cheaper fixes that were
considered and rejected, and the shape of the one that works — so the next
attempt does not re-derive any of it.

## The problem

`ServerIdentity.prove()` signs `<id>.<nonce>` and nothing else. The address is
not in the signed payload, and `/v0/server/prove` answers without a session on
purpose: a client has to be able to check an address *before* it sends a token
there.

Confirmed against the running server — an unauthenticated `curl` to
`/v0/server/prove` returns a valid signature for any nonce. So the signature
proves "this private key exists somewhere I can reach". It does not prove the
thing that answered holds it.

The attack is a relay:

1. A client knows its server's LAN route, `http://192.168.0.128:4310`.
2. It is carried onto another network where something else holds that address.
3. That thing takes the client's nonce and forwards it to the real server over
   any route it can reach — the public tunnel will do.
4. It relays the signature back.
5. `proveServer` returns ok, the client moves its route, and the bearer token
   goes to the impostor.

This defeats the one claim the route-switching design rests on.

## Why the cheap fixes are not fixes

**Sign the dialled origin, and refuse to sign an origin not in `paths()`.** One
field and one check, and it kills the generic relay. It does not kill the case
you would actually meet: this server genuinely holds `192.168.0.128`, and
`192.168.0.x` is the most common home range there is, so a hostile network
assigns itself that address and the check passes. It also needs a
compatibility step for clients that send no origin. Rejected because shipping
it would make the documentation *more* misleading — "we bind the origin"
sounds like a fix.

**Ask the person before taking a new cleartext route.** Puts a human where the
cryptography cannot help. Rejected as the primary answer because dialogs are
clicked through, and because the better version of it falls out of the fix
below for free: a hostile address becomes a route that *fails to connect*
rather than one that succeeds and asks to be vouched for. The system knowing
beats the system asking.

The root cause is that a relay is stopped by binding the proof to the channel,
and over cleartext HTTP there is no channel to bind to.

## The shape of the answer

Give the connection an identity, and let the handshake be the proof.

- The server generates a self-signed leaf certificate with IP SANs for the
  private addresses it holds, re-issued when the interface set changes.
- The leaf is **ECDSA P-256**, not Ed25519. Chromium does not accept Ed25519
  certificates, and both shells are Chromium. Confirm that is still true
  before building on it.
- The leaf's SPKI hash is **signed by the Ed25519 identity key**. The identity
  stays exactly where it is; TLS gets a key it can actually use, and the
  attestation is what ties the two together.
- A client that has paired already holds the identity public half, so it
  verifies the attestation and pins the leaf.

A relay cannot terminate a handshake for a certificate it has no key to, so
the impostor at `192.168.0.128` fails to connect instead of succeeding.

## What it costs

Two pieces of security-critical native code.

- **Android** — `onReceivedSslError` on the WebView client. **Measured, and it
  works**; see below.
- **Windows** — WebView2's `ServerCertificateErrorDetected`. Not measured.

Both must cover **WebSockets**, which means the override lives in the
WebView's TLS stack rather than in a native HTTP client; `CapacitorHttp` can
carry a fetch but not a socket.

The natural bug in both is "accept any certificate", which is worse than the
situation today. Whatever lands here needs a test that a *wrong* attestation
is refused, not only that a right one is accepted.

### Measured on Android, 2026-09-22

The question that could have sunk the whole approach was whether
`onReceivedSslError` is reached for a WebSocket handshake or only for the page
and its resources. Everything live in Conduit is a socket, so if `wss://`
never arrived there, pinning in the WebView could not work and TLS would have
had to be terminated somewhere else.

It is reached. On a Pixel 10 Pro XL emulator, API 36, against a Conduit
serving its own leaf on 4319 and 4320, with the ports reversed into the guest
so the dialled address matches the certificate's SANs and the only fault is
the self-signed authority:

- `wss://127.0.0.1:4320/v0/dictation/stream` raises the callback with
  `primary=3` (`SSL_UNTRUSTED`) and `error.getUrl()` carrying the `wss://`
  URL.
- `error.getCertificate().getX509Certificate().getPublicKey().getEncoded()`
  hashes to exactly the fingerprint the server's identity attested, so the pin
  can be compared where the decision is made.
- With that fingerprint pinned, the socket opens: `OPEN`, live, over TLS.
- With one byte of the fingerprint changed, the same socket to the same
  server is refused -- `pinned=false`, `handler.cancel()`.

So the Android half is a WebView client and a set of fingerprints, not a
native proxy. `ConduitWebViewClient` holds it.

Still unmeasured: whether WebView2's event covers WebSockets. Microsoft's
documentation describes it as raised when a server certificate cannot be
verified "while loading a web page" and does not say either way. Measuring it
means writing the COM handler in the Tauri shell and running a Windows debug
build -- there is no cheaper seam, because the event only exists once
something subscribes to it.

## What it unlocks

This is the part worth having, and it is not the security patch.

Once the connection proves identity, a candidate address costs nothing to try.
`paths()` becomes a candidate list, `path-selector` becomes the thing that
races them, and a wrong candidate simply fails rather than being dangerous.
That is the shape every mature version of this problem converges on —
Tailscale's direct-then-DERP, Syncthing, WebRTC ICE all gather candidates from
anywhere and let the cryptographic handshake decide which are real.

Nothing about the LAN gets smarter. `192.168/16` never told us anything; under
this it stops needing to.

Two consequences to pick up at the same time:

- **`disableIPv6` in `lan-advertisement.js` should probably be reverted.** It
  was right on 2026-09-22, when extra addresses were a disclosure that bought
  nothing. Under a transport that proves itself, more candidates is better
  connectivity and a useless one is harmless.
- **A subnet sweep loses most of its objections.** "Nothing found is a
  confident wrong answer" goes away, because a sweep hit that is not this
  server fails the handshake. The scanning-noise and looks-like-reconnaissance
  objections stand, so the answer is still no, but for one reason rather than
  four.

## What it does not solve

**First contact.** There is no pin before the first pairing — that is the
bootstrap. A server discovered over mDNS and never met before is proved
against a key from its own advertisement, which is circular, and no transport
fixes that. First contact needs a human-checkable channel: show the advertised
identity id and let the person match it against their own server. Tracked
separately.

Browsers stay where they are. A page cannot pin a certificate, and automatic
route switching was never something a browser did.

## Open questions

- Where the attestation travels. A TXT field in the mDNS record, a field on
  `/v0/server`, or an extension in the certificate itself.
- What a client does with a pinned certificate that has legitimately changed —
  a re-issue after an interface change is routine, and refusing it would break
  a server that moved networks.
- Whether the loopback route is worth a certificate at all, or stays plain
  HTTP on the grounds that it cannot leave the machine.

## What is built

The server side, as of 0.7.5 development.

- `src/server-tls.js` issues the leaf: self-signed ECDSA P-256, IP SANs for
  the addresses `localPaths` reports, 398 days, re-issued when that set
  changes or expiry is within a month. The X.509 is written as DER here
  rather than by a library, because nothing chains to this certificate and
  the only question asked of it is whether its key is the attested one.
- The leaf is kept in `data/leaf.json`, 0600, and reused across restarts. A
  client pins the key it was attested, so a server minting a fresh one every
  boot would turn the re-check into an event that happens constantly, which
  is an event nobody reads as a warning.
- `attestLeaf` / `verifyLeafAttestation` sign and check
  `conduit-leaf-spki-sha256.v1.<id>.<sha256 of SPKI>` with the Ed25519
  identity. The prefix is domain separation: an attestation must not be
  replayable as any other signature this key makes.
- The server listens over TLS on `CONDUIT_TLS_PORT`, nine above the plain
  port -- 4319 by default, with 4311 through 4318 left to the development
  servers that `port + 1` would otherwise collide with. Both numbers are
  permanent from the first release that pins: a client that pinned a
  certificate reached on 4319 cannot be moved off it, and 4310 cannot be
  promoted onto TLS for the same reason. A port of its own rather than one
  socket serving both, because
  telling TLS from HTTP on a shared socket means reading the first bytes of
  every connection and guessing, in front of everything. A port already in
  use warns rather than refusing to start: the plain listener is what every
  client uses today.
- `/v0/server` reports `secure: { port, fingerprint, attestation }` beside
  `paths`, and deliberately not among them. No shell can pin a certificate
  yet, so an `https` origin in `paths()` today would be a route every client
  refuses to take.

Still open, in the order it has to happen: the two shells' certificate
callbacks, then `https` origins in `paths()`, then the candidate-list
rework this unlocks. The `disableIPv6` revert and the mDNS field for the
attestation both wait on the first of those.
