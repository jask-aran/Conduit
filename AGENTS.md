# Repository Guidelines

## Documentation Contract

Repository documentation is stateless: describe the current system, current
commands, and current constraints only. Do not use README files or `AGENTS.md`
as change logs, migration narratives, or records of removed experiments. Replace
obsolete statements instead of appending historical qualifications. History
belongs in Git commits, pull requests, and issues.

`README.md` is the product, architecture, data-model, and onboarding reference.
`AGENTS.md` is the implementation contract for contributors and coding agents.
Keep both synchronized with the repository they describe.

## Project Structure

`conduit-web/` contains the product implementation: the Express server and Pi
RPC lifecycle live in `src/`, the React/Vite interface lives in `src/client/`,
generated Shadcn primitives live in `src/components/ui/`, Node tests live in
`test/`, and Playwright interface tests live in `test/browser/`.
`components.json` configures the Shadcn Radix Nova and Magic UI registries,
aliases, CSS variables, and Lucide icon library. Tailwind CSS v4 supplies
component and application styling.

`templates/` contains tracked Pi launch presets (profiles in the UI). Each
template owns its manifest, system prompt, extensions, skills, and prompt
templates. The server discovers every `templates/*/template.json` at boot.
`scripts/pi-runtime.mjs` translates a selected manifest into explicit Pi
arguments; `scripts/conduit-pi.mjs` provides the equivalent interactive terminal
launch. App default profile lives in `data/preferences.json`; each chat stores
sticky `templateId` / `templateVersion` in the session registry.

`data/` is ignored mutable application data:

```text
data/chat/files/      working files visible to chats
data/pi/              isolated Pi credentials, settings, and native sessions
data/conduit.json     stable project identity and display metadata
data/sessions.json    atomic lightweight Conduit chat registry
data/preferences.json app preferences (default profile for new chats)
data/runtime.json     warm-pool and generation policy
```

The reserved unstructured project uses `data/chat/files` itself as its working
directory. Managed named projects use `data/chat/files/<slug>`. Workspaces point
at allow-listed absolute directories (unregister does not delete them). Clone
creation runs `gh repo clone` for GitHub sources when available, otherwise `git
clone`, at a user-selected absolute path and then registers that path. Keep Pi
configuration and native session files out of these roots. Conduit owns only
`.conduit/chats/<chat-id>/attachments` and `.partial` beneath each working root;
Pi continues to run with the project root as `cwd`. Browser-supplied paths never
become Pi cwd until the server resolves them against `CONDUIT_WORKSPACE_ALLOWLIST`.

The root SVG is architecture documentation. `.devcontainer/` contains the
development environment setup and Conduit launch scripts.

## Runtime and Data Ownership

Pi owns authentication, settings, model behavior, and JSONL transcript contents.
Conduit owns public chat IDs, `draft`/`active` status, project IDs, names, kinds,
creation times, per-chat attachment folders, live process records, browser
connections, and template/profile selection. Each chat durably stores
`templateId` (and `templateVersion` at first launch). Resume reloads that
template by id from the repository registry; drafts may change profile until the
first Pi process attaches. Special templates such as `runtime` are not valid
defaults or ordinary profile choices and are launched through dedicated routes.
Host Pi session IDs and JSONL paths are private mappings; browser routes always
use the stable Conduit chat ID. Settings may report the detected installation
executable and agent-home paths as local runtime diagnostics.

Workspace creation immediately opens a draft using its default ordinary profile;
the composer exposes ordinary profiles plus a synthetic Host Pi option in one
selector. Drafts may change that choice until the first Pi process attaches; the
runtime kind is immutable afterward. `conduit_profile` launches the
bundled 0.80.6 executable with `data/pi`, explicit profile resources, and no
ambient project resources. `native_pi` launches the detected absolute host Pi
executable with the server user's login-shell environment and effective native
Pi home/resources and the versioned
Conduit Workspace bridge only. Host Pi is available only for Workspaces and
requires saved host trust or a one-run trust/ignore choice at first launch. One `PiManager` owns
both runtimes so process limits and writer exclusion remain global. Host Pi
chat movement is unavailable because moving would re-home its host-native JSONL
through Conduit's isolated session store.

`data/pi/settings.json` is authoritative for Isolated Pi scoped models. Terminal and web
saves share it, the latest successful save wins, and Conduit reloads it for
model requests and new processes. The template model list is only the fallback
when Pi has no saved `enabledModels` value. Host Pi uses the detected agent
home's scoped models and default. Settings reports that scope read-only; chat
model changes go through Host Pi's RPC and therefore update its future-chat
default.

