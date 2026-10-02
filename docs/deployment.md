# Install and operations

Conduit runs as you, on a computer you own, with your permissions -- it is a
GUI for the agents and tools already there. There is no container and nothing
needs root.

## Install

```bash
curl -fsSL https://get.jask-aran.com/conduit | bash
```

`get.jask-aran.com/conduit` serves `scripts/install.sh` from `main`. It:

1. picks the build for this computer (Linux x64 or arm64, macOS arm64; Windows
   runs it inside WSL);
2. downloads that release from GitHub and checks its SHA-256, then the exact
   Node it was built with;
3. installs both into `~/.local/share/conduit` and links `~/.local/bin/conduit-server`;
4. runs `conduit-server setup`: a login password, who may reach Conduit (this computer
   only, or any device on the network), the port, the Python tools for
   spreadsheets and documents, and the service that keeps it running.

`--version v0.7.7` installs a given release, `--no-setup` stops before setup.

## Layout

| Path | Holds | Replaceable |
| --- | --- | --- |
| `~/.local/share/conduit/versions/<v>` | one release: server, built client, production `node_modules`, templates | yes; the two newest are kept |
| `~/.local/share/conduit/current` | link to the running release | yes |
| `~/.local/share/conduit/node/<v>` | the Node the release runs on | yes |
| `~/.conduit/data` | everything durable: registries, preferences, password, Pi credentials and transcripts, chat files, toolchains | **no** -- this is the backup |
| `~/.conduit/conduit.env` | `CONDUIT_HOST`, `CONDUIT_PORT` and any other `CONDUIT_*` setting | edit, then `conduit-server restart` |

A development checkout uses the same `~/.conduit/data` unless
`CONDUIT_DATA_ROOT` says otherwise.

## Running

| Command | Does |
| --- | --- |
| `conduit-server status` | version, whether it is healthy, where its data and logs are |
| `conduit-server start` / `stop` / `restart` | restart waits up to ten minutes for answers still being written |
| `conduit-server logs` | follows the log |
| `conduit-server update [v]` | installs the latest (or a given) release and restarts |
| `conduit-server rollback` | returns to the previous release |
| `conduit-server password` | changes the login password |
| `conduit-server doctor` | Node, Python tools, password, agents on PATH, server health |
| `conduit-server uninstall` | removes the app and service; `~/.conduit` stays |
| `conduit-server use dev <clone>` | runs a development clone instead of a release, on the same data and port |
| `conduit-server use release` / `use v<v>` | back to an installed release |

The service is a `systemd --user` unit on Linux (with lingering enabled, so it
survives logout on a headless machine) and a launchd agent on macOS. Without
either, `conduit-server` runs the server as a background process with a pid file.

Agents are the user's own: Conduit finds `claude`, `codex` and `opencode` on
PATH and uses their existing logins and sessions.

## Development and a fresh install on one machine

A clone and an installed release are the same daemon running different code.
`conduit-server use dev ~/Conduit` points it at the clone; from then on
`.devcontainer/start-conduit.sh restart` builds the clone and restarts the
daemon, and `start`, `stop`, `status` and `logs` go to it too. `conduit-server
use release` runs the installed release on the same data, and `use dev`
returns. `start-conduit.sh dev` (Vite hot reload) still runs on its own.

To see what a new user sees without touching any of that, install a sandbox:

```bash
curl -fsSL https://get.jask-aran.com/conduit | bash -s -- --sandbox
```

It is a second daemon, `conduit-server-sandbox`, with its own
`~/.conduit-sandbox` data, port 4321 and service, and `conduit-server-sandbox
uninstall` removes all of it.

## Reaching it

Setup asks how Conduit will be reached, and the choices follow what it finds
(`conduit-server connect` asks again). The server stays on `127.0.0.1` for
every choice except "my network" -- it controls the computer.

**A laptop or desktop** (a screen, macOS, or WSL):

- *Just this computer* -- `http://localhost:4310`, or the desktop app.
- *My devices anywhere, with Tailscale* -- `tailscale serve` gives it
  `https://<machine>.<tailnet>.ts.net` for your phone and other computers.
- *Any device on my network* -- binds `0.0.0.0`, opened at the LAN address.

**A VPS used as a remote dev box** (reached over SSH, no screen):

- *Tailscale (recommended)* -- installs Tailscale if it is missing (sudo once),
  runs `tailscale up` to sign the server in, then `tailscale serve`. If serve is
  refused for a non-root user it offers `tailscale set --operator=$USER`; if
  the tailnet has HTTPS off, it says where to turn it on.
- *SSH tunnel* -- nothing to install; it prints the `ssh -NL 4310:localhost:4310
  user@<ip>` to run on your computer, then `http://localhost:4310`.
- *Own proxy or Cloudflare Tunnel* -- point it at `127.0.0.1:4310` and terminate
  HTTPS there. Password login and the clients' bearer tokens assume an
  untrusted network.

The choice is `CONDUIT_ACCESS` in `conduit.env`; `conduit-server status` shows
the addresses it gives.

## Backup and restore

Stop Conduit and copy `~/.conduit/data`; restore by putting it back and
starting. Live agent processes are not part of a backup -- chats resume from
their transcripts. Sessions belonging to other harnesses (Claude Code, Codex,
OpenCode) live in those harnesses' own folders and are theirs to back up.

## Releasing

A `v*` tag builds the server per platform with `scripts/package-server.sh` in
`.github/workflows/release.yml` and attaches the archives, their checksums and
`install.sh` to the GitHub Release; see [desktop and Android
clients](desktop-client.md#releasing) for the rest of the release.
