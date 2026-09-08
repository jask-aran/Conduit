# Backend-neutral chats + ChatGPT Web adapter — implementation plan

Source roadmap: **#41** (backend-neutral chats and agent-managed profiles).
Related: **#29** (unified session registry/broker), **#56** (managed profiles — explicitly out of scope for agent-managed), **#31** (seed dispatch, v0 Pi-only), **#55** (PTY literal-CLI fallback).
Status: shaping sketch → this doc is the build sequence. Feature sub-issues become authoritative for the slices they implement (per `CONTRIBUTING.md`: Roadmaps stay Roadmaps, children are Features).

> Rule from #41: keep `chat` as the one structured agent session. Do not introduce a `workspace_agent` surface. PTY stays the separate exact-fidelity escape hatch.
>
> Architecture decision (answers the two-paths question): **one chat control plane, parallel adapter implementations — not two parallel stacks.** `conduit-pi` stays a first-class, full-fidelity backend *inside* the neutral contract as the privileged adapter. Third-party profiles (Codex CLI, ChatGPT Web, OpenCode, …) are thin adapters that wire through to their own backend. The neutral contract is an envelope, not a straitjacket: the required lifecycle is tiny, everything Pi-specific rides as optional capabilities plus opaque Pi passthrough. No Pi feature is removed or remodeled to fit a third-party backend.

## 0. Outcome

- Assistant / Coding / Code Mode remain Conduit-managed on pinned Pi RPC with unchanged observable behaviour (first compatibility proof). Pi keeps its full behaviour: steering, follow-up queues, compaction, thinking levels, model switching, plans, edits, terminal output, usage/cache stats, extension UI — nothing is leveled down to fit third-party backends.
- Users select **profiles, and profiles map to backends**: `conduit-pi` profiles keep the current Conduit-managed experience (tools, context, skills, overlays injected as today); agent-managed profiles (first: **ChatGPT Web**) wire through to their backend with no tool/context injection, and the model picker shows only models that backend reports.
- Chat persists frozen profile/backend identity; lifecycle (create/restore, prompt, streamed activity, cancel, permission/host interaction, reconnect, close) runs through a backend-neutral boundary.
- Browser renders normalized events without speaking Pi RPC, ACP, or `backend-api`.
- Optional features are capability-gated; missing Pi-only capabilities don't break the chat.
- One transcript authority per chat. Backend choice immutable after durable history (switch = fork).
- External-agent config stays authoritative in the user's installation for thin adapters.

## 1. Current architecture (what we are migrating)

| Layer | Today | Files |
|---|---|---|
| Chat lifecycle serialization | `ChatLifecycle`: per-chat tails, project guards, delete draining | `conduit-web/src/chat-lifecycle.js` |
| Pi process management | `PiManager`: `buildPiArgs (--mode rpc)`, spawn, capacity caps, reaper, RPC `prompt/abort/get_state/get_session_stats/fork/extension_ui_response`, `SessionManager.open` for cache stats, `createPiEventNormalizer` | `conduit-web/src/pi-manager.js`, `scripts/pi-runtime.mjs` |
| Event vocabulary | Pi-shaped: `agent_start/end/settled`, `message_start/update/end`, `tool_execution_*`, `extension_ui_request/resolved`, `queue_update`, `compaction_*`, `runtime_state/exit/error/stdout/stderr`, `context_usage`, `session_checkpoint` | `pi-manager.js`, `pi-event-normalizer.js`, `activity.js`, `active-generation.js` |
| Persistence | Pi JSONL authoritative; Conduit JSON stores identity/registry/preferences only; `sessionIdFor`, `runtime: "pi-rpc"` markers | `conduit-web/src/session-store.js`, `session-operations.js` |
| Chat HTTP API | templateId + runtimeKind (`conduit_profile` \| `native_pi`), `runtimeFor()`, `templateForChat()`, model-profile overlay for web-search | `conduit-web/src/server/routes/chats.js`, `model-profiles.js`, `model-profile-runtime.js` |
| Registry | live-session routes, runtime stream | `server/routes/live-sessions.js`, `runtime.js`, `runtime-hub.js` |

