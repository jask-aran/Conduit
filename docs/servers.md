# Several servers

How a client holds more than one Conduit server, how it moves between them, and
how the list of them gets from one client to the next.

## What a server is, here

An identity, the addresses that reach it, a name, and — on an installed client
— a token of its own.

The identity is a 32-hex id and an Ed25519 key pair, held in `data/identity.json`
at mode `0600` (`src/server-identity.js`). The id is stable across restarts and
grants nothing; it exists so that two addresses can be recognised as one server
rather than kept apart forever. The private half never leaves the machine and
is not a login: possessing it proves identity and authorises nothing.

The addresses are called **routes**, and they are a property of the server
rather than separate servers. A client reaching the same machine at
`127.0.0.1:4310` and at `localconduit.example.com` holds one entry with two
routes, and which one is in use is a fact about where the client is standing.

The name defaults to the host **including the port**, because the port is
usually the only thing telling two of them apart. A list where every local
server reads `127.0.0.1` is a list you cannot use.

`src/client/platform/servers.ts` holds the list, the active server and the
active route; `src/client/api/transport.js` asks it where to send everything.
Every request already funnels through `httpUrl`/`webSocketUrl`, so no call site
knows which server or which route it is talking to.

## Identity, and why one endpoint is authenticated and one is not

Two questions, answered separately on purpose.

**"Who are you, and where else do you answer?"** — `GET /v0/server`, which
requires a session. It returns the id, the public key and the routes. It is
authenticated because an open version of it would let anything on the network
say "I am the server you already hold a token for", which is the whole reason
addresses were kept apart before this existed.

**"Prove you are the server I already paired with."** — `POST /v0/server/prove`,
which does **not** require a session, and that is the point. A client asks it
*before* it sends a token, so moving to a new address cannot be the thing that
hands a credential to whatever happened to answer there. The caller picks the
nonce and the server signs `<id>.<nonce>`, so a reply recorded off the wire is
worthless for the next question, and a caller holding no public half for this
server learns nothing it can act on.

### Where the routes come from

- **Loopback and LAN are derived.** `localPaths()` reads
  `os.networkInterfaces()` and keeps IPv4 loopback plus the private ranges.
  Link-local `169.254/16` is excluded: a machine gives itself one when nothing
  handed it an address, and offering it would put a row in every client's menu
  that only ever fails to answer.
- **The public address is observed.** Nothing on the machine says it sits
  behind `localconduit.example.com`; a client that arrived through it proves
  the address works by arriving. So `observe()` records the `Host` header —
  **only for authenticated requests**, because a `Host` header is written by
  whoever sends it, and an unauthenticated one would let a passer-by write an
  address into the list every client then reads. Capped at ten, oldest dropped.

### Choosing one

`src/client/platform/path-selector.ts` probes the routes and takes the nearest
one that answers and can prove it is this server, preferring loopback, then
private, then public. A route picked by hand is a decision and is pinned;
automatic selection stands down until it is set back. A switch does not rebuild
the client — the live sockets are moved — and it waits for a quiet moment,
because repainting a terminal while somebody is watching output arrive is a
poor trade against a few milliseconds.

## Finding a server that was never typed

Everything above works outwards from an address the client already has. The
first time, there is none: a server is running on a machine at home and the
phone has never heard of it.

The server publishes `_conduit._tcp` over mDNS (`src/lan-advertisement.js`),
with the identity id and the Ed25519 public half in the TXT record. Those are
the same two facts `/v0/server` hands out, and putting them on the LAN is what
makes discovery safe rather than merely convenient: whatever answers can be
asked to sign a nonce and checked against the key before a credential goes near
it. It is withdrawn when the machine holds no private address, republished when
the interfaces change, and turned off with `CONDUIT_ADVERTISE_ON_LAN=false`.

The built shells browse for it — Android through `NsdManager` in a Capacitor
plugin, the desktop through `mdns-sd` behind a Tauri command — and hand raw
advertisements to `src/client/platform/discovery.ts`, which picks the usable
address and shapes one result. Browsing lasts as long as the question; a
standing listener would hold a multicast socket open for the life of the app,
and on a phone that is a radio kept awake.

**A browser cannot do this at all**: there is no mDNS API in a page, and an
HTTPS document cannot open a plaintext connection to a LAN address. The
add-server form says so rather than showing a search that was never going to
finish.

**There is deliberately no subnet sweep.** Probing every host on a /24 is
indistinguishable from a port scan to any IDS or managed access point, it
cannot see past the client's own subnet, it has to guess the port — so "nothing
found" becomes a confident wrong answer — and it is impossible from a browser
anyway, which is the client that most needs help. If it ever earns a place it
is a button somebody presses, not something the app does on its own.

## Switching

| | Installed client | Browser |
| --- | --- | --- |
| What happens | `App` is remounted | the page navigates to that origin |
| The token | one per address, in the OS credential store | that origin's own cookie |
| What is torn down | every `onCleanup` in the tree | the whole document |

**An installed client does not reload.** Its assets are on disk and say nothing
about either server, so re-parsing the bundle to arrive at the same code is
time spent for nothing. Disposing the component tree runs every cleanup there
is, which closes the runtime stream, the live-session socket, the terminals and
dictation — a cold start in the sense that matters. Server-side PTYs keep
running on the server being left; they are simply no longer attached to.

