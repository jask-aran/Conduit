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
2. downloads that release from GitHub, with a progress bar, and checks its
   SHA-256 and signature;
3. uses the `node` on PATH when it is new enough (`NODE_MIN` in the release,
   currently 22.19); otherwise offers a private copy of the Node the release
   was built with, leaving the system's alone;
4. installs it into `~/.local/share/conduit` and links `~/.local/bin/conduit-server`;
5. runs `conduit-server setup`: a login password, who may reach Conduit (this computer
   only, or any device on the network), the port, the Python tools for
   spreadsheets and documents, and the service that keeps it running.

`--version v0.7.7` installs a given release, `--no-setup` stops before setup.

Local voice models' native packages (transcribe-cpp, onnxruntime,
transformers) are not in the release. Installing the first voice model fetches
them with npm into `~/.conduit/data/runtime/` once per version set, and links
them into the running release.

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
| `setup` / `connect` | password, port, how it is reached; `connect` asks only the last |
| `open` | opens Conduit in the browser, signed in by a one-minute, one-time code |
| `pair` | a QR code of a one-time, five-minute sign-in link: a phone camera opens it signed in, and the app's **Scan QR code** (or the link pasted into its address field) redeems it for an app token at `POST /v0/auth/native-pair`; waits until it is used |
| `status [--json]` | what runs, its addresses, service, data, and whether an update is out |
| `start` / `stop` / `restart` | restart waits up to ten minutes for answers still being written |
| `logs [--since 1h] [--errors]` | follows the log, or searches it |
| `projects [add <folder> [name]]` | lists projects, or adds a folder (handy over SSH) |
| `sessions [revoke <id>\|all]` | signed-in browsers and apps; signs one or all out |
| `config [get\|set\|unset K [V]]` | `CONDUIT_*` settings in `conduit.env`; restarts if running |
| `password` | changes the login password, signing everything out |
| `update [v] [--channel beta]` | installs the latest (or a given) release; beta follows pre-releases |
| `use dev <clone>` / `use release` / `use v<v>` | which code the daemon runs |
| `rollback` | the release before this one |
| `backup [--lean] [file]` / `restore <file>` | archives `~/.conduit/data` without toolchains and voice models (`--lean` also skips turn checkpoints and worktrees), pausing the server for a consistent copy; restore keeps the old data beside it |
| `doctor [--fix] [--json]` | Node, Python, password, lingering, service file, agents installed and signed in, port, health; `--fix` repairs what it can |
| `report` | a bundle for a bug report: status, doctor, system, settings and recent logs with tokens cut out |
| `completion bash\|zsh` | shell completion |
| `uninstall` | removes the app and service; `~/.conduit` stays |

All are `conduit-server <command>`. Releases are checked against the release
signing key (the Windows updater's) as well as their SHA-256, by a verifier
carried in `install.sh` and run with the downloaded Node.

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

Setup asks how Conduit will be reached -- one list on every machine, since a
desktop can sit behind a tunnel and a VPS can be used only over SSH; what it
finds only annotates the choices (`conduit-server connect` asks again). The
server stays on `127.0.0.1` for every choice except "my network".

- *Just this computer* -- `http://localhost:4310`, or the desktop app.
- *Tailscale* -- installs it if missing (sudo once), signs the machine in with
  `tailscale up`, then `tailscale serve` gives `https://<machine>.<tailnet>.ts.net`.
  A refused serve offers `tailscale set --operator=$USER`; HTTPS off in the
  tailnet is pointed out.
- *A tunnel or reverse proxy* -- point it at `http://127.0.0.1:4310` and let it
  do HTTPS (`cloudflared tunnel --url http://127.0.0.1:4310`, Caddy
  `reverse_proxy 127.0.0.1:4310`); WebSockets must pass through. Its public
  address, if given, is shown by setup and `status` (`CONDUIT_PUBLIC_URL`).
- *An SSH tunnel* -- prints the `ssh -NL 4310:localhost:4310 user@<ip>` to run on
  your computer, then `http://localhost:4310`.
- *Any device on my network* -- binds `0.0.0.0`, opened at the LAN address.

Password login and the clients' bearer tokens assume an untrusted network.
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
