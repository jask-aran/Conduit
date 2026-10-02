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
3. installs both into `~/.local/share/conduit` and links `~/.local/bin/conduit`;
4. runs `conduit setup`: a login password, who may reach Conduit (this computer
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
| `~/.conduit/conduit.env` | `CONDUIT_HOST`, `CONDUIT_PORT` and any other `CONDUIT_*` setting | edit, then `conduit restart` |

A development checkout uses the same `~/.conduit/data` unless
`CONDUIT_DATA_ROOT` says otherwise.

## Running

| Command | Does |
| --- | --- |
| `conduit status` | version, whether it is healthy, where its data and logs are |
| `conduit start` / `stop` / `restart` | restart waits up to ten minutes for answers still being written |
| `conduit logs` | follows the log |
| `conduit update [v]` | installs the latest (or a given) release and restarts |
| `conduit rollback` | returns to the previous release |
| `conduit password` | changes the login password |
| `conduit doctor` | Node, Python tools, password, agents on PATH, server health |
| `conduit uninstall` | removes the app and service; `~/.conduit` stays |

The service is a `systemd --user` unit on Linux (with lingering enabled, so it
survives logout on a headless machine) and a launchd agent on macOS. Without
either, `conduit` runs the server as a background process with a pid file.

Agents are the user's own: Conduit finds `claude`, `codex` and `opencode` on
PATH and uses their existing logins and sessions.

## Reaching it

Conduit binds `127.0.0.1:4310` unless setup was told otherwise -- it controls
the computer, so exposing it is a choice:

- **This computer:** open `http://localhost:4310`, or point the desktop client
  at it.
- **Your devices anywhere:** Tailscale, `tailscale serve 4310`, and connect the
  phone or desktop client to the machine's tailnet address.
- **Public:** a Cloudflare Tunnel or your own reverse proxy in front of
  `127.0.0.1:4310`. Conduit's password login and the clients' bearer tokens
  assume an untrusted network; terminate TLS at the proxy.

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
