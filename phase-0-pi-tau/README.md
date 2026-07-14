# Phase 0: Pi Tau Web Server

This folder evaluates
[`milanglacier/pi-tau-web-server`](https://github.com/milanglacier/pi-tau-web-server)
as Conduit's current default chat surface and Pi runtime host.

The dependency is pinned to commit
[`af1f3dee`](https://github.com/milanglacier/pi-tau-web-server/commit/af1f3dee7784e50c58176f3932efbda9601b4ff6)
so a fresh Codespace recreates the evaluated version instead of following a
moving upstream branch.

Pi Tau runs one server-owned `pi --mode rpc` child process per live browser tab.
Each session receives its own working directory, model and Pi session, while
closing or refreshing the browser leaves the child running.

## Run locally

Install Pi and authenticate it first, then:

```bash
git clone https://github.com/milanglacier/pi-tau-web-server.git \
  ~/.conduit/upstream/pi-tau-web-server
git -C ~/.conduit/upstream/pi-tau-web-server checkout \
  af1f3dee7784e50c58176f3932efbda9601b4ff6
npm ci --prefix ~/.conduit/upstream/pi-tau-web-server
TAU_HOST=127.0.0.1 TAU_PORT=3001 TAU_PROJECTS_DIR="$HOME" npm start
```

Open <http://127.0.0.1:3001>.

Inside a GitHub Codespace, use the forwarded port labelled
**Conduit · Pi Tau**. The devcontainer installs and starts this implementation
automatically.

## Evaluation boundary

Pi Tau is a working Phase 0 vertical slice, not Conduit's permanent platform
contract. Its live tabs, WebSocket messages and Pi session references remain
runtime-specific. Conduit will eventually own stable chat/task/run identities,
normalized events, durable projections and additional runtime adapters.

Upstream declares the package MIT in its README and package metadata but does
not currently include a root `LICENSE` file. Resolve that packaging gap before
copying substantial upstream source into Conduit.
