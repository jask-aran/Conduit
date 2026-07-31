# Repository Guidelines

This file is the working contract for contributors and coding agents: hard
invariants, operational constraints, and steering. It deliberately does not
repeat reference documentation:

- `README.md` — product, architecture, data model, interface reference and
  setup.
  Read the section covering the area you touch before changing it.
- `docs/operations/testing.md` — test selection, commands, seams, local/VPS
  boundaries and evidence requirements for every testing approach.
- `conduit-web/README.md` — runtime model, HTTP API, auth mechanism, process
  residency and caps, and the live-session WebSocket protocol (a contract: keep
  changes additive and update that section in the same change).
- `docs/architecture/personal-agent-platform-design.md` — long-range vision.
  `docs/` is current-state documentation; `specs/` holds transient working
  documents and shipped specs are deleted rather than archived.

Architecture in one breath: one Express server (`conduit-web/src/server.js`)
owns a pool of `pi --mode rpc` child processes — one per live chat, across two
installations (bundled Isolated Pi and the user's native Host Pi) — and
relays their events to a strict TypeScript SolidJS/Vite client over per-chat
WebSockets plus a global SSE runtime channel. Pi's JSONL files are the
authoritative transcripts; Conduit's stores (`$CONDUIT_DATA_ROOT/*.json`,
repository `data/` by default) hold identity, registry, and preferences only,
and the browser is a reconnectable client of server-owned state.

Documentation is stateless: describe the current system only. Replace obsolete
statements rather than appending history; history lives in Git and PRs. Keep
`README.md` and this file synchronized with the repository in the same change
that alters behavior they describe.

## Hard invariants

- Keep Git history operations scoped and intentional: stage only relevant files,
  record checks in non-trivial commits, and do not publish unrelated work.
- Pi JSONL is the authoritative transcript; `data/sessions.json` is a
  lightweight registry and `data/conduit.json` the project catalog. Never
  duplicate ownership across them, and never let two Pi processes write the
  same JSONL simultaneously.
- The server owns live Pi processes. Browser disconnect never terminates a
  process; never auto-stop a process that is generating, compacting, retrying,
  waiting on host UI, or has clients attached.
- Never parse every transcript to serve an ordinary sidebar request.
- Browser-supplied paths never become a Pi `cwd` or file target until the
  server resolves them against its allowlists; fail closed on symlinks and
  malformed input. Attachment publishing stays atomic (`.part` + rename).
- Do not set `PI_CODING_AGENT_SESSION_DIR`, pass `--session-dir`, or generate
  Pi config inside working trees. Associate sessions with projects by the
  canonical `cwd` in each JSONL header, never the lossy encoded directory name.
- Keep Isolated Pi and Host Pi scopes separate: runtime-aware model APIs must
  never expose one installation's models or settings to the other's chats.
- Isolated and Host Pi must stay compatible at their shared RPC contract. Check
  protocol changes against the locally pinned
  `@earendil-works/pi-coding-agent` version, not against upstream docs.
- Destructive operations (chat/project delete, process stop before delete)
  require interface confirmation and must stop matching live processes first.
- Auth is one choke point plus the WS upgrade
  (`conduit-web/src/auth-middleware.js`; mechanism in `conduit-web/README.md`).
  Never add a route, static asset, or upload handler before or outside
  `requireAuth`. Never extend the unauthenticated allowlist beyond `GET /login`,
  `POST /v0/auth/login`, and `GET /healthz`. WebSocket upgrades validate the
  session cookie before `handleUpgrade` and destroy the socket otherwise. Never
  relax the non-loopback password requirement or reach for
  `CONDUIT_ALLOW_INSECURE=1` to make a bind succeed.
- Browser-managed Pi credentials are a separate authenticated surface: they
  operate only on the bundled Isolated Pi `auth.json`, never Host Pi, and must
  not expose OAuth URLs, device codes, or credentials across Conduit sessions.
- Never commit `.env*` (except sanitized examples), `data/`, credentials, logs,
  `dist/`, or `node_modules/`. Treat Pi extensions, skills, and template tool
  lists as trusted executable configuration; review them before adding them to
  a template.

## Interface

Assistant Markdown renders only through `src/client/chat/markdown.tsx` using
Marked, DOMPurify, and the KaTeX extension; user prompts remain literal text.
Do not introduce a parallel Markdown parser, and do not introduce parallel
command or tool registries: tool names are data, and generic tool cards must
remain useful for unknown tools. `@kobalte/core` is the only
accessibility-primitive dependency — do not add a component library. New
surface features should be reachable from the typed Cmd/Ctrl+K palette when
that improves keyboard access.

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

## Testing guidance

Before testing or reviewing the server, web UI, local server, candidate build,
release artifact or VPS deployment, read `docs/operations/testing.md`. It is
the single reference for approach selection, commands, safety boundaries and
evidence.

### Shared component workflow

Conduit is the integration and visual-development host for the sibling
`solid-components` repository. For component work:

- Run `bash .devcontainer/solid-components.sh dev` to edit package source with
  Conduit HMR at port 5173. Never copy package implementation into Conduit,
  edit `node_modules`, or change the locked dependency during iteration.
- Before returning a source monkey patch for manual interaction, run
  `bash .devcontainer/solid-components.sh serve` so the production client and
  backend are both served from Conduit's standard port 4310.
- Diagnose with the smallest deterministic package or consumer check. Let the
  user perform subjective interaction or provide a performance trace;
  do not initiate broad exploratory Playwright or performance runs unless
  requested.
- Combine related component changes into one clean committed package candidate,
  then run `bash .devcontainer/solid-components.sh preview` to serve its packed
  artifact at port 4310. User approval seals that commit and payload.
- After approval, make no implementation edits. Run
  `bash .devcontainer/solid-components.sh promote <patch|minor|major>` to
  publish and adopt the exact approved payload. Leave Conduit's manifest and
  lockfile changes uncommitted until the complete Conduit suite passes.
- Local component modes are managed state. Inspect them with `status`, leave
  them with `registry`, and never run setup, build, restart, or deploy around
  the workbench command.

## Style

ES modules, two-space indent, semicolons, double quotes; `camelCase`
functions, `PascalCase` components, kebab-case filenames. Client code is strict
TypeScript and must not add React production dependencies. Configuration lives
in env vars documented by `conduit-web/.env.example`. No repo-wide formatter:
avoid formatting changes unrelated to the task.

## Commits and pull requests

Short, imperative, sentence-case subjects; one coherent change per commit.
Every non-trivial commit also needs a body stating the failure mode or
motivation, the key invariant or behavioural change, and verification
performed; do not merely restate the diff. Current code and current-state
documentation describe the app as it is now; commit bodies are the durable
record of why a change was made — retrieve them with `git log
--format='%H%n%B%n---' <range>`, since `--oneline` drops exactly that record.

Sequential commits on `main` are the normal development flow. Close a related
run with a natural final commit (for example deleting its temporary review
queue) whose body records the included range, outcomes, verification, and
intentional deferrals; when there is no natural final commit, use an annotated
`sprint/` tag carrying that summary instead. PRs are optional review bundles,
not the canonical history.

## Pi research

For Pi design or API questions, use DeepWiki against `earendil-works/pi` — not
`earendil-works/pi-coding-agent`. If a request fails because the repository or
query is wrong, correct it and retry rather than abandoning the lookup. DeepWiki
describes upstream HEAD: verify anything it tells you against the locally pinned
`0.80.6` packages before acting on it.