Pi JSONL entries are authoritative for an existing session's model, thinking
level, messages, and tool calls. Opening a session must reconstruct those values
from JSONL. Runtime-aware chat model APIs resolve the selected installation and
must never expose Isolated Pi models to a Host Pi chat. The saved `defaultModel`
seeds new chats; choosing a model updates both the attached live process and that
installation's settings, but existing-session launches must not pass model flags
that overwrite the model recorded by another session.

Conduit sets `PI_CODING_AGENT_DIR` to `data/pi` and lets Pi derive its native
session directory from `cwd`. Do not add `PI_CODING_AGENT_SESSION_DIR`,
`--session-dir`, or project-local `.pi/settings.json` redirects. Associate
sessions with projects using the canonical `cwd` in each JSONL header; Pi's
encoded directory name is lossy and can collide.

`data/conduit.json` is the central project catalog. The `chat` project maps to
`data/chat/files`; other project slugs map to direct children. Do not duplicate
catalog metadata in working directories or make Pi JSONL the owner of Conduit
application identity.

`data/sessions.json` is an atomic lightweight registry. Rows contain the Conduit
chat ID, project, title, durable `draft` or `active` status, private Pi mapping,
and timestamps. Create the row and `.conduit/chats/<id>/{attachments,.partial}`
before Pi starts. Empty drafts stay hidden; a completed attachment makes one
visible; the first prompt attaches Pi and marks the existing chat active. Only
startup cleanup may remove an empty draft older than 24 hours. Never remove a
draft containing a completed attachment.

Pi JSONL remains the transcript authority. Checkpoint active mappings only at
completed-response and explicit mutation boundaries, reconcile native files at
startup, and never parse every transcript for an ordinary sidebar request. The
filesystem is the attachment registry. Stream raw request bodies through an
exclusive `.part` file and publish with a same-filesystem atomic rename. Derive
all paths from server-owned project/chat data, validate attachment UUIDs, and
fail closed for malformed files and symlinks. Browser, upload-progress, and
incomplete-stream state is disposable.

Deleting a named project removes its catalog entry, working directory, and
native session directory. The reserved `chat` project cannot be deleted.
Deleting an individual chat removes its authoritative JSONL and Conduit chat
folder. Stop matching live processes before either destructive operation and
require confirmation in the interface. Chat duplication remains unavailable
until attachment ownership has an explicit product contract.

The server owns live Pi processes. A browser disconnect must not terminate its
process. Persisted JSONL is resumable after server restart, while live process
records and buffered RPC events are in-memory state. Never allow two Pi
processes to write the same JSONL simultaneously. Cap warm live processes
(`CONDUIT_MAX_LIVE_PROCESSES` / Settings → Runtime, default 12): when creating a
new process, stop the oldest idle process with no attached browsers first, or
reject with `live_process_limit`. Cap concurrent agent loops separately
(`CONDUIT_MAX_GENERATING_PROCESSES`, default 2): starting a new generation while
at the cap rejects with `generation_limit` without reclaiming warm processes.
Steer/follow-up into an open turn does not consume an extra generating slot.
Reap unattached idle processes after `CONDUIT_IDLE_PROCESS_TTL_MS` (default
120s). Never auto-stop a process that is generating, compacting, retrying,
waiting on host UI, or has clients attached.

Assign each response a monotonically increasing opaque generation ID. Stop must
close the client and server generation gates before waiting for Pi's public
`abort` RPC. Terminate a process that does not acknowledge within 250 ms and let
the next action start one fresh writer. Edit and regenerate use Pi's public
`fork` RPC, retain the Conduit chat/folder, advance only the private Pi mapping,
and never rewrite JSONL. Experimental stopped-response continuation is an
ordinary hidden user prompt behind `ENABLE_PARTIAL_CONTINUE`; keep it isolated
and removable.

Transcript APIs return ten complete turns at a time with a 50,000-character soft
limit. Preserve turn boundaries when paging. Stream assistant output as raw text
deltas relayed unthrottled to the browser; the client appends them to the
per-generation live stream store and coalesces published updates with
requestAnimationFrame, then replaces the stream with the canonical completed
message when the generation ends. Runtime snapshots carry the accumulated stream
content for reconnecting clients; never replay individual deltas. All Markdown
rendering, sanitization, KaTeX, and Shiki highlighting run in the browser.

