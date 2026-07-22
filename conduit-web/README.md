# Conduit Web

The Conduit web surface combines an Express server, server-owned Pi RPC
processes, and a strict TypeScript SolidJS/Vite client.

## Run

```bash
npm ci
npm test
npm run build
cd ..
bash .devcontainer/start-conduit.sh restart
```

Open <http://127.0.0.1:4310>. Authenticate the isolated Pi runtime from the
repository root with `./scripts/conduit-pi.mjs`, then enter `/login`.

For client development, keep the managed server running and start Vite from
this directory:

```bash
npm run dev
```

## Runtime model

The reserved `chat` project uses `data/chat/files` as its working directory.
Named projects use direct children such as `data/chat/files/example`. Project
metadata lives centrally in ignored `data/conduit.json`; working directories
also contain `.conduit/chats/<chat-id>/{attachments,.partial}`. Pi runs from the
project root and native JSONL remains outside the working tree. Ignored
`data/sessions.json` holds the atomic lightweight Conduit chat registry. Draft
chats exist before Pi; the first message attaches a private Pi mapping and makes
the same public chat ID active. Active mappings are checkpointed after completed
responses and explicit mutations and reconciled with native files at startup.

Raw attachment bodies stream to exclusive `.part` files and publish by atomic
rename. The filesystem is the durable attachment registry. Prompt envelopes
contain validated relative paths rather than file bytes. Generation IDs gate
late output after stop; Pi receives public `abort` and `fork` RPC commands, and
a hung abort terminates the process after 250 ms for clean resumption.

The interface keeps uploaded Attachment cards above the bounded native
textarea until send, then renders the same cards beneath their user message.
Persisted image cards use the attachment preview route, including when restored
for edit. The compact composer model menu remains separate from Settings'
searchable multi-model picker. Cmd/Ctrl+K opens the typed application command
palette. Root lists concrete app actions and models; Settings… and Go to… are
drill-down pages with search prefixes
(`Settings ›`, `Go to ›`) so sections and chats do not flood the root list.
Cmd/Ctrl+Shift+O opens Go to mode directly; Cmd/Ctrl+Shift+C starts a new chat.
The composer slash Popover contains only `/attach`. A project-aware breadcrumb
identifies where each chat belongs.

Every Isolated Pi profile process receives:

- `PI_CODING_AGENT_DIR=data/pi`;
- the selected project directory as `cwd`;
- resources from the chat's sticky profile (`templates/<id>/template.json`) as
  explicit CLI arguments.

No session-directory override is supplied. Pi writes native JSONL sessions to
`data/pi/sessions/<encoded-cwd>/`, and Conduit verifies each JSONL header's `cwd`
when associating sessions with projects.

Host Pi Workspace processes instead use the detected absolute host executable,
login-shell environment and effective Pi home/configuration, the Workspace as `cwd`, and only the
additive Conduit attachment bridge. They never receive `PI_CODING_AGENT_DIR`, a
tracked profile, Conduit model scope, or tool allow-list. Conduit validates Host
Pi project-resource paths, automatically persists trust for each registered
Workspace at launch, and reports the active process posture in the chat header.
One `PiManager` owns both launch forms and enforces shared writer and process
limits. Workspace creation immediately opens a draft using the app default or
that Workspace's explicit override; the
composer exposes ordinary profiles and a synthetic Host Pi choice. Host project
trust is persisted on first launch, and the launch form becomes immutable when Pi
first starts. Host trust covers Pi project resources such as `.pi` and `.agents`;
ordinary files and Conduit attachments are unaffected.

JSONL remains authoritative for persisted messages, tool calls, model changes,
and thinking-level changes. Opening a chat reconstructs that state from its
entries. Selecting a model updates the active process and Pi's shared
`defaultModel`; a new chat starts with that saved model while an existing chat
retains its recorded model.

## Client composition

The Solid client has three state owners: the catalogue store owns projects and
selection, the runtime store owns the global SSE process map, and the active-chat
store owns one transcript, WebSocket, generation state, queue, and host UI.
Model settings and attachments are narrow helpers. Components consume those
stores directly; there is no compatibility layer or parallel client runtime.

The concrete icon-collapsible sidebar separates first-class Chats, Projects,
and Workspaces. Draft chats stay out of navigation until their first message
creates a session. Kobalte provides accessible menu and context-menu behavior;
the surrounding sidebar, composer, transcript, command palette, and Settings
surfaces are direct Solid components rather than a copied component catalogue.
Settings → Workspaces stores global-profile inheritance, an explicit ordinary
profile, or Host Pi. If Host Pi becomes unavailable, Conduit clears that
override and retries with the inherited profile.

Assistant messages pass through `src/client/chat/markdown.tsx`. Marked parses
GFM and fenced code, the KaTeX extension renders math, and DOMPurify enforces the
client boundary. The renderer is lazy-loaded, strips remote images and unsafe
URLs, requires confirmation for external links, and keeps user messages literal.
Live deltas are coalesced into one Solid signal update per animation frame. The
canonical Markdown document is parsed and sanitized, then reconciled into the
existing DOM so semantic nodes remain stable while unfinished syntax takes
shape and through durable checkpoint reconciliation. Tool calls use one
generic disclosure card with lifecycle status, deterministic summaries, lazy
deferred results, and bounded previews; tools are data, not component registry
keys.

