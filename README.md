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

### Develop solid-components in Conduit

Use the sibling `solid-components` checkout as a live source dependency without
changing Conduit's package manifest or lockfile:

```bash
bash .devcontainer/solid-components.sh dev
```

This HMR surface runs on port 5173. To rebuild the current package source into
Conduit's normal production client and manually validate it on port 4310, run:

```bash
bash .devcontainer/solid-components.sh serve
```

When a clean committed candidate is ready, build and run its exact packed
artifact at port 4310 for approval:

```bash
bash .devcontainer/solid-components.sh preview
```

After approval, `promote patch` verifies the sealed commit and payload,
publishes it, installs the exact npm version in Conduit, and restarts port 4310.
Use `status` to inspect the active mode and `registry` to discard a local mode.
The checkout defaults to `../solid-components`; set
`CONDUIT_SOLID_COMPONENTS_DIR` when it lives elsewhere.

## Deploy

Conduit publishes a prebuilt Linux image to GHCR from each tagged release. A
VPS needs Docker Engine with the Compose plugin, but does not need Git, Node.js,
npm, Pi, the repository checkout, or enough resources to compile Conduit.

Run the clone-free installer from an ordinary VPS user account:

```bash
curl -fsSLo /tmp/conduit-install.sh \
  https://raw.githubusercontent.com/jask-aran/Conduit/main/scripts/install.sh
bash /tmp/conduit-install.sh
```

The installer downloads only the deployment files into `~/conduit`. The first
run creates persistent data and Workspace directories, pulls
`ghcr.io/jask-aran/conduit:latest`, prompts for the Conduit password, and starts
the container at `http://PUBLIC_IP` on host port 80.

Subsequent upgrades are:

```bash
~/conduit/scripts/deploy.sh restart
```

Set `CONDUIT_DEPLOY_MODE=build` in `.env` only when working from a complete
source checkout and deliberately building locally. Read [deployment operations](docs/operations/deployment.md)
for the mount layout, release pinning, backup/restore, and the intentionally
unsupported Host Pi boundary.

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
- [Engineering distillations](references/distillations.md) — retained
  implementation decisions.

## Verify

Browser development and pre-commit QA uses the restored agent-browser session:

```bash
bash .devcontainer/start-conduit.sh restart
cd conduit-web
agent-browser skills get core
SESSION="$(agent-browser session id --scope worktree --prefix conduit-qa)"
AGENT_BROWSER_SESSION="$SESSION" npm run qa:agent-browser
# Continue with the affected flow, then close the session.
agent-browser --session "$SESSION" close
```

Fast checks:

```bash
cd conduit-web
npm run typecheck
npm run build
npm test
npm run test:harness -- \
  --scenario ci-steady \
  --profile steady \
  --text "CI deterministic stream"
```

These checks run automatically on pull requests and pushes to `main`. The
Playwright release canaries run manually or for `v*` release tags:

```bash
npm run test:browser:setpieces
```

The full Playwright suite is local maintenance only:

```bash
npm run test:browser
```

Use agent-browser for ordinary UI development. Browser tests mock the API for
the deterministic Playwright canaries; failures leave traces under
`test-results/`. See `docs/operations/testing.md` for the complete policy.
