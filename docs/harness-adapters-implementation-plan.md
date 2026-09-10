# Harness adapters implementation plan

Adds Claude Code, opencode, and native Pi as Conduit harnesses, and makes
harness registration and detection data-driven so a fourth backend costs one
file instead of seven edits.

Scope per harness is **discovery + drive**: list the threads on this machine,
open one in `/computer` with full history, prompt it. Being a selectable profile
for Conduit-owned chats is deliberately out of scope and tracked as follow-up.

## Why this shape

The event contract (`src/chat-backend-contract.d.ts`) is settled. Codex proved a
foreign protocol maps onto it, and the transcript work proved the client renders
it without knowing the backend. What is not settled is how an adapter *plugs in*:
the typedef declares 12 methods, `CodexAppServerAdapter` implements ~45, and two
backend names are spelled out in seven places.

| Site | Hard-coded today |
| --- | --- |
| `src/server.js:149-160` | a `spawnSync` probe per backend, positional constructor args |
| `src/pi-rpc-adapter.js:137` | `ChatBackendRegistry(manager, codex, additional)` - codex is a positional parameter |
| `src/chat-backend.js:44` | `agentProfiles()` returns a literal array |
| `src/chat-backend.js:79` | `["codex", "chatgpt-web"]` literal in `profileSelection` |
| `src/server/routes/harnesses.js:7` | `SUPPORTED = new Set(["codex", "chatgpt-web"])` |
| `src/server/routes/harnesses.js:13` | `harnessCatalog()` literal array |
| `src/server/routes/chats.js:43,61` | `implementation !== "codex"` guards |

Three more backends on that base is ~21 edits and four more copies of the record
store. Phase 1 removes the tax before incurring it.

## Protocol findings

Probed on this machine: `claude` 2.1.267, `opencode` 1.18.30, `pi` 0.85.0,
`codex` 0.154.0.

| Harness | Live transport | History source | Resume handle |
| --- | --- | --- | --- |
| Codex (built) | app-server JSON-RPC over stdio | `thread/items/list` | `thread/resume` |
| opencode | HTTP + SSE (`opencode serve`) | `GET /session/{id}/message` | durable session id |
| Claude Code | stream-json over stdio | `~/.claude/projects/<cwd-slug>/<uuid>.jsonl` | `--resume <uuid>` |
| native Pi | `pi --mode rpc` | `~/.pi/agent/sessions/<cwd-slug>/<ts>_<uuid>.jsonl` | `--session <path>` |

Notes that drive the per-harness phases:

- **opencode is the closest fit to the contract we have.** It exposes real
  permission endpoints (`GET /permission`, `POST /permission/{requestID}/reply`,
  and per-session variants), so it is the first non-Pi backend that can honestly
  advertise `permissions: true`. It also has `/session/{id}/abort`,
  `/session/{id}/summarize`, `/session/{id}/fork`, `POST /session/{id}/model`,
  and both global (`GET /event`) and per-session (`GET /session/{id}/event`)
  SSE. Its capability set lands near Pi's, not Codex's. The server prints
  `OPENCODE_SERVER_PASSWORD is not set; server is unsecured` - Conduit must set
  one and bind loopback.
- **native Pi is nearly free.** `--mode rpc` is the protocol
  `normalizePiBackendEvent` already maps losslessly, so the live path reuses
  `PiRpcAdapter` unchanged. Only discovery is new code, and each session JSONL
  opens with `{"type":"session","cwd":...}`, so cwd is a first-line read.
- **Claude Code has the cleanest transcript mapping and the two worst traps.**
  `message.content` is native Anthropic blocks, so text / thinking / tool_use map
  1:1 onto `AssistantBlock`. But history is a **tree** (`parentUuid`), not a
  list, so it must be walked back from the leaf; and `isSidechain: true` records
  are **subagent transcripts interleaved into the same file** and must be
  filtered out of the main transcript. Records also carry `cwd`, `gitBranch`,
  `sessionId`, `timestamp` and `aiTitle`, which fills the `repository.branch`
  slot `groupThreadsByFolder` leaves null for Codex.

## Phase 1 - manifest, helpers, detection

