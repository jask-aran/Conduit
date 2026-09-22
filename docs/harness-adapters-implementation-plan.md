# Harness adapters implementation plan

> **Status (2026-09-22): foundation landed; adapters remain.**
> `src/harnesses/index.js` owns registration, detection, catalogue entries,
> profile selection and discovery policy. `SessionRecords`, `unsupported()` and
> the session-store scanner are present. Conduit still ships no fx, OpenCode or
> Claude Code adapter. This plan targets fx 0.0.10, OpenCode 2.0.8 and Claude
> Code 2.1.278, which are installed on the development machine.

Add fx, OpenCode and Claude Code as Conduit harnesses. The first scope is
**discovery + drive**: list this machine's threads, open one in `/computer`
with full history, and prompt it. Keep `profile: false` until each driven
harness proves restore, live streaming, cancellation and permission handling.

Native Pi is not part of this plan. Its existing `PiRpcAdapter` remains the
right live transport, but host-Pi discovery can land separately.

## The boundary that already exists

No registration refactor is required. A new harness supplies one manifest and
one adapter:

```js
export const manifest = {
  id: "fx",
  label: "fx",
  protocol: "acp",
  installationId: "host-fx",
  capabilities: FX_CAPABILITIES,
  discovery: "machine",
  drive: true,
  profile: false,
  probe,
  build,
};
```

The adapter implements `ChatBackendAdapter` and translates its native protocol
once into Conduit's neutral events. It composes `SessionRecords`,
`SocketDelivery` and `unsupported()`; it does not inherit from a shared base
class. The three transports and lifetimes are different enough that a base
class would hide the important work.

The existing routes already derive supported harnesses and drive behavior from
the manifest. The browser already renders neutral transcript operations,
assistant content, tool activity, permissions and runtime state. Do not add a
backend-specific browser path.

## Current protocol findings

| Harness | Control interface | Discovery and history | Live lifetime |
| --- | --- | --- | --- |
| fx 0.0.10 | ACP v1 over stdio | `fx sessions --all --json`; `fx session --id <id> --json`; ACP `session/load` replays history | one `fx acp` process per driven record |
| OpenCode 2.0.8 | V2 loopback HTTP API through `@opencode/client` | V2 session and message APIs on the shared local service | one user service, many sessions |
| Claude Code 2.1.278 | `@anthropic-ai/claude-agent-sdk` | `listSessions`, `getSessionInfo`, `getSessionMessages`, `forkSession` | one SDK `query()` runtime per driven record |

### fx: use ACP for drive

fx can be integrated without ACP, but neither alternative represents the
installed fx harness as completely:

- `libfx` is an embedding API. It creates a separate agent core. The host must
  supply credentials, tools, permissions and checkpoint storage. It does not
  inherit the installed CLI's session store, login, shell, filesystem tools,
  skills or permission rules. That would make Conduit a new fx host rather
  than a client of the user's fx installation.
- `fx ask --json` can create or resume a saved session, but it is a
  non-interactive command. It buffers structured final output, writes progress
  to stderr, and can ask a person only through a TTY. It cannot carry
  Conduit's asynchronous permission dialog or a long-lived live session.
- `createFxTerminal()` preserves terminal behavior but embeds the terminal UI
  and its storage adapters. It is not a neutral chat transport.

ACP preserves the installed fx configuration and exposes the required control
surface: `session/new`, `session/list`, `session/load`, `session/resume`,
`session/prompt`, `session/cancel`, `session/close`, model/config changes,
streamed messages, tool updates and permission requests. Each connection has
one active session and one active prompt. Use one child per driven record so
two open threads cannot replace each other's active session.

Use the JSON CLI only for machine-wide discovery. ACP is launched under one
primary workspace, while `fx sessions --all --json` explicitly enumerates all
workspaces. Inspect a selected thread with `fx session --id <id> --json`, then
load it into ACP for drive. Do not parse `~/.fx/sessions` directly.

ACP does not currently expose fx's interactive compaction command, steering
or a follow-up queue. Declare those capabilities false. Confirm usage,
thinking and attachment event shapes against a captured fx 0.0.10 exchange
before advertising them.

