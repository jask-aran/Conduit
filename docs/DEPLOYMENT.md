# Install, clients and operations

Conduit runs with your user permissions and uses your installed agents and logins. Windows runs the server inside
WSL; the desktop client runs on Windows. `conduit-server help` lists the operating commands; most server environment
variables and their defaults are in `conduit-web/src/config.js`.

## Install and connect

```bash
curl -fsSL https://get.jask-aran.com/conduit | bash
```

For remote access, run `conduit-server connect`: Tailscale, a tunnel or reverse proxy, or an SSH tunnel. A proxy must
pass WebSockets and provide HTTPS; point it at `http://127.0.0.1:4310`. Public addresses require HTTPS. Loopback and
private-network addresses can use HTTP, but LAN HTTP sends traffic without encryption.

## Data and recovery

| Path | Purpose |
| --- | --- |
| `~/.conduit/data` | Durable state: chats, credentials, preferences, server identity and toolchains. Back this up. |
| `~/.conduit/conduit.env` | Server configuration. Restart after manual edits. |
| `~/.local/share/conduit` | Installed releases and private Node runtime; replaceable. |

`conduit-server backup` excludes toolchains and voice models (`--lean` also turn checkpoints and worktrees);
`restore` keeps the previous data beside the restored copy. A backup does not preserve live agent processes. Claude
Code, Codex and OpenCode keep sessions in their own directories; back those up separately. Normal uninstall keeps
`~/.conduit`; sandbox uninstall removes sandbox data.

## Development

The development checkout and the installed release use the same daemon and `~/.conduit/data`. Switch its code with
`conduit-server use dev ~/Conduit` or `conduit-server use release`. Set `CONDUIT_DATA_ROOT` for separate data. After a
checkout change, run `bash .devcontainer/start-conduit.sh restart` from the repository root.

For a separate fresh installation:

```bash
curl -fsSL https://get.jask-aran.com/conduit | bash -s -- --sandbox
```

The sandbox uses `conduit-server-sandbox`, port 4321 and `~/.conduit-sandbox`. It still shares the machine: auth
commands need an explicit `CONDUIT_DATA_ROOT` to avoid touching the real password, and Tailscale setup changes the real
tailnet. Read docs/TESTING.md, Release and install, before testing an installer or update.

### A server that follows main

[`follow-main.sh`](../scripts/follow-main.sh) makes a clone's server take every push to `main` (a second daemon beside
the release one: `CONDUIT_PROFILE=dev`, its own port, state and data); its header says how. Run it every minute from a
systemd user timer whose service sets `CONDUIT_PROFILE`, `CONDUIT_STATE_DIR`, `CONDUIT_DATA_ROOT` and a `PATH` with the
clone's Node; its log is `<state dir>/follow-main.log`.

### Build installed clients

Installed clients bundle the interface; a server update alone does not update it. From `conduit-web/`:

| Task | Command |
| --- | --- |
| Windows hot reload, without installation | `npm run desktop:dev:win` |
| Windows development installer | `npm run desktop:build:win -- --dev` |
| Windows release-shaped local installer | `npm run desktop:build:win` |
| Android development APK | `npm run android:build` |
| Android development APK, offered to dev apps as an update | `bash scripts/build-android-dev.sh` |

Windows builds use the Windows toolchain, invoked from WSL. Installers go to
`%LOCALAPPDATA%\conduit-build\desktop-target[-dev]\release\bundle\nsis\`. Keep Cargo output on Windows storage to
avoid slow writes across the WSL share. An interrupted build can leave a Windows Cargo process holding the build lock.

Android output is `conduit-web/android/app/build/outputs/apk/debug/app-debug.apk`. Development clients install beside
released clients with separate local state; a development APK cannot update the released app (identifier and signing
key differ). A development APK takes interface updates from the server it is connected to without a reinstall;
changes to native code, plugins or permissions still need a new APK.

Run builds one at a time: they share `conduit-web/dist`.

## LAN https for browsers

A browser grants the microphone, the service worker and the installable PWA only to a secure context, and
`http://192.168.x.x:4310` is not one, so a LAN name gets a real certificate.

Settings › System › Network (LAN names) sets this up, with a Cloudflare API token (Zone > DNS > Edit for one zone) or
the hub machine's signed-in `cf` CLI (`CONDUIT_CF_CLI` overrides the command). Use a name below the zone, such as
`lan.example.com` in `example.com`: the wildcard key goes to every node, so the zone itself is not allowed. Nothing
needs to accept connections from the internet (DNS-01). Certificates are kept in `~/.conduit/tls/`
(`CONDUIT_LAN_TLS_CERT` / `CONDUIT_LAN_TLS_KEY` override the read paths). Disable the optional hub name on a VPS; the
nodes can still use their LAN names.

`scripts/lan-cert/issue.sh` and its DNS hooks serve hubs set up by hand with certbot and the `cf` CLI. For those,
`LAN_CERT_HUB=0` skips the hub certificate, and an existing `conduit-lan-cert.timer` can continue to renew.

Routers with DNS rebinding protection return nothing for a public name that points at a private address. Allow the
domain in the router, or point the device at a resolver that does not filter (Android Private DNS `one.one.one.one`).

## Several servers

A server has one identity and can have several routes: loopback, LAN, Tailscale or a public proxy. Sign in to each
server separately. Identity proves which server answers; it does not grant access, and a cleartext identity proof
cannot prevent an active attacker from relaying it to the real server. Shared server entries travel between clients
through the servers they visit (credentials do not), which exposes the shared addresses to those servers.

## Release

A `v*` tag runs the [release workflow](../.github/workflows/release.yml) for the server, Windows and Android clients.
Supply `docs/releases/<tag>.md`. Use CI artifacts from a tag as release candidates, never local development builds.
Run `npm test` first (docs/TESTING.md).

**Pushing `main` changes the live installer before any release tag:** the install URL serves `scripts/install.sh` from
`main`. Test installer changes locally with `scripts/try-install.sh --sandbox`.

Windows updater archives must use Stored ZIP entries: compressed entries pass signature verification but fail during
installation ([`check-updater-archive.mjs`](../conduit-web/scripts/check-updater-archive.mjs) checks this). The build
version, update manifest and release artifacts must agree.

Keep the updater key `~/.conduit/conduit-updater.key` and its password file `~/.conduit/conduit-updater.key.password`
safe. CI uses `CONDUIT_UPDATER_KEY` and `CONDUIT_UPDATER_KEY_PASSWORD`; clients carry the public key in
`conduit-web/src-tauri/tauri.conf.json`. Replacing that key breaks the update path for existing clients; losing the
private key or password prevents signing updates they can accept. Preserve the Android release keystore for the same
reason.

Updater signatures are not Windows publisher signing: the unsigned installer can trigger SmartScreen. Clean-machine
install is unverified.