No new backend lands in this phase. It exists to make phases 2-4 one file each.

### 1.1 Manifest

New `src/harnesses/`, one module per backend exporting:

```js
export const manifest = {
  id: "opencode",
  label: "opencode",
  protocol: "native_api",          // AgentProtocol, already in the contract
  installationId: "host-opencode",
  capabilities: OPENCODE_CAPABILITIES,
  discovery: "machine",            // "machine" | "folder" | "none"
  drive: true,                     // can /computer open a thread?
  profile: false,                  // selectable for Conduit-owned chats
  probe,                           // () => { available, version, status, detail }
  build,                           // (config) => adapter instance
};
```

`src/harnesses/index.js` exports the array. Every site in the table above reads
from it:

| Site | Becomes |
| --- | --- |
| `server.js` | `ChatBackendRegistry.fromManifests(await detect(manifests), { manager })` |
| `ChatBackendRegistry` ctor | takes a map; the positional `codex` parameter is deleted |
| `agentProfiles()` | templates plus manifests where `profile` is true |
| `profileSelection()` | accepted ids derived from manifests where `profile` is true |
| `harnesses.js SUPPORTED` | ids where `discovery !== "none"` |
| `harnessCatalog()` | mapped from manifests |
| `chats.js:43,61` | `implementation !== "codex"` becomes `manifest.discovery === "machine"` |

### 1.2 Composed helpers

Three helpers adapters *use*. Deliberately not a base class: Codex is
process-per-record, opencode is one server for every session, and native Pi
delegates its live path to `PiManager`. Inheritance would fight all three.

- **`SessionRecords`** (`src/harnesses/session-records.js`) - the record map,
  socket set and event array, plus the eight methods each adapter hand-rolls
  identically today: `get`, `getByChatId`, `list`, `stop`, `view`, `publish`,
  `attach`, `runtimeState`. `CodexAppServerAdapter` and `ChatGptWebAdapter` are
  effectively byte-identical here; both migrate onto it as the proof.
- **`unsupported(capabilities)`** (`src/harnesses/unsupported.js`) - derives the
  throwing stubs from the capability flags rather than hand-writing `fork()`,
  `queue()`, `respondHostUi()`, `sendPi()` per adapter. Makes `ChatCapabilities`
  enforced rather than decorative.
- **`scanSessionStore({ root, parse })`** (`src/harnesses/session-store.js`) -
  the cwd-slug-directory-of-JSONL walk Claude Code and native Pi both need.
  Codex and opencode skip it; they have APIs.

### 1.3 Detection

Today detection is one `spawnSync(codex, ["--version"])` at boot, frozen for the
process lifetime: installing Claude Code needs a Conduit restart to be seen.

`probe()` per manifest, in three kinds already required:

- `command` - spawn `--version`, capture the version string (codex, claude, pi)
- `http` - `GET /global/health` against a spawned or existing server (opencode)
- `import` - the `python -c "import curl_cffi"` check (chatgpt-web)

Probes run **in parallel** at boot (four sequential 3s timeouts would add up to
12s of startup), are cached, and are **re-probed on `GET /v0/harnesses?refresh=1`**.

Every probe returns the shape `ChatGptWebAdapter` already invented and nothing
else uses: `{ available, version, status, detail }` with status
`ready | authentication_required | unavailable`. "Installed but not logged in"
becomes a first-class state for all backends instead of a chatgpt-web special
case, and it fills the `version` slot `harnessCatalog` already declares and
never populates.

### 1.4 Verification

- New node test: for every manifest, assert it yields a registry entry, a
  catalog row, a `profileSelection` acceptance, and `SUPPORTED` membership
  consistent with its `discovery`. This is the test that would have caught all
  seven sites drifting.
- Unit tests for `SessionRecords` and `unsupported()`.
- **The existing Codex and chatgpt-web tests must pass unchanged.** They are the
  regression net for the migration; changing them to fit the refactor defeats
  the point.
- Full node suite green (baseline: 699/699).

## Phase 2 - native Pi

Smallest real backend, so it validates the manifest first.

