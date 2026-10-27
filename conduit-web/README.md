# Conduit Web

The Conduit web surface combines an Express server, the in-process Conduit durable agent, external harness adapters, and a strict TypeScript SolidJS/Vite client.

## Run

```bash
cd ..
bash .devcontainer/start-conduit.sh setup
node scripts/conduit-auth.mjs set-password
bash .devcontainer/start-conduit.sh restart
```

Open <http://127.0.0.1:4310>, sign in, then use **Settings → Models & accounts** to manage provider credentials and model access for the Conduit durable agent.

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
[`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md)
for installation, backup and release guidance.

## Runtime model

The reserved `chat` project uses `data/chat/files` as its working directory.
Named projects use direct children such as `data/chat/files/example`. Project
metadata lives centrally in ignored `data/conduit.json`; each chat's files live
under `.conduit/chats/<chat-id>`. `data/sessions.json` stores the lightweight
Conduit chat registry. Assistant, Coding and Runtime chats run on the
pi-durable-based Conduit durable agent. Each chat stores its template profile
and durable conversation id; the template configures its prompt, tools,
extensions, skills and model scope. The server keeps provider credentials and
model settings under `data/pi`.

At startup, the server converts registry rows that still point to classic Pi
JSONL sessions. It carries the active branch and message ids into a durable
conversation, then replaces the stored session path with that conversation id.
The JSONL reader remains for this one-time conversion and legacy cleanup; new
turns use the durable conversation as their transcript source. Conduit also
stores chat-title requests and outcomes in `data/session-name-requests.jsonl`,
without prompt content. A selected naming model can name a chat's first prompt
without delaying the chat response; the command palette can regenerate a title
from the persisted transcript.

Raw attachment bodies stream to exclusive `.part` files and publish by atomic
rename. Each upload is capped by `CONDUIT_MAX_ATTACHMENT_BYTES` (100 MiB by
default), including chunked requests. The filesystem is the durable attachment
registry. Prompt envelopes contain validated relative paths rather than file
bytes. Generation IDs gate late output after stop. The durable agent cancels its turn and forks its stored conversation when the reader edits history.

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

Chat search opens on five recent chats and a tree of Chats, project, and Workspace
folders. Right expands a folder to show up to five recent chats, including the
current chat when present. Browse all opens that folder's full flat chat list;
Left or Escape returns to the same folder row. Slash searches within the active
folder, while typing in the root searches chat titles and folder names across
all folders. Up and Down move one cursor through the visible rows. Enter opens
a chat or folder, and the path above the input shows the search scope. The
footer sets activity view (All, Needs attention, In progress, Unread) and
Latest or Created sort. Rows use the sidebar's live and unread indicators;
active work appears beside project and date. It includes the current chat and
supports Cmd/Ctrl+E selection mode. Outside selection mode, Alt+R renames the highlighted chat and
Cmd/Ctrl+K followed by R, M, or D renames, moves, or requests confirmed
deletion. Selection mode supports Space, M (move), C (copy links), and
D/Delete (confirmed delete); rename remains a single-chat action. The sidebar's
Chats group shows 20 rows by default; Settings → UI stores an integer limit
from 5 to 100, and View all chats opens a Chats-scoped search for older rows. A
folder or Workspace can remain collapsed even when it contains the active
chat; Search chats remains the route to that session. Edit keeps the result
list in place: checkboxes shift rows right and the selected count stays in the
footer. Search and management use the
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

The composer slash Popover combines Conduit's `/attach` and capability-gated
`/compact` actions with runnable commands exposed by the selected harness.
`GET /v0/chats/:chatId/commands` lists prompt-template and skill commands from the chat profile without starting an agent. A live harness can provide its own command list. A project-aware breadcrumb identifies where each
chat belongs.

The chat header, Cmd/Ctrl+., and Workspace views… open a per-chat Workspace
panel. Files owns file browsing, comparison, and editing. Its All files mode
shows the working tree and offers preview and edit states. Its Diff mode keeps
This chat, Selected turn, Uncommitted, Unstaged, and Staged as comparison
sources in the changed-file navigator. Chat's Agent changes button and Source
Control's Review and file rows open that Diff mode. Staged compares HEAD to the
index; Unstaged compares the index to the working copy. Historical turns compare
their start to the next captured turn start; the latest turn compares to the
working copy. Historical content stays read-only; Edit working file opens the
current file without restoring a snapshot. The file navigator resizes on wide
panes and opens as a drawer on narrow panes. The editor footer holds preview,
edit, find, history, wrap, position, indentation, and language controls. The
comparison footer holds file/diff, comparison source, find, change navigation,
endpoint, position, wrap, and read-only status controls.
The lazy directory API hides `.conduit`, rejects symlinks and traversal,
and caps text previews at 1 MiB. Source Control can stage, unstage, commit,
fetch, pull, push, and inspect one historical commit on demand. Terminal is available for
every chat, starts at the validated Workspace root for Workspace chats and the
server home directory otherwise, and remains server-owned after the browser
leaves its tab. The terminal header can store up to 12 server-persisted command
buttons. A button sends its command and Enter to the attached terminal, or
starts a new resident terminal and sends the command when that attachment is
writable. New-terminal shortcuts use the shortcut name as the terminal window
name. The editor controls shortcut order and whether each command runs in the
current shell or a new shell.

The Conduit durable agent runs in the server process. The chat's template and
workspace select its instructions, tools, extensions, skills, model scope and
working directory. Device workspaces use the place-aware execution environment
for file and shell calls; the browser still connects to the head server.

`data/pi` remains the durable agent's provider and model settings directory.
The web-search extension may use a derived model-routing file there, while
credentials and model settings remain in the canonical directory.

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
the selected transcript concurrently; capabilities and profiles
load independently, while workspace-path suggestions are requested only
when workspace creation opens.
Settings → Workspaces stores global-profile inheritance or an explicit ordinary
profile for each Workspace.

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
and queued-message count without displacing composer controls. First-party chats
read provider and model settings from `data/pi`; the selected template supplies
the chat model scope. The transcript seeds the composer controls, and model
changes update the live durable conversation.

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

Every route below — plus every upload and every WebSocket upgrade — requires an
authenticated session except the login flow, `GET /healthz`, the PWA bootstrap
assets (`favicon.svg`, PWA icons, manifests, service workers, and Workbox
assets), and the compiled client under `/assets/`.

`/assets/` is public deliberately. The service worker is served without a
session and its precache manifest lists every one of those paths, so the names
have always been public; the files are content-hashed build output carrying
nobody's data. Withholding them bought nothing and cost the shell: a page
served from the worker's cache renders without asking anyone, and a stylesheet
answered with 401 does not become a sign-in screen — it becomes the page with
no stylesheet. What needs a session is the API the client then calls.
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

The installed shells use a separate native session. They send the password to
the chosen server, store the returned bearer token in the platform's secure
store — Android Keystore, Windows Credential Manager — and send it in the
`Authorization` header. Native requests are accepted from exactly two origins,
the Capacitor webview `https://localhost` and the Tauri shell
`http://tauri.localhost` (`src/native-auth.js`); `validateNativeSession`
refuses a bearer token that did not come from one of them. CORS does not permit
wildcard origins, cross-origin cookies, or headers other than `Authorization`
and `Content-Type`. WebSockets use a random 30-second ticket that expires after
one upgrade; the bearer token never enters a URL.

`normalizeServerOrigin` accepts HTTP for loopback and private addresses.
Installed clients upgrade direct routes to identity-verified TLS when the
server advertises support, without falling back to HTTP on failure. See
[connection constraints](../docs/DEPLOYMENT.md#install-and-connect).

Enforcement is a single `requireAuth` middleware mounted before every other
route and static handler, plus the WebSocket upgrade validator. The allowlist
is `GET /login`, `POST /v0/auth/login`, `POST /v0/auth/native-login`,
`POST /v0/server/prove`, `GET /healthz`, and the PWA bootstrap assets required
before the application session exists. `/v0/server/prove` is open on purpose:
its whole job is to be checkable *before* a credential is sent, and it reveals
only a signature over a nonce the caller chose. `GET /v0/server`, which lists
the routes, is authenticated. See `docs/DEPLOYMENT.md`. Logout
(`POST /v0/auth/logout`) requires a valid session like any other route. Loopback
binding without a configured password stays open for local dev; non-loopback
binding refuses to start without a password or `CONDUIT_ALLOW_INSECURE=1`.
Per-IP rate limiting is meaningless behind a tunnel, so `POST /v0/auth/login`
applies a global cap: after five failures the next attempt is rejected with
exponential backoff (5 s → 5 min); scrypt compare runs even on throttled paths
so timing reveals nothing.

- `GET /login` — server-rendered HTML form, no SPA code. The normal Vite build
  generates its HTML from the v2 `PasswordSignIn` and `ConnectionScreen`
  components, with the same colour, type and control tokens as the app. It
  works without JavaScript. A custom `CONDUIT_CLIENT_DIST` must include the
  build's `access/templates.json` and its referenced `/assets/` files.
- `POST /v0/auth/login` — accepts `application/json` (SPA fetch) or
  `application/x-www-form-urlencoded` (plain form POST); on success issues the
  cookie and returns `303 → after` (form) or `{ ok, redirect }` (JSON). Wrong
  password re-renders the page with an inline error (form) or returns `401`
  JSON (fetch).
- `POST /v0/auth/native-login` — accepts the password from one of the two
  installed-client origins and returns one native bearer token
- `GET /v0/server` — this server's id, public key and routes (authenticated)
- `POST /v0/server/prove` — signs a caller-chosen nonce (unauthenticated)
- `POST /v0/auth/socket-ticket` — exchanges a native bearer token for one
  short-lived, single-use WebSocket ticket
- `POST /v0/auth/logout` — clears the current session row and cookie
- `GET /v0/auth/status` — `{ hasPassword, authenticated, sessionCount }`
- `POST /v0/auth/reset-sessions` — keeps the caller's token, signs out everyone
  else

### Provider authentication

Settings → Models & accounts manages provider credentials for the Conduit durable
agent in `data/pi/auth.json`. This surface requires an authenticated Conduit
session, even when passwordless loopback development otherwise serves the app.
OAuth attempts are in memory, owned by their initiating session, expire after
ten minutes, and do not reveal URLs, codes or prompts to other sessions. API-key
values use the provider format and are never returned by the API.

- `GET /v0/pi-auth` — redacted provider status for the durable agent
- `GET /v0/pi-auth/attempt` — caller-owned OAuth attempt state
- `POST /v0/pi-auth/oauth`, `/v0/pi-auth/attempt/respond`, and
  `/v0/pi-auth/attempt/cancel` — OAuth/device-code actions
- `PUT /v0/pi-auth/api-key`, `DELETE /v0/pi-auth/:providerId` — store or remove
  a durable-agent provider credential

### Application routes

- `GET /healthz`
- `GET /v0/capabilities`
- `GET /v0/share-origin` resolves the current host's MagicDNS HTTPS origin from
  the local Tailscale CLI; the client appends the selected chat path before
  copying it.
- `POST /v0/chats`; `{ warm: true }` starts the chat's live agent session before
  the page opens
- `POST /v0/runs` `{ prompt, projectId?, profileId?, model?, thinkingLevel? }`
  starts a headless agent run: an untracked chat (no chat list shows it) on any
  profile, launched and prompted with no page attached. `GET /v0/runs/:id`
  returns `status` (`running`, `settled`, or `lost` when no process or log is
  left), the stated `outcome`, the final `answer`, and `waiting` when it is
  held on an approval or question. `GET /v0/runs/:id/events` (SSE) replays the
  chat log from `?since=` / `Last-Event-ID` and follows it until the turn
  settles: transcript ops and statuses, with each message stated in full on
  `message.close` (no deltas). `POST /v0/runs/:id/messages` prompts a settled
  run again; `POST /v0/runs/:id/stop` stops it like the composer's Stop. A
  run's state lives in the server's chat log, so after a restart it reads as
  `lost` while its transcript remains in the chat.
  A run's `requests` lists the approvals and questions it waits on; one left
  unanswered for `hostUiTimeoutMs` (given at creation, default ten minutes) is
  cancelled, as a dismissed card would be. Runs are not auto-named unless
  created with `autoName: true`.
- `GET /v0/agent` includes saved approval rules; `DELETE /v0/agent/rules/:id` removes one.
- `GET /v0/push` returns the hub's VAPID public key and its push subscriptions
  (host of each endpoint only: an endpoint is a capability). `POST
  /v0/push/subscriptions` `{ endpoint, keys: { p256dh, auth }, kind, label }`
  adds or refreshes one (`kind` is `unifiedpush` or `webpush`); `DELETE
  /v0/push/subscriptions/:id` removes it; `POST /v0/push/test` `{ id? }` sends a
  test. `POST /v0/push/answer/:token` answers an approval with `{ choice }`. The hub sends Web Push (RFC 8291 encryption, RFC 8292 VAPID) to every
  subscription; a push service's 404 or 410 drops it. The keys and
  subscriptions live in `push.json` in the data root.
- `GET /v0/host-ui` lists every approval or question any live agent is waiting
  on, with its chat, project and whether it belongs to a run;
  `POST /v0/chats/:chatId/host-ui/:requestId` answers one with
  `{ confirmed }`, `{ value }` or `{ cancelled: true }`, through the same path
  as the composer's card. Pending requests also reach every page in each
  process view on the global runtime channel.
- `GET /v0/profiles` lists profile identity and backend metadata
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
- `GET /v0/projects/:id/tree?path=…&after=…` lists one validated directory level.
  It sorts the complete directory by type (directories first) and name, then
  returns up to 500 entries with `total`, `truncated`, and `cursor`. Pass the
  returned cursor as `after` for the next page. `.conduit` and symlinks are
  excluded. Above 50,000 scanned entries it returns `oversize: true`, an empty
  page, and `total: null`. The file-tree filter covers loaded entries only.
- `GET /v0/projects/:id/workspace/version?paths=…` returns the shared workspace
  change version and changed relative paths for a JSON array of visible paths.
  `changedPaths: null` means refresh all visible data.
- `GET /v0/projects/:id/file?path=…` returns a size-capped text preview;
  `&metadata=1` returns only file size and modification time
- `PUT /v0/projects/:id/file?path=…` creates a file; `If-Match` with the
  current revision saves an open file, while `If-Match: *` replaces an
  existing file
- `DELETE /v0/projects/:id/file?path=…` deletes one validated regular file
- `GET /v0/projects/:id/diff` returns bounded Git status; `?history=0` defers the graph and refs until the Graph detail opens, while `?patch=1&reuse=1` reuses the short-lived status inspection and additionally returns staged/unstaged unified diff
- `GET /v0/projects/:id/commits/:hash` returns one validated full commit patch, bounded to 4 MiB
- `POST /v0/projects/:id/move-sessions`
- `GET /v0/workspaces/policy` returns the server-owned allowlist, default
  Workspace parent, and input-safe default path
- `GET /v0/workspaces/suggestions` returns visible direct folders under the
  configured suggestion root, using `~` only for paths under the native home
- `POST /v0/runtime/chats` creates a fresh special Runtime management chat
- `GET /v0/models`
- `GET|PATCH /v0/preferences` reads and updates the default profile, the scoped
  model and thinking level used to name new chats, and terminal command buttons
- `GET|PATCH /v0/settings` reads and updates the durable agent's shared model scope;
  terminal and web saves use the same isolated settings file.
- `GET|PATCH /v0/chats/:id/models` resolves the selected template's scoped
  models and changes the draft/live durable conversation model.
- `GET /v0/sessions/:id` reads a backend transcript; `PATCH` renames the chat;
  `DELETE` removes the chat and any legacy session files it owns
- `GET /v0/sessions/:id/context` and `POST /v0/sessions/:id/context/breakdown`
  read context usage and optional breakdowns
- `POST /v0/sessions/:id/auto-name` replaces the Conduit title from the full persisted chat context
- `GET /v0/sessions/:id/transcript`
- `POST /v0/sessions/:id/read` records the read watermark
- `POST /v0/sessions/:id/duplicate` returns `409` while chat-file ownership is deferred
- `GET|POST /v0/live-sessions`
- `GET /v0/live-sessions/:id/snapshot`
- `DELETE /v0/live-sessions/:id/process`
- `WS /v0/live-sessions/:id/stream`
- `GET /v0/harnesses` lists installed adapter dashboards and available controls
- `GET /v0/harnesses/:implementation/sessions?projectId=...` lists bounded backend metadata for one validated Workspace
- `POST /v0/harnesses/:implementation/threads/open` opens (`sessionId`, or `chatId` again) or starts (`newThread`) a thread not in Conduit as an untracked chat; a thread Conduit already keeps answers as that chat
- `POST /v0/chats/:id/track` makes an untracked chat an ordinary one in the workspace its folder is
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
- `GET /v0/runtime/settings` and `PATCH /v0/runtime/settings` read/update the
  max live sessions and max concurrent generations (`data/runtime.json`, env defaults)
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

The server owns live agent sessions. A browser disconnect does not stop them.
Opening a chat attaches to an existing session but does not start one; a prompt,
compaction, regeneration or steer may start one. The max live-session count
(default 12) reclaims the oldest idle session when full; otherwise launch returns
429 `live_process_limit`. Concurrent agent loops have a separate limit
(default 2); reaching it returns 429 `generation_limit`. Durable conversations
remain in the runtime store and resume on the next open.

Context usage comes from the active harness. For the durable agent, the server
reads its conversation context and usage records, then emits a Conduit
`context_usage` event with current context, the latest request usage, cumulative
session statistics and derived cache statistics. Null tokens/percent mean unknown, not
zero. Session statistics include message and tool counts, input/output/cache
token totals, and cumulative cost.

The command palette exposes **Compact context** when the selected backend
supports compaction and the chat is idle. The durable agent compacts its stored
conversation; Codex uses `thread/compact/start`.

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
Derived values are display calculations only; the active harness supplies raw
token and cost values.

## Chat profile identity

`GET /v0/profiles` returns templates and harness-backed profiles. Assistant,
Coding and Runtime use `native_api` with implementation `conduit-runtime`; other
profiles select their own adapters. Runtime still uses its dedicated create
route.

`POST /v0/chats` and draft `PATCH /v0/chats/:id` accept `profileId`. The existing
`templateId` and `runtimeKind` inputs remain supported. Conflicting neutral and
legacy selections return `400 profile_conflict`. Existing draft, session and
special-profile restrictions apply to both forms.

Chat responses include `profileId`, `profileRevision` and backend identity, but
omit `backend.opaqueSession`. For durable chats, that value is the durable
conversation id. The startup converter reads old classic Pi JSONL paths and
replaces them with durable conversation ids while retaining the selected
profile and active history branch.
## Adapter dashboards and untracked threads

Each installed harness has a page of its own, `/computer/harness/:id`, which
`?cwd=` scopes to one folder: the threads it ran that no Conduit chat owns, the
Conduit chats on it, and the folders it ran in. Computer folder actions open a
harness's page with that folder in scope.

A thread opened or started there runs as an **untracked chat**: an ordinary
chat record marked `untracked`, in the thread's workspace or, outside one, its
Computer folder (`computer:` project id, resolved by `findChatContext`). No
list of Conduit's chats includes it -- the catalogue, dashboards, harness
tracking projections -- but everything else is the chat path: the live-session
launch, transcript ops and chat log, attachments, message ids, steering and
queueing, edit, fork, regenerate, turn checkpoints, model, permission mode and
speed. Its data lives in `<folder>/.conduit/chats/<id>` like any chat's. It is
shown at `/computer/harness/:id/thread/:threadId?cwd=`, or `thread/c:<chatId>`
before the harness has named the thread. The harness page's composer is one
too, made when the composer is first used and moved when its folder changes.
**Track** keeps the chat and clears `untracked`, in the folder's workspace,
linking the folder as one first. Leaving the page deletes the chat and stops
its process; the thread stays with the harness. Untracked chats are not
reloaded when the server starts, so one a closed tab left behind goes then.

The ChatGPT Web dashboard reports adapter and authentication status. Session
listing and untracked threads stay unavailable because that adapter does not
expose backend history discovery.

## Live session protocol

See [chat profile identity](#chat-profile-identity) for the additive HTTP and
persistence contract.

`WS /v0/live-sessions/:id/stream` carries newline-free JSON objects in both
directions. Adapters translate their runtime events into the shared transcript
and status vocabulary. First-party chats use durable conversations as their
persisted history; external adapters read their own transcript stores.

The backend-neutral vocabulary and lifecycle contract are defined in
`../docs/chat-backend-contract.md` and `src/chat-backend-contract.d.ts`. The
server owns event ordering, the chat log, and the active-generation projection;
the client reduces those events into its live transcript. Changes to the wire
vocabulary must update the contract and this section in the same change.

Slow WebSocket clients recover from the current runtime snapshot, the server's
own fold of the running generation, and the chat log. Paint may be dropped
because the closing message or tool event restates its final value; ordered
records remain available for replay.

Client commands:

| Command | Fields | Effect |
|---|---|---|
| `prompt` | `message`, `attachmentIds[]`, optional `streamingBehavior` (`steer` \| `followUp`) | Send a user prompt in the strict attachment envelope through the selected backend |
| `follow_up` / `steer` | `message`, `attachmentIds[]` | Queue mid-run follow-up or steering input |
| `stop_generation` / `abort` | `generationId` | Close the generation gate, then cancel the active backend turn |
| `fork_and_prompt` | `entryId`, `message`, `attachmentIds[]`, optional `model`, `thinkingLevel` | Fork history at an entry, apply the composer selection, then prompt |
| `regenerate` | `entryId`, optional `model`, `thinkingLevel` | Fork at an entry, apply the composer selection, then resend its recorded prompt |
| `extension_ui_response` / `host_ui_response` | `id`, `confirmed` \| `value` \| `cancelled` | Answer a blocking extension UI request |
| `refresh_context` | — | Request a context-usage refresh from the backend |
| `compact` | — | Ask the backend to compact its context |
| `clear_queue` | — | Discard queued steering and follow-up messages |
| `interrupt_and_send` | `message`, `attachmentIds[]` | Stop the running turn and send in its place |
| `resume_log` | `logId`, `since` | Ask for the numbered events this client missed |
| `frame_interval` | `ms` | State how fast this reader draws, to pace its own socket |

`resume_log` and `frame_interval` concern one socket and change nothing about
the chat, so neither joins the ordered command chain. Any other command is
refused: an unknown `type` is an `invalid_request`, not an escape hatch to the
backend. A refused command produces `error` with `scope: "request"` and a
`code`, which belongs to that command and never to a turn that may still be
running.

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
and do not contain credentials or chat transcript content.

## Workspace terminal protocol

Terminal processes run in a dedicated tmux server. Conduit uses disposable
`node-pty` clients to attach browsers to those sessions. The server derives each
cwd: a validated Workspace root for Workspace chats, otherwise Conduit's home
directory. The browser supplies only a project id and cannot select a path.
Lightweight records persist in `data/remotes.json`. A terminal survives browser,
network, and Conduit server restarts. On startup Conduit reattaches recorded tmux
sessions, marks missing ones as exited, and removes sessions in its dedicated
tmux server that have no record. Set `CONDUIT_TERMINAL_TEARDOWN=1` on the server
and managed launcher to end all terminal sessions during shutdown and discard
any that remain at startup. Without this setting, `stop` preserves them too.
Conduit generates each terminal UUID and derives an immutable tmux session name
from it. The mutable Conduit title is also the tmux window name. Terminal list
responses add live `currentCommand`, `lastActivityAt`, and `paneDead` metadata
from tmux; these observations are not persisted.

`WS /v0/ptys/:id/attach` is authenticated like every other upgrade. Binary client
frames are stdin bytes, and client JSON frames are `{ "type": "resize", "cols",
"rows" }`. Query parameters `cols` and `rows` set the initial attachment size.
The server sends binary terminal output plus JSON `status`, `control`, and
`client_error` frames. tmux redraws its current terminal state after a new
attachment; Conduit does not keep or replay an output journal. One browser may
attach to each terminal id at a time. A second attachment receives
`client_error.code = "pty_in_use"` and closes with code `4009`; different
terminal ids can stream at the same time. An explicit `takeover=1` query closes
the current owner with `client_error.code = "pty_taken_over"` and code `4010`,
then transfers the attachment to the requesting client. Clients do not retry
either ownership close code automatically. The browser owns VT parsing and
rendering. Conduit brokers bounded process I/O and closes a slow client with
code `1013`.

Server events use the backend-neutral vocabulary defined by
`docs/chat-backend-contract.md` and typed in `src/chat-backend-contract.d.ts`.
Every adapter maps its own events into it, and a harness's own words never
cross its adapter.

A turn travels on two channels. **The record** is what the browser cannot work
out for itself: `transcript_op`, `transcript_sync`, `session_checkpoint`,
`status` carrying a phase, and a runtime-scope `error`. It is ordered,
delivered exactly once, and numbered in the chat's log. **Paint** is
`assistant_content` and `tool_activity`: the typewriter, merged per block,
droppable, never authoritative and never numbered. Dropping paint is safe
because `message.close` restates the message in full.

| Event | Channel | Fields | Meaning |
|---|---|---|---|
| `transcript_op` | record | `op`, `log`, op fields | `message.open` / `message.close` / `message.drop`, `tool.open` / `tool.close`, `turn.settle` |
| `status` | record | `generationId`, `phase`, `seq`, `log` | `started`, `running`, `stopping`, `stopped`, `settled`; `running` is not numbered |
| `error` | record when `scope: "runtime"` | `scope`, `code`, `message` | A failed turn, or with `scope: "request"` a refused command |
| `transcript_sync` | record | `messages`, `tools`, optional `replace` | A window of the transcript, or the whole of it |
| `session_checkpoint` | record | chat identity fields | Durable registry checkpoint |
| `assistant_content` | paint | `phase`, `generationId`, `seq`, message and block fields | Assistant `start`, `delta` or `final` |
| `tool_activity` | paint | `phase`, `generationId`, `seq`, `toolCallId`, tool fields | Tool `start`, `update` or `end` |
| `generation_replay` | — | `generationId`, `generation` | The complete reduced generation, on attach |
| `runtime_state` | — | `session` with capabilities, queue, usage | Backend state and supported controls |
| `log_state` / `log_reset` | — | `log` | Where the chat's order stands, or that it cannot be resumed |
| `permission_request` / `permission_resolved` | — | request fields, stated flat | Backend host interaction |
| `usage`, `queue_state`, `compaction`, `retry` | — | capability fields | Optional capability state |

Delivery merges paint per block and paces it; the record is sent the moment it
is published, whatever the backlog. The first frame after a quiet moment goes
out immediately, and only a stream arriving faster than the window is merged
into it — the window is a rate limit, not a delay. The window is the reader's
own frame: the browser measures its refresh with `requestAnimationFrame` and
sends `frame_interval` on connect, which paces that socket alone; until then
it gets `DELIVERY_FLUSH_MS` (8 ms), and a claim is clamped to 4–50 ms. A
socket above the 256 KiB high-water mark stops receiving paint and keeps
receiving the record.

A client that sees a gap in `log.seq` sends `resume_log` and is either given
exactly what it missed or told `log_reset` and re-synced from scratch.

The browser does not receive harness-native payloads. Adapters translate them
inside the server boundary.

## Progressive web app

Production builds (`npm run build` via `vite-plugin-pwa`) emit:

- `dist/manifest.webmanifest` — `display: standalone`, Conduit icons/theme
- a root-scoped `dist/sw.js` (Workbox) plus its workbox runtime helper
- PNG icons copied from `public/pwa-192x192.png` and `public/pwa-512x512.png`

`index.html` carries apple-mobile web-app meta and an apple-touch-icon for iOS
Add to Home Screen. The plugin injects manifest link and service-worker
registration into the production HTML only; Vite dev does not register a
worker, so installability is a production property.

### When a new build replaces the page

`registerType: "prompt"` and `skipWaiting: false`: a new worker installs and
then **waits**, and `src/client/pwa-update.ts` is the only thing that decides
when it takes over.

It used to be `autoUpdate` with `skipWaiting`, and the page reloaded itself
from two places at once — a `controllerchange` listener in `main.tsx`, and the
`activated` listener `registerSW` attaches under `autoUpdate`. Neither asked
what the page was doing, so a tab that woke from the background and checked for
updates could reload mid-sentence.

Holding the **worker** rather than the reload matters for more than politeness.
Once a new worker activates, Workbox deletes the precached files the running
page still needs, and this client loads Settings, the workspace panel, the
terminal and the project dashboard on demand — an old page left running past
activation would fault on the next one it opened. Waiting keeps both builds
whole, which is what makes holding the update free.

The decision:

- **Nothing in the composer** — taken at once. The reload is invisible because
  there was nothing to interrupt.
- **Something in the composer** — the build waits, a persistent notice says so,
  and an effect on the composer takes it the moment the draft empties. Sending,
  discarding and clearing all release it without knowing this exists.
- **`Check for updates` in the sidebar footer** — the same lever, minus the
  asking. `forcePwaUpdate` triggers a registration update, waits for the new
  worker to reach `waiting`, then takes it.

Under `skipWaiting: false` the generated worker carries a `SKIP_WAITING`
message handler, which is what `updateSW()` posts to it; `controlling` is then
the event that means the handover happened, and the library performs the one
reload. Do not add a second reload path.

`pwa-update.ts` imports `virtual:pwa-register` **dynamically**, because that
module exists only inside a Vite build and `test/pwa-update.test.js` loads the
rest of the file directly under Node.

The service worker precaches static shell assets (`js`/`css`/`html`/`svg`/
`png`/`ico`/`woff2`). It does **not** add runtime caching for `/v0`,
`/healthz`, or `/login`. Express serves non-asset `dist/` files with
`Cache-Control: no-cache`, and the worker scripts themselves (`sw.js`,
`registerSW.js`, `workbox-*.js`) with `no-store, must-revalidate`. The stronger
header is not pedantry: the service worker decides which build every other file
comes from, so a cached copy of it pins the client to a build the server no
longer has, and a CDN in front of this will rewrite a revalidating header into
a browser TTL of its own. Cloudflare returned `max-age=14400` for `sw.js`
against an origin asking for `no-cache`, and a browser that will not re-fetch
that file cannot discover that a new one exists — one address served
yesterday's client while another served today's. Do not add a blanket
`NetworkFirst` (or any) Workbox route for `/v0`: those endpoints are
authenticated and mutable. Offline after a successful online load serves the
shell only; API and live-session calls fail on the network as usual.

`scripts/check-bundle.mjs` fails the build if the manifest, root service
worker, or icons are missing, or if generated worker code appears to
runtime-cache `/v0`. After a build, `npm test` also runs
`test/pwa-artifacts.test.js` against `dist/` (skipped when `dist/` is absent).

Phone chrome (full-bleed drawers, header palette entry, long-press menus) has
no automated coverage. The Playwright suite that used to assert it was removed
first: it took over twelve minutes, most of it was failing, and none of the
failures told us anything about the app. The remaining specs went the same way
for the same reason, and the repository now has no headless browser suite at
all. Browser-level checking is Agent Browser, driven rather than asserted.
Rebuild a suite deliberately if it earns its place.

## Installed shells

Two shells package the production `dist/` bundle around the same client the
browser runs: the Capacitor project in `android/` and the Tauri 2 project in
`src-tauri/`. Both hold bearer tokens instead of a cookie, choose the servers
rather than inheriting one, and never redirect to `/login`.
`src/client/platform/installed-client.ts` is the single place that asks which
client is running; nothing else tests for Capacitor or Tauri.

Installation, client builds, server switching and release constraints are in
[install, clients and operations](../docs/DEPLOYMENT.md).

### Android

The Capacitor 8 project in `android/` packages the production `dist/` bundle
under the application ID `com.jaskaran.conduit`. It uses the secure local
WebView origin and does not load a production `server.url`. Native builds do not
register the PWA service worker or show its update and cache-reset actions;
Check for updates asks the GitHub releases API for a newer APK instead, and
hands it to the system installer, which confirms before installing anything
from outside the Play Store.
First launch lists any Conduit server found on this network over mDNS, then
offers an address field, then checks `/healthz` and reveals the normal Conduit
password field. The server origin stays in local storage because it is not
secret; the bearer token stays in Android Keystore-backed storage. Change
server clears both values. The plugin that browses the network lives in
`android/app/src/main/java/com/jaskaran/conduit/ConduitDiscoveryPlugin.java`
and is registered in `MainActivity`.

Versioned tags build the Android app in
`.github/workflows/publish-container.yml`. A tag such as `v0.6.0-rc.1`
creates a GitHub prerelease with `conduit-v0.6.0-rc.1.apk` and its SHA-256
file. A stable tag such as `v0.6.0` creates the latest release. Add the
required `docs/releases/<tag>.md` changelog, then push the tag. Release
candidates do not update the container `latest` tag. The workflow signs every
APK with the persistent key in the `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`
GitHub Actions secrets. Keep that key permanently: Android rejects an update
signed with a different key.

```bash
npm run cap:sync       # build the web bundle and copy it into Android
npm run android:build  # produce android/app/build/outputs/apk/debug/app-debug.apk
npm run android:open   # open the generated project in Android Studio
npm run android:run    # sync and select a connected device or emulator
```

`android:build` produces a **development APK**, and it is a different
application from the release: the debug build type carries
`applicationIdSuffix ".dev"`, so it installs as `com.jaskaran.conduit.dev`
beside the released `com.jaskaran.conduit` rather than over it. It is signed
with the local debug key, not the release keystore, and has no update channel
of its own — it reports version `0.0.0-dev`, so `Check for updates` always
offers the latest published release, and taking that offer installs the
released app alongside rather than updating this one. Sideload a new build to
replace it. `docs/TESTING.md` has the four builds side by side.

Capacitor 8 requires Node 22 or newer, Android Studio 2025.2.1 or newer, and an
installed Android SDK.

## Verification

Use [`../docs/TESTING.md`](../docs/TESTING.md) as the
single source of truth for fast checks, deterministic harnesses, browser QA,
live transport measurements, and deployment proof.
# Managed-scope Git discovery

New terminals and agent processes in Chats and managed projects set
`GIT_CEILING_DIRECTORIES` to the parent of their working root. This prevents
automatic discovery of Conduit's enclosing repository while allowing repositories
created inside the managed scope. Linked Workspaces retain their environment.
Existing processes need a restart to inherit this setting. Shell prompts with
their own discovery may still show the enclosing repository. This is a discovery
boundary, not a restriction on explicit Git paths. Moving runtime data to
`~/.conduit` is deferred.
