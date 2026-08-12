# Conduit Web

The Conduit web surface combines an Express server, server-owned Pi RPC
processes, and a strict TypeScript SolidJS/Vite client.

## Run

```bash
cd ..
bash .devcontainer/start-conduit.sh setup
node scripts/conduit-auth.mjs set-password
bash .devcontainer/start-conduit.sh restart
```

Open <http://127.0.0.1:4310>, sign in, then use **Settings → Auth** to
authenticate the Isolated Pi runtime. `../scripts/conduit-pi.mjs` remains an
optional terminal launcher.

For client development, use the managed watcher and Vite pair:

```bash
bash .devcontainer/start-conduit.sh dev
```

This runs the server on 4310 and Vite with hot reload on 5173. `setup`,
`build`, `start`, `stop`, `status`, `logs`, and `deploy` share the same managed
launcher.

The production container sets `CONDUIT_DATA_ROOT=/data`, serves the compiled
client from its read-only image, and mounts durable data and the portable
`/workspaces` namespace from the host. See
[`../docs/operations/deployment.md`](../docs/operations/deployment.md)
for the Compose, release, ownership, backup, and Native Pi boundary contracts.

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
Pi records each fork's `parentSession`; startup uses that family to keep
superseded regeneration branches attached to one sidebar chat while preserving
their JSONL files.

Raw attachment bodies stream to exclusive `.part` files and publish by atomic
rename. Each upload is capped by `CONDUIT_MAX_ATTACHMENT_BYTES` (100 MiB by
default), including chunked requests. The filesystem is the durable attachment
registry. Prompt envelopes contain validated relative paths rather than file
bytes. Generation IDs gate
late output after stop; Pi receives public `abort` and `fork` RPC commands, and
a hung abort terminates the process after 250 ms for clean resumption.

The interface keeps uploaded Attachment cards above the bounded native
textarea until send, then renders the same cards beneath their user message.
Persisted image cards use the attachment preview route, including when restored
for edit. The compact composer model menu remains separate from Settings'
searchable multi-model picker. Cmd/Ctrl+K opens the typed application command
palette. Root lists concrete app actions and models; Settings…, Search chats…,
and Workspace views… are drill-down pages with search prefixes
(`Settings ›`, `Search ›`, `Workspace ›`) so sections, chats, and panel tabs do
not flood the root list. Cmd/Ctrl+P opens Chat search directly and prevents the
browser print shortcut while the page has focus. The legacy Cmd/Ctrl+Shift+O
shortcut opens the same chat mode as a compatibility alias. Chat search accepts
`scope:chats`, `scope:all`, and quoted `in:<folder-or-workspace>` filters; View
all chats pre-applies `scope:chats` in the same surface. Empty-query Backspace
removes a filter before it can change palette level; Escape returns to the root
palette or closes a direct launch. Tab enters a highlighted drill-down page.

Chat search matches chat titles and their owning folder or Workspace. It shows
creation dates, includes the current chat, and supports Cmd/Ctrl+E selection
mode. Selection mode supports Space, R (rename), M (move), C (copy links), and
D/Delete (confirmed delete). The sidebar's Chats group shows 20 rows by
default; Settings → UI stores an integer limit from 5 to 100, and View all
chats opens a Chats-scoped search for older rows. A folder or Workspace can
remain collapsed even when it contains the active chat; Search chats remains
the route to that session. Existing generation indicators stay unchanged.
Search and management use the
same palette shell so later file, artifact, and host search domains can add
rows and previews without a second dialog.

Cmd/Ctrl+Shift+C starts a new chat.
The composer slash Popover contains only `/attach`. A project-aware breadcrumb
identifies where each chat belongs.

The chat header, Cmd/Ctrl+., and Workspace views… open a per-chat Workspace
panel. Files and Source Control are read-only: the lazy directory API hides
`.conduit`, rejects symlinks and traversal, and caps text previews at 1 MiB;
Git controls only refresh and copy branch/commit IDs. Terminal is available for
every chat, starts at the validated Workspace root for Workspace chats and the
server home directory otherwise, and remains server-owned after the browser
leaves its tab.

