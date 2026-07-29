# Conduit

Conduit is a self-hosted, single-user web interface for Pi coding-agent work.
It keeps chats, working files, Workspaces, attachments, and live agent
processes behind one authenticated address, while Pi's native JSONL remains the
source of truth for conversation history.

It is built for a person who wants a durable place to work with an agent, not a
hosted multi-tenant chat product. The current product is chat-first: create a
chat, choose a project or Workspace, attach files, inspect the working tree,
and keep using the same session as the browser reconnects or the server
restarts.

## What exists today

- Authenticated chat over the bundled, pinned **Isolated Pi** runtime.
- Named projects and Workspaces: link an allow-listed folder, create a managed
  folder, or clone a Git repository. Workspace creation and cloning are
  durable server operations, so closing the browser does not abandon them.
- Per-chat attachments, chat forking and regeneration, model/thinking controls,
  transcript history, command palette, Markdown, artifacts, and PWA support.
- A read-only Workspace panel with a lazy file tree, bounded previews, Git
  status/history/diff, and a server-owned terminal.
- Optional **Host Pi** for non-container Workspace sessions, kept strictly
  separate from the bundled runtime's credentials and settings.
- A Docker deployment with explicit durable data and Workspace mounts,
  release archives, backup, restore, and a simulated-host persistence proof.

The broader direction — remote targets, a unified session control plane,
Assistant, and ACP-backed sessions — is described as direction rather than
current capability in [the platform design](docs/architecture/personal-agent-platform-design.md).

## Start locally

Requirements: Node.js 22+ and npm. A separately installed `pi` is optional and
needed only for Host Pi Workspaces.

```bash
bash .devcontainer/start-conduit.sh setup
node scripts/conduit-auth.mjs set-password
bash .devcontainer/start-conduit.sh restart
```

Open <http://127.0.0.1:4310>, sign in, then open **Settings → Auth** to connect
the bundled Pi runtime to a model provider. For client hot reload, use:

```bash
bash .devcontainer/start-conduit.sh dev
```

The managed server runs on port 4310; Vite runs on port 5173 in development
mode. `setup`, `build`, `start`, `stop`, `status`, `logs`, and `deploy` are all
available through the same launcher.

## Deploy

Conduit has a Docker-native deployment for Linux hosts with Docker Engine and
the Compose plugin. It runs as an unprivileged, read-only application image;
only the durable application data and Workspace roots are writable.

```bash
git clone https://github.com/jask-aran/Conduit.git conduit
cd conduit
./scripts/deploy.sh up
```

The first run creates local configuration, prompts for the Conduit password,
and binds to `127.0.0.1:4310`. Put a TLS reverse proxy or Tailscale Serve in
front of that loopback address. Read [deployment operations](docs/operations/deployment.md)
before a real deployment: it defines the mount layout, upgrades, exact-release
archives, backup/restore, and the intentionally unsupported Host Pi boundary.

## How it is built

One Express server owns live `pi --mode rpc` and terminal child processes. A
strict TypeScript SolidJS/Vite client reconnects over per-chat WebSockets and a
global runtime SSE stream. The server owns process lifetime; browser disconnect
does not terminate work. `data/sessions.json` is a lightweight navigation and
runtime registry, while Pi JSONL is authoritative for transcripts and native
session state.

Runtime state lives under `CONDUIT_DATA_ROOT` (`data/` by default, `/data` in
Docker). It includes the project catalogue, chat registry, preferences,
Isolated Pi settings/credentials/history, chat files, and attachments. Managed
Workspace roots are separate and explicitly allow-listed. The durable-state
contract is documented in [runtime data](docs/operations/runtime-data.md).

## Repository map

```text
conduit-web/  Express server, Solid client, API contract, Node and Playwright tests
templates/    Pi profiles and trusted tool/skill configuration
scripts/      managed launcher, auth provisioning, deployment, backup and release tools
docs/         current architecture and operations documentation
specs/        temporary implementation material; shipped specs are removed
```

Detailed references:

- [Web runtime and API](conduit-web/README.md) — auth, HTTP routes, WebSocket
  protocol, terminals, and runtime behavior.
- [Operations](docs/operations/deployment.md) — production layout, release,
  backup, restore, and deployment proof.
- [Runtime data](docs/operations/runtime-data.md) — ownership and persistence
  boundaries.
- [Contributor contract](AGENTS.md) — invariants, development workflow, and
  verification requirements.
- [Engineering distillations](docs/engineering/distillations.md) — retained
  implementation decisions.

## Verify

```bash
cd conduit-web
npm run typecheck
npm test
npm run build
npm run test:browser
```

Browser tests mock the API for deterministic desktop and mobile coverage.
Failures leave Playwright traces under `test-results/`; `README.md` in
`conduit-web/` documents focused-suite and trace commands.
