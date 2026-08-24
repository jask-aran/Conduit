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
The composer accepts files through the picker, chat-surface drag-and-drop, and
Ctrl/Cmd+V when the browser exposes clipboard file items. Ordinary text paste
remains text paste, and the configured server attachment limit still applies.
Persisted image cards use the attachment preview route, including when restored
for edit. The compact composer model menu remains separate from Settings'
searchable multi-model picker. Cmd/Ctrl+K opens the typed application command
palette. Root lists concrete app actions and models; Settings…, Search chats…,
and Workspace views… are drill-down pages with search prefixes
(`Settings ›`, `Search ›`, `Workspace ›`) so sections, chats, and panel tabs do
not flood the root list. Cmd/Ctrl+Shift+K toggles Chat search directly; on
Firefox for Windows and Linux, the browser can claim that chord for Web
Console, so Settings → Shortcuts reports the conflict and permits a local
override. Chat search accepts
`scope:chats`, `scope:all`, and quoted `in:<folder-or-workspace>` filters; View
all chats pre-applies `scope:chats` in the same surface. Empty-query Backspace
removes a filter before it can change palette level; Escape returns to the root
palette or closes a direct launch. Tab enters a highlighted drill-down page.

Chat search matches chat titles and their owning folder or Workspace. It shows
creation dates, includes the current chat, and supports Cmd/Ctrl+E selection
mode. Outside selection mode, Alt+R renames the highlighted chat and
Cmd/Ctrl+K followed by R, M, or D renames, moves, or requests confirmed
deletion. Selection mode supports Space, M (move), C (copy links), and
D/Delete (confirmed delete); rename remains a single-chat action. The sidebar's
Chats group shows 20 rows by default; Settings → UI stores an integer limit
from 5 to 100, and View all chats opens a Chats-scoped search for older rows. A
folder or Workspace can remain collapsed even when it contains the active
chat; Search chats remains the route to that session. Existing generation
indicators stay unchanged. Search and management use the
same palette shell so later file, artifact, and host search domains can add
rows and previews without a second dialog.

Cmd/Ctrl+Shift+C starts a new chat.
One stable client command registry owns shortcut labels, contexts, defaults,
and palette projections. One capture-phase shortcut manager dispatches the
highest active context, supports one- and two-stroke bindings, and excludes
active terminal targets. Settings → Shortcuts stores browser-local overrides
under `conduit:shortcuts:v1`; changes update dispatch and visible keycaps
without a reload. The recorder blocks internal overlaps in the same context
and permits reuse in separate contexts. It warns about known browser and
system bindings, but it cannot detect a key that the browser or operating
system consumes before the page receives it. Overrides are local to the
current browser profile and are not server-synced.

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

