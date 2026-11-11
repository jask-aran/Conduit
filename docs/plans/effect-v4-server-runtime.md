# Effect v4 server runtime

Effect is used on the server for concurrency, process termination and lifetimes (`server/effect-concurrency.js`,
`server/effect-process.js`, `server/server-lifetime.js`, `server/session-scope.js`). This is an architecture
consolidation, not an Effect rewrite: the end state is that Conduit stops carrying its own implementations of
concurrency, cancellation, lifetime and dependency wiring, not that everything is Effect.

## The rule for further slices

Each slice must delete an existing owner or duplicated algorithm, not wrap it. If a slice leaves the old managers and
shutdown systems in place while adding Layers, services and scopes beside them, the migration has become extra mass
and should stop or be reworked.

## What stays outside Effect

- **ChatLog**: deterministic ordering and catch-up; no lifetime problem to solve.
- **Record versus paint delivery**: record events are authoritative and numbered, paint may be merged or dropped and
  is repaired by closes. `SocketDelivery`, high-water handling, frame pacing and replay stay as they are.
- **Harness adapters** stay separate and own their transport, native session restoration and translation into
  Conduit's events; Effect must not turn them into a lowest common denominator.
- **Express and ws** stay until the runtime and service boundaries are stable and Effect's HTTP modules are stable.
- **The Solid client and the Capacitor and Tauri shells.**

## Intended server shape

```text
Express / WebSocket boundary
           |
   application services
           |
    SessionSupervisor
           |
  harness adapters
```

beside ChatLog (ordering, catch-up), delivery (record vs paint, backpressure) and persistence (harness-owned
transcript plus Conduit metadata). A `SessionSupervisor` owns common lifetime (acquire, start, attach, interrupt,
close, release) and knows no harness protocol. Prefer consolidating lifetime ownership over adding another control
layer on top of `PtyManager`, `ChatBackendRegistry`, `SessionRecords` and `RuntimeHub`.

## Open slices

1. **Application services**: narrower `ChatService`, `WorkspaceService`, `RuntimeService` and `VoiceService`, so
   route files translate HTTP to operations instead of receiving bags of stores and managers.
2. **Typed operational failures**: replace ad-hoc `Object.assign(new Error(...), { code, status })` with one
   domain-error layer, keeping external codes and statuses and translating to HTTP or WebSocket at one boundary.
3. **Schema at trust boundaries**: client commands, harness events, runtime state and persisted harness identity
   defined once, with validation and types derived from them, at browser, harness and disk boundaries only.
4. **Transport last**: reconsider Effect HTTP only after the above.

Open: `conduit-web/package.json` declares Node `>=22`, looser than the release floor (`NODE_MIN` 22.19.0) and Effect's
supported floor (22.18).
