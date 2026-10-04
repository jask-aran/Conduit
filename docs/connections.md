# Connections: unified server connections and lifecycle

The remaining connection work covers one shared connection experience,
server discovery and route trust, and client readiness when the server restarts.
This document separates the current implementation from the agreed work.
[`servers.md`](servers.md) describes the existing server identity, route list,
and shared directory.

## Terms

One vocabulary in the clients, the CLI and setup output:

| Term | Means |
| --- | --- |
| **Loopback** | a route on `127.0.0.0/8` or `[::1]` that proved this server's identity |
| **Network** | a private-range route (`10/8`, `172.16/12`, `192.168/16`) |
| **Tailscale** | a `.ts.net` route; a provider label, public scope |
| **Internet** | any other public route |
| **This machine only / This machine and network** | the two setup choices |

"On this machine" is deferred (see Identity, discovery, and routes).

## 1. Connection experience, discovery, and routes

### Connection experience

One connection component, shown in three places:

- **First connection screen**: a full page in the pane.
- **Settings → Servers**: the Settings list (DESIGN.md, Components → Settings list).
- **Sidebar server switcher**: a dropdown menu. "Add server" is its single
  footer action under a hairline, and it opens the component in a
  `FrostDialog` (a full-screen bubble on a phone).

Behaviour:

- **QR pairing comes first**, then discovered servers, then an entered address.
- In installed clients, opening the component starts a bounded search for
  servers on this machine and network. Results append as they arrive and never
  reorder under the cursor. A small spinner beside the heading shows while
  searching; an empty search reads "Nothing here yet." Discovery stops when the
  component closes. Both shells stream results; `discoverServers()` currently
  returns them all once at the timeout.
- A discovered server whose identity ID is already saved shows as that saved
  server, not as a second row.
- Selecting a discovered server opens the normal password screen. Successful
  login saves it. Unpaired discoveries remain temporary.
- Browsers keep address-based connections: the address field, a line saying
  discovery needs the app, and a record rather than a sign-in.
- Settings and the switcher show saved servers, connection state, active route,
  and "Add server", from the same rows and route controls.
- Connection state is the runtime dot: a healthy server shows the dot alone, a
  label only when there is something to say, one indicator per row, worst
  state first.
- The switcher shows available routes. A pinned route that has failed stays in
  the list, dimmer and struck through, with Automatic as the next choice. That
  row is the fallback offer; there is no toast or modal. Settings lists every
  candidate, available or not.
- Support any number of servers.

**Naming.** Built: the server owns one canonical name. Setup's
`CONDUIT_SERVER_NAME` seeds it on first start only; afterwards the name saved
in `identity.json` wins. Renaming in Settings → Servers (for the server this
client is connected to) or with `conduit-server name` calls
`PUT /v0/server/name`, which saves it and republishes the mDNS instance name;
every client takes the server's name on its next identity fetch. Per-client
labels are gone.

**First contact.** First contact through discovery accepts the advertised
identity and uses normal password login. A LAN impostor that answers first
receives **the password**, not just a session token, and that password works
against the real server over any route. This risk is accepted, which is why QR
pairing comes first: it supplies the identity from trusted setup output. No
comparison codes or new password protocol.

### Identity, discovery, and routes

Keep the existing server ID and identity key authoritative. Addresses find a
server; they do not define it. Merge routes only after verifying the same
identity.

- Reuse mDNS for network discovery. Return route candidates rather than
  discarding all but one address.
- Show available routes first; keep unavailable candidates in Settings. Keep
  local availability evidence on the client, separate from the shared server
  directory.

Automatic selection prefers a verified Loopback route, then Network, then
Tailscale or Internet. Probe candidates concurrently with bounded timeouts;
`path-selector.ts` probes them one at a time today. Wait for a quiet moment
before upgrading a working connection; recover immediately when an automatic
route fails. Preserve manual pins.

Route selection for a saved server can reuse its known candidates during
connection and recovery. It does not start a new network discovery scan.

**Deferred: "On this machine".** A loopback response alone cannot tell this
machine's server from an SSH forward of a remote one, and routing does not
need to: a verified Loopback route already ranks first. The label needs a
host-local registration file (identity, name, candidates, no secrets) visible to
Windows, WSL and the development container. That is deferred until there is a
concrete shared path and a named writer. Until then the route reads Loopback.

## 2. Proving the server by its connection

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

TLS whose certificate the identity key vouches for. The handshake becomes the
proof: a relay cannot complete it without the certificate's private key, and
only the identity key can vouch for that certificate. This protects route
changes after pairing; it does not remove the first-contact risk accepted above.

### Built

- **Server.** `src/server-tls.js` issues a self-signed ECDSA P-256 leaf (P-256
  because Chromium refuses Ed25519 certificates), kept in `data/leaf.json` for
  398 days and re-issued only near expiry. The identity key signs
  `conduit-leaf-spki-sha256.v1.<id>.<base64 sha256 of SPKI>`, and the leaf
  carries that signature in a non-critical `2.25.<uuid>` extension
  (`ATTESTATION_EXTENSION_OID`), so a client holding the identity key can
  accept the leaf from the certificate alone. TLS and plain HTTP share one
  port: the listener reads each connection's first byte and hands a TLS
  handshake (`0x16`) to the HTTPS server, anything else to HTTP.
- **Android.** The page hands `ConduitTlsPlugin` the identity keys of its
  paired servers (`client/platform/certificate-pins.ts`).
  `ConduitWebViewClient.onReceivedSslError` (which also fires for `wss://`)
  accepts a leaf whose embedded attestation verifies against one of them,
  answering only an untrusted authority or a name mismatch; expired and
  not-yet-valid leaves are refused. Platform Ed25519 needs API 33; older
  devices refuse every leaf. Remembered decisions are cleared when the set
  changes. Measured on the SM-S936B: an attested leaf is accepted, and the
  same server is refused when only another identity is trusted.
