# Conduit

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/jask-aran/Conduit?quickstart=1)

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/jask-aran/Conduit)

![architecture](interface_first_platform_architecture.svg)

Conduit is an interface-first personal agent platform: one self-hosted web
address for conversational and execution-heavy agent work. The design vision
lives in `personal-agent-platform-design.md`; the surface that exists today is
Chat — a web chat interface over the Pi coding agent with projects,
attachments, history forking, response controls, and model management. Remotes,
Assistant, and Dashboard surfaces are described by the vision document and are
not yet implemented.

The web application owns one `pi --mode rpc` process per live chat while Pi
remains authoritative for authentication, models, tools, and JSONL session
history. Sessions outlive browser connections and server restarts; the browser
is a reconnectable client of server-owned processes.

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
  sessions.json        atomic lightweight chat registry
```

`conduit-web/`, `templates/`, and `scripts/` are tracked product source.
`data/` is ignored mutable application data and forms one backup or mount
boundary for working files, project metadata, Conduit-profile credentials,
preferences, and Conduit-profile session history. Native Pi history remains in
the host Pi home and needs a separate backup.

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
`data/chat/files/<slug>`. Working directories contain project-level files plus a
Conduit-owned `.conduit/chats/<chat-id>/` tree. Each chat tree contains its
`attachments/` files and a transient `.partial/` upload directory. Pi still runs
at the project working root, so it can read chat attachments by their relative
paths. Pi configuration and native session JSONL remain outside working trees.

All unstructured chats share `data/chat/files` and therefore share access to its
files. Named projects provide separate filesystem scopes beneath that root.
Renaming a named project changes its catalog display name while preserving its
stable slug and working-directory path.
Deleting a named project deletes its catalog entry, working directory, and
native Pi sessions. The reserved unstructured project cannot be deleted.

### Chats, attachments, and Pi sessions

Conduit creates a stable UUID chat and its filesystem directory before starting
Pi. New chats are durable `draft` rows; empty drafts stay out of the sidebar,
while the first completed attachment makes a draft visible. Pi starts only when
the first user message is sent. Conduit then records the private native Pi
session mapping and promotes the same public chat ID to `active`. Browser routes
therefore remain `/chat/<conduit-chat-id>` across Pi restarts and history forks.

Uploads use a raw HTTP request body streamed through
`.partial/<attachment-id>.part` and atomically renamed into
`attachments/<attachment-id>--<safe-name>`. The filesystem is the attachment
registry; Conduit adds no file-count, MIME, extension, or byte policy. Host disk,
browser, network, and proxy limits can still reject an upload. Attachment bytes
are never injected into model context. The user prompt instead carries validated
relative paths in a small envelope that transcript presentation hides again.

`data/pi` is the isolated agent home for Conduit-profile chats:

```text
data/pi/
  auth.json
  settings.json
  trust.json                 when Pi creates it
  sessions/
    <encoded-cwd>/
      <timestamp>_<id>.jsonl
