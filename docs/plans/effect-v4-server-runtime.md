# Effect v4 server runtime consolidation

## Context

This plan records the architecture decision and the first implementation slice made from Conduit v0.8.0 main at `72b905b8`.

Conduit is no longer a Pi-specific web wrapper. The server now coordinates Pi, Codex, Claude Code, OpenCode, fx and ChatGPT Web adapters; persistent PTYs; voice and transcription workers; runtime discovery; authenticated HTTP, SSE and WebSocket clients; process and generation limits; replay; restart preparation; and native clients. The backend-neutral chat contract is already a strong boundary, but the mechanics underneath it have accumulated several small home-grown concurrency and lifetime systems.

Before this change, two examples were representative:

- `ChatLifecycle` implemented keyed serialization with a `Map<chatId, Promise>`, manual release promises, project activity counters, waiter arrays, `Promise.race` and timeout cleanup.
- `PiManager` independently implemented a promise-tail mutex for live-process capacity checks. Other server components also have their own timeout, abort and shutdown mechanics.

Each mechanism is understandable in isolation. The architectural problem is that Conduit is increasingly responsible for implementing the same resource, concurrency and failure mechanics in several places.

Effect v4 is now a stable LTS line and the core `effect` package has no runtime dependencies. It provides stable concurrency, resource scopes, typed failures, services/layers, scheduling and Schema. Those capabilities match the mechanics Conduit is already implementing while allowing the Conduit-specific contracts to remain explicit.

This is an architecture consolidation, not an Effect rewrite.

## What this PR changes

The PR pins `effect@4.0.1` and introduces one small server-only substrate, `src/server/effect-concurrency.js`. The server imports `effect/Effect` and `effect/Semaphore` directly rather than the package's broad root barrel, keeping this slice's runtime module surface limited to the primitives it actually uses.

`ServerConcurrency` is intentionally flat: it directly owns three mechanics, without local mutex wrapper classes:

1. A one-permit Effect semaphore serializes Pi capacity mutations. This replaces `PiManager.capacityQueue`.
2. Keyed one-permit Effect semaphores serialize chat lifecycle mutations. This replaces `ChatLifecycle.chatTails`.
3. Effect timeout/interruption owns the project-drain deadline. This replaces the explicit `Promise.race` and timer bookkeeping in `beginProjectDeletion`.
4. Project activity now has one drain latch per active period instead of a waiter array. Because deletion is exclusive, only one deletion can wait for that latch; the array was concurrency machinery without a second consumer.
5. Pi capacity policy calls the shared capacity mutex directly rather than retaining a pass-through `runExclusive` abstraction.
6. Pi process shutdown uses the same timeout primitive for the SIGTERM grace period before escalating to SIGKILL, removing another one-off lifecycle timer from `PiManager`.

The production composition root creates one `ServerConcurrency` and supplies it to `PiManager` and `ChatLifecycle`. Their public APIs and policy decisions stay where they are. Both classes still construct a private default when used independently in tests or tooling.

At this boundary the intended ownership is now literal:

```text
ServerConcurrency
  ├─ keyed chat mutex
  ├─ capacity mutex
  └─ timeout primitive
        ↓
ChatLifecycle     PiManager
(domain policy)  (Pi policy)
```

`ChatLifecycle` still owns launch coalescing, deletion state and project activity because those are Conduit lifecycle rules. `PiManager` still owns RPC correlation, generation/process policy, reaping and socket delivery because those are Pi/runtime rules. Neither owns another generic mutex or deadline implementation.

The conversion from Promise work to Effect deliberately maps a rejected value back to that exact value. Existing `Error` instances and their `code`, `status` and other fields therefore cross the Promise/Effect boundary unchanged.

## Behaviour that must not change

This work is intentionally below the domain contract. In particular:

- A full generation limit is still rejected immediately with `generation_limit`; it does not become a semaphore queue.
- The live-process cap still reclaims only processes that `PiManager` considers reclaimable, and still rejects with `live_process_limit` when it cannot make room.
- Concurrent `createWithCapacity` calls are still serialized so they cannot overshoot the cap.
- A second compatible launch still joins the in-flight launch. A launch with incompatible settings still receives `live_session_start_mismatch`.
- Chat move/delete/start transitions retain their existing per-chat order.
- Project deletion still marks the project deleting before waiting for existing guarded work, rejects new guarded work, waits up to the configured drain timeout, and clears the deleting guard after `project_busy`.
- Existing HTTP status codes and WebSocket error vocabulary remain unchanged.
- Browser disconnect still does not imply process shutdown.
- Transcript authority, adapter session identity and persistence remain unchanged.

The existing `chat-lifecycle.test.js` and `process-policy.test.js` tests exercise these invariants directly.

## What deliberately remains outside Effect

Several current Conduit mechanisms look sophisticated because the underlying problem is sophisticated. They should not be abstracted away merely to increase Effect usage.

### ChatLog

`ChatLog` is deterministic domain logic. It assigns one server-owned order to transcript record events and supports exact catch-up or reset. It has no resource-lifetime problem for Effect to solve and remains unchanged.

### Record versus paint delivery

The record/paint distinction is a core Conduit protocol invariant. Record events are authoritative and numbered; assistant/tool paint may be merged or dropped and is repaired by authoritative closes. `SocketDelivery`, high-water handling, frame pacing and replay semantics stay unchanged.

### Backend adapters

Pi RPC, Codex app-server, Claude Code, ACP/fx, OpenCode and ChatGPT Web remain separate adapters. Effect must not turn these into a lowest-common-denominator implementation. Adapters continue to own protocol transport, native session restoration and translation into Conduit's event vocabulary.