The composer also supports draft-only voice dictation. The on-screen microphone
is a start/stop toggle. The configurable `Ctrl+Shift+D` shortcut uses the
selected Activation behaviour: Push to talk holds the recording, while Toggle
starts and stops it with separate presses. The shortcut is captured before page
controls so Chrome does not consume the default chord as a bookmark command.
Microphone capture starts in
parallel with the voice connection. The composer shows Preparing microphone
until the first PCM packet exists, then shows Recording, Finishing capture,
Waiting for transcription engine when needed, and Transcribing as the session
advances. A healthy AudioContext and cached worklet are reused between
sessions. The composer keeps a compact,
width-responsive left-to-right history in the status line. Settings → Voice uses the same
bounded bar renderer in a larger monitor with current level, peak hold, and
recording state. The browser captures 16 kHz mono PCM with an `AudioWorklet`
and sends it in 20 ms, 320-sample packets only to authenticated
`WS /v0/dictation/stream`; Stop flushes one final partial packet when needed.
Conduit owns one accepted PCM timeline and one transcript truth for each
session. Stop sends one immutable whole-session buffer to BatchPort. During
pauses sends each closed range to BatchPort with absolute sample positions and
flushes the open tail. Live sends every accepted sample once, in order, to the
persistent StreamPort. Live does not run Eager segmentation. Conduit uses one
shared `SegmentationProvider` contract for pinned Silero and the calibrated
heuristic provider; analysis always uses a copy of the accepted PCM. Short
valid ranges are retained, and bounded range exhaustion merges the remaining
tail. The complete WAV remains the archive source, and sidecars retain frame
probabilities, selected ranges, source-region mapping, progressive sequence
status, transcript watermarks, segmentation metadata, and the segment guard.
Exact-zero input remains a digital-silence or device-stall diagnostic.
Settings → Voice
can select a browser microphone, refresh the device list, and run an in-memory
input-level test until the user stops it; a 60-second safety cap prevents an
abandoned test from running forever. When the browser supports a playable
`MediaRecorder` format, the stopped test also exposes local Play and Stop
controls. The recording stays in browser memory, is never uploaded, and is
released when replaced or when Settings closes. Browsers without a playable
recorder still provide the live level test and show why playback is unavailable.
Chrome site settings still control permission. The selected input must be
available there. Voice shortcut,
activation, auto-send, microphone, warm-microphone retention, transcription source, and model changes stay
in a draft until **Save Voice settings**. A selected microphone remains stored
until capture reports that it is unavailable; Conduit then shows a recovery
toast without silently changing the device. Conduit ignores a no-signal
completion from a short intentional stop, and reports sustained silence only
after five seconds. Warm microphone retention is off by default; when enabled,
Settings shows the active state and a direct Stop warm microphone control.
The page presents Transcription source before the selected local or Cloud path.
Local settings show one semantic model family at a time, then the compatible
runtime, precision or variant, and valid batching profiles. Variant choices
show truthful install state; the selected path reports requested and actual
compute state. During pauses is labelled with its catalogue detector, such as
Silero or Silence detection, rather than hiding pause selection in Advanced.
Capture profile, shortcut, activation, auto-send, and warm microphone stay
inside one closed Advanced section. Cloud settings show the selected transport
and its fixed timing;
OpenAI model selection updates between the HTTPS upload and WebSocket live
adapters before Save.
Settings → Voice can use managed
Whisper Tiny English, Whisper Base, Whisper Small, Parakeet Unified English Q8, Parakeet TDT 0.6B v2, or Parakeet TDT 0.6B v3,
and has first-class provider/model profiles for OpenAI, Deepgram, and Groq.
Remote None, Bearer, and custom API-key-header credentials are stored server-side in `data/voice.json`
(mode `0600`) and are never returned to the browser. Environment configuration
remains a locked deployment override. Provisional transcript text replaces one
highlighted composer range in place, leaves one trailing space after each
non-empty dictation, final text remains an editable draft, and
optional auto-send accepts only a server-confirmed final event settled within
one second of stop.

Managed local setup is an explicit user action. Conduit downloads pinned q8
Whisper ONNX artifacts, the pinned Parakeet/ONNX Runtime package, or the
Unified English Q8 GGUF into `data/voice/models`. A reviewed source manifest
pins every model artifact to an immutable revision or release URL, exact byte
size, and SHA-256 digest. The installer verifies these digests, displays
progress, supports cancellation and retry, and keeps only one selected model
resident. Whisper runs in the server through Transformers.js; legacy Parakeet
runs as one unprivileged loopback worker; supported Parakeet ONNX artifacts
also have a managed `transcribe-rs` BatchPort worker. Unified English Q8 uses the pinned
`transcribe-cpp@0.1.3` Node binding and its locked Linux CPU/Vulkan native
package. The binding verifies its ABI contract and reports the actual compute
backend. The `transcribe-rs` worker is a long-lived unprivileged child process
over private pipes. It pins `transcribe-rs` 0.3.8, `ort` 2.0.0-rc.12, bundled
ONNX Runtime 1.24.2, Rust 1.88, and the x86_64 Linux CPU target. Its versioned
frames use bounded length-prefixed JSON and PCM16 payloads; the worker reports
compiled, requested, and actual providers separately. The worker exposes
After Stop and During pauses only. It does not advertise Live because this
pinned Parakeet implementation has no persistent StreamPort. Unified English
Q8 uses one `parakeet_buffered` stateful session per
dictation, with the current 1.12 s profile (5.6 s left context, 560 ms chunk,
and 560 ms right context) and stable-prefix commits. It emits stable and tentative text
while capture continues. If stream startup fails before useful text, Conduit
records the failure and uses the bounded WP5 progressive batch fallback. If a
stable segment has an exact sample checkpoint, a later stream failure replays
only that checkpoint's bounded-overlap suffix through BatchPort and preserves
the stable prefix. It does not run both paths in parallel. File-upload providers buffer one bounded
utterance in memory and transcribe it after Stop. Other installed local batch
models can use the bounded progressive range path during capture; this is not
stateful streaming and does not run for remote providers. The native worker
protocol and build records are in `native/transcribe-rs-worker/README.md`.
Installing a model is separate from selecting the active model. The selected
model is persisted with **Save Voice settings**, and installation never occurs
without explicit license acceptance.