```

Conduit-profile chats use the bundled, pinned Pi executable and set
`PI_CODING_AGENT_DIR=data/pi` but do not set
`PI_CODING_AGENT_SESSION_DIR` or pass `--session-dir`. Pi derives its native
session directory from the process working directory and records the canonical
`cwd` in every JSONL header. Conduit associates a session with a project by
matching that header exactly, rather than trusting the lossy encoded directory
name.

Workspace chats choose their runtime when created. **Conduit profile** uses the
bundled Pi, isolated home, and an explicit tracked profile. **Native Pi** uses
the host Pi executable discovered through the server user's login shell, the
host `~/.pi/agent` home, native authentication and resources, plus a minimal
Conduit attachment bridge. Native project resources require an existing saved
trust decision or a one-run choice to trust them or start without them. Both
runtimes use the Workspace as canonical `cwd`, share one process manager and
global capacity limits, and preserve the one-writer-per-JSONL invariant.

Pi JSONL is the authoritative transcript. `data/conduit.json` stores stable
project IDs, display names, kinds, and creation times. `data/sessions.json` is an
atomic lightweight registry of stable Conduit chat IDs, `draft`/`active` status,
titles, project associations, immutable runtime/installation identity, private
Pi mappings, and timestamps. Existing
pre-migration rows retain their stable ID as the Conduit chat ID. Normal sidebar
requests read this registry without parsing transcripts; active rows are
reconciled with native files at startup and checkpointed after completed
responses and explicit mutations.
Live process state, connected WebSockets, incomplete response state, and recent
RPC events remain disposable server memory; persisted sessions remain resumable
after a browser or server restart.

Opening a chat returns at most ten recent complete turns with a 50,000-character
soft limit. Older ten-turn pages load when the transcript is scrolled upward.
Large tool results are fetched only when their card is expanded.
Reopening a chat restores its recorded model, thinking level, messages, and tool
calls from JSONL. Selecting a model updates the active Pi process and
`data/pi/settings.json`, making it the default for the next chat without
replacing the model recorded by existing chats.

Chat renames append Pi's native `session_info` entry. Editing an earlier user
message and regenerating a response use Pi's public `fork` RPC while retaining
the Conduit chat ID and attachment folder; the registry advances to the new
private Pi mapping and preserves the old native session file. Chat duplication
is deliberately unavailable because attachment ownership semantics are not yet
defined. Moving a Conduit-profile chat creates a native cross-directory fork with the
destination project's canonical `cwd`, moves its Conduit folder, and deletes the
source only after the destination JSONL has been created. Moving all chats from
a project follows the same rule as one batch. Native Pi chats cannot move
between working roots.

Deleting a chat stops any live process writing that session and deletes its
authoritative JSONL plus Conduit chat folder. Both chat and project deletion
require interface confirmation.

Do not let two Pi processes write the same JSONL simultaneously.

### Templates (profiles)

Templates are tracked Conduit launch presets (profiles in Settings), not
project-local `.pi` directories. Conduit discovers every
`templates/*/template.json` at boot. Each manifest selects a system prompt,
allowed tools, fallback models, extensions, skills, and prompt templates. The
web server and `conduit-pi` translate the selected template into explicit Pi
arguments while independently selecting the Pi home, working directory, and
session.

New chats use the app default profile from `data/preferences.json` (Settings →
Profiles). Each chat stores sticky `templateId` / `templateVersion` in
`data/sessions.json` and reloads that template by id on resume. Chats missing a
profile receive the default the next time the runtime touches them. Drafts may
change profile until the first Pi process attaches.

The sidebar presents managed folders under **Projects**. **Workspaces** register
an existing allow-listed host directory; cloning first creates a checkout under
the managed files root and then registers that checkout as a Workspace. Unlinking
an existing-directory Workspace keeps its external tree. Shipped profiles:
General (restrained tools), Workspace
(full tools + skills), and Runtime (a special one-off admin chat for templates
and `pi install`). Runtime is not a valid app/project default or ordinary chat
profile; Settings → Profiles shows it separately and creates a fresh instance
when requested.

Pi's global `enabledModels` setting is the authoritative model scope shared by
the terminal and web interface. Conduit reloads `data/pi/settings.json` for
model and settings requests and uses the saved scope for new Pi processes. The
template model list applies only when Pi has no saved `enabledModels` value.

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

The composer is a bounded native textarea with a compact model selector and
Shadcn Attachment cards above it. Upload progress appears in those cards; after
send, the same cards move beneath their user message. Cmd/Ctrl+K lazy-loads the
global Shadcn Command palette: an extensible registry for chat ops, models, and
thinking levels, with Settings… and Go to… drill-down pages (search prefixes,
Cmd/Ctrl+Shift+O for Go to) so nested targets stay out of the root list. The
textarea-focused slash Popover exposes only composition commands
(`/attach`). Settings opens as a centered Dialog with fixed vertical Tabs and a
searchable, grouped multi-model Combobox. The chat header uses a project-aware
breadcrumb. Response controls copy source Markdown, fork for edit/regenerate,
stop a generation immediately, and optionally continue an aborted partial
response.

Every response generation has a server-issued ID. Stop freezes the browser's
visible partial synchronously and rejects later deltas for that ID. Conduit asks
Pi to abort and kills a non-responsive process after 250 ms so the persisted
session can be resumed by a single fresh writer. Browser disconnect alone never
terminates the server-owned process. Experimental partial continuation is
controlled by `ENABLE_PARTIAL_CONTINUE` and defaults to enabled.

Assistant streaming relays Pi's raw text deltas over the session WebSocket. The
browser appends them to a per-generation live stream store and coalesces
interface updates with requestAnimationFrame, so rendering follows the display's
refresh rate without a tuned cadence. Reconnecting mid-response restores the
accumulated stream from the runtime snapshot instead of replaying deltas. All
Markdown rendering runs in the browser; KaTeX styles load with the application
shell inside the CSS budget.
The icon-collapsible sidebar presents Chats and Projects as separate groups.
Chats are direct menu items; projects expand to session subitems. Group actions
create chats and folders. Chat context menus provide rename, move, duplicate,
transcript copy, and confirmed deletion. Project context menus provide new chat,
rename, bulk chat movement, and confirmed deletion.
An unsent draft is not listed; its persisted session appears selected after the
first message creates the JSONL.

Assistant text renders through Streamdown in streaming mode while a response is
live and static mode once it completes. It supports GFM, KaTeX math using
`$...$` or `$$...$$`, and fenced code presented in an Artifact card with Shiki
highlighting, line numbers, and a copy action; highlighting uses the
fine-grained Shiki core with a JavaScript regex engine and a pinned language
set. Raw HTML in assistant output renders only through Streamdown's
sanitize-and-harden pipeline. Sanitization permits safe web and email links,
confirms external navigation with a Shadcn Alert Dialog, and replaces remote
images with their alt text. User messages remain literal text.

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

Start or restart the managed Conduit server from the repository root, then run
Vite from `conduit-web/` when developing the client:

```bash
bash .devcontainer/start-conduit.sh restart
cd conduit-web
npm run dev              # Vite UI with API/WebSocket proxying
```

Use `npm test` for server/store behavior and `npm run test:browser` for interface
behavior. A failed browser test writes its screenshot, error context, and trace
under `conduit-web/test-results/`; inspect a trace with the command printed by
the failure, normally `npx playwright show-trace test-results/<test>/trace.zip`.
Keep browser tests deterministic by intercepting API requests when the behavior
under test is purely client-side. Use the real Express server only for an
end-to-end boundary that cannot be represented by a fixture.

The managed restart command builds the client when necessary, owns the server
PID and log, and serves Conduit on port 4310.

The dev container also installs `conduit-pi` in `~/.local/bin`, starts Conduit,
and forwards port 4310.

## Verification

```bash
cd conduit-web
npm test
npm run test:browser
npm run build
```