### OpenCode: target V2, not the V1 API in the old plan

OpenCode 2 uses one authenticated loopback service for the user account. The
installed `opencode serve` confirms the V2 surface at `/api/info`; the V1
`/global/health` and `/doc` paths fall through to the web application. Do not
use the old `@opencode-ai/sdk/v2` package, V1 endpoints, or the former
`permission.reply` shapes.

Use the released V2 packages:

- `@opencode/client/service` discovers or ensures the registered local
  service and supplies its authentication headers.
- `@opencode/client` supplies generated request and event types for the V2
  API. Derive the adapter's boundary parsers from these types rather than
  copying a second protocol schema.
- Scope session operations with the V2 location/directory input. The service
  owns sessions across projects.

Conduit must not stop a shared service that it did not start. Let the official
service helper own discovery, compatibility checks, authentication and
startup. A private `opencode serve` process remains a later isolation option,
not the default.

The local T3 Code adapter is useful for behavior, not for package names or
process topology: it targets the V1 SDK. Retain these proven rules from it:

- A resume cursor is the native session ID. A confirmed missing session can
  become a new session; authentication and transport failures must not.
- Reapply the selected permission policy when a session resumes.
- Live event subscriptions have no replay guarantee. After disconnect, reread
  the session, messages, status and pending permission/question state before
  continuing the live fold.
- Recover pending requests by listing them after reconnect; do not assume a
  missed live event resolved them.
- Treat an allow-for-this-session reply as session-scoped. Do not persist a
  workspace-wide grant by accident.

OpenCode V2 renamed permission configuration and changed the client API. Read
the installed generated client types during implementation. Do not translate
V1 action names such as `bash` or `task` into the new adapter.

### Claude Code: use the Agent SDK

The Claude Agent SDK is more complete than raw CLI `stream-json` for this
integration. It uses the installed Claude Code executable and configuration,
but adds typed control and local session operations:

- `query()` streams SDK messages and partial content and supports resume,
  model, effort, permission mode, settings, MCP servers and additional
  directories.
- `canUseTool` and `onUserDialog` let Conduit answer approvals and user
  questions without a terminal.
- The live query can change model and permission mode and can be closed for a
  hard cancellation boundary.
- `listSessions`, `getSessionInfo` and `getSessionMessages` replace Conduit's
  proposed JSONL directory scanner and hand-written `parentUuid` walk.
- `forkSession` creates a native fork at a message boundary. Resume the new ID
  through `query()`.

This is also the shape used by the local T3 Code Claude adapter. Its important
lesson is to isolate `CLAUDE_CONFIG_DIR`: SDK history helpers read process
environment, so a non-default Claude account must run history operations in a
small child process with that account's environment. Never mutate the Conduit
server's `process.env` while other adapters are active.

Raw `claude -p --input-format stream-json --output-format stream-json` remains
a useful diagnostic and fixture source. Do not make it the production
transport: the SDK already owns that subprocess protocol and exposes session
history, forks, permissions, user dialogs and dynamic settings that a raw
parser would have to rebuild.

Claude Code 2.1.278 has no documented ACP agent server. Its other server-like
interfaces do not replace the SDK:

- The background daemon and `claude agents --json` manage Claude-owned
  background jobs. `attach` is a terminal client, and the listing is not the
  complete saved-session browser.
- Remote Control is for Claude's web and mobile clients. It is not a documented
  local third-party session API.
- `claude gateway` fronts model access and enterprise policy. It does not
  expose local Claude Code sessions.
- Claude Managed Agents is an Anthropic-hosted product with different session
  ownership. It does not drive the user's local Claude Code installation.

## Phase 1 - fx

Add `src/harnesses/fx.js`, `src/fx-acp-adapter.js` and a small ACP stdio
client. Do not add a general ACP framework until a second ACP harness needs
one.

1. Probe `fx --version` and require the ACP/session methods used by the
   adapter during initialization.
2. Discover with paged `fx sessions --all --json`; inspect a chosen session
   with `fx session --id <id> --json`.
