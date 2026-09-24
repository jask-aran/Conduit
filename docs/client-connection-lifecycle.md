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
   a server restart. Both installed clients should be able to download before
   installation, subject to their platform install rules.
5. Apply the chosen handoff to each supported deployment path. Check whether
   the local script and container replacement can expose the new browser
   assets while the old server still serves connections. If a path cannot,
   define its own safe fallback instead of treating readiness replies as proof
   that clients downloaded assets they could not reach.

## Installed-client update source

Today the released Windows app fetches its updater manifest from GitHub
Releases. Android looks up the latest GitHub Release and opens its APK URL.
The server already has a development-only `/desktop-updates` route for local
Windows builds. Released clients can keep using GitHub Releases directly,
including for background downloads. A server-hosted update manifest and files
are an optional distribution route if a concrete need appears, such as local
network delivery or updates when GitHub is unavailable. Server caching is not
required for a client to download an update before installing it.

The manifest needs a channel, version, platform, artifact URL, and enough
identity to avoid mixing a development build with a release build. The Windows
client must still verify the package signature with its built-in key. Android
must still use an APK signed with the expected key and obtain system installer
confirmation. A server-provided URL or version is an offer, not authority to
run unverified code.

A server cache, if later justified, should fetch the exact published release
artifacts from GitHub in the background, store them across server/container
restarts, and expose a version only after its required files are complete. It
must not offer a half-downloaded release. The development server can keep
serving locally built development artifacts. Building and serving are separate
steps: a running server must keep serving the last complete build while another
is being built. An update notice can tell connected clients to check their
chosen source; clients that reconnect check it without a prior notice.

Windows local builds use the updater key at
`~/.conduit/conduit-updater.key`; CI reads its copy from a secret. If those are
the same key, both outputs are trusted by a Windows client carrying its public
half, although the signatures and artifacts differ for different builds. The
development Windows app is a separate installation and version channel.
Android development APKs use a debug key, while CI release APKs use the release
keystore; a development APK cannot replace the released Android app.

Windows now calls Tauri's `download` while the app remains usable and reports
**ready** after the package is verified. The person starts `install` from that
state; the app then relaunches without another network transfer.
Windows exits the app during installation, so the install/relaunch still causes
a short interruption. Decide whether a ready package remains available after
the app itself exits; Tauri's in-process downloaded update alone does not
establish that guarantee. Do not tie this install to every server restart.

Android can likewise download an APK from its chosen source and hold it ready
without Google Play. A later install must still go through Android's package
installer and may require approval to install from that source. Google Play
distribution would enable a different Play-managed update flow; it is not a
prerequisite for predownloading an APK. The current Android path opens a remote
APK URL, so local staging and installer handoff are new work.

An installed app can connect to several servers, which may run different
releases or be controlled by different operators. If server delivery is added,
choose an explicit update source and trust rule: a configured home server, a
fixed Conduit update server, or an opt-in source on each server. Do not silently
accept an app update from whichever server happens to be selected. Keep package
update state (available, downloading, ready, installing) separate from the
short-lived connection state used to decide when a server may restart.

## Suggested order

1. Done: split Windows download from install using the current signed updater
   source, with a ready-to-restart action. The installed update still needs a
   live Windows test when an artifact is available.
2. Keep released clients on GitHub while Windows staging is proven. Use the
   existing local route for development builds. Add a production server cache
   only if direct GitHub delivery has a measured or product-level shortcoming.
3. Let Android download an APK from its chosen source into app-controlled
   storage, then hand the local file to Android's installer on request. This
   needs a different client install path even if the source is shared.
4. Add short-lived connection identities and browser worker readiness replies
   to shorten the server restart wait. Native package readiness can be reported
   for visibility, but must not become a condition for stopping the server.

The connection record could then show which active client version and protocol
capabilities each server currently sees, target update notices, and explain why
a browser restart waited. A later compatibility rule could warn an older app
before a server feature it cannot use. These facts apply only to connected
clients: offline devices are unknown, a completed download is not an install,
and a new installed version is confirmed only when the client connects again.

## Release selection

Keep a tag as the explicit decision to publish a release candidate or stable
release. Today `v*` tags trigger CI builds of the container, Windows app, and
Android APK. A `vX.Y.Z-rc.N` tag produces a GitHub prerelease and does not move
the container's `latest` tag; `vX.Y.Z` produces a stable release. Each tag
needs its own committed `docs/releases/<tag>.md` file. Run the repository's
release test gate before tagging. The decision that a commit is ready remains
human, based on the finished scope and checks; the tag records that decision
on an exact commit.

The local `.devcontainer/start-conduit.sh restart` builds the working tree, not
the latest tag. Local Windows development builds also use the last tag only to
derive their next development version; they build the current checkout. Keep
this fast development channel independent of release tags. A future locally
distributed development update should identify its exact committed source and
not claim that a dirty checkout is the named commit. If production servers
later cache releases, they should mirror completed CI artifacts, not rebuild
release binaries. If a local tool is needed to inspect a release build, make
the tag an explicit input and build an isolated checkout of that exact commit;
do not silently choose the highest local tag.

After checking a candidate's installed artifacts, a stable tag can select the
validated commit, provided its stable changelog was committed. The current CI
builds new artifacts for the stable tag; it does not promote the candidate's
exact binaries. Decide separately whether binary-identical promotion is worth
changing that pipeline.

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
- Is there a concrete need for a production server cache? If so, which server
  may offer updates, and how are channel and artifact identity selected?
- When should a ready Windows package install: only on request, when the app
  becomes idle, or after a server announces a compatible new release? Which
  unsent work must delay relaunch?
- Must a downloaded Windows package survive closing the app before install?
  If so, define durable staging instead of relying on an in-process update.
- Should browser restart readiness and installed-client update delivery be
  separate implementation slices under one connection/update design?

The first useful outcome is a bounded browser handoff: a changed worker is
ready before the old server stops; the server stops as soon as all eligible
clients report readiness, or at the timeout; native clients do not delay it.
The connection model should also make it clear which clients were counted and
why a restart waited. This is design scope, not an implementation commitment.
