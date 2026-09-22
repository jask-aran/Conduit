# Codex native feature gap

This document tracks the difference between Conduit and the Codex app-server
protocol. The reference implementation is the installed Codex CLI. Recheck
method and field names when that version changes.

Current reference: `codex-cli 0.154.0`, checked 2026-09-13. Re-read this
against the installed CLI before trusting the gap list; a version bump is what
makes it wrong, and nothing here notices on its own.

## Implemented

- Connect to the Codex app-server daemon through its control-socket RPC
  transport.
- Start, resume, read, list, and unsubscribe from threads.
- Use Codex-generated thread names from `thread/name/updated`; skip Conduit's
  naming model for manifests that declare backend-owned name generation.
- Start, steer, interrupt, and follow up on turns.
- Stream assistant text and reasoning summaries.
- Project command, file-change, MCP, collaboration, web-search, and image-view
  items into Conduit's tool activity.
- Select models and reasoning effort.
- Start native compaction through `thread/compact/start`.
- Derive composer permission modes from `permissionProfile/list`, `config/read`,
  and `configRequirements/read`. Apply each mode's permission profile, approval
  policy, and reviewer settings on thread and turn requests.
- Handle command and file-change approval requests with approve, approve for
  session, and deny decisions.
- Fork before a selected user turn through `thread/fork`. This supports
  Conduit's edit-and-resend and regenerate actions. Resolve the native turn
  from `thread/read`; use `thread/revert` when the first turn is replaced.
  Conduit does not show a thread tree.

## Permission and host interaction gaps

- Handle `item/permissions/requestApproval`, including the granted permission
  profile and scope.
- Show all command approval decisions, including exec-policy amendments,
  network-policy amendments, and cancel.
- Show proposed exec and network policy changes before approval.
- Handle `mcpServer/elicitation/request` for forms, URLs, credentials, accept,
  decline, and cancel.
- Handle `item/tool/call` for client-provided dynamic tools.
- Apply live changes for approval policy, sandbox policy, permissions,
  personality, collaboration mode, reviewer settings, and service tier.

## Thread and turn gaps

- Start native review through `review/start`.
- Expose thread archive, unarchive, delete, rename, metadata, section, and
  revert operations where Conduit has a matching product action.
- Expose native user shell commands where they add value beyond Conduit's
  terminal.
- Decide whether Conduit needs loaded-thread, turn-page, item-page, goal,
  memory-mode, queue, and background-terminal management APIs.
- Show a fork tree or ancestor link if Conduit adds branch exploration.

## Streaming and transcript gaps

- Stream command output deltas instead of waiting for item completion.
- Project plan updates, turn diffs, hook activity, sub-agent activity, app tool
  progress, image generation, sleep, realtime, and raw-response events.
- Preserve richer command actions, file-change metadata, MCP progress, memory
  citations, and collaboration-agent state.
- Handle thread name, status, project, queue, goal, and settings notifications.
- Report token usage, context-window state, rate limits, and spend controls.

## Account and catalogue gaps

- Read account identity, authentication state, usage, rate limits, reset
  credits, and workspace messages.
- Start, cancel, and complete native account login and logout flows.
- Expose more effective configuration and configuration requirements beyond
  permission-mode discovery.
- Write configuration values and reload MCP server configuration.
- List and configure Codex skills and extra skill roots.
- List installed and available apps, plugins, and marketplaces.
- Expose feedback upload only if Conduit adds an explicit user action.
- Expose standalone sandboxed `command/exec` only if it replaces an existing
  Conduit execution path.

## Compatibility rules

- Opt in with `initialize.capabilities.experimentalApi` before using permission
  profiles or other experimental protocol fields.
- Reject unknown server requests with a JSON-RPC error. Never leave them
  unanswered because Codex waits for the response.
- Keep native Codex payloads inside the server adapter. Add only neutral events
  to the browser protocol.