Every Isolated Pi profile process receives:

- `PI_CODING_AGENT_DIR=$CONDUIT_DATA_ROOT/pi`, except a web-search-enabled
  isolated process with a model-aware overlay, which uses
  `$CONDUIT_DATA_ROOT/pi/model-profiles/<profile-id>`;
- the selected project directory as `cwd`;
- resources from the chat's sticky profile (`templates/<id>/template.json`) as
  explicit CLI arguments.

No session-directory override is supplied. The model-profile directory links
to canonical Pi auth and model files; it contains only derived web-search
routing. Pi writes native JSONL sessions to
`$CONDUIT_DATA_ROOT/pi/sessions/<encoded-cwd>/`, and Conduit verifies each JSONL
header's `cwd` when associating sessions with projects.

Host Pi Workspace processes instead use the detected absolute host executable,
login-shell environment and effective Pi home/configuration, the Workspace as `cwd`, and only the
additive Conduit attachment bridge. They never receive `PI_CODING_AGENT_DIR`, a
tracked profile, Conduit model scope, or tool allow-list. Conduit validates Host
Pi project-resource paths, automatically persists trust for each registered
Workspace at launch, and reports the active process posture in the chat header.
Validation rejects symlinks and resource trees over 10,000 entries or 100 MiB;
it traverses filesystem metadata without reading or hashing file contents.
One `PiManager` owns both launch forms and enforces shared writer and process
limits. Ready Workspace creation immediately opens a draft using the app
default or that Workspace's explicit override; a cloning Workspace cannot
create chats, terminals, inspections, or runtime changes until it is ready. The
composer exposes ordinary profiles and a synthetic Host Pi choice. Host project
trust is persisted on first launch, and the launch form becomes immutable when Pi
first starts. Host trust covers Pi project resources such as `.pi` and `.agents`;
ordinary files and Conduit attachments are unaffected.

JSONL remains authoritative for persisted messages, tool calls, model changes,
and thinking-level changes. Opening a chat reconstructs that state from its
entries through an append-aware index: ordinary transcript requests read only
the requested turn window, incomplete final writes are ignored, and file
replacement or truncation invalidates cached offsets. Selecting a model updates
the active process and Pi's shared `defaultModel`; a new chat starts with that
saved model while an existing chat retains its recorded model. For
web-search-enabled profiles, changing between different model profiles restarts
an idle process against the same session file; the server rejects that change
during generation. Changing within one model profile stays live. Pi has one active thinking level, so
Conduit stores the last valid level for each model on the stable chat record and
reapplies it when that model is selected. The selected transcript response
seeds the composer's model and thinking level immediately; one runtime-aware
chat-model request supplies its catalogue and reconciles resident process state
without a second post-WebSocket reload.

## Client composition

The Solid client has three state owners: the catalogue store owns projects and
selection, the runtime store owns the global SSE process map, and the active-chat
store owns one transcript, WebSocket, generation state, queue, and host UI.
Model settings and attachments are narrow helpers. Components consume those
stores directly; there is no compatibility layer or parallel client runtime.

