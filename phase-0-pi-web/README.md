# Conduit Phase 0 — PI WEB

This is the recommended Phase 0. PI WEB is the complete application: it owns its
web UI, API/gateway, long-lived `sessiond`, Pi processes, model selection, tools,
projects, workspaces, terminals, and session resumption.

Conduit does not wrap or iframe it in Phase 0.

## WSL2 Ubuntu with systemd

Requirements: Node.js 22+, npm, git, and an authenticated `pi` command.

```bash
npm install
npm run install:service
npm run doctor
```

Open <http://127.0.0.1:8504>. `pi-web install` creates separate per-user web and
session-daemon services. If you want them to survive logout/reboot on Linux, run:

```bash
sudo loginctl enable-linger "$USER"
```

## WSL2 without systemd

```bash
npm install
npm run verify
npm run dev
```

The development launcher supervises `pi-web-sessiond` and `pi-web-server` as two
processes and stops both cleanly on Ctrl-C.

## Configuration

PI WEB writes its normal configuration to `~/.config/pi-web/config.json` and its
managed state to `~/.pi-web`. `config/config.example.json` documents the initial
loopback-only posture. External filesystem roots remain denied until explicitly
added to `pathAccess.allowedPaths`.

For remote browser access, use an SSH tunnel, private VPN address, or authenticated
reverse proxy. Do not expose PI WEB directly to the public internet.

## Preserved Conduit seam

PI WEB's IDs, database, WebSocket protocol, and lifecycle names are implementation
details. Future Conduit platform identity, normalized events, lineage, portable
state, grants, approvals, and alternative harness adapters must remain separate.

Upstream: <https://github.com/jmfederico/pi-web> (MIT).

