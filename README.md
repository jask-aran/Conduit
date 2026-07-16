# Conduit

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/jask-aran/Conduit?quickstart=1)

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/jask-aran/Conduit)

![architecture](interface_first_platform_architecture.svg)

Conduit is an interface-first personal agent platform. The web application owns
one `pi --mode rpc` process per live chat while Pi remains authoritative for
authentication, models, tools, and JSONL session history.

## Repository structure

```text
conduit-web/
  src/                 Express server and Pi RPC lifecycle
  src/client/          React/Vite interface
  src/components/ui/   Shadcn component source
  test/browser/        Playwright browser smoke tests
  test/                Node test suites
  components.json      Shadcn registry and alias configuration

templates/
  chat/                selected Pi system prompt and resource manifest

scripts/
  conduit-pi.mjs       template-aware terminal launcher
  pi-runtime.mjs       template loading and Pi argument construction

data/
  chat/files/          chat working directories and agent-visible files
  pi/                  isolated Pi agent home
  conduit.json         Conduit project catalog
  sessions.json        rebuildable lightweight session registry
```

`conduit-web/`, `templates/`, and `scripts/` are tracked product source.
`data/` is ignored mutable application data and forms one backup or mount
boundary for working files, project metadata, credentials, preferences, and
session history.

## Data model

### Projects and working files

`data/conduit.json` is the Conduit-owned project catalog. Each project contains:

```json
{
  "id": "project_…",
  "slug": "example",
  "name": "Example",
  "kind": "project",
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

The reserved `chat` project has ID `project_chat`, kind `unstructured`, and
working directory `data/chat/files`. Every named project uses
`data/chat/files/<slug>`. Working directories contain only files available to
the corresponding chats; they do not contain Conduit metadata, Pi configuration,
or session JSONL.

All unstructured chats share `data/chat/files` and therefore share access to its
files. Named projects provide separate filesystem scopes beneath that root.
Renaming a named project changes its catalog display name while preserving its
stable slug and working-directory path. The web interface can ask the host
desktop to open a named project's working directory.
Deleting a named project deletes its catalog entry, working directory, and
native Pi sessions. The reserved unstructured project cannot be deleted.

### Pi runtime and sessions

`data/pi` is Conduit's app-wide Pi agent home:

```text
data/pi/
  auth.json
  settings.json
  trust.json                 when Pi creates it
  sessions/
    <encoded-cwd>/
      <timestamp>_<id>.jsonl
