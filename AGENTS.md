# Repository Guidelines

This file is the working contract for contributors and coding agents: hard
invariants, verification, and steering. It deliberately does not repeat
reference documentation:

- `README.md` — product, architecture, data model, setup, and interface
  reference. Read the section covering the area you touch before changing it.
- `conduit-web/README.md` — runtime model, HTTP API, process residency and
  caps, and the live-session WebSocket protocol (a contract: keep changes
  additive and update that section in the same change).
- `personal-agent-platform-design.md` — long-range vision. `specs/` — near-term
  roadmap and per-feature implementation specs (upcoming behavior; this file
  governs code as it exists).

Architecture in one breath: one Express server (`conduit-web/src/server.js`)
owns a pool of `pi --mode rpc` child processes — one per live chat, across two
installations (bundled Isolated Pi and the user's native Host Pi) — and
relays their events to a strict TypeScript SolidJS/Vite client over per-chat WebSockets plus a
global SSE runtime channel. Pi's JSONL files are the authoritative
transcripts; Conduit's stores (`data/*.json`) hold identity, registry, and
preferences only, and the browser is a reconnectable client of server-owned
state.

Documentation is stateless: describe the current system only. Replace obsolete
statements rather than appending history; history lives in Git and PRs. Keep
`README.md` and this file synchronized with the repository in the same change
that alters behavior they describe.

## Hard invariants

- Pi JSONL is the authoritative transcript; `data/sessions.json` is a
  lightweight registry and `data/conduit.json` the project catalog. Never
  duplicate ownership across them, and never let two Pi processes write the
  same JSONL simultaneously.
- The server owns live Pi processes. Browser disconnect never terminates a
  process; never auto-stop a process that is generating, compacting,
  retrying, waiting on host UI, or has clients attached.
- Never parse every transcript to serve an ordinary sidebar request.
- Browser-supplied paths never become a Pi `cwd` or file target until the
  server resolves them against its allowlists; fail closed on symlinks and
  malformed input. Attachment publishing stays atomic (`.part` + rename).
- Do not set `PI_CODING_AGENT_SESSION_DIR`, pass `--session-dir`, or generate
  Pi config inside working trees. Associate sessions with projects by the
  canonical `cwd` in each JSONL header, never the lossy encoded directory name.
- Keep Isolated Pi and Host Pi scopes separate: runtime-aware model APIs must
  never expose one installation's models or settings to the other's chats.
- Destructive operations (chat/project delete, process stop before delete)
  require interface confirmation and must stop matching live processes first.
- Auth is one choke point plus the WS upgrade. The `requireAuth` middleware
  (`conduit-web/src/auth-middleware.js`) is mounted before every other route and
  static handler in `server.js`; the only allowlisted paths are `GET /login`,
  `POST /v0/auth/login`, and `GET /healthz`. Never add a route before
  `requireAuth`, and never expose a static asset or upload handler without it.
  WebSocket upgrades validate the session cookie before `handleUpgrade` and
  destroy the socket otherwise. Loopback binding without a configured password
  stays open for local dev; a non-loopback bind refuses to start without a
  password, unless `CONDUIT_ALLOW_BOOTSTRAP=1` enables its login-only first-run
  setup or `CONDUIT_ALLOW_INSECURE=1` is explicitly used for development.
  Bootstrap is first-writer-wins and must sit behind private edge access.
  Credentials live only in
  `data/auth.json` (mode `0600`, atomic writes); the running server reloads it
  on each login attempt and on session-validation cache miss, never on a timer.

## Interface

Build concrete Solid components for concrete Conduit surfaces. Use Kobalte
selectively when accessible behavior (menus, context menus, focus management)
earns the dependency; keep the local primitive boundary small and do not copy a
generic component catalogue. New surface features should be reachable from the
typed Cmd/Ctrl+K palette when that improves keyboard access. Do not introduce
parallel command or tool registries: tool names are data and generic tool cards
must remain useful for unknown tools.

Assistant Markdown renders only through `src/client/chat/markdown.tsx` using
Marked, DOMPurify, and the KaTeX extension; user prompts remain literal text.
Do not introduce a parallel Markdown parser.

Rendering stability (hard-won — do not regress):

- Timeline render keys are durable identities: reconcile optimistic entries in
  place, never re-key rendered lists of the same content.
- A timeline slot keeps one element type across its streaming→final
  lifecycle; vary props, never component identity mid-life.
- Browser state has three owners: catalogue, global runtime, and active chat.
  Keep new state in the narrowest owner and expose it through Solid signals.
- Navigation is load-then-commit: never commit a cleared intermediate state
  while replacement data is in flight; key per-thread UI state by session id.
- No `content-visibility` or intrinsic-size placeholders on elements in
  initial scroll math.

## Build, test, and verify

Always start or restart the local server from the repository root with:

```bash
bash .devcontainer/start-conduit.sh restart
```

It rebuilds when needed and owns the PID/log on port 4310. Do not launch
`node src/server.js` or `npm run start`/`dev:server` directly. From
`conduit-web/`: `npm run dev` (Vite client), `npm test` (node:test suites),
`npm run test:browser` (Playwright, mocked API, desktop + mobile),
`npm run build` (bundle budgets enforced — treat budget increases as reviewed
architectural changes).

Before committing, run the complete local verification suite: `npm run
typecheck`, `npm test`, `npm run build`, and `npm run test:browser`. GitHub
Actions intentionally does not repeat the test suites; its manual static check
only verifies a clean install, strict TypeScript, and the production bundle
budgets. GitGuardian remains the automatic repository security check.

Run a single server suite with `node --test test/<name>.test.js`; run a
single browser spec with `npx playwright test test/browser/app.spec.js
-g "<test name>"`. Server tests are `test/*.test.js` with `node:test`;
browser specs live in `test/browser/` and mock the API unless the server
boundary itself is under test. Every behavior change requires focused coverage. Failed browser tests
write traces under `test-results/`; inspect with the printed
`show-trace` command.

Before returning to the user for manual testing, run the restart command above
so the running server reflects your change. Every user-facing change must end
with a manual smoketest checklist in your report: the concrete steps, clicks,
and URLs the user should walk through to validate the change themselves.

## Style

ES modules, two-space indent, semicolons, double quotes; `camelCase`
functions, `PascalCase` components, kebab-case filenames. Client code is strict
TypeScript and must not add React production dependencies. Configuration lives
in env vars documented by `.env.example`. No repo-wide formatter: avoid
formatting changes unrelated to the task.

## Commits and pull requests

Do not commit, push, branch, open PRs, or merge unless the user explicitly
asks. Short, imperative, sentence-case commit subjects; one coherent change
per commit. PRs explain user-visible behavior, list verification commands,
include screenshots for interface changes, and call out configuration,
data-format, dependency, template, or session-lifecycle effects.

## Security and ignored state

Never commit `.env*` (except sanitized examples), `data/`, credentials, logs,
`dist/`, or `node_modules/`. Edge auth gates every route and upgrade behind a
single-user password (see `specs/edge-auth.md`); a non-loopback bind refuses
to start until `scripts/conduit-auth.mjs set-password` has run or
`CONDUIT_ALLOW_INSECURE=1` is exported. Treat Pi extensions,
skills, and template tool lists as trusted executable configuration; review
them before adding them to a template.