Invariants that must survive (from `docs/distillations.md`): singular transcript/catalog ownership; server-owned live-process lifecycle; metadata before transcripts; resolve untrusted paths once; keep Pi installations separate; verify RPC against pinned `@earendil-works/pi-coding-agent 0.84.1`; one auth boundary; preserve streaming/navigation identity.

## 2. Target contract (from #41, frozen here)

```ts
type SessionSurface = "chat" | "terminal";
type AgentProtocol = "pi_rpc" | "acp" | "native_api" | "pty";
type AgentImplementation = "conduit_pi" | "native_pi" | "codex" | "opencode" | "chatgpt-web" | string;
type ProfileManagement = "conduit" | "agent";

interface AgentProfile {
  id: string;               // e.g. "assistant", "coding", "code-mode", "chatgpt-web"
  label: string;
  management: ProfileManagement;
  agent: { protocol: AgentProtocol; implementation: AgentImplementation; installationId: string };
  // resources (prompts/tools/skills/extensions/model scope/overlays) — Conduit-managed only
}

interface PersistedChatBackend {
  profileId: string;
  profileRevision: string;
  protocol: AgentProtocol;
  implementation: AgentImplementation;
  installationId: string;
  opaqueSession: unknown;   // adapter-private: Pi sessionFile | ACP sessionId | {conversation_id, parent_message_id}
}
```

Adapter responsibilities: transport + version negotiation; launch/attach details; map backend events → Conduit vocabulary; backend session restore + transcript replay/restoration data; backend-specific config ops. Each adapter also reports its own model catalog (model picker is scoped per adapter — selecting `chatgpt-web` never shows Pi models and vice versa) and its own capability set. Conduit-managed resources (system prompts, tools, skills, extensions, overlays, web-search routing) apply only to `management: conduit` profiles; agent-managed adapters bypass injection entirely and wire the prompt through.
Conduit responsibilities: stable chat/project identity; frozen backend; server-owned process/sidecar lifecycle + reconnect; small command surface (create/resume, prompt, cancel, close, host interaction); normalized browser events (assistant content, tool activity, permissions, status, errors); capability reporting.

Explicit non-constraint: the neutral boundary must never reduce what `conduit-pi` can do. If a Pi behaviour cannot be expressed in the required lifecycle, it is carried as an optional capability or Pi-namespaced passthrough, or the boundary is extended — Pi is never cut down to match the thinnest adapter. Two adapter *implementations* in parallel, one chat *control plane* (lifecycle, registry, transcript ownership, delivery/backpressure, reconnect). We do not maintain two chat stacks, two persistence authorities, or two client protocols.

Do not generalize every Pi feature into a required interface. Steering, follow-up queues, compaction, thinking levels, model switching, plans, edits, terminal output, usage are **optional capabilities**.

## 3. Normalized event + capability vocabulary (slice 1 output)

Browser must never see `pi_rpc` / ACP / `backend-api` shapes. Adapters map into:

- `assistant_content` (delta + final; preserves current `content_block_delta` merge/coalesce + streaming identity rules)
- `tool_activity` (start/update/end with data-driven generic cards; unknown tools still render)
- `permission_request` / `permission_resolved` (today: blocking `extension_ui_request`; ChatGPT Web initially: none — capability off)
- `status` (working/stopping/idle/failed + coarse activity derivation)
- `error` (typed: `generation_limit`, `live_process_limit`, `rpc_timeout`, `rate_limited` with `retry_after`, `auth_expired`, `backend_unavailable`)
- `usage` (optional; Pi provides tokens/cost/cache stats — others may omit)
- `session_checkpoint` / `runtime_state` (reconnect resume)

Capability flags per adapter (advertised at create, enforced client-side): `steer`, `followUpQueue`, `cancel`, `compaction`, `thinkingLevels`, `modelSwitch`, `toolUse`, `permissions`, `usage`, `replay`. Missing Pi-only capabilities must degrade, not break. `conduit-pi` advertises the full set (it defines the superset); thin adapters advertise a subset and the UI hides/disables what they lack. Hiding steering/queues/thinking/model-switch for ChatGPT Web constrains *that adapter's UI*, never Pi's.