The live-session WebSocket vocabulary documented in `conduit-web/README.md` is
a contract: keep changes additive where possible, and update that section in
the same change as any event or command shape it describes.

## Interface Standard: Shadcn First

Use Shadcn components as the default building blocks for interface development.
Before implementing a control or interaction, check for an appropriate Shadcn
component and use its standard structure, accessibility behavior, keyboard
handling, and states. This applies especially to buttons, forms, dialogs,
drawers, dropdowns, command menus, tabs, tooltips, navigation, notifications,
tables, and loading or empty states.

Add Shadcn components as repository-owned source through the standard Shadcn
workflow when they are needed. Preserve the upstream component shape initially;
customize through composition, variants, and shared design tokens. Do not build
a bespoke primitive merely to obtain different styling. Create custom components
when the behavior is Conduit-specific or no suitable Shadcn primitive exists,
and keep generic interaction mechanics delegated to tested primitives beneath
them.

Shadcn lowers primitive interaction risk but does not replace application tests.
Test Conduit-specific state transitions, RPC behavior, data mapping, responsive
composition, and regressions introduced by customization.

Keep the application sidebar composed from Shadcn `Sidebar`, `SidebarGroup`,
`SidebarGroupLabel`, `SidebarGroupAction`, `SidebarMenu`, and submenu primitives
with `collapsible="icon"`. Use Shadcn Context Menu for chat and project actions;
do not recreate collapse, focus, keyboard, padding, or menu behavior in custom
controls. A new-chat draft is transient navigation state: omit it from Chats
until the first message persists a session, then select that session.

Render assistant Markdown only through `src/client/chat-markdown.jsx` and
Streamdown's default hardened pipeline; user prompts remain literal text.
Preserve streaming mode for the live message and static mode for completed
messages, the eager KaTeX plugin, URL sanitization, image blocking, and the
Shadcn external-link confirmation dialog. Fenced code renders through the
ai-elements Artifact and CodeBlock components using the fine-grained Shiki core
with the JavaScript regex engine and a pinned language set; do not import the
full `shiki` bundle. Do not introduce a parallel Markdown parser; raw HTML in
assistant output renders only through Streamdown's sanitize-and-harden plugins.

Rendering stability: timeline React keys are durable identities. When the server
confirms an optimistic client entry, reconcile it in place and preserve the
original key; never wholesale-replace a rendered list with re-keyed equivalents
of the same content. A timeline slot keeps a single element type across its
lifecycle from streaming to final; vary props, never the component identity
mid-life. Read mutable external stores during render only through
`useSyncExternalStore`. Navigation and reloads are load-then-commit: never commit
a cleared intermediate state while replacement data is in flight, and key
per-thread interface state by the loaded session id so scroll position and
per-thread component state reset atomically with content. Pre-paint scroll
positioning requires exact layout, so do not apply `content-visibility` or
intrinsic-size placeholders to elements that participate in initial scroll math.

Keep the composer a bounded native textarea. Keep palette and composer commands
as explicit registries in `command-registry.js`:

- `paletteCommands` — static one-shot actions (new chat, attach, stop, …)
- `paletteSources` — dynamic lists; set `page: "settings" | "goto" | null`. Page
  sources only appear on their drill-down page; root sources (e.g. thinking
  levels) appear at root. Page children must never leak into root browse/search
- `PALETTE_PAGES` — Settings… and Go to… portals with VS Code-style input
  prefixes (`Settings ›`, `Go to ›`). Entering a portal (or a shortcut that opens
  that page) shows children; Escape/Back/empty Backspace returns to root
- `palette-search.js` ranks root and page results with label/prefix priority and
  drops weak fuzzy noise; searching uses `shouldFilter={false}` and a flat
  score-sorted list so models are not trapped under static groups

The lazy Shadcn Command dialog owns persistent application actions: new surface
features should be reachable from Cmd/Ctrl+K. Wire `run` handlers through the
`commandActions` bag in `main.jsx` (and sidebar `commandRequest` for dialogs).
Keyboard: `⌘/Ctrl+K` palette, `⌘/Ctrl+⇧O` open palette in Go to mode, `⌘/Ctrl+⇧C`
new chat (not `⌘N` — browsers steal it), `⌘/Ctrl+,` settings dialog, `⌘/Ctrl+B`
sidebar (Shadcn). The textarea slash Popover exposes only `/attach` and does not
route textarea keystrokes through cmdk. Keep the compact composer model menu;
Settings owns the searchable, grouped multi-model Combobox and remains a centered
Dialog with a visible vertical Tabs rail at narrow widths. Render the same
Attachment composition above the composer while pending and beneath the user
message after send. Keep raw upload queueing and the drag-enter counter as
shallow application logic.