### Express and ws

This PR keeps Express, `ws`, HTTP routes, SSE and upgrade handling. Effect v4's HTTP family is useful but currently marked unstable. Replacing a mature transport boundary at the same time as changing the server runtime would create risk without simplifying the domain model.

### Solid and native clients

Effect is not introduced into the Solid client, Capacitor shell or Tauri shell. Their current state ownership is unrelated to the server-lifetime problem.

## Why start with concurrency instead of services or Schema

The safest first slice is code with an existing behavioral seam and direct regression tests. The two custom mutex implementations and the drain timer are pure orchestration mechanics; replacing them does not require changing any persisted shape, protocol event, route, adapter or UI.

Starting by converting every store into a `Context.Service`, every error into a tagged error, or every wire type into Schema would produce a much larger diff while leaving the old lifecycle machinery underneath it. The migration should delete custom runtime machinery as Effect is adopted, rather than adding Effect-shaped wrappers around an unchanged architecture.

## Architectural mass accounting

This slice is negative architectural mass by ownership and duplicated algorithms, not by raw line count.

Before it, chat serialization and Pi capacity each carried their own promise-tail mutex; project deletion carried a waiter registry plus a timer race; and Pi graceful stop carried another one-off deadline. After it, generic serialization and deadlines have one mechanical owner, while `ChatLifecycle` and `PiManager` retain only the policy that decides when those mechanics apply.

The production JavaScript diff is still net positive because `ServerConcurrency` is a new boundary. Effect is also a new dependency and therefore a new concept for a maintainer who does not already know it. This PR is justified by reducing the number of places that implement concurrency mechanics and by establishing a reusable boundary, not by claiming fewer source lines.

That creates a constraint on follow-on work: Effect adoption must continue to delete bespoke lifecycle/concurrency/resource machinery. If later slices leave the old managers and shutdown systems intact while adding Layers, services and scopes beside them, the migration has become positive architectural mass and should stop or be reworked.

## Intended server architecture

The direction is to make the server composition progressively simpler:

```text
Express / WebSocket boundary
           |
   application services
           |
    SessionSupervisor
           |
  backend adapters
```

Three explicit Conduit mechanisms remain beside that path:

```text
ChatLog        authoritative ordering / catch-up
Delivery       record vs paint / backpressure
Persistence    backend-owned transcript + Conduit metadata
```

A future `SessionSupervisor` should own common operational lifetime such as acquire, start, attach, interrupt, close and release. It should not know Pi JSONL, ACP, Codex JSON-RPC or OpenCode internals; those remain adapter concerns.

This matters for issue #29. The older unified-registry/broker sketch was written while runtime ownership was more fragmented. Conduit should avoid adding another broad control layer on top of `PiManager`, `PtyManager`, `ChatBackendRegistry`, `SessionRecords` and `RuntimeHub` if the same outcome can be reached by consolidating lifetime ownership. The eventual supervisor can provide the common registry/lifecycle surface while preserving chat, terminal and future worker differences.

## Follow-on slices

The migration should remain incremental and behavior-preserving.

1. **Resource ownership.** Move subprocesses, external streams, recurring timers and similar long-lived resources behind Effect scopes/acquire-release boundaries. A parent server/session scope should eventually make cleanup ownership structural rather than something every adapter and top-level shutdown path must remember independently.
2. **Application services.** As lifetime ownership stabilizes, expose narrower `ChatService`, `WorkspaceService`, `RuntimeService` and `VoiceService` boundaries. Route files should translate HTTP to application operations rather than receive large bags of stores/managers.
3. **Typed operational failures.** Replace ad-hoc `Object.assign(new Error(...), { code, status })` construction behind a common domain-error layer. Preserve the current external codes/statuses and translate domain failures to HTTP or WebSocket form at one boundary.
4. **Schema at trust boundaries.** Define persisted and wire shapes such as client commands, backend events, runtime state and persisted backend identity once, deriving runtime validation and TypeScript types from those definitions. Do this at browser/harness/disk boundaries rather than converting internal deterministic data merely for consistency.
5. **PiManager reduction.** Keep moving generic process/lifetime concerns outward until `PiManager` is primarily Pi launch/RPC/event translation/transcript behavior, structurally comparable to the newer adapters.
6. **Reassess transport last.** Only reconsider Effect HTTP after the runtime and service boundaries are stable and the Effect HTTP modules themselves are an acceptable stability dependency.

The desired end state is not “everything is Effect.” It is that Conduit stops carrying bespoke implementations of concurrency, cancellation, lifetime and dependency wiring where stable Effect primitives express the same mechanics more directly.

## Findings while implementing

Effect 4.0.1 is the v4 release pinned here and the package has zero runtime dependencies. Effect's v4 installation guidance supports Node 22.18 or newer.

Conduit's release installer/package path already records and enforces `NODE_MIN=22.19.0`, so the supported packaged runtime is already above Effect's floor and this PR does not need to raise the release requirement. `conduit-web/package.json` still declares Node `>=22`; that existing source-package metadata is looser than both the release floor and Effect's documented support floor. It is recorded here rather than silently changing install policy in this behavior-preserving PR.

No pre-existing server behavior bug was identified that needed to be fixed as part of these slices, so product behavior remains unchanged.

Review of the refactor itself found one timing bug before merge: project deletion originally re-read the active-period drain latch from state after crossing the Promise/Effect boundary. The final guarded operation could resolve and clear that state in the intervening microtask, turning a successful drain into an internal failure. The implementation now captures the drain promise synchronously before yielding, and a regression test forces that ordering.
