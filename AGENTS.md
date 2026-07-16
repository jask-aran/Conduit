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

`templates/` contains tracked Pi launch presets. Each template owns its manifest,
system prompt, extensions, skills, and prompt templates. `scripts/pi-runtime.mjs`
translates a selected manifest into explicit Pi arguments;
`scripts/conduit-pi.mjs` provides the equivalent interactive terminal launch.

`data/` is ignored mutable application data:

```text
data/chat/files/      working files visible to chats
data/pi/              isolated Pi credentials, settings, and native sessions
data/conduit.json     stable project identity and display metadata
data/sessions.json    atomic lightweight Conduit chat registry
```

The reserved unstructured project uses `data/chat/files` itself as its working
directory. Named projects use `data/chat/files/<slug>`. Keep Pi configuration
and native session files out of these roots. Conduit owns only
`.conduit/chats/<chat-id>/attachments` and `.partial` beneath each working root;
Pi continues to run with the project root as `cwd`.

The root SVG is architecture documentation. `.devcontainer/` contains the
development environment setup and Conduit launch scripts.

## Runtime and Data Ownership

Pi owns authentication, settings, model behavior, and JSONL transcript contents.
Conduit owns public chat IDs, `draft`/`active` status, project IDs, names, kinds,
creation times, per-chat attachment folders, live process records, browser
connections, and template selection. Native Pi IDs and paths are private
mappings; browser routes always use the stable Conduit chat ID.

`data/pi/settings.json` is authoritative for scoped models. Terminal and web
saves share it, the latest successful save wins, and Conduit reloads it for
model requests and new processes. The template model list is only the fallback
when Pi has no saved `enabledModels` value.

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
processes to write the same JSONL simultaneously.

Assign each response a monotonically increasing opaque generation ID. Stop must
close the client and server generation gates before waiting for Pi's public
`abort` RPC. Terminate a process that does not acknowledge within 250 ms and let
the next action start one fresh writer. Edit and regenerate use Pi's public
`fork` RPC, retain the Conduit chat/folder, advance only the private Pi mapping,
and never rewrite JSONL. Experimental stopped-response continuation is an
ordinary hidden user prompt behind `ENABLE_PARTIAL_CONTINUE`; keep it isolated
and removable.

Transcript APIs return ten complete turns at a time with a 50,000-character soft
limit. Preserve turn boundaries when paging. Stream assistant output by freezing
complete server-rendered Markdown blocks, updating only the unfinished tail at a
bounded cadence, and replacing it with canonical server-rendered output when the
message completes. Final Markdown sanitization, KaTeX, and Shiki run server-side.

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

Keep the composer a bounded native textarea. Use the plain shared command
registry for both the lazy Shadcn Command dialog and the textarea-focused slash
Popover; do not route slash keystrokes through cmdk. Settings remains a centered
Dialog with a visible vertical Tabs rail at narrow widths. Use the existing
Attachment composition with Popover, ScrollArea, and Progress, while keeping raw
upload queueing and the drag-enter counter as shallow application logic.

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

Use these commands from `conduit-web/`:

```bash
npm run dev:server       # watch the API server on port 4310
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