```

Conduit sets `PI_CODING_AGENT_DIR=data/pi` but does not set
`PI_CODING_AGENT_SESSION_DIR` or pass `--session-dir`. Pi derives its native
session directory from the process working directory and records the canonical
`cwd` in every JSONL header. Conduit associates a session with a project by
matching that header exactly, rather than trusting the lossy encoded directory
name.

Pi JSONL is the authoritative transcript. `data/conduit.json` stores only
application metadata Pi does not model: stable project IDs, display names,
kinds, and creation times. `data/sessions.json` is an atomic, rebuildable index
of session IDs, titles, project associations, file paths, and checkpoint times.
Normal sidebar requests read the complete lightweight registry without parsing
transcripts. The server reconciles missing and new native files at startup and
updates the registry after completed responses and explicit session mutations.
Live process state, connected WebSockets, incomplete response state, and recent
RPC events remain disposable server memory; persisted sessions remain resumable
after a browser or server restart.

Opening a chat returns at most ten recent complete turns with a 50,000-character
soft limit. Older ten-turn pages load when the transcript is scrolled upward.
Large tool results are fetched only when their card is expanded.

Chat renames append Pi's native `session_info` entry. Duplication uses Pi's
native cross-directory fork operation and assigns a new session ID. Moving a
chat creates that fork with the destination project's canonical `cwd`, then
deletes the source only after the destination JSONL has been created. Moving all
chats from a project follows the same rule as one batch.

Deleting a chat stops any live process writing that session and deletes its
authoritative JSONL. Both chat and project deletion require interface
confirmation.

Do not let two Pi processes write the same JSONL simultaneously.

### Templates

Templates are tracked Conduit launch presets, not project-local `.pi`
directories. `templates/chat/template.json` selects a system prompt, allowed
tools, fallback models, extensions, skills, and prompt templates. The web server and
`conduit-pi` translate the selected template into explicit Pi arguments while
independently selecting the Pi home, working directory, and session.

The configured template is applied when a session process starts or resumes.
Pi's global `enabledModels` setting is the authoritative model scope shared by
the terminal and web interface. Conduit reloads `data/pi/settings.json` for
model and settings requests and uses the saved scope for new Pi processes. The
template model list applies only when Pi has no saved `enabledModels` value.
Template identity is present in live process state but is not persisted as part
of the current project catalog.

## Interface development

The interface uses Shadcn's Radix Nova component preset with Tailwind CSS v4,
Lucide icons, Geist, and dark neutral design tokens. Generated component source
lives under `conduit-web/src/components/ui/`; `components.json` defines its
registries, CSS, and import aliases. React, React DOM, and the locally imported
Shadcn package are pinned to exact releases for reproducible builds. Add
Shadcn primitives with `npm run ui:add -- button` and Magic UI effects with
`npm run ui:add -- @magicui/animated-beam`; the script invokes
`npx shadcn@latest` so new source comes from the current registry and the
resulting dependency versions are recorded in the lockfile.

New controls, dialogs, menus, forms, navigation, feedback, and layout primitives
use Shadcn components whenever an appropriate component exists. Compose and
theme those primitives before writing bespoke interaction code; custom
components are for Conduit-specific behavior that the component set does not
cover.

The application shell composes Shadcn Sidebar, Button Group, Dropdown Menu,
Context Menu, Input Group, Field, and Card primitives. Chat transcripts use the
first-party Message Scroller, Message, and Bubble components: Message Scroller
owns streaming follow, turn anchoring, and jump-to-latest behavior while Pi RPC
continues to own transport and message state. The settings surface writes Pi's
global scoped-model setting through the Conduit server.

Assistant streaming commits complete Markdown blocks as immutable server-rendered
HTML and rerenders only the unfinished tail at a 40 ms cadence. Final Markdown,
KaTeX HTML plus MathML, sanitization, and limited-language Shiki highlighting run
on the server. Incomplete maths and Markdown continue to render through a lazy
client tail renderer; KaTeX browser CSS loads only when maths is present.

Shadcn components are added to the repository as source when needed, keeping
their standard accessibility and interaction behavior intact. Application tests
cover the behavior introduced by their composition. Magic UI is the secondary
registry for purposeful animation and visual effects; it does not replace
Shadcn interaction primitives.

Browser verification uses the Playwright test runner directly, without a browser
MCP server:

```bash
cd conduit-web
npm run test:browser
npm run test:browser:headed
```

The test runner starts Vite, mocks the API boundary for deterministic interface
tests, covers desktop and mobile Chromium, emits concise line output, and retains
screenshots and traces only for failures. Use `npm run test:browser:headed` when
watching an interaction is useful. Dev-container setup installs the pinned
browser and its Linux libraries automatically.

Production builds write `dist/bundle-report.json` and enforce gzip budgets for
initial JavaScript, initial CSS, and the largest lazy JavaScript chunk. Hashed
assets receive immutable cache headers; HTML revalidates, and HTTP responses are
compressed by the application or its outer proxy.

## Setup and development

Requirements: Node.js 22+, npm, and Pi Coding Agent 0.80.6 available as `pi`.

The dev container performs the complete setup through
`.devcontainer/setup.sh`: system build tools, the pinned Pi CLI, npm
dependencies, Chromium and its Linux libraries, and the initial production
build. For a local Linux environment, run the equivalent commands:

```bash
sudo npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.80.6
cd conduit-web
npm ci
npx playwright install --with-deps chromium
npm test
npm run test:browser
npm run build
```

On macOS or Windows, install Node.js 22+ and the pinned Pi CLI, run `npm ci`,
then run `npx playwright install chromium`; Playwright's `--with-deps` option is
for supported Linux package managers.

Authenticate Conduit's isolated Pi runtime from the repository root:

```bash
./scripts/conduit-pi.mjs
```

Enter `/login`. The launcher uses the current directory as Pi's working
directory. To share a named project's native history with the web app:

```bash
cd data/chat/files/project-name
../../../../scripts/conduit-pi.mjs
```

For application development, run the API and Vite servers in separate terminals
from `conduit-web/`:

```bash
npm run dev:server       # Express API on http://127.0.0.1:4310
npm run dev              # Vite UI with API/WebSocket proxying
```

Use `npm test` for server/store behavior and `npm run test:browser` for interface
behavior. A failed browser test writes its screenshot, error context, and trace
under `conduit-web/test-results/`; inspect a trace with the command printed by
the failure, normally `npx playwright show-trace test-results/<test>/trace.zip`.
Keep browser tests deterministic by intercepting API requests when the behavior
under test is purely client-side. Use the real Express server only for an
end-to-end boundary that cannot be represented by a fixture.

Run the production server from `conduit-web/` with `npm start`, then open
<http://127.0.0.1:4310>.

The dev container also installs `conduit-pi` in `~/.local/bin`, starts Conduit,
and forwards port 4310.

## Verification

```bash
cd conduit-web
npm test
npm run test:browser
npm run build
```
