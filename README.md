# Conduit

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/jask-aran/Conduit?quickstart=1)

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/jask-aran/Conduit)

![architecture](interface_first_platform_architecture.svg)

Conduit is an interface-first personal agent platform: one self-hosted web
address for conversational and execution-heavy agent work. The surface that
exists today is Chat — a web interface over the Pi coding agent with projects,
Workspaces, attachments, history forking, response controls, and model
management, gated behind single-user password auth. Remotes, Assistant, and
Dashboard are future surfaces.

One Express server owns a pool of `pi --mode rpc` child processes — one per
live chat, across two installations (bundled Isolated Pi and the user's
native Host Pi) — and relays their events to a strict TypeScript SolidJS/Vite client over
per-chat WebSockets plus a global SSE runtime channel. Pi's JSONL files are
the authoritative transcripts; Conduit's `data/*.json` stores hold identity,
registry, and preferences only. Sessions outlive browser connections and
server restarts.

Documentation map: this file (product, data model, setup) ·
`conduit-web/README.md` (runtime model, HTTP API, auth, WS protocol) ·
`AGENTS.md` (contributor/agent contract) ·
`personal-agent-platform-design.md` (long-range vision) · `specs/` (roadmap
and feature specs).

## Build order

1. `specs/edge-auth.md` — password login gating every route and socket
2. `specs/ui-parity.md` — tool-call legibility, thinking UX, native tool
   components, /commands, settings overhaul
3. `specs/rhs-panel.md` — right-hand file navigator, diff viewer, artifact
   viewer
4. `specs/remotes-pty.md` — Remotes v0: server-owned PTY terminal panes
5. `specs/broker-registry.md` — unified session registry and
   spawn/attach/stop/status verbs
6. `specs/seed-tool.md` — chat escalates work into a Coding session with
   lineage

## Repository structure

```text
conduit-web/
  src/                 Express server and Pi RPC lifecycle
  src/client/          SolidJS client, typed API boundary, and state stores
  src/components/      Small Kobalte-backed primitive boundary
  test/                Node test suites
  test/browser/        Playwright browser tests

templates/
  chat/                General profile (restrained tools)
  workspace/           Coding profile (full tools + skills)
  runtime/             special one-off admin profile
  conduit-workspace/   Host Pi attachment bridge (internal, not a profile)

scripts/
  conduit-pi.mjs       template-aware terminal launcher
  conduit-auth.mjs     auth provisioning CLI (set-password, status, …)
  pi-runtime.mjs       template loading and Pi argument construction

specs/                 near-term roadmap and implementation specs

data/                  ignored mutable application data
  chat/files/          working files visible to chats
  pi/                  isolated Pi home (credentials, settings, JSONL sessions)
  auth.json            password hash and session tokens (0600)
  conduit.json         project catalog
  sessions.json        atomic lightweight chat registry
  preferences.json     app preferences (default profile)
  runtime.json         warm-pool and generation policy
```

`data/` is one backup/mount boundary for working files, project metadata, and
Isolated Pi credentials and history. Host Pi history lives in the host Pi
home and needs a separate backup.

## Data model

**Projects and Workspaces.** `data/conduit.json` is the project catalog. The
reserved unstructured `chat` project works in `data/chat/files`; named
projects use `data/chat/files/<slug>`; Workspaces register (or `git`/`gh`
clone) an allow-listed absolute host directory, and unlinking never deletes
the working tree. Each working root contains a Conduit-owned
`.conduit/chats/<chat-id>/` tree for attachments; Pi runs at the root and
reads attachments by relative path. Browser-supplied paths never become a Pi
`cwd` until resolved against `CONDUIT_WORKSPACE_ALLOWLIST`.

**Chats and sessions.** A chat is a stable UUID row in `data/sessions.json`,
created as a durable `draft`; Pi starts on the first message, which records
the private native-session mapping and marks the row `active`. Browser routes
stay `/chat/<conduit-chat-id>` across Pi restarts and forks. Pi JSONL is the
authoritative transcript — the registry only lets the sidebar list chats
without parsing transcripts, and is reconciled at startup and checkpointed
after completed responses and explicit mutations. Edit/regenerate use Pi's
public `fork` RPC; moves fork across directories and delete the source JSONL
only after the destination exists; deletion (always interface-confirmed)
stops the live process and removes JSONL plus chat folder. Never let two Pi
processes write one JSONL.

**Attachments.** Raw request bodies stream to `.partial/<id>.part` and
publish by atomic rename; the filesystem is the registry, with no MIME or
size policy of Conduit's own. Attachment bytes never enter model context —
prompts carry validated relative paths in a hidden envelope.

