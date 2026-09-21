# Several servers

How a client holds more than one Conduit server, how it moves between them, and
how the list of them gets from one client to the next.

## What a server is, here

An address, a name, and — on an installed client — a token of its own. Nothing
identifies a server beyond the address it is reached at: two addresses that
happen to arrive at the same machine are two entries, because nothing the
client can see says otherwise and the only thing that could say so is an
unauthenticated endpoint nobody should be trusting for it.

The name defaults to the host **including the port**, because the port is
usually the only thing telling two of them apart. A list where every local
server reads `127.0.0.1` is a list you cannot use.

`src/client/platform/servers.ts` holds the list and the active address;
`src/client/api/transport.js` asks it where to send everything. Every request
already funnels through `httpUrl`/`webSocketUrl`, so no call site knows which
server it is talking to.

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

`shared` is per entry. Loopback starts **off**, because `127.0.0.1` names a
different machine on every device that reads it — the one address that is not
the same server everywhere. Everything else starts **on**. Either can be
flipped in Settings → System → Servers: two browsers on the machine the server
runs on can agree about a loopback address by saying so.

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
  The menu lists the servers with what each costs to reach, then Add server.
  Reachability is measured only while that menu is open: a timer pinging every
  known address forever is traffic nobody asked for over links that may be
  metered. A browser can only measure the origin it was served by, for the
  cross-origin reason above.
- **Settings → System → Servers** — rename, share, forget.
- **Add server** — address, then password, on an installed client. A browser
  cannot probe another origin or sign in to it, so there it records an address
  and says so rather than offering a password field that could not work. The
  server on this machine is offered wherever it might help; in a browser as an
  address to fill in rather than one confirmed.

## Storage

| | Where |
| --- | --- |
| The list, the active address | `localStorage`, per origin |
| An installed client's token | OS credential store, keyed per address |
| The shared directory | `knownServers` in each server's preferences |

The token key carries the address with everything a credential store cannot
hold folded to dashes, so `http` and `https` and two ports stay distinct. A
client that could hold only one server wrote its token under a bare name and
its address under `conduit.native.server-origin`; both are read once, and that
token is claimed by that address alone — under anything less specific, a server
added after the update would inherit a token another one minted.