- `src/harnesses/native-pi.js`: manifest with `discovery: "machine"`,
  `drive: true`, `protocol: "pi_rpc"`, capabilities `PI_CAPABILITIES`.
- `listThreads({ cwd, limit })` via `scanSessionStore` over
  `~/.pi/agent/sessions`, reading the first-line `{"type":"session","cwd":...}`
  header for cwd, id and timestamp. Honour `--session-dir` / config overrides
  rather than hard-coding the path.
- Drive delegates to the existing `PiRpcAdapter` with
  `sessionFile: <resolved path>`; no new event mapping, no new transcript code.
- Verification: a discovered host-Pi thread appears in `/computer` grouped by
  folder, opens with full history, and accepts a prompt. Confirm the existing
  `native_pi` chat path is unaffected.

## Phase 3 - opencode

- `src/harnesses/opencode.js` plus `src/opencode-server-adapter.js`.
- Lifecycle: **one server, many sessions.** Spawn `opencode serve --port 0
  --hostname 127.0.0.1` once with `OPENCODE_SERVER_PASSWORD` set to a
  per-process random secret, read the chosen port from stdout, reference-count
  it the way `CodexAppServerAdapter.discovery()` does, and shut it down when the
  last record closes.
- Discovery: `GET /session` for the list, `GET /project` for folder grouping.
- Restore: `GET /session/{id}/message` into the same `{messages, tools}`
  transcript shape `CodexAppServerAdapter.threadTranscript` produces, so the
  client renders it through the shared transcript with no client change.
- Drive: `POST /session/{id}/prompt_async`, stream `GET /session/{id}/event`
  (SSE) mapped to `assistant_content` / `tool_activity` / `status`,
  `POST /session/{id}/abort` for cancel.
- Capabilities: this is the first backend to set `permissions: true` - wire
  `GET /permission` and `POST /permission/{requestID}/reply` to
  `permission_request` / `permission_resolved`. Also `modelSwitch` via
  `POST /session/{id}/model`, `compaction` via `/session/{id}/summarize`.
- Verification: an opencode session opened in `/computer` renders history,
  streams a live turn, cancels, and surfaces a permission prompt end to end.

## Phase 4 - Claude Code

- `src/harnesses/claude-code.js` plus `src/claude-code-adapter.js`.
- Discovery via `scanSessionStore` over `~/.claude/projects`. Do **not** trust
  the directory slug for cwd - it is lossy; read `cwd` and `gitBranch` from the
  records. Use `aiTitle` for the thread title.
- History: walk the `parentUuid` chain back from the newest leaf rather than
  reading the file in order, and **drop `isSidechain: true` records** so
  subagent transcripts do not appear as main-thread turns.
- Transcript: map `message.content` blocks straight onto `AssistantBlock`
  (`text`, `thinking`, `tool_use` -> `tool_call`); pair `tool_use` with its
  `toolUseResult` for `tool_activity`.
- Drive: `claude -p --input-format stream-json --output-format stream-json
  --include-partial-messages --resume <uuid>` over stdio; map the stream-json
  frames to the neutral events.
- Verification: a Claude Code thread opens with history matching what
  `claude --resume` shows for the same session, including a turn that used
  subagents (which must not leak into the transcript).

## Risks

- **The migration is the risk, not the new backends.** Codex and chatgpt-web
  moving onto `SessionRecords` touches working code. Mitigation: their existing
  tests pass unchanged, and the migration is its own commit, separate from the
  helper introduction.
- **Browser suite baseline is red** - 23 passing / 15 failing, all clustered in
  the workspace panel area, unrelated to harnesses but easy to misattribute.
  Establish the count before starting each phase.
- **opencode server security.** Unsecured by default. Loopback bind plus a
  per-process password is a requirement, not a nicety.
- **Claude Code's stream-json frames are not a stable published contract** the
  way Codex's app-server JSON-RPC is. Expect this adapter to need version
  pinning or tolerant parsing.

## Out of scope

- Making the new harnesses selectable profiles for Conduit-owned chats
  (`profile: true`). Per-backend follow-up once discovery and drive prove out.
- Attachment support for driven sessions (`attachmentsSupported={false}`).
- Setpiece suite runtime (~20 minutes), deferred separately.