Local selection is stored as `voiceConfigVersion: 2` with a canonical tuple:
`modelId`, `artifactId`, stable `runtimeId`, `execution`, and `segmentation`.
The tuple resolves to one immutable execution profile and backend path. The
runtime version is reported separately, so a routine runtime update does not
invalidate the selection. Legacy `localModelId` values migrate through an
explicit map and remain available to the older client for compatibility. A
valid selection can be saved before its artifact is installed; capture then
returns the specific missing-artifact error and the selection remains intact.
The settings response includes the static profile catalogue and a separate
backend-path status list with artifact state, runtime state, requested and
actual compute backend, loaded runtime version, and the last error code.

The current Unified English selection resolves to
`parakeet-unified-en-0.6b` / `parakeet-unified-en-0.6b-q8-gguf` /
`transcribe-cpp` and can use the persistent `live` StreamPort. The current
Transformers.js paths use `eager` BatchPort execution with Silero
segmentation. Legacy Parakeet paths use `stop` BatchPort execution. The
`transcribe-rs` paths use `stop` and Silero-segmented `eager` BatchPort
profiles. Each
dictation freezes this resolved tuple at open; a settings change affects the
next dictation only. One runtime lease covers the session and releases once on
completion, failure, cancellation, socket close, or shutdown.

OpenAI offers `gpt-transcribe` for Stop-time file upload and `gpt-live-transcribe` for live PCM through the same dictation WebSocket. GPT-4o file models are not listed.
Deepgram offers Nova-3 and Nova-2 with `Token` authentication and smart
formatting; Groq offers Whisper Large V3 Turbo and Large V3. Provider endpoints,
auth schemes, model fields, streaming behavior, and response parsing are owned
by their profiles. The custom profile retains WSS/HTTPS adapter and header
configuration for other services.

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
node scripts/conduit-auth.mjs mint-session     # local agent session; no password
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
- `GET|PUT /v0/voice/settings` reads or updates the redacted voice source,
  canonical local execution tuple, static execution catalogue, backend-path
  status, named adapter, endpoint, and authentication policy
- `POST /v0/voice/test` tests the effective endpoint without disclosing its
  credential; `DELETE /v0/voice/credential` removes a stored remote secret
- `POST /v0/voice/model/install`, `POST /v0/voice/model/cancel`, and
  `DELETE /v0/voice/model` manage independently installed local model tiers

## Global runtime channel

`GET /v0/runtime/stream` is a server-to-browser SSE channel for application-wide
process residency and coarse activity. It does not carry transcript token
deltas. On connect the server writes one `runtime_global_snapshot` with every
live process view, then low-frequency `runtime_process` and
`runtime_process_removed` events. Reconnect always starts with a fresh snapshot.

Each public process view includes safe client-facing fields only: `id`,
`chatId`, `projectId`, `status`, `active`, `activity`, `activityDetail`,
`stopping`, queue lengths via `queue`, `hostUiRequests`, `contextUsage`,
`sessionStats`, and cumulative derived `cacheStats`,
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
emits a Conduit `context_usage` event. The event carries current context usage,
the latest assistant request usage, cumulative session statistics, and
cumulative derived cache statistics. Null tokens/percent mean unknown, not
zero. Session statistics include message and tool counts, input/output/cache
token totals, and cumulative cost.

`cacheStats` is derived from successive assistant request usage records. For
each eligible pair, Conduit sets prompt tokens to input plus cache-read plus
cache-write tokens, eligible tokens to the lower prompt total, and cache hits
to the lower cache-read and eligible totals. The cumulative eligible hit rate
is the sum of cache hits divided by the sum of eligible tokens. Compaction and
branch summaries break the request-to-request eligibility link; cumulative
totals remain.

The composer can display these values as independent browser-local metrics.
The default `Compact` preset shows core context usage, the latest request's
input/output/cache fields, cumulative session totals, cost, and eligible cache
hit rate. `Full` enables every measure. `Cache diagnostics` focuses on current
and cumulative cache-read, uncached, eligible, hit, and missed measures.
Changing one checkbox switches the selector to `Custom`; all selections remain
browser-local.

The complete metric catalogue includes:
context tokens, window size, used and remaining percentages, latest request
token/cache/reasoning/cost fields, cumulative session token and cost fields,
message counts, tool counts, cumulative cache-eligible tokens/hits/misses and
eligible hit rate, and derived cache-read or uncached-input percentages.
Derived values are display calculations only; Pi remains the source of token
and cost values.

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