## Build, Test, and Development Commands

The dev container runs `.devcontainer/setup.sh`, which installs system build
tools, Pi Coding Agent 0.80.6, npm dependencies, Playwright Chromium and its
Linux libraries, then builds the client. For local Linux setup with Node.js 22+:

```bash
sudo npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.80.6
cd conduit-web
npm ci
npx playwright install --with-deps chromium
```

Always start or restart the local Conduit server from the repository root with
`bash .devcontainer/start-conduit.sh restart`. This command applies the
forwardable `0.0.0.0` host binding, rebuilds the frontend when needed, and
manages the server PID and log. Do not launch `node src/server.js`, `npm run
start`, or `npm run dev:server` directly.

Use these commands from `conduit-web/` for development and verification:

```bash
npm run dev              # run the Vite client in another terminal
npm test                 # execute all node:test suites
npm run test:browser     # deterministic desktop and mobile Chromium checks
npm run test:browser:headed  # show Chromium while debugging interactions
npm run build            # create the production Vite bundle
npm run ui:add -- button     # add a Shadcn primitive using the latest CLI
npm run ui:add -- @magicui/animated-beam # add a Magic UI effect
```

`npm run build` also emits `dist/bundle-report.json` and fails when compressed
initial or lazy chunks exceed the configured budgets. Treat budget increases as
reviewed architectural changes, not incidental dependency updates.

From the repository root, `bash .devcontainer/start-conduit.sh restart` builds
when necessary and restarts the Conduit web surface.

## Coding Style

Use ES modules, two-space indentation, semicolons, and double-quoted JavaScript
imports and strings. Use `camelCase` for variables and functions, `PascalCase`
for React components and classes, and kebab-case filenames such as
`project-store.js`.

Files generated under `src/components/ui/` retain Shadcn's upstream formatting
so future `shadcn add` and `shadcn diff` operations remain reviewable. Apply the
repository JavaScript style to application-owned files around those primitives.
The `ui:add` script invokes `npx shadcn@latest`; keep React, React DOM, and the
locally imported Shadcn package pinned exactly, and commit lockfile changes from
each component addition.
Add Magic UI effects through the configured `@magicui` registry and keep them
under `src/components/ui/`; prefer Shadcn for interaction mechanics and reserve
Magic UI for purposeful motion or visual effects.

Keep configuration in environment variables documented by `.env.example`.
No repository-wide linter or formatter is configured, so review diffs for local
consistency. Avoid repository-wide formatting changes unrelated to the task.

## Testing

Server tests use `node:test` and `node:assert/strict`. Name files `*.test.js`
directly under `test/` so the Node test command does not collect Playwright
specifications from `test/browser/`. Isolate filesystem behavior with temporary
directories and place regression coverage beside the affected store or lifecycle
behavior. Every behavior change requires focused coverage; there is no numeric
coverage threshold.

Run `npm test` and `npm run build` before submission. Interface changes require
`npm run test:browser`, responsive verification, and screenshots in pull
requests. Browser tests use the Playwright CLI rather than MCP, mock the API when
testing client behavior, and retain traces and screenshots only on failure under
`test-results/`. Use the command printed by a failure—normally
`npx playwright show-trace test-results/<test>/trace.zip`—to inspect DOM state,
network activity, console output, and actions. Use a real server-backed browser
test only when the API or WebSocket boundary is itself under test.

## Commits and Pull Requests

Do not create commits, push branches, open pull requests, or merge unless the
user explicitly asks for that step. Implement and verify work first; wait for
instruction before any git publish or history-changing action.

Use short, imperative, sentence-case commit subjects. Keep each commit scoped to
one coherent change. Pull requests must explain user-visible behavior, identify
the affected surface, list verification commands, and link relevant issues.
Include screenshots for interface changes and call out configuration,
data-format, dependency, template, or session-lifecycle effects.

## Security and Ignored State

Never commit `.env`, `.env.local`, `data/pi/`, `data/conduit.json`,
`data/sessions.json`, `data/chat/files/`, credentials, logs, generated `dist/`, `node_modules/`, or
runtime session data. Sanitized `.env.example` files are documentation.

Bind development services to loopback unless the documented Codespaces or an
authenticated tunnel flow requires otherwise. Treat Pi extensions and skills as
trusted executable configuration and review them before adding them to a
template.
