# One install command

> **Superseded** by what shipped in v0.7.7: the CLI is `conduit-server` (`scripts/conduit-server`), state is `~/.conduit/data`, and the current reference is [docs/deployment.md](../deployment.md). Kept as the reasoning behind it.

Drafted 2026-10-02. A plan, not a spec: how Conduit goes from "clone the repo
and run a dev script" (or "run the container on a VPS") to

```sh
curl -fsSL https://github.com/jask-aran/Conduit/releases/latest/download/install.sh | sh
```

on any computer the user owns.

## Why the container goes

Conduit is a GUI for driving the agents on *your* computer: your folders, your
toolchains, your `claude`, `codex` and `opencode` logins. The container exists
to do the opposite -- fence Conduit off from the host -- and pays for it
everywhere: Host Pi is reported unavailable, workspaces are a `/workspaces`
mount with their own path namespace, harnesses on the host cannot be reached,
and a VPS needs Docker, Compose and Caddy before Conduit runs at all. The
container, GHCR image, Compose files, Caddyfile and the deploy/prove scripts
are removed. Conduit runs as the user, with the user's permissions, like any
other program they install.

## What already lines up

- **Code and state are separable.** `CONDUIT_DATA_ROOT` is already the single
  state boundary (registries, preferences, password, Pi credentials and
  transcripts, chat files), and `CONDUIT_CLIENT_DIST` / `CONDUIT_TEMPLATES_ROOT`
  already point the server at code elsewhere. The container uses exactly this.
- **Toolchains are already private.** uv and its Python are downloaded at a
  pinned version into the data root; Pi is an npm dependency, not a host
  install.
- **Releases already build per platform.** A tag runs validate → Android,
  Windows → release with signed artifacts; `scripts/package-release.sh` makes an
  exact-commit tarball.
- **Lifecycle already exists.** `start-conduit.sh` knows how to drain live
  turns, give browsers the PWA grace period, restart and health-check.

## The shape

### What gets installed

```
~/.local/share/conduit/
  versions/0.7.7/        one release, read-only: server, built client,
                         production node_modules, templates, working-files
  current -> versions/0.7.7
  node/                  pinned Node runtime (like uv today)
  data/                  CONDUIT_DATA_ROOT: everything durable
~/.local/bin/conduit     the CLI
```

macOS uses `~/Library/Application Support/Conduit`. Windows is WSL, as today.
Nothing needs root.

### The release artifact

A new `server` job in the release workflow builds one tarball per platform --
`linux-x64`, `linux-arm64`, `darwin-arm64` (and `darwin-x64` if wanted):

- the built client (`dist/`) and server source;
- production `node_modules` only (`npm ci --omit=dev`), with `node-pty`'s
  native build for that platform -- the one reason the tarball is per
  platform;
- `templates/`, `working-files/pyproject.toml` + `uv.lock`;
- a manifest naming the Node version it was built against.

Each is checksummed and signed with the minisign key the Windows updater
already uses. `install.sh` is attached to the release too, so `latest/download`
always serves the installer matching the newest release.

### `install.sh`

1. Detect OS and architecture; refuse plainly where there is no build.
2. Download the pinned Node runtime if absent, then the release tarball;
   verify both.
3. Unpack into `versions/<v>`, point `current` at it, write `~/.local/bin/conduit`.
4. Set the login password -- read from `/dev/tty`, since stdin is the pipe.
5. Sync the working-files Python environment (uv, as `setup` does now).
6. Register a service and start it (below), then print the URL.

Re-running it is an update. `CONDUIT_VERSION=0.7.7` pins one;
`--no-service` installs without starting.

### The `conduit` CLI

`start-conduit.sh`'s production half moves into `scripts/conduit.mjs`, run by
the bundled Node:

| Command | Does |
| --- | --- |
| `conduit start / stop / restart / status / logs` | the drain, PWA grace and health checks `start-conduit.sh` has today |
| `conduit update [version]` | download, verify, unpack beside `current`, switch, drained restart; keeps the previous version for `conduit rollback` |
| `conduit password` | `conduit-auth.mjs set-password` |
| `conduit doctor` | Node, uv, Python, harnesses on PATH, port, service, data root |
| `conduit uninstall [--keep-data]` | service, versions, CLI; data only when asked |

`start-conduit.sh` stays for development (`dev`, the Windows desktop update
directory, building from source) and calls the same code for start/stop.

### Running in the background

- **Linux:** a `systemd --user` unit, with `loginctl enable-linger` offered so it
  survives logout on a headless machine. Without systemd, the CLI's own
  detached process and pid file, as now.
- **macOS:** a `launchd` agent in `~/Library/LaunchAgents`.

### Reaching it

The server binds `127.0.0.1:4310` by default -- it controls the machine, so
exposing it is a choice, not a default. The installer prints the three ways in:

- the same machine: the browser, the desktop client;
- a private network: Tailscale (`tailscale serve 4310`), the recommended path
  for phones and other machines;
- public: Cloudflare Tunnel or the user's own reverse proxy, with
  `CONDUIT_HOST=0.0.0.0` behind it. Conduit's password login and the clients'
  bearer tokens already assume an untrusted network.

Caddy and automatic TLS leave the product; the docs keep a short reverse-proxy
example.

## Repository changes

1. **Defaults follow the install.** When run from an installed `current`, the
   data root defaults to the platform data directory rather than `<repo>/data`;
   a clone keeps `./data`. Workspace allowlist and default root become the
   user's home rather than `/workspaces`.
2. **The CLI** (`scripts/conduit.mjs`) with the lifecycle lifted from
   `start-conduit.sh`; that script shrinks to dev-only.
3. **The `server` release job** and signed tarballs; `install.sh` rewritten
   and attached to the release.
4. **Removed:** `Dockerfile`, `compose.yaml`, `compose.build.yaml`, `Caddyfile`,
   the `container` job and GHCR push, `scripts/deploy.sh`,
   `scripts/prove-deployment.sh`. `docs/deployment.md` becomes "Install,
   update, back up": the data root is still the whole backup.
5. **Host Pi and every harness become available everywhere** -- the container's
   "Runtime boundary" section goes with it.
6. **Desktop and Android clients** are unchanged: they already take a server
   address.

## Order

1. Data-root and workspace defaults for an installed layout; the CLI over the
   existing lifecycle. Usable from a clone immediately.
2. The `server` release job producing tarballs for Linux x64.
3. `install.sh` + systemd user service; prove it on a fresh Debian VM and on
   WSL.
4. arm64 and macOS builds, launchd.
5. `conduit update` / `rollback`, and the clients offering a server update.
6. Delete the container path and rewrite the deployment docs. Existing Docker
   installs migrate by pointing the installer at their `data/` directory
   (`CONDUIT_DATA_ROOT=/srv/conduit/data`); the layout is the same. Persisted
   workspace paths under `/workspaces` need one rewrite to their host paths --
   a `conduit migrate-workspaces <from> <to>` step.

## Open questions

- **Bundle Node or require it?** Bundling (as uv is) makes the one command
  truly one command and pins the ABI `node-pty` was built for; it costs
  ~30 MB per install. Recommended.
- **Install root:** `curl | sh` of a signed artifact from GitHub Releases, or a
  short vanity URL that redirects there.
- **Default bind:** loopback-only as above, or prompt during install for "this
  machine only / my network".
- **Python environment:** synced at install (≈ a minute, ~300 MB) or on first
  use of a working-files task.