## Voice dictation protocol

`WS /v0/dictation/stream` is authenticated like every other upgrade. Browser
binary frames are signed 16-bit little-endian mono PCM at 16 kHz. The normal
packet is 320 samples (640 bytes, 20 ms); the final frame can be shorter. The browser
stop control is `{ "type": "stop" }`; it may include the optional numeric
`audioBytesSent` field and bounded `clientDiagnostics` metadata. After the server
sends `completed`, the browser sends one bounded `{ "type": "client_diagnostics" }`
frame with its final-event timing; the server acknowledges it and updates the
matching JSON sidecar. File-upload adapters (`openai_audio_sse_v1`,
`deepgram_audio_v1`) send one in-memory WAV after Stop. OpenAI
`gpt-live-transcribe` uses `openai_realtime_stream_v1`: each accepted 16 kHz
PCM packet is upsampled to 24 kHz and appended to a Realtime transcription
session; `partial` / `final` events include `stableText`, `tentativeText`,
and `revision`. Unified English Q8 uses `transcribe_cpp_stream_v1` the same
way with native float32 packets, plus `audioCommittedMs` and `bufferedMs`.
Conduit copies incoming packets into one bounded accepted timeline, coalesces
eight 20 ms packets into one 160 ms native feed, and allows only one native
`feed()` call at a time. The queue limit is 5,000 ms. The stream reports
`serverQueuedAudioMs`, `runtimeBufferedAudioMs`, `totalInferenceLagMs`,
`acceptedThroughSample`, `submittedThroughSample`, `committedThroughSample`,
`processedThroughSample`, and `archiveOwnedThroughSample` (null for processed
unless the binding reports an exact cursor). A failure before output or after
tentative output emits `stream_fallback` and replays the accepted PCM through
`transcribe_cpp_batch_fallback_v1` from sample zero. A failure after stable
output is safe only with an exact `throughSample`; the fallback replays from
that committed sample with bounded overlap, preserves the stable prefix, and
records discarded tentative revisions and duplicate-boundary handling. Without
an exact checkpoint, Conduit emits `error` and preserves the accepted PCM for
the archive. A stream-start failure is reported in `streamFallback` and can
also select `transcribe_cpp_batch_fallback_v1` with the WP5 progressive path.
The current CPU Live profile uses 5.6 s left context, a 560 ms chunk, and
560 ms right context for 1.12 s lookahead. The other supported Unified English
profiles remain available to later profile selection work.
Other managed local models can submit closed ranges during capture through the
bounded progressive path; the managed legacy Parakeet runtime still serves
the OpenAI-compatible upload endpoint on loopback. Conduit emits
`ready`, `partial`, `final`, `stream_fallback`, `finalizing`, `segment_error`,
`settlement_deadline`, `session_final`, `completed`, and `error`. `final` events
contain cumulative text and optional stable segment IDs, sequence, revision,
and sample metadata. `session_final` is derived once from the accepted stable
segments before `completed`. `finalizing`
announces the duration-aware server deadline before the selected adapter
completes its final range or whole-session pass. The user stop or the
five-minute limit finalizes the session. `completed` includes `settlementMs`,
`finalWithinDeadline`, `reason`, `audioBytes`, `audioDurationMs`, and
non-secret adapter/provider/model metadata; clients must never infer auto-send
timing from browser clocks. The browser also emits
`conduit:voice-dictation-metrics` with the completion diagnostics.

Completion diagnostics use schema version 5. Client timings use the browser's
monotonic `performance.now()` clock and server timings use the server's own
monotonic clock; the two clocks must not be subtracted. The bounded sidecar and
metrics event include shortcut-to-first-PCM capture startup, microphone and
worklet setup, first WebSocket send, packet and byte counts, socket buffering,
redacted requested/effective audio settings, the selected raw or processed
capture profile, source and processing sample rates, resampler method, and
pre/post-worklet RMS/peak/clipping. Live capture does not calculate spectral
energy. Conduit does not apply adaptive ASR gain; the recorded worklet gain is
therefore an identity value. Capture diagnostics also state whether the
microphone stream was reused. The diagnostics also include first/last server
PCM, runtime preparation, inference queue/start/finish, partial/final,
completion-send, archive, and bounded VAD queue/execution timing.
The client event record includes digital-silence device-stall notifications.
The server record includes Silero frame probabilities, selected padded sample
ranges, source-region mapping, segmentation provider and calibration version,
accepted/submitted/processed/committed/archive-owned watermarks, fallback
source and completing profiles, and any segment-guard action. Direct adapter
calls without a session selection retain the legacy RMS split for compatibility;
the authenticated dictation path always supplies its server-side VAD decision.
Completed session metadata also records the frozen profile ID, model and
artifact IDs, stable runtime and backend-path IDs, execution and segmentation,
requested and actual compute backend, and loaded runtime version.
Raw device identifiers, credentials, and transcript bodies are not diagnostic
fields or structured log fields. The current runtime reports its execution path
and records an unavailable compute backend as `null` until the runtime exposes
that fact.