## 4. Slices

All work lands on `main` as a sequence of small, reviewable commits. Each slice is a Feature sub-issue of #41 with its own acceptance + evidence. Tiers per `docs/testing.md` (prefer Tier 1–2 during iteration; Tier 4 release-only).

### Slice 1 — Extract + document current lifecycle and event contract

Goal: make the implicit contract explicit with zero behaviour change.
Work:

- Audit `pi-manager.js` (all published event types, `view()`, delivery/backpressure path), `pi-event-normalizer.js`, `activity.js`, `live-sessions` WS protocol (`conduit-web/README.md` protocol section), `chat-lifecycle.js` transitions.
- Write the normative vocabulary (§3) + lifecycle state machine (create/restore → prompt → stream → settle/cancel → reconnect/close) as code-adjacent docs + types.
- Add contract tests: normalizer fixtures, `deliveryDeltaKey/mergeDeliveryDelta` parity, harness scenarios (steady/burst/stall) with versioned JSON.
- Acceptance: doc + types land; `npm test`-equivalent Tier 1–2 green; no observable Pi change.
- Evidence: `node --test test/<contract>.test.js`, `npm run test:harness -- --scenario streaming-burst` (first-delta, gap p95, coalescing ratio as observations, not extra runs).

### Slice 2 — Neutral identity + persistence migration

Goal: chats record frozen backend identity without breaking existing chats.
Work:

- Add `AgentProfile` / `PersistedChatBackend` to session/chat stores with migration: existing Pi chats → `{management: conduit, protocol: pi_rpc, implementation: conduit_pi|native_pi, installationId: conduit-pinned|host-pi}`, Pi JSONL authority preserved, `bySessionFile` mapping untouched.
- Rename Pi-specific generic fields (`templateId/runtimeKind`-era names) behind compat readers; update `server/routes/chats.js` to accept profile selection while still serving old clients additively.
- Keep `data/` hygiene (never commit `.env*/data/credentials/logs/dist/node_modules`).
- Acceptance: old chats open/resume/compact unchanged; new fields present on new chats; migration covered by unit tests; `README.md`/API docs updated additively.
- Evidence: Tier 1 store/migration tests + targeted browser nav (Tier 3 only if sidebar/chat-search touched).

### Slice 3 — Route Pi through the neutral boundary (Pi as privileged adapter, parity-gated)

Goal: `PiManager` becomes one adapter behind the neutral lifecycle **with zero observable change**. This is a behavior-preserving refactor, not a remodel: any Pi behaviour change in this slice is a bug.
Work:

- Define server-side `ChatBackendAdapter` interface: `create(opts) / restore(opaqueSession) / prompt(msg, opts) / cancel(generationId) / close() / respondHostUi(res) / replay(since?) → normalized events / getCapabilities() / listModels()`.
- Implement `PiRpcAdapter` wrapping existing `PiManager` (capacity, reaper, `ChatLifecycle.run/runLaunch`, delivery, `view()` projection minus Pi leakage). Pi-only richness (steering, queues, compaction, thinking, `get_session_stats` usage/cache stats, extension UI) passes through as full capabilities + Pi-namespaced fields — never stripped.
- Route all chat creation/prompt paths through the adapter registry with `conduit_pi` as the only registered implementation. Keep Pi-direct vs Pi-behind-adapter parity runs side by side during the migration; cut over only when identical. Later adapters (ChatGPT Web) land additively behind a flag and cannot affect the Pi path.
- Acceptance: no observable regression in prompt/stream/cancel/reconnect/fork/model-switch/compact/permissions; caps (`maxLiveProcesses`, `maxGeneratingProcesses`) and 429s preserved; harness parity (first-delta, gap p95, coalescing); Pi adapter still exposes every capability it does today. Performance note: Pi keeps its exact delivery mechanics (delta merge/coalesce, high-water-mark backpressure, pause/recovery, flush timers, same `JSON.stringify` wire via lossless v0 serialization) — the adapter adds a `forChat` lookup plus one per-event normalization whose result is discarded except for `.pi`. Parity runs prove no stream regression.
- Evidence: Tier 2 harness + Tier 1; `npm run test:setpieces` only if transport/reconnect touched (it's Tier 4-ish cost — gate accordingly).

### Slice 4 — Codex app-server adapter + capability-gated neutral client

Status today: the browser still speaks v0 Pi — wire is lossless Pi payloads and the client assumes Pi capabilities everywhere (steering, queues, thinking, model switch, compaction, extension-UI permissions, usage). Server-side launch routes through the adapter but steady-state + wire do not yet. Slice 4 is the cutover that makes the client backend-agnostic.
Goal: make Codex app-server the first user-testable non-Pi backend while the UI stops assuming Pi and backend switches fork.
Work:

- Adapter: add `CodexAppServerAdapter` over the installed `codex app-server --stdio` JSONL protocol. Use the machine's existing Codex installation and authentication. Map initialize, thread start/resume, turn start, streamed item deltas, turn completion/error, and turn interruption into the neutral contract. Add no ACP bridge and no credential store.
- Profile: expose an agent-managed `codex` profile when the CLI probe succeeds. Scope its model list and capabilities to app-server. Do not inject Conduit Pi prompts, tools, skills, extensions, model profiles, or web-search overlays.
- Client: capability-gated composer/controls (hide/disable steering, queues, thinking, model switch, compaction when unadvertised); normalized error/rate-limit rendering with `Retry-After` backoff display.
- Server: reject in-place profile/backend change on chats with durable history (`409 backend_locked` + fork offer); allow it only pre-history.
- Registry (#29 surface): expose profile/adapter/implementation/installation + opaque session kinds without Pi-generic names.
- Acceptance: Pi chats show full capabilities with no observable change; a user can select Codex, create a chat, prompt, stream, cancel, reconnect, and resume through the installed CLI; Codex renders cleanly with reduced controls; in-place switch is blocked after durable history and fork works; transcript ownership remains singular after reconnect. Client contains no Pi RPC, ACP, or `backend-api` shapes — only normalized events and capability flags.
- Evidence: Tier 1 protocol/parser/capability/locking tests, Tier 2 app-server probe and harness, and one targeted Tier 3 browser pass over profile selection, model picker, and composer controls.

### Slice 6 — Session discovery, visibility, workspace binding, foreign-session adoption

Goal: Conduit stays the source of "what sessions exist, where, and how to start them" across all adapters, and users can resume backend sessions Conduit didn't start without breaking transcript ownership or workspace trust.

Design (extends #41's opaque-session + workspace-binding rules):

- **Workspace binding is the anchor.** Every adapter launches with `cwd = ` the Conduit project's working root (never a model-chosen arbitrary path; resolve once at the server boundary, reject symlinks/escapes, keep `session_cwd_mismatch`-style validation). The chat record stores `{projectId, cwd, installationId, opaqueSession}` — Conduit holds the pointer, never parses backend session files.
- **Discovery = registry + metadata.** Sidebar/dashboard serve bounded registry metadata only. Adapters expose `listSessions()` filtered to the bound workspace (e.g. Codex on-disk sessions). Registry projects two sets: durable Conduit chats (first-class) and live foreign backend sessions (adoptable). No transcript scans for lists.
- **Adoption ceremony (explicit, never silent merge).** User picks a foreign session → Conduit creates a *new* chat bound to that project + opaque session (frozen backend from birth; switch = fork). History comes from read-only consumption of the harness session file where one exists; each adapter declares its replay fidelity (full transcript vs summary vs from-now) and Conduit journals its own view forward from adoption. Never two writers on one chat.
- **Trust boundaries.** Backend owns its config/models/auth/instructions; Conduit owns display identity, lifecycle, workspace binding, session mapping, event normalization. Adopting a session imports no backend settings into Conduit-managed profiles. Per-adapter concurrency caps and serialization (e.g. one flight per ChatGPT account) live in the adapter, enforced through the same `ChatLifecycle` serialization.
- **Acceptance:** workspace-scoped foreign sessions listed without full-transcript reads; adoption creates a frozen-backend chat that streams, reconnects, and replays per its declared capability; adopted chats can't acquire a second transcript authority; paths outside the project allowlist are rejected.
- **Evidence:** Tier 1 registry/adoption/path-allowlist tests + Tier 2 sidecar probes; one Tier 3 pass only if the picker/adoption UX is touched.

### Slice 7 — Adapter dashboards and ephemeral drive mode

Goal: each harness gets a graphical home in Computer for status, sessions, launch, and resume — plus a low-commitment way to take control of a harness thread without creating a Conduit chat. (One slice here; may split into server seam + UI halves at implementation time.)

Design:

- **Placement.** Computer sidebar gets one row per installed adapter (actual product mark — Codex/OAI, Claude Code, OpenCode, etc. — not a generic Lucide glyph; 13–16px static SVG vendored per adapter with Lucide fallback only when no mark is available; brand color lives on the glyph alone, surrounding chrome stays neutral), name, status dot; selected = gray wash. Route `/computer/harness/<adapter>` renders a full pane, not a modal or chat. Files view gains folder-contextual "open *<harness>* here," deep-linking the dashboard with `cwd` preset to the navigated folder (allowlist-validated before anything spawns).
- **Three zones.** Status strip (version, auth state with one-click recovery, quota/reset where reported, sidecar health for web); sessions ledger (bounded metadata only — title/id/workspace-relative cwd/timestamps — split into *Tracked* with chevrons to sidebar chats vs *Adoptable* foreign, workspace-scoped with a project selector); launch row (optional initial prompt + cwd preset + start; optimistic row on adapter confirm, inline rollback on failure).
- **Drive mode (ephemeral, adapter-driven, Conduit persists nothing).** Opening a foreign thread renders the same transcript/composer UI bound to an ephemeral context (`{adapter, opaqueSessionId, cwd}`) — no chat record, no journal, no sidebar entry — but every interaction flows through the *same adapter prompt path* as a mounted chat. One session, one driver: the attached adapter connection. No concurrent terminal, no handoff games; unmapped native behaviour (question tools et al.) must be handled by per-harness structured mappers, which are required adapter work, not optional polish. Anything the adapter cannot map surfaces as a typed unsupported-interaction with link-back/native instructions, never a second writer. Close = detach and drop; the thread stays modified harness-side. Concurrency serializes per opaque id. Header always marks it "driving `<harness>` thread — not tracked" with the native id.
- **Mount upgrade.** Every drive view carries one-click "track this thread": runs the slice 6 adoption ceremony from current harness state (new frozen-backend chat, initial read per declared fidelity, journal from here). Drive→mount is a promotion, never a surprise; close itself stays lightweight with no unsaved-changes drama.
- **Server seam.** `getStatus()`, `listSessions({projectId, cwd?})`, `launch({cwd, prompt?})`, `mount(sessionId)`, plus ephemeral open/prompt/close through the *same adapter path* with no persistence. All list paths metadata-first; transcript bytes flow only on open/mount. Realtime over the existing runtime SSE, reconciled by stable session id. The standalone PTY escape hatch stays exactly what it is today (a separate terminal surface for literal CLI use) — it is never attached concurrently to an adapter-driven session.
- **Acceptance:** dashboard lists workspace sessions without transcript scans; folder-contextual launch creates a tracked chat in the right project; drive opens/closes with zero Conduit persistence and unmistakable not-tracked chrome; mount-from-drive produces a normal frozen-backend chat; untrack action reads "removes from sidebar; harness session retained."
- **Evidence:** Tier 1 seam/allowlist/ephemerality tests (close leaves no record); Tier 2 adapter probes; one Tier 3 pass for dashboard + drive/mount flows.

## 5. Slice 5 — ChatGPT Web as second agent-managed adapter (`native_api`)

Why ChatGPT Web remains separate from Codex app-server: the requested model (**GPT-5.6 Pro / Sol Pro**) is a **Chat-surface** entitlement with its own allowances, not reachable through Pi's `openai-codex` subscription path. Slice 4 first validates the adapter architecture through the installed Codex CLI at low cost. This slice then adds the distinct Chat surface. Verified: OpenAI help documents separate Chat allowances (Pro $200: 200/wk GPT-6 Pro + 170/day Sol Pro, combined 200/day; other plans share one allowance) and lists Work/Codex/API availability separately from Chat Pro selection ("select GPT-5.6 Sol, then choose Pro"). Pi's `openai-codex` OAuth provider covers subscription/Codex usage only.

> Scope: new generations via the web-chat path. Chat-history import is a separate later feature (export `conversations.json` first; live `GET /backend-api/conversations` mirror later).

### 5.1 Why cookie + `backend-api` (no headless Chrome by default)

Three proxy families were surveyed; only one fits:

- **Codex-OAuth proxies** (`router-for-me/CLIProxyAPI`, `raine/claude-code-proxy`, `claudecodex` launcher): correct for subscription agentic work, wrong product surface for Chat Pro. Rejected for this adapter.
- **Browser-automation proxies** (`Octo-Lex/ChatGPT-Web2API` — Chrome+CDP+MCP; `CatGPT-Gateway` — Patchright stealth + Xvfb/VNC + copy-button detection): handle Turnstile/PoW transparently but cost a browser per session, single-session locks, selector drift. Fallback only.
- **Cookie + `backend-api` with auto-refresh** (`zhaees/chatgpt-proxy` pattern: Bun proxy + Python `curl_cffi` helper): direct web-chat path, no browser, proven PoW + Cloudflare handling. Selected.

Key mechanism (from `chatgpt-http-helper.py`, 805 lines, cross-checked vs Dec-2025 HAR study + `gin337/ChatGPTReversed`):

1. **Cookies in, bearer out.** User pastes `document.cookie` once. Durable secret: `__Secure-next-auth.session-token` (~30d); `_puid`/`oai-sc` help; `__cf_bm`/`_cfuvid` rotate ~30min. Hold them in a `curl_cffi.Session(impersonate="safari17_0")` — Safari TLS fingerprint is what defeats Cloudflare where raw Node `fetch` 403s. Session jar auto-captures `Set-Cookie`; persist to disk; refresh via `GET https://chatgpt.com/` on any 403 then retry once. `GET /api/auth/session` → `accessToken` (cache ~20min).
2. **Sentinel gate.** Scrape DPL from homepage (`cdn.oaistatic.com` script URLs / `data-build`). `POST /backend-api/sentinel/chat-requirements` with `{"p": <requirements-token>}` → `{token, proofofwork: {seed, difficulty}, turnstile, arkose}`. (Newer web flow splits into `prepare → finalize`; treat endpoint shape as drift surface.) Solve PoW locally: `sha3_512(seed + base64(config))` loop to difficulty; `config` = screen sums, parse-time string, Safari UA, DPL, script URL, navigator/document/window keys, core count.
3. **Conversation.** `POST /backend-api/conversation` (HAR also shows `/backend-api/f/conversation` + `/conversation/init`; version-drift) with `action: next, messages[{id, author{role}, content{parts[]}, metadata{…}}], parent_message_id, model: <slug>, conversation_id?`, `conversation_mode: {kind: primary_assistant}`, `supports_buffering`, `client_contextual_info`, plus `thinking_effort` for thinking/pro slugs. Headers: `Authorization: Bearer`, `Openai-Sentinel-Chat-Requirements-Token`, `Openai-Sentinel-Proof-Token`, `Oai-Device-Id` (stable UUID), `Oai-Language`, `Origin/Referer`, `Accept: text/event-stream`. Parse SSE v1 delta (`v.message` full + `o: append, p: /message/content/parts/0` chunks + shorthand `{"v"}` inheriting last path). Cursor = returned `conversation_id` + assistant `message_id`; reuse per setup-hash up to ~30min/20 turns.
4. **Retention.** Web conversations are retained by default — every chat is a Conduit chat regardless of backend. Agent turns will accumulate in the chatgpt.com sidebar; accepted for history continuity.
5. **Model slugs are dynamic.** Known map stops at 5.5 (`gpt-5-5-pro`, `gpt-5-4-pro`, `research`, `agent-mode`). Discover 5.6-Pro slug at runtime via authed `GET /backend-api/models`; expect a `gpt-5-6*pro*` slug matching the Chat "Sol → Pro" affordance — confirm against the account before hardcoding.

### 5.2 Conduit integration shape

- **Sidecar owned by the server** (like voice workers): Python `curl_cffi` helper on loopback (vendored into the sidecar env — confirmed absent from the working venv) + thin `ChatGptWebAdapter` implementing the §2 interface. Pi never sees `backend-api`. `curl_cffi` containment: sidecar-only import (the server process never touches it); pinned exact version + impersonation profile recorded in the sidecar manifest and reported by `GET /health` alongside cookie state; bump profile/version only as a deliberate compat event with a probe run. It solves the *network* fingerprint only (TLS ClientHello/JA3-JA4, cipher/extension order, HTTP/2 framing — e.g. `safari17_0`); PoW/Turnstile/challenge layers are handled separately by the sentinel code. Missing dependency fails closed with typed `backend_unavailable` — never silently fall back to plain `fetch`/`requests`, which would burn challenge budget on doomed 403s. Profile rot is expected (fingerprints move with browser releases); update cadence is "bump on observed 403-rate change or upstream release."
- **Profile:** `{id: "chatgpt-web", management: "agent", agent: {protocol: "native_api", implementation: "chatgpt-web", installationId: "user-chatgpt-account"}}`. Conduit owns display identity, sidecar lifecycle, workspace binding, session mapping, event normalization — not model/config/instructions (agent-managed per #41). No Conduit tool/context injection on this path; the prompt wires straight through, and the model picker for this profile lists only what the web `GET /backend-api/models` call returns.
- **Auth UX (case by case):** CLI harnesses consume the machine's existing setup — no credential UX in Conduit; a missing login fails cleanly with "set up the CLI first." ChatGPT Web gets an expanding 'third party harnesses' card on the Models/Accounts settings page for pasting the web cookie. Sidecar `GET /health` shows `has_token/session_cookies/cookie_updates` (names only, never values). 401 → prompt re-paste; 403 → auto-refresh path. Secrets stored like passwords, redacted in logs, never in chat JSONL.
- **Capabilities advertised:** `streaming:true, tools:emulated (XML <tool_call> prompt injection, system prompt truncated ~12K), cancel:true (best-effort — backend has no true abort; close generation client-side and drop stream), permissions:false, modelSwitch:false, thinkingLevels:false (slug-chosen), compaction:false (Conduit-side), usage:false, replay:reread-via-backend-api-with-journal-fallback, models:web-catalog-only`.
- **Transcript ownership and deletion semantics:** Conduit journal is authoritative for the Conduit view; the backend session is retained. Deleting a Conduit chat *untracks* it (drops the registry binding + Conduit journal) — harness-owned sessions underneath survive, including web conversations. Link-back affordance per backend: web chats expose the chatgpt.com URL; CLI sessions expose the native `resume <id>` command for the terminal escape hatch.
- **Rate limits:** surface web 429s as normalized `rate_limited` with `retry_after` (60s default, parsed when present); client backs off. Serializes per-account (one flight at a time; queue, don't parallelize).
- **Fallback to headless Chrome** only if sentinel returns `turnstile.required:true`/Arkose-interactive or Cloudflare `challenge-platform` blocks `curl_cffi` persistently. Do not pay the browser tax by default.

### 5.3 Acceptance (slice 5 Feature)

- `chatgpt-web` appears in profile selection, creates a normal chat, streams normalized `assistant_content`, survives browser + server reconnect via journal replay.
- Frozen backend enforced (switch → fork). Reduced capability UI renders with no Pi assumptions.
- Cookie refresh survives Cloudflare rotation without user action; expired session token prompts cleanly (`auth_expired`).
- Web conversations are retained with a link-back URL; deleting the Conduit chat untracks rather than deletes the backend session.
- 5.6-Pro slug discovered live and recorded; PoW + sentinel shapes that drifted are isolated to the sidecar (no Conduit contract change).

### 5.4 Evidence

- Tier 1: SSE v1-delta parser fixtures, PoW solver vectors, session-map + cleanup unit tests, capability tests.
- Tier 2: sidecar-level `curl` probes (`/health`, `/v1/models`, non-streaming then streaming `/v1/chat/completions`) before any Pi wiring.
- Tier 3 (only if profile picker/composer touched): one Playwright pass; never Tier 4 in-iteration.

## 6. Risks and open questions

- **Abstraction risk (the two-paths concern), answered:** Pi is not forced through a lowest-common-denominator path. The required contract is tiny by design; Pi defines the capability superset and keeps every behaviour it has today, proven by Pi-direct vs Pi-behind-adapter parity before cutover. The alternative — two full chat stacks — would duplicate lifecycle serialization, delivery/backpressure, reconnect, persistence, and client state, and force every future fix (#29 registry, #31 dispatch) to be built twice. Single control plane + parallel adapters is the cheaper long-term shape.

- **ToS gray area:** personal local use of your own ChatGPT account via its web path is the tolerated end; never expose as public API or resell. Keep it single-user loopback, matching Conduit's self-hosted posture.
- **Endpoint drift:** `sentinel/chat-requirements` vs `prepare/finalize`, `/conversation` vs `/f/conversation`, SSE v1 encoding, slug names — isolate all of it in the sidecar; Conduit contract must not move when they do.
- **Missing dependency:** `curl_cffi` vendored into the sidecar env with pinned version + profile (see §5.2 containment); alternative (Node TLS-impersonation lib) is more work and unproven here.
- **No true cancel / no usage / emulated tools:** agentic quality differs from Pi/Codex; document as capability limits, don't fake them.
- **History:** live sidebar read (`GET /backend-api/conversations?offset&limit` + `GET /backend-api/conversation/<id>` graph walk) is deliberately deferred; bulk path is the data-export zip (`conversations.json`). Retention default is retain-everything (see §5.2); untrack-vs-delete and link-back are the settled semantics.
- **Ordering:** #29's registry is the shared projection slice 6 extends; #31 broadens dispatch targets only after slice 6 lands.
- **Open:** exact 5.6-Pro slug + sentinel `turnstile` posture for this account; per-account concurrency limit tuning.

## 7. Sources

- #41 / #56 / #31 / #29 bodies via `gh api repos/jask-aran/Conduit/issues/{41,56,31}`.
- OpenAI: GPT-5.6 and GPT-6 Pro in ChatGPT — https://help.openai.com/en/articles/20001354-gpt-56-in-chatgpt
- Cookie+`backend-api` reference implementation — https://github.com/zhaees/chatgpt-proxy (`chatgpt-http-helper.py`, `chatgpt-provider.ts`, `proxy.ts`)
- Web flow dissection (BFF gateway, sentinel prepare/finalize, celsius→WS, conversation graph, widget vs `call_mcp`) — https://alinr.com/experiments/chatgpt-har-architecture-conversation-data.html
- Sentinel/PoW token walkthrough (`getRequirementsToken`, `_generateAnswer`, csrf/session/requirements/proof tokens) — https://github.com/gin337/ChatGPTReversed
- History endpoint shapes — https://github.com/terminalcommandnewsletter/everything-chatgpt/blob/main/README.md
- Browser-automation fallback patterns — https://github.com/Octo-Lex/ChatGPT-Web2API ; https://dev.to/gautamvhavle/i-reverse-engineered-chatgpts-ui-into-an-openai-compatible-api-and-heres-why-you-shouldnt-ch
- OAuth-path contrast (subscription usage, not Chat Pro) — https://github.com/router-for-me/CLIProxyAPI ; https://github.com/raine/claude-code-proxy ; https://github.com/karem505/claudecodex