**Runtimes.** Ordinary profiles run the bundled, pinned Isolated Pi with
`PI_CODING_AGENT_DIR=data/pi`; Workspaces may instead select **Host Pi**: the
executable, home, credentials, and resources discovered from the server
user's login shell, plus a minimal attachment bridge. The choice is mutable
until the first prompt, then immutable. Both runtimes share one process
manager, capacity limits, and the Workspace as canonical `cwd`. Host Pi
project-resource trust is persisted automatically for registered Workspaces;
its model scope and settings are read-only diagnostics in Conduit.

**Profiles (templates).** `templates/*/template.json` manifests select system
prompt, tools, fallback models, extensions, and skills, translated into
explicit Pi arguments. New chats take the app default from
`data/preferences.json`; each chat stores a sticky `templateId` and reloads
it on resume; Workspaces may override per-Workspace (including `host-pi`).
Shipped profiles: General (restrained), Coding (full tools + skills), and
Runtime (special admin chat for `pi install`, never a default). Isolated Pi's
`data/pi/settings.json` is the shared model-scope authority for web and
terminal; template model lists are only the fallback.

**Auth.** Single-user password, scrypt-hashed in `data/auth.json`,
deny-by-default middleware over every route, asset, and WebSocket upgrade, and
a minimal server-rendered login page. If `data/auth.json` is absent, Conduit
always serves only the setup page until the first same-origin browser password
submission claims the instance. That password is then persisted for ordinary
local, devcontainer, and headless deployments alike; no bootstrap flag or
terminal provisioning is required. The initial page warns that the first
person able to reach it can set the password. The CLI can replace a forgotten
password or clear sessions. Full contract in `conduit-web/README.md`.

**Headless Pi login.** Once the Conduit password is set, Settings → Auth can
authenticate the pinned Isolated Pi runtime without a terminal. It uses Pi's
own OAuth/device-code flows and accepts a pasted localhost callback URL where
needed; credentials remain in `data/pi/auth.json`. Host Pi stays deliberately
outside this browser-managed boundary.

## Interface

SolidJS + strict TypeScript + Tailwind v4 + Lucide + Geist, with Kobalte used
selectively for accessible menus and context menus. Concrete app components
replace the former generic component catalogue. Transcripts render assistant
Markdown client-side through Marked, DOMPurify, and KaTeX; fenced code uses
bounded Artifact cards. Streaming relays raw deltas coalesced per animation
frame, parses and sanitizes the canonical document, and reconciles it into the
existing DOM so semantic nodes remain stable as unfinished syntax takes shape.
Cmd/Ctrl+K opens the command palette; Cmd/Ctrl+. opens a read-only Workspace
panel with a resizable lazy file tree, Git history/working-tree context, and an
Artifacts boundary for transcript outputs and future interactive UI; Settings is a centered
tabbed dialog; response controls cover copy, fork/edit, regenerate, stop, and
experimental partial continue (`ENABLE_PARTIAL_CONTINUE`). Production builds
enforce gzip bundle budgets (`dist/bundle-report.json`). Composition rules
and rendering-stability constraints live in `AGENTS.md`.

## Setup and development

Requirements: Node.js 22+ and npm. The pinned Isolated Pi runtime is an npm
dependency; `npm ci` installs it alongside Conduit's server. The dev container
does everything via `.devcontainer/setup.sh`; locally:

```bash
bash .devcontainer/start-conduit.sh deploy    # npm ci, production build, start
```

Open Conduit on port 4310, choose the first Conduit password if prompted, then
use **Settings → Auth** to authenticate the Isolated Pi runtime. A separately
installed `pi` binary is optional and is discovered only for Host Pi
Workspaces; Conduit does not install one globally.

For ordinary use and after source changes:

```bash
bash .devcontainer/start-conduit.sh restart   # rebuilds if needed; managed server on 4310
```

`start`, `stop`, `status`, `logs`, and `deploy` are available through the same
script. For hot-reload client work, use the managed development mode instead of
launching Vite manually:

```bash
bash .devcontainer/start-conduit.sh dev  # server watcher on 4310; Vite on 5173
```

Open port 5173 while using this mode. It proxies HTTP and WebSocket traffic to
the managed Conduit server; `stop`, `restart`, `status`, and `logs vite -f`
remain the same launcher surface. It is not used for deployment.

## Verification

```bash
cd conduit-web
npm test
npm run test:browser
npm run build
```

Browser tests mock the API for deterministic desktop and mobile coverage;
failures write traces under `test-results/` with a printed `show-trace`
command. Single suites: `node --test test/<name>.test.js` or
`npx playwright test test/browser/app.spec.js -g "<name>"`.