3. Spawn `fx acp` in the thread's cwd, initialize it, and load or create the
   exact session.
4. Map ACP updates to transcript operations, assistant paint, tool activity,
   permission requests and settled status.
5. Implement cancel and close. Kill only the child process owned by the
   record.

Verification: discover an existing fx session, open its complete history,
run one tool-using prompt, answer one permission request, cancel one prompt,
and resume the same session after the ACP child restarts.

## Phase 2 - OpenCode 2

Add `src/harnesses/opencode.js` and `src/opencode-adapter.js` against the V2
client and service helper.

1. Ensure the compatible local service and retain its authenticated endpoint.
2. List sessions with their native project locations for machine-wide folder
   grouping.
3. Load the selected session and messages into Conduit's transcript shape.
4. Subscribe to V2 live events and filter them by session and location.
5. Send prompts, cancel, fork and answer permission/question requests through
   generated client methods.
6. On subscription loss, resubscribe and reconcile authoritative session,
   message, status and pending-request state before emitting more live events.
7. Advertise compaction or model switching only after the installed V2 client
   exposes and a focused live probe proves the operation.

Verification: open a session created by the OpenCode 2 TUI, render its full
history, stream a tool-using turn, recover across a forced event disconnect,
answer a permission and a question, cancel, then reopen the same native
session. Confirm Conduit neither changes the shared service configuration nor
stops it.

## Phase 3 - Claude Code

Add `src/harnesses/claude-code.js`, `src/claude-code-adapter.js` and the
official `@anthropic-ai/claude-agent-sdk` dependency.

1. Probe the installed CLI and SDK compatibility without creating a session or
   starting authentication.
2. Discover with `listSessions` and read with `getSessionMessages`; do not scan
   transcript JSONL directly.
3. Start or resume `query()` with the selected cwd, model, effort, permission
   mode and Claude config environment.
4. Map partial assistant blocks, thinking, tools, subagent/task activity,
   usage, compaction, rate limits and result messages to neutral events.
5. Route `canUseTool` and `onUserDialog` through Conduit's host-UI request
   surface. Preserve native option IDs in replies.
6. Use SDK session helpers for native forks and history reads. Isolate history
   helper environment for non-default `CLAUDE_CONFIG_DIR` values.

Verification: open an existing Claude Code session with tools and subagents,
compare its history with the SDK result, stream a live turn, answer an approval
and an `AskUserQuestion`, cancel, switch model, compact, fork at a message, and
resume after process restart.

## Cross-adapter verification

Keep validation surgical:

- The manifest contract test must cover each new registration and catalogue
  row.
- Give each native protocol one captured transcript-pipeline test through the
  real adapter translation and browser projection.
- Keep existing Codex and ChatGPT Web tests unchanged. They prove that adding
  manifests did not alter working adapters.
- Perform one manual `/computer` discovery-and-drive check per completed phase.

Do not run the broad browser or setpiece suites during these phases.

## Risks and limits

- **fx maturity:** 0.0.10 is experimental. Validate the ACP initialize result
  and fail unavailable on an incompatible protocol instead of accepting the
  binary from `--version` alone.
- **OpenCode shared state:** the V2 service belongs to the user's other clients.
  Conduit may create and drive sessions but must not rewrite service settings,
  stop the service, or assume it owns all live events.
- **Live-event loss:** OpenCode's V2 subscription is live-only. Reconciliation
  is part of correctness, not an optional reconnect improvement.
- **Claude SDK drift:** pin the Agent SDK to a reviewed range compatible with
  the installed CLI. Keep parsing tolerant at the external boundary and
  exhaustive after validation.
- **Capability honesty:** a native command's existence does not make it safe to
  advertise. Enable a capability only after create, restore and restart paths
  all preserve it.

## Out of scope

- Selectable Conduit-owned profiles for these harnesses.
- Attachment upload from the driven-session composer.
- Host-Pi discovery.
- A reusable ACP abstraction before another ACP adapter proves the shared
  shape.
- Managing or updating OpenCode or Claude Code installations from Conduit.
