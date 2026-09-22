# Proving a server by the connection, not beside it

Status: plan for 0.7.5. Nothing here is built. This records an investigation
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

Two pieces of security-critical native code that cannot be tested from the
development machine.

- **Android** — `onReceivedSslError` on the WebView client.
- **Windows** — WebView2's `ServerCertificateErrorDetected`.

Both must cover **WebSockets**, which means the override lives in the
WebView's TLS stack rather than in a native HTTP client; `CapacitorHttp` can
carry a fetch but not a socket.

The natural bug in both is "accept any certificate", which is worse than the
situation today. Whatever lands here needs a test that a *wrong* attestation
is refused, not only that a right one is accepted.

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
