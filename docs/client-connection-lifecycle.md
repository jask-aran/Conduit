# Client connections and update readiness

Status: future design work. The current restart handoff stays in place.

## Current boundary

`RuntimeHub` holds a set of open runtime streams. It can send a restart notice to
them, but it does not identify a logical client, record its build or update path,
or know whether that client has prepared an update. Other live transports, such
as terminal sockets, are separate from this set. An open stream is evidence of
a current connection, not a record of every installed device or browser profile.

For a local rebuild, `.devcontainer/start-conduit.sh restart` checks whether
`sw.js` changed. If it did, the running server tells connected browsers to
check for a new service worker before the server stops. The script then waits
up to the configured grace period (20 seconds by default), even when every
browser is ready. A browser can activate its waiting worker when the runtime
stream closes, subject to the existing dirty-tab protection. Server-only
restarts do not need this wait.

The installed clients do not load their interface from the server. Windows
ships its own web assets inside a Tauri app and updates through a signed
updater package. Android ships its assets inside an APK and needs system
installer confirmation. Neither can prepare a service worker for a server
restart. An installed client can also switch between several servers; a browser
installation belongs to one origin. See `docs/desktop-client.md` and
`docs/servers.md`.

The VPS/container replacement in `scripts/deploy.sh restart` does not use the
local script's pre-restart notice. Any design that claims to cover deployed
browser clients must address that route and when the new assets become
available, not only the local development restart.

## Remaining work

1. Define what the server tracks: a live transport, a tab or window, or a
   logical client. Give each live connection a short-lived ID and explicit
   client kind and build information where useful. Keep connection state scoped
   to the selected server. Do not use this as a persistent device registry
   unless a separate product need justifies one.
2. Define a restart attempt with a build identity. The server must know which
   connected browser clients can prepare that build. A readiness reply must
   identify the attempt and come from the authenticated client. The client
   must reply only when the matching service worker is installed and waiting,
   or when it already runs that build. A stale reply must not count.
3. Define the restart rule. Stop early when all eligible, currently connected
   browsers are ready. Keep a firm timeout for slow, suspended, or unreachable
   clients. Specify how late arrivals, disconnects, reconnects, and several
   tabs that share one service worker affect the waiting set. Preserve the
   dirty-tab rule when the worker activates after disconnect.
4. Separate server compatibility from app installation. Desktop and Android
   can report their kind and build so the server can diagnose or reject an
   incompatible protocol. Their package downloads and installs must not hold
   a server restart. Decide separately whether either installed client should
   ever prefetch an update; Windows can use its signed updater, while Android
   still needs user confirmation.
5. Apply the chosen handoff to each supported deployment path. Check whether
   the local script and container replacement can expose the new browser
   assets while the old server still serves connections. If a path cannot,
   define its own safe fallback instead of treating readiness replies as proof
   that clients downloaded assets they could not reach.

## Decisions to make before implementation

- Is one browser tab a participant, or is one service worker registration a
  participant for all tabs in the same browser profile and origin? What is the
  smallest identity that makes readiness replies reliable without durable
  tracking?
- Should readiness use an authenticated HTTP reply to the existing one-way
  runtime stream, or should connection tracking move to a two-way transport?
- Does the current 20-second cap remain fixed, or should the operator set it
  per deployment? The server must still restart at the cap.
- What is the compatibility contract between an installed client build and a
  server release, especially when one installed client visits several servers?
- Should this work cover only browser restart readiness first, with installed
  client compatibility as a separate implementation slice?

The first useful outcome is a bounded browser handoff: a changed worker is
ready before the old server stops; the server stops as soon as all eligible
clients report readiness, or at the timeout; native clients do not delay it.
The connection model should also make it clear which clients were counted and
why a restart waited. This is design scope, not an implementation commitment.