The single-line composer owns runtime-aware model and thinking controls. Isolated
Pi reads `data/pi`; Host Pi reads its detected agent home and reconciles against
the live process through `get_available_models` and `get_state`. A selection is
sent through correlated RPC and saved as that installation's next-chat default.
Opening a persisted session restores JSONL state and does not pass model flags
that could replace it.

## Runtime API

### Auth

Every route below — plus the SPA bundle, every static asset, every upload, and
every WebSocket upgrade — requires an authenticated session except the login flow.
Provision one user, one password from the CLI:

```bash
node scripts/conduit-auth.mjs set-password     # hidden prompt, twice
node scripts/conduit-auth.mjs reset-sessions   # sign out every device
node scripts/conduit-auth.mjs status           # password set? session count?
```

Credentials live in `data/auth.json` (mode `0600`, atomic writes). Tokens are
32-byte `crypto.randomBytes`, sent to the browser raw as the `conduit_session`
cookie (`HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS/X-Forwarded-Proto),
30-day rolling expiry, capped at 20 stored sessions. The hashed session row
(SHA-256) is the only thing persisted server-side.

Enforcement is a single `requireAuth` middleware mounted before every other
route and static handler, plus the WebSocket upgrade validator. The allowlist
is just `GET /login`, `POST /v0/auth/login`, and `GET /healthz`. Logout
(`POST /v0/auth/logout`) requires a valid session like any other route. Loopback
binding without a configured password stays open for local dev; non-loopback
binding refuses to start without a password or `CONDUIT_ALLOW_INSECURE=1`.
Per-IP rate limiting is meaningless behind a tunnel, so `POST /v0/auth/login`
applies a global cap: after five failures the next attempt is rejected with
exponential backoff (5 s → 5 min); scrypt compare runs even on throttled paths
so timing reveals nothing.

- `GET /login` — server-rendered HTML form, no SPA code
- `POST /v0/auth/login` — accepts `application/json` (SPA fetch) or
  `application/x-www-form-urlencoded` (plain form POST); on success issues the
  cookie and returns `303 → after` (form) or `{ ok, redirect }` (JSON). Wrong
  password re-renders the page with an inline error (form) or returns `401`
  JSON (fetch).
- `POST /v0/auth/logout` — clears the current session row and cookie
- `GET /v0/auth/status` — `{ hasPassword, authenticated, sessionCount }`
- `POST /v0/auth/reset-sessions` — keeps the caller's token, signs out everyone
  else

### Application routes

- `GET /healthz`
- `GET /v0/capabilities`
- `POST /v0/chats`
- `GET|DELETE /v0/chats/:id` (draft cleanup requires `?ifEmpty=true`)
- `PUT|GET /v0/chats/:id/attachments/:attachment-id` uploads raw bytes or downloads;
  `?preview=1` serves supported raster images inline
- `GET /v0/chats/:id/attachments`
- `DELETE /v0/chats/:id/attachments/:attachment-id`
- `GET|POST /v0/projects`
- `PATCH|DELETE /v0/projects/:id`
- `POST /v0/projects/:id/move-sessions`
- `GET /v0/workspaces/policy` returns the server-owned linked-workspace roots
- `GET /v0/workspaces/suggestions` returns visible direct folders under `~/`
- `GET /v0/workspaces/:id/native-preflight` reports derived host trust/resource status
- `GET /v0/pi-installations` lists safe installation/version status
- `POST /v0/pi-installations/host/detect` re-detects the host Pi executable
- `POST /v0/runtime/chats` creates a fresh special Runtime management chat
- `GET /v0/models`
- `GET|PATCH /v0/settings` reads and updates Pi's shared global model scope;
  terminal and web saves use the same isolated settings file.
- `GET|PATCH /v0/chats/:id/models` resolves the selected installation's scoped
  models and changes the draft/live chat model through the server-owned runtime.
- `GET|PATCH|DELETE /v0/sessions/:id`
- `GET /v0/sessions/:id?before=<entry-index>` returns a ten-turn transcript page
- `GET /v0/sessions/:id/transcript`
- `GET /v0/sessions/:id/tools/:tool-id` fetches deferred large tool output
- `POST /v0/sessions/:id/duplicate` returns `409` while chat-file ownership is deferred
- `POST /v0/sessions/:id/move`
- `GET|POST /v0/live-sessions`
- `GET /v0/live-sessions/:id/snapshot`
- `DELETE /v0/live-sessions/:id/process`
- `WS /v0/live-sessions/:id/stream`
- `GET /v0/runtime` returns the current global live-process snapshot
- `GET /v0/runtime/stream` (SSE) pushes snapshot-first global process updates
- `GET /v0/runtime/settings` and `PATCH /v0/runtime/settings` read/update max warm processes, max concurrent generations, and idle reclaim TTL (`data/runtime.json`, env defaults)

## Global runtime channel

`GET /v0/runtime/stream` is a server-to-browser SSE channel for application-wide
process residency and coarse activity. It does not carry transcript token
deltas. On connect the server writes one `runtime_global_snapshot` with every
live process view, then low-frequency `runtime_process` and
`runtime_process_removed` events. Reconnect always starts with a fresh snapshot.

Each public process view includes safe client-facing fields only: `id`,
`chatId`, `projectId`, `status`, `active`, `activity`, `activityDetail`,
`stopping`, queue lengths via `queue`, `hostUiRequests`, `contextUsage`,
`runtime`, `binaryVersion`, `trustPosture`, `updatedAt`, and `clientCount`. The durable Conduit chat id is the public row
key; the live process id is disposable.

Coarse `activity` values: `idle`, `starting`, `working`, `waiting_for_user`,
`retrying`, `compacting`, `stopping`, `failed`. Fine activity (thinking,
tool name, responding) is derived on the selected-chat client from the
per-chat WebSocket stream.

Process residency: the server owns Pi processes. Browser disconnect does not
stop them. Opening an active chat starts or reuses one process per chat. A
configurable warm-pool cap (default 12) reclaims the oldest idle unattached
process when full; otherwise create returns 429 `live_process_limit`. Concurrent
agent loops are limited separately (default 2): starting a new generation at the
cap returns 429 `generation_limit` without killing warm processes. Unattached
idle processes are stopped after the idle TTL (default 2 minutes). Transcripts
remain on disk and resume on the next open.

Context usage is synthesized by Conduit: after `agent_end` / `compaction_end`
(and on selected-chat reconnect) the server calls Pi `get_session_stats` and
emits a Conduit `context_usage` event. Null tokens/percent mean unknown, not
zero.

## Live session protocol

`WS /v0/live-sessions/:id/stream` carries newline-free JSON objects in both
directions. This is the v0 event vocabulary: Pi JSONL remains the authoritative
record, the rendered transcript is a projection of it, and changes to this
vocabulary are additive and must update this section in the same change.

Client commands:

| Command | Fields | Effect |
|---|---|---|
| `prompt` | `message`, `attachmentIds[]`, optional `streamingBehavior` (`steer` \| `followUp`) | Send a user prompt in the strict attachment envelope after Pi accepts it |
| `follow_up` / `steer` | `message`, `attachmentIds[]` | Queue mid-run follow-up or steering input |
| `stop_generation` / `abort` | `generationId` | Close the generation gate, then ask Pi to abort |
| `fork_and_prompt` | `entryId`, `message`, `attachmentIds[]` | Fork history at an entry, then prompt |
| `regenerate` | `entryId` | Fork at an entry and resend its recorded prompt |
| `continue` | — | Experimental hidden-prompt continuation of a stopped response |
| `extension_ui_response` / `host_ui_response` | `id`, `confirmed` \| `value` \| `cancelled` | Answer a blocking extension UI request |
| `refresh_context` | — | Request a context-usage refresh via Pi session stats |

Any other object is forwarded verbatim to Pi's RPC stdin. A failed command
produces `client_error` with `code` and `message`.

Server events. On connect the server sends one `runtime_snapshot` containing
the session view, the accumulated `stream` content for any open generation
(`{ generationId, content }` or `null`), the current turn's replayable events,
plus `hostUiRequests`, `queue`, and `contextUsage` when known; individual
`assistant_stream_delta` events are never replayed.
Conduit-origin events thereafter:

| Event | Fields | Meaning |
|---|---|---|
| `runtime_state` | `session` | Process/session status changed |
| `generation_started` | `generationId`, `continuation` | A response began; deltas follow |
| `assistant_stream_delta` | `generationId`, `delta` | Raw assistant text delta, relayed unthrottled |
| `assistant_stream_final` | `generationId`, `message`, `content`, optional `usage` | Canonical completed message text |
| `generation_stopped` | `generationId`, `status`, `processTerminated` | Stop completed; late output was gated |
| `context_usage` | `contextUsage` | Synthesized context window usage (nullable tokens/percent) |
| `extension_ui_resolved` | `requestId` | A host-UI request was answered |
| `session_checkpoint` | `chat` | Registry row checkpointed after a completed response |
| `history_forked` | `chat` | The chat advanced to a forked native session |
| `runtime_stderr` / `runtime_stdout` | `message` | Non-JSON process output |
| `runtime_error` | `message` | Process or rendering failure |
| `runtime_exit` | `code`, `signal` | The Pi process exited |
| `client_error` | `code`, `message` | A client command failed |

Pi RPC events that Conduit does not transform (`agent_start`, `agent_end`,
`message_end`, `tool_execution_start`, `tool_execution_update`,
`tool_execution_end`, `queue_update`, `compaction_start`, `compaction_end`,
`auto_retry_start`, `auto_retry_end`, `extension_ui_request`, `response`, …)
are relayed as-is; during a generation every relayed event is stamped with the
active `generationId`, and events for a closed generation are suppressed at
the source.

## Verification

```bash
npm test
npm run test:browser
npm run build
```

Browser tests mock the API for deterministic desktop and mobile coverage and
write screenshots and traces under `test-results/` only when a test fails.
