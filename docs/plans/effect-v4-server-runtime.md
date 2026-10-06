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

Effect `4.0.1` is pinned and used through four small server modules. Each replaces machinery that existed in several places:

| Module | Owns | Replaced |
|---|---|---|
| `server/effect-concurrency.js` | keyed chat mutex, machine-wide admission mutex, generation-start mutex, `within` (a bounded wait that releases its timer) | `ChatLifecycle`'s promise-tail lock, Pi's capacity queue, the project-drain `Promise.race`, seven `Promise.race`-against-`setTimeout` waits |
| `server/effect-process.js` | `terminate(child)`: SIGTERM, grace, SIGKILL, resolve on exit | separate escalations in Pi, the voice model, project clone, workspace git and the transcribe worker; fx and ChatGPT Web had none |
| `server/server-lifetime.js` | the server's Scope: each resource is owned where it is made and released in reverse, each release bounded and isolated | the hand-ordered `shutdown()` |
| `live-session-launcher.js` / `live-session-stream.js` | the live-process cap and the generation cap for every harness | Pi's own admission, reclaim, cap enforcement and generation limit |

Admission holds the machine-wide lock only while it reclaims room and reserves a slot. A launch then starts outside the lock holding its reservation, so one cold start does not hold up another chat's.

## Behaviour changes

Each was a choice; the defaults chosen are listed.

1. **Both caps apply to every harness.** The generation cap and the live-process cap were enforced for Pi only; Codex, Claude Code, OpenCode, fx and ChatGPT Web ran uncapped. They are now counted together. A turn waiting on an approval, compacting or retrying counts as generating.
2. **Every child process is escalated to SIGKILL.** fx and the ChatGPT Web sidecar were sent SIGTERM only and could outlive the server. A Pi `stop()` (not `stopAndWait`) now also escalates after 3s.
3. **Shutdown order follows creation in reverse:** browser sockets and streams first (each told the server is restarting), then the listener and its connections, the runtime hub, agents, the voice archive drain, the voice model, LAN advertisement, terminals last. The archive drain now runs after the agents stop rather than beside them. One failing or hanging release no longer stops the rest. Shutdown with nothing running takes ~50ms instead of ~1.1s.
4. **Launches no longer queue behind one another.** Only the slot check is serialized.

Unchanged: error codes and statuses, `generation_limit` is still an immediate rejection, compatible launches still join, project deletion and its drain, transcript authority, delivery and persistence.

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

Before it, chat serialization and Pi capacity each carried their own promise-tail mutex; project deletion carried a waiter registry plus a timer race; Pi graceful stop carried another one-off deadline; and the machine-wide live-process limit was duplicated between the backend-neutral launcher and PiManager. After it, generic serialization and deadlines have one mechanical owner, and the live-process budget has one policy owner outside every individual backend.

Effect is a new dependency and therefore a new concept for a maintainer who does not already know it. The standard for this migration is therefore stricter than line-count neutrality: each slice must delete an existing owner or duplicated algorithm rather than wrapping it. This PR now removes Pi's live-process admission, reclaim, enforcement and max-live configuration entirely.

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

1. **Session resource ownership.** The server scope and process termination are done. Next is a scope per live session, owning its child, timers and pending requests, so an adapter's `close` is closing that scope.
2. **Application services.** As lifetime ownership stabilizes, expose narrower `ChatService`, `WorkspaceService`, `RuntimeService` and `VoiceService` boundaries. Route files should translate HTTP to application operations rather than receive large bags of stores/managers.
3. **Typed operational failures.** Replace ad-hoc `Object.assign(new Error(...), { code, status })` construction behind a common domain-error layer. Preserve the current external codes/statuses and translate domain failures to HTTP or WebSocket form at one boundary.
4. **Schema at trust boundaries.** Define persisted and wire shapes such as client commands, backend events, runtime state and persisted backend identity once, deriving runtime validation and TypeScript types from those definitions. Do this at browser/harness/disk boundaries rather than converting internal deterministic data merely for consistency.
5. **PiManager reduction.** Keep moving generic process/lifetime concerns outward until `PiManager` is primarily Pi launch/RPC/event translation/transcript behavior, structurally comparable to the newer adapters.
6. **Reassess transport last.** Only reconsider Effect HTTP after the runtime and service boundaries are stable and the Effect HTTP modules themselves are an acceptable stability dependency.

The desired end state is not “everything is Effect.” It is that Conduit stops carrying bespoke implementations of concurrency, cancellation, lifetime and dependency wiring where stable Effect primitives express the same mechanics more directly.

## Findings while implementing

Effect 4.0.1 is the v4 release pinned here and the package has zero runtime dependencies. Effect's v4 installation guidance supports Node 22.18 or newer.

Conduit's release installer/package path already records and enforces `NODE_MIN=22.19.0`, so the supported packaged runtime is already above Effect's floor and this PR does not need to raise the release requirement. `conduit-web/package.json` still declares Node `>=22`; that existing source-package metadata is looser than both the release floor and Effect's documented support floor. It is recorded here rather than silently changing install policy in this behavior-preserving PR.

The thin server release path copies `package.json` and `package-lock.json` and installs production dependencies with `release-deps.mjs`, so Effect is included by the existing release mechanism without a packaging special case.

Continued review found one pre-existing capacity race and fixes it here: the backend-neutral launcher already enforced the live-process budget across all harnesses, but only Pi had a serialized create path. Two different backends could therefore concurrently observe the final free slot and both launch. Admission and launch are now serialized at the machine-wide boundary, and the redundant Pi-only reclaim/create path has been deleted.

Review of the refactor itself found one timing bug before merge: project deletion originally re-read the active-period drain latch from state after crossing the Promise/Effect boundary. The final guarded operation could resolve and clear that state in the intervening microtask, turning a successful drain into an internal failure. The implementation now captures the drain promise synchronously before yielding, and a regression test forces that ordering.