Finalisation uses `max(base, recordedAudioSeconds × modelMultiplier)` and a
ten-minute cap. The relaxed defaults are a 30-second base and a 12× fallback
multiplier; the full-precision local Parakeet policy uses 18×. Deployments can
adjust the base, cap, and fallback with
`CONDUIT_VOICE_FINALIZATION_BASE_MS`, `CONDUIT_VOICE_FINALIZATION_MAX_MS`, and
`CONDUIT_VOICE_FINALIZATION_DEFAULT_MULTIPLIER`.

The browser keeps the selected microphone ID and capture profile in local
settings and applies the microphone ID as an exact `getUserMedia` device
constraint. The raw candidate profile requests echo cancellation, noise
suppression, and browser automatic gain control off. The processed profile
requests all three features on for devices that need speaker-echo handling.
The browser reports the effective track settings separately from those
requests. Both profiles use the same unamplified ASR PCM path.
Conduit requests a 16 kHz `AudioContext`; when the browser keeps another source
rate, the capture worklet uses a windowed-sinc FIR resampler and records the
effective rates and method. The input test uses the selected profile, measures
the live stream until the user stops it, and has a 60-second safety cap. A
missing signal is reported in Settings → Voice. It blocks only an empty
completion; a non-empty server transcript is retained even when browser level
meters are quiet. Dictation sessions accept up to five minutes and the client
surfaces the completion reason when the server reaches that limit.

Dictations with at least one second of server-received PCM are retained under
`data/voice/recordings` as timestamped WAV/JSON diagnostic pairs, including
sessions where the transcription service returns no text. Empty results have
an empty `transcript` and `transcriptStatus: "empty"` in the sidecar. The
archive keeps the latest 20 standard pairs and a separate bounded quota of
four short failure recordings; short sessions do not evict normal recordings.
The JSON sidecar contains non-secret completion, provider, model, and byte
metadata. Settings microphone tests remain browser-local and are not archived.
Archive handoff copies the accepted PCM into a bounded queue of at most two
records and 32 MiB. Transcript completion and auto-send do not wait for disk.
Server diagnostics record archive queue delay, pair-write duration, published
file names, rotation counts, and failure state separately from transcript
settlement. Archive work is drained for up to five seconds during orderly
shutdown; work that misses that deadline is reported as a shutdown failure.
WAV and JSON files are staged under `.pending-*` names, and only matching
published pairs are retained as valid records.

The server owns one bounded PCM accumulator per active session and shares its
immutable accepted view with the selected scheduler and archive. Stop BatchPort
materialises one whole-session buffer; Eager BatchPort receives bounded range
slices; Live StreamPort receives ordered feeds. The server limits concurrent dictation sessions, audio duration and bytes,
frame/event sizes, WebSocket buffering, connect time, and finalisation time.
Settings-created remote endpoints require HTTPS, reject URL credentials and
query strings, resolve only to public addresses, and pin the checked address for
connection setup. Diagnostic WAV files use a private data directory
and do not contain credentials or Pi JSONL content.

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
view plus `hostUiRequests`, `queue`, `contextUsage`, and `sessionStats` when
known. Structured
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
| `context_usage` | `contextUsage`, `sessionStats` | Synthesized context window usage, latest request usage, and cumulative Pi statistics (nullable context tokens/percent) |
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

To force an installed app to check for a new shell, open any chat's More chat
options menu and select `Update app`. Conduit asks the active service worker to
update, waits for a new worker to take control when needed, and reloads the
current chat.

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

Use [`../docs/testing.md`](../docs/testing.md) as the
single source of truth for fast checks, deterministic harnesses, browser QA,
Playwright canaries, live transport measurements, and deployment proof.
