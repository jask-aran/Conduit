# Install, clients and operations

Conduit runs with your user permissions and uses your installed agents and
logins. Windows runs the server inside WSL; the desktop client runs on Windows.

## Install and connect

Install the server:

```bash
curl -fsSL https://get.jask-aran.com/conduit | bash
```

Setup asks for a password, port and access options, then starts the service.
Open this machine's server with `conduit-server open`. Use
`conduit-server pair` to sign in a phone or installed client with a one-time
QR code. `conduit-server status` shows the server's addresses.

For remote access, run `conduit-server connect`. Choose Tailscale, a tunnel or
reverse proxy, or an SSH tunnel. A proxy must pass WebSockets and provide
HTTPS; point it at `http://127.0.0.1:4310`. Public addresses require HTTPS.
Loopback and private-network addresses can use HTTP, but LAN HTTP sends traffic
without encryption. Installed clients use identity-verified TLS on direct
routes once they know the server supports it; they do not fall back to HTTP
if that TLS connection fails.

For command syntax, use `conduit-server --help`. Useful operating commands are
`status`, `logs`, `doctor`, `update` and `rollback`. Changing the password signs
out all clients; `sessions revoke` can revoke individual sessions.

The [installer](../scripts/install.sh) and
[server CLI](../scripts/conduit-server) define installation and command behaviour.

## Data and recovery

| Path | Purpose |
| --- | --- |
| `~/.conduit/data` | Durable state: chats, credentials, preferences, server identity and toolchains. Back this up. |
| `~/.conduit/conduit.env` | Server configuration. Restart after manual edits. |
| `~/.local/share/conduit` | Installed releases and private Node runtime; replaceable. |

`conduit-server backup [file]` pauses the server for a consistent archive.
It excludes toolchains and voice models; `--lean` also excludes turn checkpoints
and worktrees. `conduit-server restore <file>` preserves the previous data
beside the restored copy.

A backup does not preserve live agent processes. Claude Code, Codex and
OpenCode also keep sessions in their own directories; back those up separately.
Normal uninstall preserves `~/.conduit`; sandbox uninstall removes sandbox data.

## Development

The development checkout and installed server release use the same daemon and
`~/.conduit/data`. Switch its code with `conduit-server use dev ~/Conduit` or
`conduit-server use release`. Set `CONDUIT_DATA_ROOT` for separate data.
After a checkout change, run from the repository root:

```bash
bash .devcontainer/start-conduit.sh restart
```

For a separate fresh installation:

```bash
curl -fsSL https://get.jask-aran.com/conduit | bash -s -- --sandbox
```

The sandbox uses `conduit-server-sandbox`, port 4321 and `~/.conduit-sandbox`.
It still shares the machine: auth commands need an explicit `CONDUIT_DATA_ROOT`
to avoid touching the real password, and Tailscale setup changes the real tailnet.
See [testing](TESTING.md) before testing an installer or update.

### Build installed clients

Installed clients bundle the interface. A server update alone cannot update
that interface; build a new client. Run these commands from `conduit-web/`:

| Task | Command |
| --- | --- |
| Windows hot reload, without installation | `npm run desktop:dev:win` |
| Windows development installer | `npm run desktop:build:win -- --dev` |
| Windows release-shaped local installer | `npm run desktop:build:win` |
| Android development APK | `npm run android:build` |

Windows builds require the Windows toolchain, invoked from WSL. Installers go
to `C:\Users\<user>\conduit-desktop-target[-dev]\release\bundle\nsis\`.
Keep Cargo output on Windows storage to avoid slow writes across the WSL share.
An interrupted build can leave a Windows Cargo process holding the build lock.

Android output is `conduit-web/android/app/build/outputs/apk/debug/app-debug.apk`.
Development clients install beside released clients with separate local state.
Android development APKs must be rebuilt and sideloaded; they cannot update the
released app because their identifier and signing key differ.

Run builds one at a time: they share `conduit-web/dist`.
Use Settings → Appearance → About to check interface, shell and server versions.
Build scripts and configuration are in
[`conduit-web/package.json`](../conduit-web/package.json),
[`build-desktop-windows.sh`](../conduit-web/scripts/build-desktop-windows.sh),
[`src-tauri/`](../conduit-web/src-tauri/) and [`android/`](../conduit-web/android/).

## Several servers

A server has one identity and can have several routes: loopback, LAN, Tailscale
or a public proxy. Sign in to each server separately. Identity proves which
server answers; it does not grant access. A cleartext identity proof cannot
prevent an active attacker from relaying it to the real server.

Installed clients can discover LAN servers and switch servers without leaving
the app. Browser tabs navigate to the other server and use its own login;
a browser cannot discover LAN servers. A browser installed as a PWA cannot
change routes within its standalone window.

Use the sidebar server menu to switch servers or routes. Automatic selection
prefers loopback, then private, then public routes. Manual selection stays
pinned until you select Automatic again.

Settings → System → Servers controls names, sharing and removal. Shared entries
travel between clients through the servers they visit; credentials do not.
This exposes the shared server addresses to those servers. Local addresses
start unshared because the same address can refer to different machines on
other devices or networks. Switching servers leaves server-side terminals running.

For implementation, see [server selection](../conduit-web/src/client/platform/servers.ts),
[route selection](../conduit-web/src/client/platform/path-selector.ts),
[identity](../conduit-web/src/server-identity.js) and
[TLS](../conduit-web/src/server-tls.js).

## Release

A `v*` tag runs the [release workflow](../.github/workflows/release.yml) for the
server, Windows and Android clients. Supply `docs/releases/<tag>.md`.
Use CI artifacts from a tag as release candidates; local development builds
are not release candidates. Follow [contribution rules](../CONTRIBUTING.md)
and [release verification](TESTING.md).

**Pushing `main` changes the live installer before any release tag:** the install
URL serves `scripts/install.sh` from `main`. Test installer changes locally with
`scripts/try-install.sh --sandbox` instead of publishing them to test.

Windows updater archives must use Stored ZIP entries. Compressed entries pass
signature verification but fail during installation;
[`check-updater-archive.mjs`](../conduit-web/scripts/check-updater-archive.mjs) checks this.
The build version, update manifest and release artifacts must agree.

Keep the updater key `~/.conduit/conduit-updater.key` and its password file
`~/.conduit/conduit-updater.key.password` safe. CI uses `CONDUIT_UPDATER_KEY` and
`CONDUIT_UPDATER_KEY_PASSWORD`; clients carry the public key in
`conduit-web/src-tauri/tauri.conf.json`. Replacing that key breaks the update path
for existing clients. Losing the private key or password prevents signing
updates they can accept. Preserve the Android release keystore for the same reason.

Updater signatures do not provide Windows publisher signing. The unsigned
installer can trigger SmartScreen. Clean-machine verification remains unproven;
local development use does not establish fresh-install behaviour.
