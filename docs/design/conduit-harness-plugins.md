# Conduit harness plugins

Drafted 2026-10-01 from the context-readout work. A plan, not a spec: what
each harness lets Conduit reach into, what a first-party Conduit plugin per
harness would give us, and the order to build them in.

## Why

Conduit speaks one set of verbs and shapes for every harness (Conduit-first
primitives). Today it gets there by adapting whatever each harness reports
from the outside -- its RPC, its SDK, its files. That ceiling shows first in
the context readout: Claude Code itemises what fills its window and nothing
else does, so the breakdown is one "Used" row for Pi, Codex and OpenCode.

A plugin that runs inside the harness, owned by Conduit, lifts the ceiling:
it sees the request as it is sent, and it can carry anything Conduit needs
next (cache attribution, compaction thresholds, tool metadata, checkpoints)
without waiting for each harness to expose it.

## What each harness offers

| Harness | Extension point | Sees the request? | Route |
|---|---|---|---|
| Pi | Extensions (`pi.on(...)`). Conduit launches Pi, so it loads one with no install. | Yes. `before_provider_request` has the exact payload (system, tools, messages); `ctx.getContextUsage()`; `pi.appendEntry()` persists to the session file. | First-party extension |
| OpenCode | Plugins (JS, `~/.config/opencode/plugins`; herdr already installs one). | Mostly. `experimental.chat.system.transform` (system prompt), `tool.definition` (each tool's schema), `experimental.chat.messages.transform` (messages). | First-party plugin |
| Codex | Hooks (SessionStart, UserPromptSubmit, tool and Stop events; shell commands) and plugins bundling skills, MCP servers and hooks. | No: hooks see lifecycle only. | Rollout reading for context; a plugin with a Conduit MCP server for anything interactive |
| Claude Code | The SDK's `getContextUsage()`, plus hooks. | Already complete. | Nothing to add |

## Context, the first feature

**One category set** that Conduit ingests and speaks (see
`src/context-categories.js`): System prompt, Tools, Instructions (memory
files, skills, agents, MCP server instructions), Messages, Autocompact buffer,
Deferred tools, Free space. A harness reports what it can; the rest is absent,
never invented.

**Estimated, scaled to the reported total.** Where a harness does not itemise,
each part is measured from its text and the parts are scaled so they sum to
the input tokens the harness reported for its last request. The total stays
exact; the split is labelled estimated everywhere but Claude Code.

- **Pi:** the extension measures the real payload per request and writes the
  breakdown into the session with `appendEntry`, so a live chat and its
  history read the same thing. Per-request cache attribution comes with it.
- **OpenCode:** the plugin measures system prompt, tools and messages per
  request and reports to Conduit. It runs inside a service the user's TUI
  shares, so it acts only on sessions Conduit owns.
- **Codex:** estimated from the rollout -- `session_meta.base_instructions`,
  `turn_context` instructions, `response_item` messages, reasoning, tool calls
  and outputs -- against its `token_count`. Tool schemas are not recorded, so
  that slice is what remains after scaling.

## Providers and authentication

The same work lifts provider management and authentication, at least for Pi:
the extension can read `ctx.modelRegistry` (effective providers, resolved
auth, scoped models), so Conduit can show and manage what Pi will actually
use instead of re-deriving it from Pi's files. Whether OpenCode and Codex can
follow is part of the investigation for each.

## Order

1. **Pi extension.** Cheapest (Conduit owns the launch) and the most reach:
   context, cache attribution, compaction threshold, providers and auth.
2. **Codex rollout estimator.** No install; closes the breakdown gap.
3. **OpenCode plugin**, once installing it and confining it to Conduit's
   sessions are decided.

## Open questions

- How Conduit installs, versions and removes a plugin it does not launch
  (OpenCode, Codex), and how a user sees that it is there.
- Where a plugin reports to: the session file (Pi), Conduit's server, or the
  harness's own event stream.
- A token estimator shared by all three, and how close "scaled to the total"
  gets against Claude Code's real numbers.