The ambient chat meteor field is `DefaultMeteorShower` from the public
[`@jask-aran/solid-components`](https://www.npmjs.com/package/@jask-aran/solid-components)
package. Its source of truth is
[`jask-aran/solid-components`](https://github.com/jask-aran/solid-components):
version tags there are released to npm, and Conduit consumes the versioned npm
artifact rather than a copied renderer.

The concrete icon-collapsible sidebar separates first-class Chats, Projects,
and Workspaces. Draft chats stay out of navigation until their first message
creates a session. The Chats group is bounded to a user-selected recent window
and provides a palette-backed View all chats action; selecting a chat from the
palette expands its collapsed owning folder and scrolls it into view. Kobalte
provides accessible menu and context-menu behavior;
the surrounding sidebar, composer, transcript, command palette, and Settings
surfaces are direct Solid components rather than a copied component catalogue.
Transcript history loads automatically as the reader approaches the top and
preserves the visible scroll anchor; server cursors and history windows are not
exposed as pagination controls. Direct chat routes fetch catalogue context and
the selected transcript concurrently; capabilities, profiles, and installation
status load independently, while workspace-path suggestions are requested only
when workspace creation opens.
Settings → Workspaces stores global-profile inheritance, an explicit ordinary
profile, or Host Pi. If Host Pi becomes unavailable, Conduit clears that
override and retries with the inherited profile.

Assistant messages pass through `src/client/chat/markdown.tsx`. Settings → UI
exposes five selectable Markdown renderers: Marked Stable, Marked Experimental,
Immediate Stable, Typewriter Stable, and Synthetic Experimental. New users use
Synthetic Experimental by default. Marked Stable is the basic historical
reference; the three Incremark modes share the parser, table projection, layout,
reconciliation, security boundary, and final-content path. Typewriter adds the
adaptive display queue, and Synthetic adds eager provisional KaTeX previews.
The renderer is lazy-loaded, strips remote images and unsafe URLs, requires
confirmation for external links, and keeps user messages literal. Live deltas
are coalesced into one Solid signal update per animation frame. The canonical
Markdown document is parsed and sanitized, then reconciled into the existing
DOM so semantic nodes remain stable while unfinished syntax takes shape and
through durable checkpoint reconciliation. Tool calls use one generic
disclosure card with lifecycle status, deterministic summaries, lazy deferred
results, and bounded previews; tools are data, not component registry keys.

The single-line composer owns runtime-aware model and thinking controls. A
permanent TUI-like status line below it shows fine agent activity, context usage,
and queued-message count without displacing composer controls. Isolated Pi reads
canonical `data/pi` state, with the selected profile's derived web-search overlay
selected at launch; Host Pi reads its detected agent home and reconciles against the live
process through `get_available_models` and `get_state`. A selection is
sent through correlated RPC and saved as that installation's next-chat default.
Opening a persisted session restores JSONL state and does not pass model flags
that could replace it.

## Runtime API

### Auth

Every route below — plus the SPA bundle, every static asset, every upload, and
every WebSocket upgrade — requires an authenticated session except the login
flow, `GET /healthz`, and the public PWA bootstrap assets (`favicon.svg`, PWA
icons, manifests, service workers, and Workbox assets).
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
is `GET /login`, `POST /v0/auth/login`, `GET /healthz`, and the PWA bootstrap
assets required before the application session exists. Logout
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

### Isolated Pi authentication

Settings → Auth manages credentials only in the bundled Isolated Pi runtime's
`data/pi/auth.json`; Host Pi credentials and its environment are never read or
changed. This surface requires an authenticated Conduit session, even when
passwordless loopback development otherwise serves the app. OAuth attempts are
in-memory, owned by their initiating session, expire after ten minutes, and do
not reveal URLs, codes, or prompts to other sessions. API-key values are stored
as literal Pi credentials and never returned by the API.

Credential changes stop only idle, unattached Isolated Pi processes; active,
starting, and browser-attached processes remain resident.

- `GET /v0/pi-auth` — redacted Isolated Pi provider status
- `GET /v0/pi-auth/attempt` — caller-owned OAuth attempt state
- `POST /v0/pi-auth/oauth`, `/v0/pi-auth/attempt/respond`, and
  `/v0/pi-auth/attempt/cancel` — OAuth/device-code actions
- `PUT /v0/pi-auth/api-key`, `DELETE /v0/pi-auth/:providerId` — store or remove
  an Isolated Pi credential

### Application routes

- `GET /healthz`
- `GET /v0/capabilities`
- `GET /v0/share-origin` resolves the current host's MagicDNS HTTPS origin from
  the local Tailscale CLI; the client appends the selected chat path before
  copying it.
- `POST /v0/chats`
- `GET|DELETE /v0/chats/:id` (draft cleanup requires `?ifEmpty=true`)
- `PUT|GET /v0/chats/:id/attachments/:attachment-id` uploads raw bytes or downloads;
  `?preview=1` serves supported raster images inline
- `GET /v0/chats/:id/attachments`
- `DELETE /v0/chats/:id/attachments/:attachment-id`
- `GET|POST /v0/projects`
- `PATCH|DELETE /v0/projects/:id`; `DELETE` with
  `{ mode: "destroy_workspace", confirmation: "<exact Workspace name>" }`
  permanently removes a Workspace's validated folder, while ordinary delete
  remains unlink-only for external Workspaces
- `GET /v0/projects/:id/dashboard` returns project identity, lightweight chat
  and live-process stats, up to ten recent active chats, and bounded Git
  overview data for Workspaces. It does not walk the working tree for disk
  usage or read every transcript.
- `GET /v0/projects/:id/tree?path=…` lists one validated directory level,
  returning a bounded selection of at most 500 visible entries in
  directory-first/name order plus `truncated: true` when additional visible
  entries exist; `.conduit` and symlinks are excluded before applying the bound
- `GET /v0/projects/:id/file?path=…` returns a size-capped text preview
- `GET /v0/projects/:id/diff` returns bounded Git status; `?patch=1&reuse=1` reuses the short-lived status inspection and additionally returns staged/unstaged unified diff after the patch disclosure opens
- `POST /v0/projects/:id/move-sessions`
- `GET /v0/workspaces/policy` returns the server-owned allowlist, default
  Workspace parent, and input-safe default path
- `GET /v0/workspaces/suggestions` returns visible direct folders under the
  configured suggestion root, using `~` only for paths under the native home
- `GET /v0/workspaces/:id/native-preflight` reports derived host trust/resource status
- `GET /v0/pi-installations` lists safe installation/version status
- `POST /v0/pi-installations/host/detect` re-detects the host Pi executable
- `POST /v0/runtime/chats` creates a fresh special Runtime management chat
- `GET /v0/models`
- `GET|PATCH /v0/settings` reads and updates Pi's shared global model scope;
  terminal and web saves use the same isolated settings file.
- `GET|PATCH /v0/chats/:id/models` resolves the selected installation's scoped
  models and changes the draft/live chat model through the server-owned runtime.
- `GET|PATCH|DELETE /v0/sessions/:id` (`DELETE` removes the session's complete in-project Pi fork family)
- `GET /v0/sessions/:id?before=<entry-index>` returns a ten-turn transcript page
- `GET /v0/sessions/:id/transcript`
- `GET /v0/sessions/:id/tools/:tool-id` fetches deferred large tool output
- `POST /v0/sessions/:id/duplicate` returns `409` while chat-file ownership is deferred
- `POST /v0/sessions/:id/move`
- `GET|POST /v0/live-sessions`
- `GET /v0/live-sessions/:id/snapshot`
- `DELETE /v0/live-sessions/:id/process`
- `WS /v0/live-sessions/:id/stream`
- `GET|POST /v0/ptys` lists or creates a shell for a chat project
- `POST /v0/ptys/:id/rename` and `DELETE /v0/ptys/:id` rename or stop/remove it
- `WS /v0/ptys/:id/attach` attaches a terminal renderer
- `POST /v0/workspaces/preview` validates and resolves a link or create-folder
  target without mutating the filesystem
- `POST /v0/projects` accepts `linked`, `created`, and `cloned` Workspace
  modes; created Workspaces take an existing parent `path` plus a single
  `directoryName` and are never deleted on unlink; clone returns `202` with a
  durable provisional `cloning` Workspace plus an operation id. GitHub clone
  sources accept `owner/repository` shorthand as well as standard Git URLs;
  `gh` is preferred and Git falls back with real transfer progress enabled.
- `GET|DELETE /v0/workspace-operations/:id` reads a bounded clone diagnostic
  or explicitly cancels a live clone operation; cancellation removes only
  Conduit staging and the unpublished provisional row
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

The rendering migration's structured protocol lives in
`src/pi-event-normalizer.js` and `src/active-generation.js`. It assigns
generation-local assistant-message identities, preserves native
`contentIndex`/block order and `toolCallId`, reduces sequenced events into a
serializable Active Generation, and derives Interim Text classification solely
from tool structure and `stopReason`. `PiManager` maintains this state alongside
the bounded diagnostic event ring. The client reduces structured events into
its Live Response projection; persistence confirmation does not reconstruct
the live response.

Slow WebSocket clients recover from fresh Resume State, the current runtime
snapshot, and the latest checkpoint rather than a replay queue. While paused,
generation, tool, runtime, queue, and host-UI updates are discarded as
reconstructible; only non-reconstructible diagnostic/notification events are retained in a
coalesced 32-item/64 KiB budget, after which Conduit closes the socket with
code 1013.

Client commands:

| Command | Fields | Effect |
|---|---|---|
| `prompt` | `message`, `attachmentIds[]`, optional `streamingBehavior` (`steer` \| `followUp`) | Send a user prompt in the strict attachment envelope after Pi accepts it |
| `follow_up` / `steer` | `message`, `attachmentIds[]` | Queue mid-run follow-up or steering input |
| `stop_generation` / `abort` | `generationId` | Close the generation gate, then ask Pi to abort |
| `fork_and_prompt` | `entryId`, `message`, `attachmentIds[]`, optional `model`, `thinkingLevel` | Fork history at an entry, apply the composer selection, then prompt |
| `regenerate` | `entryId`, optional `model`, `thinkingLevel` | Fork at an entry, apply the composer selection, then resend its recorded prompt |
| `continue` | — | Experimental hidden-prompt continuation of a stopped response |
| `extension_ui_response` / `host_ui_response` | `id`, `confirmed` \| `value` \| `cancelled` | Answer a blocking extension UI request |
| `refresh_context` | — | Request a context-usage refresh via Pi session stats |

Any other object is forwarded verbatim to Pi's RPC stdin. A failed command
produces `client_error` with `code` and `message`.

## Workspace terminal protocol

Terminal processes are server-owned `node-pty` shells. The server derives their
cwd: a validated Workspace root for Workspace chats, otherwise Conduit's home
directory. The browser supplies only a project id and cannot select a path.
Their lightweight records persist in
`data/remotes.json`; the shell itself does not survive a server restart. The
browser may detach without stopping it, and the server retains a 256 KiB output
tail for a later attachment.

`WS /v0/ptys/:id/attach` is authenticated like every other upgrade. Binary client
frames are stdin bytes, and client JSON frames are `{ "type": "resize", "cols",
"rows" }`. On attach, the server sends `replay_start` with a `complete` flag,
then an optional binary replay frame prefixed with `CONDUIT-PTY-REPLAY/1\n`, and
then `replay_end`, `status`, and `control` frames. A complete replay payload is
an array of `{ "type": "resize", "cols", "rows" }` and `{ "type": "data",
"data": "<base64>" }` events. The server skips replay when the bounded journal
is incomplete. `control.writable` identifies the one attached browser that may
send input and resize; other browsers receive output but get `client_error` with
`pty_read_only`. The browser owns VT parsing and rendering, while Conduit only
brokers process I/O and applies the same slow-client protection as other live
connections.

Server events. When a generation is open, connect first sends one
`generation_resume` containing the complete current reduced generation and its
last applied sequence. It then sends `runtime_state` containing the session
view plus `hostUiRequests`, `queue`, and `contextUsage` when known. Structured
events are independent of the capped diagnostic event ring.
Delivery coalesces same-block deltas briefly per socket and flushes before
message, tool, stop, error, and settlement boundaries. A socket above the
256 KiB high-water mark stops receiving superseded deltas; when its buffer
drains, Conduit sends current `generation_resume` before any queued boundaries
and continues delivery.
Conduit-origin events thereafter:

| Event | Fields | Meaning |
|---|---|---|
| `generation_resume` | `generationId`, `seq`, `generation` | Complete current Active Generation sent on attachment; later structured events with `seq <= generation.lastSeq` are duplicates |
| `runtime_state` | `session` | Process/session status changed |
| `generation_started` | `generationId`, `seq`, `continuation`, `continuationBase` | A response began; continuation text remains part of the structured projection |
| `generation_running` / `generation_stopping` / `generation_settled` | `generationId`, `seq` | Structured generation lifecycle transition |
| `assistant_message_started` | `generationId`, `seq`, `messageId` | Server assigned a stable identity to a native assistant message |
| `content_block_started` / `content_block_completed` | `generationId`, `seq`, `messageId`, `block` | Native thinking, text, or tool-call block boundary preserving `contentIndex` |
| `content_block_delta` | `generationId`, `seq`, `messageId`, `blockType`, `contentIndex`, `delta` | Native block delta addressed by stable message/block identity |
| `assistant_message_completed` | `generationId`, `seq`, `messageId`, `blocks`, `stopReason`, optional `errorMessage`, `usage` | Complete native assistant boundary without flattened text |
| `tool_execution_started` / `tool_execution_updated` / `tool_execution_completed` | `generationId`, `seq`, `toolCallId`, tool fields | Structured execution state joined to its native tool-call block |
| `generation_retry_started` / `generation_retry_ended` / `generation_turn_ended` | `generationId`, `seq`, retry fields | Retry-aware lifecycle that does not settle the generation during a retry gap |
| `generation_failed` | `generationId`, `seq`, `error` | Terminal structured runtime failure |
| `generation_stopped` | `generationId`, `seq`, `status`, `processTerminated` | Stop completed; late output was gated |
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

## Progressive web app

Production builds (`npm run build` via `vite-plugin-pwa`) emit:

- `dist/manifest.webmanifest` — `display: standalone`, Conduit icons/theme
- a root-scoped `dist/sw.js` (Workbox) plus its workbox runtime helper
- PNG icons copied from `public/pwa-192x192.png` and `public/pwa-512x512.png`

`index.html` carries apple-mobile web-app meta and an apple-touch-icon for iOS
Add to Home Screen. The plugin injects manifest link and service-worker
registration into the production HTML only; Vite dev does not register a
worker, so installability is a production property.

The service worker precaches static shell assets (`js`/`css`/`html`/`svg`/
`png`/`ico`/`woff2`). It does **not** add runtime caching for `/v0`,
`/healthz`, or `/login`. Express already serves non-asset `dist/` files
(including `sw.js` and the manifest) with `Cache-Control: no-cache`, which is
required so updates activate without clearing site data. Do not add a blanket
`NetworkFirst` (or any) Workbox route for `/v0`: those endpoints are
authenticated and mutable. Offline after a successful online load serves the
shell only; API and live-session calls fail on the network as usual.

`scripts/check-bundle.mjs` fails the build if the manifest, root service
worker, or icons are missing, or if generated worker code appears to
runtime-cache `/v0`. After a build, `npm test` also runs
`test/pwa-artifacts.test.js` against `dist/` (skipped when `dist/` is absent).

Phone chrome (full-bleed drawers, header palette entry, long-press menus) is
covered by `test/browser/pwa-mobile.spec.js` on the Playwright
`mobile-chromium` and `desktop-chromium` projects.

## Verification

Use [`../docs/operations/testing.md`](../docs/operations/testing.md) as the
single source of truth for fast checks, deterministic harnesses, browser QA,
Playwright canaries, live transport measurements, and deployment proof.
