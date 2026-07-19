# Spec: v0 seed tool — chat escalates work to the local target

Status: draft · Priority: 6 · Requires: broker-registry. Vision: Journey A's
seed branch, invariant 8, S12 (seed-and-start only; return-to-origin is a
later phase).

## Goal

From any General-profile chat, the model can call one tool that starts a
Coding session in a chosen Workspace with an explicit, inspectable seed, and
drops a link card into the originating chat. This is the product's first
dispatch: conversation → execution without rebuilding context. v0 targets the
**local target** only; when remote targets exist, the same tool gains a
target parameter and nothing else changes.

## The tool

A Pi extension `templates/chat/extensions/conduit-seed/` registered in the
General template (and available to Coding):

```
seed_work({
  goal: string,                  // required; imperative task statement
  context?: string,              // model-composed brief: relevant facts,
                                 // constraints, decisions from the chat
  workspace: string,             // slug/id of an existing project or Workspace
  profile?: "workspace"          // v0: Coding only; default
})
```

- The seed is **explicit and inspectable** (invariant 8): the child's first
  user message is a structured, human-readable seed block — goal, context
  brief, origin chat title + id. Never a session-file transfer, never memory.
- The extension calls the Conduit server over loopback:
  `POST /v0/control/spawn` with a per-process bearer token Conduit injects
  into the Pi process environment at launch (`CONDUIT_CONTROL_TOKEN`, random
  per process, revoked when the process exits). The token authorizes only
  `spawn` with `target: "local"` — narrow scope, matching the vision's staged
  v0-seed exception.
- The broker records `lineage.parentSessionId`; the child chat is an ordinary
  Coding chat in the target Workspace, visible in the sidebar like any other.

## Origin-chat experience

- The tool result renders as a native card (registered in the tool renderer
  registry from `ui-parity.md`): child title, workspace, status chip driven by
  `registry_update` events, and a link that navigates to the child chat.
- The child chat header shows a "seeded from …" breadcrumb back to the parent
  (lineage made visible both directions).
- Return-to-origin (results/report landing back in the parent) is explicitly
  out of scope — the north-star closing capability stays at its phase. The
  card's live status chip is the v0 substitute.

## Guardrails

- `workspace` must resolve to an existing catalog entry; the tool cannot
  create projects, pick arbitrary paths, or select Host Pi in v0 (Isolated Pi
  Coding profile only — dispatch never receives the user's native credentials
  by default).
- Spawn through this path counts against the existing process/generation caps
  and appears in the registry like any session; there is no hidden execution.
- One level of dispatch in v0: the Coding template does not get spawn
  authority over further children yet (no accidental recursion).

## Verification

Node tests: spawn endpoint token scoping (wrong/absent/expired token, scope
violation), workspace resolution failures, lineage persistence, seed-block
construction. Extension test per the template test pattern
(`pi-template.test.js` style) that the tool is offered only to intended
profiles. Browser: seed card renders from mocked events, status chip updates,
navigation to child and breadcrumb back. End-to-end (real server, one test):
a scripted tool call produces a child chat whose first message is the seed
block.