**A browser cannot do this at all**, and the reason is worth stating because it
shapes everything else here:

- Conduit grants cross-origin access to exactly two origins, the Android
  webview and the Tauri shell (`src/native-auth.js`). Any other origin gets no
  CORS headers, and `validateNativeSession` refuses a bearer token that did not
  come from one of those two.
- The session cookie is `SameSite=Lax`, so it would not ride along either.
- The service worker, the storage, the install and the cache all belong to the
  origin that served the page.

So another server in a browser is another installation of this app. Choosing it
navigates there, where its own cookie signs you in. The list is the same list;
only the verb differs, and the row carries an external-link glyph to say so.

Holding a token is taken as being signed in, without checking. The check cost a
round trip in front of a blank window to learn what the next request reveals
anyway: every response goes through `authorizedFetch`, and a 401 clears the
token and raises `NATIVE_AUTH_REQUIRED`.

## The directory

Each server keeps the list, under `knownServers` in its preferences. Every
client that reaches a server reads that list and tops it up with whatever it
knows that the server does not, so an address is typed once rather than once
per device. Two addresses for the same machine therefore agree outright; two
machines learn each other the first time a client has been to both, with the
client as the courier.

It is a union in both directions, never a replacement, because both lists are
partial for the same reason: each was built by whoever happened to be there.

**Why the server and not something cleverer.** Two origins on one device share
nothing — separate storage, separate workers, separate everything. A server
they both talk to is the only channel between them, and there is no device
identifier a browser could carry across origins to narrow it. So "keep these
two browsers in step" cannot be answered without also reaching every other
client, which is why each address says for itself whether it travels.

`shared` is per entry. A **local** address starts **off**: `127.0.0.1` names a
different machine on every device that reads it, and `192.168.0.128` names
whatever machine holds that address on whatever network the reader is on, so a
phone carrying either onto mobile data is pointed at nothing. Everything
reachable by name starts **on**. Either can be flipped in Settings → System →
Servers: two browsers on the machine the server runs on can agree about a
loopback address by saying so.

## What an address may look like

HTTPS, unless the address cannot leave the machine (`localhost`, `127.0.0.0/8`,
`[::1]`) or cannot leave the network in front of it (`10/8`, `172.16/12`,
`192.168/16`, and the `169.254/16` a machine gives itself when nothing hands it
an address). Those are served over plain HTTP.

Loopback is the line a browser already draws for a secure context. A private
range is a weaker claim and worth saying out loud: that traffic does leave the
machine, onto a network the person is standing on. Requiring HTTPS there would
not protect the hop — it would mean a server on the LAN cannot be reached at
all, because no public authority issues a certificate for an address like that.

This costs the installed clients, which is the trade. A page at
`https://localhost` (Android) or `http://tauri.localhost` (Windows) calling a
plain-HTTP address is active mixed content, and Android additionally refuses
cleartext by default. **A LAN address is a browser address**: reach the server
directly at `http://<lan-ip>:<port>` and it is an ordinary web page, with no
service worker, because that is not a secure context either.

An address adopted from the directory is recorded as shared, since that is how
it arrived. Recording it otherwise would quietly drop it the next time that
client wrote the directory back.

**Forgetting has to reach the directory**, not just the device, or the address
returns on the next connection and the delete looks broken. It takes that
server's token with it: a credential for a server nobody lists can never be
used again. The server in use cannot be forgotten — there is nothing sensible
on the other side of that click.

The directory grants nothing. It is a list of addresses; every server is signed
in to separately, and a name is a label. It does mean each server learns where
the others are, which is the cost of not keeping the same list by hand in
several places.

## Where it appears

- **Sidebar footer** — the active server's name, its state, and its round trip.
  The menu lists the servers, and under the active one its routes with what
  each costs to reach. Reachability is measured only while that menu is open: a
  timer pinging every known address forever is traffic nobody asked for over
  links that may be metered. A browser can only measure the origin it was
  served by, for the cross-origin reason above — and an installed PWA cannot
  change route at all, since navigating away ejects the person from the app, so
  there the routes are shown as facts rather than as choices.
- **Settings → System → Servers** — each server with its routes listed beneath
  it, and which one is in use. Rename, share, forget.
- **Add server** — what was found on this network first, then the address
  field, then the password, on an installed client. Picking a found server
  proves the address against the key that came with it before going on to the
  password. A browser cannot browse the network, cannot probe another origin
  and cannot sign in to it, so there it gets the address field alone, a line
  saying discovery needs the app, and a record rather than a sign-in. The
  server on this machine is offered wherever it might help; in a browser as an
  address to fill in rather than one confirmed.

## Storage

| | Where |
| --- | --- |
| The list, the active server, the pinned route | `localStorage`, per origin |
| Each entry's id, public key and known routes | alongside it in that list |
| An installed client's token | OS credential store, keyed per address |
| The shared directory | `knownServers` in each server's preferences |
| The server's own id and key pair | `data/identity.json`, mode `0600` |
| Composer drafts | `localStorage`, keyed by server origin and chat, mirroring the server's copy |

The token key carries the address with everything a credential store cannot
hold folded to dashes, so `http` and `https` and two ports stay distinct. A
client that could hold only one server wrote its token under a bare name and
its address under `conduit.native.server-origin`; both are read once, and that
token is claimed by that address alone — under anything less specific, a server
added after the update would inherit a token another one minted.
