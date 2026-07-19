# Spec: Minimal broker — unified session registry and control verbs

Status: draft · Priority: 5 · Requires: remotes-pty. Vision: S12, S20 phase 2,
S7 (staged: in-process module now, separate process at hardening).

## Goal

One control plane inside the server: a unified registry of every session
Conduit knows — Isolated Pi chats, Host Pi chats, PTY sessions — addressed
through four verbs: **spawn, attach, stop, status**. Today `PiManager`,
`data/sessions.json`, and the PTY manager each track their own world; this
spec makes them clients of one registry and defines the contracts the remote
phase (home daemon over tailnet, codespaces) will reuse unchanged.

Explicitly staged: the broker is an **in-process module** (`src/control/`),
not a second process. The vision's separate-process trust boundary arrives at
the hardening phase; the contracts are designed so that split is a transport
change, not a rewrite.

## Registry

`src/control/registry.js` — the authoritative in-memory view, with events:

```
{ id, kind: "pi-chat" | "pi-host" | "pty",
  target: "local",                      // the only target in v1
  title, projectId?, workspacePath?,
  status: "draft" | "idle" | "running" | "waiting" | "exited",
  runtime: { installationId?, templateId?, command? },
  lineage: { parentSessionId? },        // consumed by seed-tool.md
  createdAt, updatedAt }
```

- Existing stores remain authoritative for their own data (`sessions.json`
  for chat identity, Pi JSONL for transcripts, `data/remotes.json` for PTY
  rows); the registry is a live projection over them plus process state — no
  duplicate persistence, no new source of truth.
- `status` derives from the process managers (generating → `running`, host-UI
  wait → `waiting`, warm → `idle`). Registry changes flow over the existing
  global runtime SSE channel (`/v0/runtime/stream`), which this registry
  generalizes: snapshot-first, then additive `registry_update` events
  alongside the current `runtime_process` events, eventually subsuming them.
  Update the channel documentation in `conduit-web/README.md` in the same
  change (it is a contract).

## Verbs

`src/control/broker.js`, thin and policy-free in v1:

- `spawn({ kind, target: "local", spec })` — delegates to PiManager (chat
  creation path) or PtyManager. Returns a registry id. Records lineage when
  the spawn request carries a parent.
- `attach(id)` — resolves the session to its stream endpoint (chat WS / PTY
  WS); the existing endpoints keep working, now looked up through the broker.
- `stop(id)` — graceful stop per kind (Pi abort path / SIGTERM→SIGKILL for
  PTY), honoring the existing never-stop-while-generating-with-clients rules.
- `status(id?)` — one record or the full list.

All interface features that list or control sessions (sidebar, palette,
Remotes group, the coming seed tool) route through these verbs rather than
reaching into managers directly. HTTP surface: `/v0/control/*`, auth-gated,
serving the registry list and verb endpoints the client already implicitly
has — consolidation, not new capability.

## What this deliberately is not

- No policy engine, grants, or credential custody (hardening phase).
- No remote targets: `target` is an enum with one value, present in every
  contract so the home-daemon phase adds a value, not a field.
- No orchestration (invariant 11) and no event-contract formalization beyond
  the additive registry event — S10's full formalization stays at its phase.

## Verification

Node tests: registry projection correctness against fixture manager states,
status derivation matrix, verb delegation per kind (spawn/stop semantics,
stop-safety rules preserved), lineage recording, `registry_update` emission.
Existing chat and PTY test suites must pass unchanged — the refactor is
behavior-preserving for current features. Browser: sidebar/Remotes lists
driven by the registry event over mocked WS.