- **Windows.** The page hands the Tauri shell the same keys
  (`trust_identities`, `src-tauri/src/certificate_trust.rs`), and WebView2's
  `ServerCertificateErrorDetected` applies the same rule. It checks the
  leaf's validity dates itself, because WebView2 reports a single status and
  an untrusted authority outranks expiry. Approvals are cleared when the set
  changes. Measured in the dev client: the event fires for both HTTPS and WSS,
  and an `AlwaysAllow` does not carry over to a different leaf on the same
  host and port.

### To build

- Discovery already advertises the identity key, so a discovered server can be
  connected over TLS before login without a temporary pin or an advertised
  attestation. Save the identity only after successful authentication.

With proof in the handshake, addresses become candidates rather than trusted
instructions. Enable `https` origins in `paths()` only after both shells
verify. Restore IPv6 support in `lan-advertisement.js` as part of candidate
handling. Decide then whether `/v0/server/prove` still has a caller; browsers
cannot reach it across origins, so it may only serve cleartext routes.

Browsers cannot pin, so their existing browser connections remain separate.
Until native verification and secure route selection land, treat a cleartext
route as checked against a passive impostor, not an active one.

### Pairing and setup

Built: the pairing link ("Pair a device" and `conduit-server pair`) keeps the
browser-compatible `<widest route>/v0/auth/handoff?code=…` and adds
`#conduit=<base64url {id, key, routes}>` in the fragment, which no browser
sends. The app trusts that identity, probes every route at once (local ones
over TLS the identity must vouch for), redeems the code on the nearest that
answers, and saves the server with its identity, routes and `tls` already
known. Verified on the emulator from a wiped app: paired on
`https://192.168.0.128:4310`, the leaf accepted as `5abbb638…`, not on the
public address the link opened with.

Local-only setup still offers pairing, labelled "This machine only".

Built: setup (and `conduit-server connect`, to change it later) says this
computer always reaches the server and asks who else does, in one checklist
with the current choices ticked: **Devices on this network** ("leave off on a
VPS"), Tailscale, a tunnel or reverse proxy, SSH. Without the network the
server binds loopback, publishes no network routes and does not advertise on
the LAN. CLI status, the ready box and `pair` name the server and use the
clients' route terms. Clients list a loopback route only while it answers
from them.

## 3. Knowing who is connected at restart

### Today

Before a local restart, `start-conduit.sh restart` has the server tell open
browsers to fetch a changed service worker, then waits a fixed 20 seconds even
when every browser is ready. `RuntimeHub` holds open streams but knows nothing
about who they are. `conduit-server restart` on an installed server waits for
live turns but sends no pre-restart notice, so browsers on a released server
are not warned.

### To build

Extend the existing runtime stream rather than replacing its transport.

- Give each live connection a short-lived ID and report client kind and build.
  Remove it when the connection closes.
- Identify browser service-worker registrations separately from tabs. Browsers
  expose no stable registration ID, so the client generates one and stores it
  in IndexedDB, where the worker and every page of that registration read the
  same value. Show tabs individually, but count each registration once for
  restart readiness, so a frozen background tab cannot hold a restart that
  another tab of the same registration has already acknowledged.
- A restart attempt carries a unique attempt ID and target worker hash. An
  authenticated HTTP acknowledgement counts only for that attempt and target.
- Snapshot the eligible registrations when preparation starts. Reconnects
  retain their registration membership; late arrivals receive preparation
  without extending the waiting set. Disconnected registrations stop holding
  the restart.
- A browser is ready when the target worker is installed and waiting, or
  already active. Preserve the current update and draft behaviour.
- Native clients report builds but never delay restart. Keep the existing
  active-turn drain and force-restart behaviour.
- Both server launch scripts use the same preparation and readiness mechanism.
  Proceed when all eligible registrations are ready, or after 20 seconds.
- Show connected clients, builds, and waiting reasons in Settings → Servers and
  CLI status. In Settings these are muted state after the server's name, per
  the Settings list rules, not a new row type.

Connection identity is scoped to the server and lasts only for a live
connection. It is not a device registry. Client application updates remain
separate from server restarts.

### Related, separate

- **Android updates.** Android could download an APK ahead of time and hand it
  to the installer on request. Today it opens a remote APK URL.
- **Durable staging on Windows.** Windows already downloads its update in the
  background. Decide whether a ready package has to survive the app closing.
- **No app updates from servers.** Never accept an app update from whichever
  server happens to be selected. Serving updates from a server is only worth
  doing if GitHub delivery proves inadequate, and then from an explicitly
  chosen source.

## Verification and delivery

Order:

1. Identity-key TLS: embedded attestation, then Android, then Windows.
2. Discovery and route selection.
3. Setup and pairing.
4. Restart readiness.

The shared connection component (§1, Connection experience) does not depend on
TLS and can land alongside step 1. Update `docs/servers.md` and
`docs/connections.md` to describe the resulting behaviour.

Use one surgical verification seam per change. Specifically prove:

- wrong-certificate and expired-certificate rejection on both shells
- Windows HTTPS/WSS verification, and the scope of WebView2's approval cache
- that a re-issued leaf is accepted with no client change
- pairing through the network without public-route access, with the code
  redeemed over TLS
- that a rename survives a server restart and reaches mDNS
- stale restart acknowledgement rejection
- that two tabs sharing one worker count once and native clients never hold
  restart

No broad test sweeps or legacy migration layer. Assume clients and servers
update together. Restart the development server after each implemented change
set for user testing. No implementation or runtime verification has occurred
during this planning session.
