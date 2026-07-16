# Personal Agent Platform: Vision Document

One address on the web. Behind it: one Interface for conversational, autonomous, and execution-heavy agent work. A task can begin in chat, move to the appropriate agent and machine without losing context, remain observable while running at whatever level of detail the moment calls for, and, in the completed vision, return its results to the session where it started. The system is pi-native but supports other harnesses through structured and terminal adapters.

The hero scenario, in ordinary prose: ask a question in chat; when the answer turns into work, escalate it into a codespace task with one tool call; check its live state in Remotes from your phone over lunch; answer the one question the agent needs a human for; and receive the PR link and a summary back in the original conversation, which still remembers why you asked. (Staging note: the last clause, return-to-origin, is the completing capability of the vision and ships late; until then the PR itself, observed on GitHub or via the session in Remotes, is the output. The everyday loop that ships first is: chat → seed → attach and observe → PR.)

## 0. Thesis

These statements direct the overall experience. Everything else in this document is derived from them.

**T1. Chat is not a different product from an agent.** Every surface except the Dashboard is presented as an agent session plus a renderer and an operating posture. The product preserves that interaction model even where the underlying harness and execution machinery differ; it varies the renderer (chat renderer, terminal pane, dashboard card, generated widget) and the posture (conversational tools, filesystem tools, scheduled autonomy).

**T2. The job to be done:** begin work conversationally, hand it to the right agent and machine without rebuilding context, observe it when necessary, and receive the result in the same place. Continuity is the product promise; running agents on a VPS, a home machine, or a codespace is the enabling capability, not the point. (Staging note: the final clause is the north star; near-term, handoff is seed-and-start and results are observed where they land.)

**T3. One address means one product boundary, not one renderer.** Every active agent session participates in one navigation, identity model, history, lineage, artifact system, attention state, and visual language. A PTY pane or an embedded specialist view is permitted; experiencing them as unrelated applications is not.

**T4. The Interface is the product.** The system deliberately avoids rebuilding agent reasoning, orchestration, and execution engines; it invests deeply in the Interface, state continuity, and the adapter layer that unify them. Calling the rest "thin glue" is accurate only because the deep work is concentrated here.

**T5. Pi-native, harness-extensible.** The architecture is optimised around pi, where the richest features (memory, code-mode tools, generative UI, native events) live first, and maintains explicit adaptation and escape layers for other harnesses. It does not pretend all harnesses are equivalent.

**T6. The Interface is the primary observational and interaction surface, not the system of record.** GitHub is authoritative for PRs and review, repositories for code, Gmail for email, the memory stores for personal memory. The platform is authoritative for sessions, provenance, dispatch, and generated artifacts, and it renders the rest without reproducing the applications that own them.

### Primary user

The founder-user: a technically capable individual using multiple agent harnesses and machines who wants one persistent, self-hosted interface across conversational and execution-heavy work. The design is flexible enough that opinionated defaults can dress it up for anyone: with nothing configured it is simply a claude.ai-like chat experience, and it stays that way until the user engages the Assistant (which is, by default, the Mercury-clone profile) or sends work to a machine (which is, by default, a specific pi setup). Approachability comes from defaults, not from a separate product.

### Two altitudes

The Interface has layered complexity rather than one density. The conversational altitude is Chat and the Assistant: conversation, tool use, seeding work, and (staged) progress, approvals, and results. The operational altitude is Remotes and the Dashboard: live sessions and their renderers, targets and health, budgets, schedules, configuration. Remotes is everyday territory (the core remote-control loop lives there); the Dashboard is occasional. The product is chat-first; the control room is one level down, not the front door.

## 1. Conceptual model and vocabulary

The canonical nouns. Sections after this one use them exactly.

**The Interface** — the product: one web application on your domain. Its navigation chrome and registry context is **the shell**. It has four **surfaces**:
- **Chat** — the claude.ai-like surface: many chats, organised (down the line) into folders. (Conduit today implements the filesystem half of grouping as "projects" — shared working-directory scopes; the folder-as-memory-pool half remains down the line.)
- **Assistant** — the persistent agent's surface: the same chat renderer as any chat, on its own always-accessible session.
- **Remotes** — every session that is not Chat or the Assistant: live instances on the VPS, home machine, or codespaces, however they were created (manually, via a chat hook, later via the Assistant), each displayed with the appropriate renderer. The monitoring window for anything running, including goal-mode runs.
- **Dashboard** — settings, configuration, targets and health, budgets, schedules, admin.

**Renderer** — the component class that displays a session: the chat renderer, the tau view, the PTY pane, the ACP renderer (later). A **pane** is an embedded renderer instance inside the shell. **Widget** — output of the generative UI channel; a persisted widget render is an artifact.

**Profile** — a configured agent role: harness, system prompt, tool **posture** (the tool/permission stance), memory scope, packages. **Harness** — the agent program itself: pi, Claude Code, Codex. **Agent instance** (colloquially "the agent") — a profile running via a harness on a target. **Session** — the persistent interaction context with one canonical event record (conversation/event files; for terminal-tier sessions, the byte stream plus metadata). Sessions outlive both browser connections and instances: an instance can die and a new one can resume the session from its files. Chats and the Assistant are **opened**; Remotes sessions are **attached** to. A session contains tasks; a task may have multiple runs.

**Host** — hardware or VM: the VPS, the home machine. **Target** — a spawnable execution location the broker knows: vps-container, home, codespace. Targets live on hosts. **Container runtime** — Docker/podman-class machinery, held by the broker.

**Task** — a bounded unit of work. **Run** — one execution of a task (an autonomous run, a scheduled run). **Dispatch** — the intent-level act, by the user or an agent, of initiating work elsewhere; it usually triggers a **spawn** (the broker creating an instance) and always records **lineage** (which session originated the work). **Seed** — the explicit context a dispatch carries. **Artifact** — a durable output (PR, file, widget render, report) linked to its producing task and originating session. **Instruct** — sending input to an existing session through the control plane or its renderer. **Collect** — retrieving a task's declared artifacts or completion report into the platform (and, in the completed vision, into the parent session). **Relocate** — resuming a session elsewhere. A relocation is **compatible** when the destination offers the same harness and profile and the state volume is available, so the same session resumes under a new instance; anything else (different harness, partial context) is not relocation but a child-session dispatch with lineage.

**State volume** — the portable files that carry agent state: session files, memory stores, AGENTS.md, tool config. **Lifecycle state** — the broker's desired/observed record of instances. **Memory scope** — the access boundary a profile defines. **Store** — a backing napkin instance (the Assistant's store; a folder **pool** shared by the chats grouped in a folder).

**The Assistant** — the canonical name of the persistent agent. **Control broker** ("the broker") — the private component mediating all session control. **Target daemon** — the constrained agent on each host that starts, stops, reports, and relays.

**Continuity is provenance and context across a linked lineage of sessions, tasks, and artifacts, not one universal session changing form.** A single session keeps one logical identity across reconnects and compatible relocations; escalation, by contrast, is a dispatch that creates a child session with its own history, harness, and target. In the completed vision the child's artifacts and completion report flow back to the parent; near-term, lineage is recorded at spawn and the artifacts are observed where they land.

## 2. Architectural invariants

Constraints that later contract and implementation work must respect. Not schemas; guardrails.

1. Sessions outlive browser connections and agent instances. A session has one logical identity across reconnects and compatible relocations; dispatch creates new sessions with explicit lineage rather than mutating the parent.
2. A session may have multiple renderers, but one canonical event record.
3. Targets are replaceable and disposable. Portable agent state is represented primarily through inspectable files and configuration; instances and host-bound capabilities are disposable. Identity also spans platform identifiers, lineage, permissions, and external bindings; those live with the platform, not in the state volume.
4. External systems remain authoritative for their native artifacts (T6).
5. The Interface provides unified navigation and lifecycle while allowing capability tiers; harness-specific capabilities degrade gracefully and honestly.
6. Agent instances receive scoped actions rather than raw credentials; secrets are held by the secret layer, never by models. This is credential and capability containment, which limits secret exposure and blast radius; it does not by itself prevent misuse of an authorised action. Approval policy (D10) governs consequential use, and content fetched from the outside world is treated as adversarial input.
7. Generated UI is an output channel, not trusted application code; it renders inside a sandbox boundary.
8. Context handoff is explicit and inspectable. The default seed is a structured context export (goal, selected transcript references, memory note references); transferring a full session file is an advanced, same-harness option, never the default.
9. Memory is scoped by default. A profile's memory scope is part of its definition; no instance receives access to personal memory merely by participating in the platform. Memory never travels with dispatch: context goes out as seed, results come back as artifacts, and each side updates its own memory from what it observes.
10. Every autonomous run has an explicit capability scope, budget, maximum duration, and a user-accessible cancellation path. (D14 decides the numbers and defaults, not the existence of bounds.)
11. A dispatched task belongs to one endpoint instance. The platform observes orchestration; it does not own it.
12. Adapters preserve the original source event alongside its normalized form. The stored representation is an append-only event log; the rendered transcript is a projection of it, never the primary record.
13. The normalized vocabulary has no required "thinking" category. Reasoning, status, or progress projections exist only where a harness explicitly emits them; the platform never assumes hidden reasoning is available or suitable for persistence.
14. PTY sessions are opaque by design: terminal bytes, connection state, process state, session metadata, and optional structured side-channels. No semantic inference from terminal text.
15. No identity or session assumption that makes future multi-user operation impossible; no team feature built speculatively.

## 3. System map

```
                        you (phone / laptop browser)
                                   │
                     https://your.domain  ← edge auth
                                   │
              ┌────────────────────┼──────────────────────┐
              │              VPS (always on)              │
              │                                           │
              │  EDGE + APP (public trust domain)         │
              │  the Interface: auth, Chat, Assistant,    │
              │  Remotes panes, Dashboard, user API —     │
              │  no host-control access                   │
              │        │ narrow RPC: desired actions      │
              │  CONTROL BROKER (private trust domain)    │
              │  policy, session control, short-lived     │
              │  grants, lifecycle state; sole holder of  │
              │  container runtime, gh creds, tailnet ctl │
              │        │                                  │
              │  instances: chat pool · Assistant ·       │
              │  spawned pool                             │
              └──────┬───────────────────┬────────────────┘
                     │ tailnet           │ gh CLI / API
                     ▼                   ▼
        HOME MACHINE (on-demand)     GITHUB CODESPACES (ephemeral)
        WSL2 target daemon:          devcontainer per repo,
        start/stop/status/relay for  harness via postCreate,
        pi+tau, Claude Code, Codex   tau via port forwarding
```

### Trust domains

Three domains, so that the publicly reachable component is never root over the system. The edge/application handles authentication, browser sessions, rendering, and the user API, and submits desired actions only. The control broker validates session-control requests, applies policy, issues short-lived target grants, and maintains lifecycle state; it alone touches the container runtime (rootless runtime or allow-listed spawn helper preferred; if a Docker socket remains necessary it is reachable only by the broker, never the web process), the gh credentials, and tailnet control. Target daemons on each host perform a constrained set: start an allow-listed profile, stop it, report status, relay events, collect declared artifacts. On a single personal VPS this is two processes and a narrow RPC, not a distributed system; the split is a security boundary, not an operational burden.

The broker mediates control, not bytes: session streams (tau WebSocket, PTY, ACP) travel between the edge/app proxy and target daemons over direct or relayed connections authorized by short-lived broker-issued grants; the broker itself carries lifecycle and policy traffic only. A minimal broker (registry; spawn, attach, stop, status) exists from the remote-control phase, because Remotes needs authenticated session control from day one of multi-host operation; the hardened broker (policy engine, custody of gh credentials and the container runtime) follows at its own phase.

Staged exception, time-boxed to the chat phase: the v0 seed tool in the chat profile holds gh/spawn actions directly via runline + psst until the minimal broker exists, at which point it becomes a thin broker client. This is consistent with invariant 6's configured-actions posture but violates the sole-holder rule during that window. Accepted knowingly: edge auth secures who talks to Chat, and the residual vector (injected web content triggering the seed action) is bounded by the action's narrow scope and the window's brevity.

### The Interface

A single native codebase: the shell plus the chat renderer, hosting the four surfaces (section 1). Everything in Remotes renders as an embedded pane inside the shell: tau's frontend proxied for pi sessions, a web PTY (ttyd/xterm.js) for CLI coding sessions and foreign harnesses, the ACP renderer when it lands. Nothing is independently served to the user; tau ports, PTY endpoints, and codespace forwards exist behind the app, inside its navigation and identity (T3). Binding notes:

- The chat renderer is never an embed; generative UI, dispatch UX, and future cross-session cards live there. Chat and the Assistant both use it (T1).
- Tau is both a UI and a protocol. Nativizing a pi-session lane later means speaking tau's WebSocket protocol from the shell with own components, with zero change on any host. Composition-first is therefore not a dead end.
- Day-one commitment even while composed: every session registers with the broker (or its v0 stand-in) and reports status; the platform subscribes to tau sessions as a headless second client; PTY status stays crude until ACP. The shell-level attention signal ("an agent is waiting on you") is the most valuable mobile feature and is never sacrificed to iframes.
- Mobile default: the tau view is the primary renderer for pi sessions even in coding mode; raw PTY is an opt-in toggle for pi and the primary renderer only for Claude Code/Codex until the ACP renderer exists.
- Nativization trigger: the first wanted cross-session feature (canonically: a diff card in Chat from work living in Remotes). Nativize exactly the lane that feature needs, not before.
- Down the line: first-class chat folders. A folder is a shared memory scope (a pool) for the chats grouped inside it; an ungrouped chat carries its own session history only (invariant 9).

### Capability tiers

| Tier | Sessions | Experience |
|---|---|---|
| Native | pi (tau protocol; chat profile) | Structured messages, tools, widgets, memory, diffs, approvals |
| Protocol-adapted | Claude Code, Codex, Gemini et al. via ACP adapters | Structured events, diffs, permission prompts where the adapter supports them |
| Terminal | anything with a CLI | Persistent remote terminal; opaque stream plus process/connection metadata; limited semantic integration |

The product unifies navigation and session lifecycle across tiers while being honest about feature differences (invariant 5).

### Normalized event contract

The internal contract the renderers share: a versioned, typed event vocabulary (message, tool-start/delta/end, widget-stream, file-change, session-status, permission-request; reasoning/progress projections only where emitted per invariant 13), with adapters from tau's protocol, ACP, and pi-web-ui's WebSocket protocol feeding it and raw source events preserved alongside (invariant 12). The vocabulary is drafted conceptually during the chat phase and formalized at the broker phase; early phases store nothing custom (pi's own session files are the persistence), so the contract formalizes a projection, not storage. It is the architectural keystone, not by itself the moat; the defensible asset is the accumulated experience built on it: adapters, graceful degradation, coherent rendering, session replay, artifact handling, cross-session provenance. The moat is turning heterogeneous harnesses into one coherent product experience.

### Memory topology

Scoped by default (invariant 9), concretely: the Assistant owns a single persistent store (napkin-backed) that only it writes; grouped chats share a folder pool (down-the-line feature, above); ungrouped chats have session history only; dispatched work receives its context as seed and returns artifacts, never memory files. Staged later-phase intent: the Assistant may consolidate durable context into its own store by harvesting chat scopes, gated by explicit per-scope read grants (never blanket access), making it the curator by grant rather than by ambient access. Whether the Assistant graduates further into a canonical system role remains reliability-contingent (D6).

### Named components

| Component | Lives | Built from / integrates | Role |
|---|---|---|---|
| The Interface | VPS, edge/app domain | Native shell + chat renderer (base: pi-web-ui components / Zetaphor pi-webui, D1); embedded tau frontend, ttyd/xterm.js panes | The product (T4); surfaces: Chat, Assistant, Remotes, Dashboard |
| Control broker | VPS, private domain | Custom (thin); container runtime; gh CLI; Tailscale | Policy, session control, lifecycle, grants |
| Target daemon | each host (home = WSL2) | pi + tau, ACP adapters, ttyd; Tailscale | Constrained start/stop/status/relay |
| Chat profile | VPS container | pi + chat system prompt; runline (code mode, 188 typed integrations), markit (anything→markdown), napkin (folder pools only; ungrouped chats have session history), search provider (D12), psst (secrets); v0 seed tool | The claude.ai-equivalent default surface |
| The Assistant | VPS container | pi + cron/loop sidecar + napkin + runline + psst + pi-goal + pi-system-reminders + pi-subagents; supervision patterns cherry-picked from Mercury (the "Mercury clone" build recipe), channels stripped | The persistent agent |
| Pi session web view | anywhere pi runs | tau (pi install npm:tau-mirror); tau-plus fork as IDE-layout reference | Self-hosted mirror, embedded as a Remotes pane |
| ACP renderer | Interface (later phase) | Agent Client Protocol; adapters: claude-agent-acp, codex-acp, gemini --acp, pi-acp / acp-adapter | One structured client for foreign harnesses |
| Generative UI channel | cross-cutting | pi-generative-ui (visualize_read_me + show_widget + guideline modules); renderers: sandboxed panel in the chat renderer, sidecar pane by terminals, Glimpse (+ Linux fork) when physically local | show_widget everywhere |
| Codespace target | GitHub | gh codespace create + devcontainer postCreate | Ephemeral repo-scoped execution |
| Review agent | the repo, not the platform | OTS: Qodo PR-Agent (OSS candidate), CodeRabbit, Copilot review (D17) | Review and merge-gating, delegated (T6) |
| Seed/dispatch tool | chat + Assistant profiles | small pi extension; chat phase = runline+psst pragmatic path, from the remote-control phase = thin client of the minimal broker | Starting work elsewhere |

### State model

Portable agent state is carried primarily in files: pi session files, napkin stores (plain markdown, BM25-searched), AGENTS.md, runline/psst config. Each instance mounts a state volume; syncing it (git or Syncthing, D6) and starting a new instance elsewhere is the practical form of relocation. Process migration is never attempted; repository state, provider-side state, credentials, and remote artifacts remain external and host-bound by design (invariant 3).

## 4. User journeys

Ordered by product weight. Legend: [D#] = open decision (section 6).

### Journey A: Chat (the complete minimum experience and default entry point)

```
open your.domain ──▶ edge auth (Google)
   │
   ▶ Chat surface (pi, chat profile)
       │
       ├─ plain conversation ──▶ streamed markdown answer
       ├─ needs the world ──▶ search tool ─▶ markit fetch ─▶ answer w/ sources
       ├─ needs your accounts ──▶ runline (creds held by psst, never the model)
       ├─ needs memory ──▶ folder pool via napkin if grouped; ungrouped
       │                    chats have session history only (invariant 9)
       ├─ "visualize / show me" ──▶ show_widget ─▶ inline widget panel
       └─ "go do this elsewhere" ──▶ seed tool
              │  seed = structured context export: goal + selected
              │  transcript refs + memory note refs (invariant 8)
              ▶ starts an instance (v0: runline+psst path; later: broker)
              ▶ lineage recorded; a session link appears; the work is
                then observed in Remotes or lands as a PR
              ▶ (north star, later: artifacts + completion report
                 return here, to the parent)
```

Standalone, this journey is a complete product; the differentiated product emerges when the user crosses from conversation into persistent execution. Attachments arrive via the chat renderer; as implemented, Conduit stores them as working-directory files and passes validated relative paths in the prompt envelope, letting Pi read bytes on demand (supersedes markit-ing for uploads; markit remains the fetch path for web content). Runline output renders as plain text/default tool blocks for now (S19).

### Journey B: Remotes (the core loop: remote control of live agents)

```
open Remotes ──▶ every live session outside Chat/Assistant:
   VPS containers · home machine (tailnet) · codespaces —
   manually created, chat-seeded, or (later) Assistant-dispatched
   │
   ├─ attach ──▶ appropriate renderer opens as a pane:
   │     pi ──▶ tau view (default, mobile-friendly);
   │            raw PTY as an opt-in toggle
   │     Claude Code / Codex ──▶ PTY pane now; ACP renderer later
   │     anything else ──▶ PTY pane
   ├─ interact: answer the agent's question, steer, review inline
   │     diffs (as pi already renders them), watch widgets stream
   │     to a sidecar pane
   ├─ attention signal: the shell badges any session waiting on you
   └─ detach; the session persists; reattach from anywhere
```

This is the most-used loop after Chat itself: agents living on the VPS, the home machine, or a codespace, controlled through the one Interface instead of a scatter of terminals. Parallelism inside a task is the endpoint's business: pi-subagents on pi, native subagents on Claude Code/Codex (invariant 11).

### Journey C: Seeded async task (fire-and-forget; the aspirational full-async loop)

```
trigger (chat seed tool, Dashboard, later the Assistant)
   ▶ seed: repo + goal + landing condition (+ memory note refs)
   ▶ ONE instance spawned at a target (codespace default, or home);
     child session, lineage recorded, visible in Remotes throughout
   ▶ agent self-manages: subagents, retries, its own loop discipline
   ▶ landing = PR on the repo
   ▶ OTS review agent reviews on the repo ─▶ approve / comment ─▶ merge
   ▶ output = the PR, observed on GitHub or via the session in Remotes
   ▶ teardown: codespace deleted (stopped ones leak storage quota)
   ▶ (north star, later: report + artifacts land in the parent session)
```

Richer platform-side choreography (retry policies, landing verification, multi-agent coordination) is explicitly long-term; sortie/lalph-shaped issue-driven dispatch is the reference if it ever returns to scope.

### Journey D: The Assistant

```
                    ┌──────────────────────────────┐
   you, via the ───▶│  the ASSISTANT (persistent   │◀── cron sidecar
   same chat        │  pi) · own napkin store ·    │
   renderer, on     │  runline + psst ·            │
   its surface      │  pi-goal / ralph (later)     │
                    └──────┬──────────┬────────────┘
        outputs            │          │ (later phase) dispatch
   ├─ own-store writes     │          └──▶ Journey B / C instances
   ├─ widget renders ──▶ Dashboard board   (seed out, artifacts
   ├─ messages in its session               observed; no memory
   └─ proactive notify ──▶ [D5]             files exchanged)
```

The Assistant arrives early but in basic claw mode: checking email, calendar, sending messages, scheduled runs via runline and cron. Dispatch authority (spinning up async work in Remotes or codespaces) is granted only after demonstrated reliability; the contracts are deliberately hookable so that authority can be switched on at any time without rearchitecting. Interface-wise it is a privileged, always-accessible session on its own surface, rendered by the exact same chat renderer as everything else; if it proves most useful for quick fire-and-forget commands, it can become a persistent quick-command affordance without rearchitecting. It owns its memory store outright (section 3); the later-phase intent is for it to harvest chat-scope memories into that store, under explicit per-scope read grants. Whether it graduates into a canonical system role (report sink for all sessions, dispatch mediator) is deliberately open and reliability-contingent (D6).

### Journey E: Dashboard (the operator surface)

```
open Dashboard
   ├─ CONTROL: spawn / attach / instruct / cancel / terminate ─▶ broker
   ├─ TARGET HEALTH: home daemon (tailnet), codespaces (gh), spend [D14]
   ├─ ASSISTANT board: recent widget renders, schedules
   └─ ADMIN: secrets (psst), store browser, budgets, config
```

Intentionally boring: a table, a form, and links into panes the shell already renders. The live-sessions list itself lives in Remotes; the Dashboard is where you operate the platform, not where you watch agents.

### Journey F: Generative UI (cross-cutting channel)

```
any pi session, any surface
   ▶ visualize_read_me (lazy guideline module) ─▶ show_widget (HTML streams)
   ├─ chat renderer ──▶ inline sandboxed widget panel (streamed morphdom at v2)
   ├─ terminal pane ──▶ widget sidecar
   ├─ Dashboard ──▶ persisted renders on the Assistant board
   └─ physically at a machine ──▶ Glimpse native window (Linux fork)
```

Staging: (1) tools + guidelines in every pi profile → (2) web rendering → (3) streaming → (4) return channel and persistence. The long-term product commitment is declared: generated interactive applications, approval workflows rendered as widgets, and real-world actions driven through them are intended capabilities, staged last because the return channel is both the frontier and a distinct security boundary (invariant 7); scope and timing remain open (D9, D10). The guideline corpus is treated as a swappable module expected to shrink as models internalize the skill.

## 5. Settled decisions

Tags: **[C]** = architectural commitment, durable; **[S]** = current implementation strategy, expected to evolve without changing the vision.

**S1 [C]. Hybrid topology, cloud-default.** VPS always on (Interface, broker, chat pool, the Assistant); home machine is an opt-in target powered on when wanted; Codespaces for ephemeral repo work. ([S] sizing note: agent loops are I/O-bound; a 2 vCPU / 4GB VPS suffices; tokens are the real spend.)

**S2 [C]. Pi-native, harness-extensible (T5).** Chat, the Assistant, and the default coding harness are pi. Claude Code / Codex are first-class guests via adapters, with honestly tiered capability.

**S3 [C]. Portability via state, not process** (invariant 3).

**S4 [C]. Machine plane on Tailscale regardless of front door.** VPS↔home traffic never touches the public internet; no router port forwarding; target daemons unreachable except via tailnet.

**S5 [C]. Auth at the edge, Google identity; only the edge/app is publicly reachable; instances get no public routes.** ([S] flavor, pick one: Cloudflare Tunnel + Access, or Caddy + oauth2-proxy self-hosted; D2.)

**S6 [C]. Credential and capability containment.** Instances act through configured actions (runline connections), secrets held by psst; scope limits exposure and blast radius; approval policy (D10) governs consequential use; external content is adversarial input (invariant 6).

**S7 [C]. Three trust domains** (section 3): edge/application, control broker, target daemons; the container runtime socket is never reachable from the web process; the broker mediates control, not bytes (session streams are data plane, flowing under broker-issued grants). [S] a minimal broker ships with the remote-control phase; staged exception, chat phase only: the v0 seed tool holds gh/spawn actions via runline + psst until then, documented and time-boxed.

**S8 [C]. One Interface, four surfaces (Chat, Assistant, Remotes, Dashboard), composition-first as the path [S].** Native shell + chat renderer; embedded tau and PTY panes in Remotes; every session registered with status from day one; tau view as the mobile default; nativization lane-by-lane, triggered by the first cross-session feature. (Details in section 3.)

**S9 [C]. Session tiers: native (tau) / protocol-adapted (ACP) / terminal (opaque PTY, invariant 14).** [S] sequencing: PTY ships before the ACP renderer; ACP is worth building because one client covers Claude Code, Codex, Gemini and future harnesses, and returns structured results to spawning instances.

**S10 [C]. The normalized event contract is an early design step**, versioned and typed, with raw-event preservation, append-only log, transcript-as-projection, and no required thinking category (invariants 12-13). [S] timing: vocabulary drafted during the chat phase, formalized at the broker phase.

**S11 [C]. Memory is scoped by default and never travels with dispatch** (invariant 9; topology in section 3): Assistant-owned store; folder pools (down the line); session-only memory for ungrouped chats; seed out, artifacts back. [S] the Assistant-harvests-chat-memory consolidation is a later-phase planned capability.

**S12 [C]. All session control passes through one broker-mediated control plane**: spawn, attach, instruct, cancel, terminate now; collect and relocate as later verbs of the same plane. Control only: session byte/event streams are data plane, flowing under broker-issued grants (section 3). Every actor (Dashboard, chat seed tool, later the Assistant) uses the same plane; one spawn API is a consequence, not the abstraction. [S] near-term: dispatch is seed-and-start only; the return flow (collect, report-to-parent) is the north-star closing capability. Codespaces auto-delete at landing.

**S13 [C]. The Assistant exists early, in basic claw mode; dispatch authority is granted later, on demonstrated reliability**, with contracts hookable at any time (Journey D). [S] composition: pi + cron sidecar + napkin + runline + psst + pi-goal + pi-system-reminders, supervision patterns cherry-picked from Mercury's source ("the Mercury clone" recipe); messaging channels omitted (the Interface is the channel).

**S14 [C]. No first-party orchestration** (invariant 11). Endpoint-native subagents handle parallelism; platform-side fire-and-forget choreography is long-term; the orchestrator ecosystem stays on the watchlist.

**S15 [C]. No first-party review surface.** Landing = PR; review = OTS review agent on the repo (D17); the Interface links and displays but hosts no review workflow (T6).

**S16 [C]. Generative UI is a staged, cross-cutting channel** with the long-term interactive commitment declared (Journey F).

**S17 [C]. MCP is opt-in only, everywhere.** Default: no MCP servers anywhere. Tool admission order: runline plugins → CLIs → pi extensions/skills. MCP by explicit per-environment, per-surface opt-in, reserved for integrations where it absorbs genuinely hard auth or stateful-connection complexity, preferring deferred-loading servers. Rationale: token-efficiency thesis (multi-server MCP setups burn five-figure context before the first message; code mode and progressive disclosure are the validated fixes) plus blast-radius control.

**S18 [S]. Diffs, near term: inline inside Remotes sessions only** (the TUI/tau view already renders them); the VPS chat pool and the Assistant do no diff-producing work themselves. Cross-session diff cards in Chat are the designated nativization trigger (S8), likely combining event-based sourcing for pi/ACP sessions with PR links for the rest.

**S19 [S]. Tool-output rendering: plain now.** Generic code-mode card + genUI-on-demand later; optionally handcraft the 3-5 daily-use plugins after the Interface matures.

**S20 [S]. Build order, remote-control-first.** (0) VPS + edge auth + a pi web surface, usable from a phone. (1) Chat profile + toolbelt; event vocabulary drafted; v0 seed tool (runline+psst path). (2) Remote-control core: minimal broker (registry; spawn/attach/stop/status), home target daemon over tailnet, attach in Remotes (tau proxy + PTY pane); the seed tool becomes a broker client. (3) Codespace target (seed a goal loop; output = the PR). (4) Broker hardened: policy, grants, credential and runtime custody, event contract formalized. (5) The Assistant, basic claw mode. (6) ACP renderer. (7) Return-to-origin: the collect verb ships and completion reports land in the parent session (the north star closes; ACP's structured results make collect clean). (8) GenUI streaming; Assistant dispatch authority.

## 6. Open decisions

**D1. Webapp base for shell + chat renderer.** Fork Zetaphor pi-webui (fastest to polished chat; small third-party codebase you then own) vs build on @mariozechner/pi-web-ui components directly (maximum control for the genUI panel and dispatch UX; write the server glue yourself, with Zetaphor's repo as reference). Tau covers phase 0 either way. Decide at phase 1 by how much you want to own the flagship. (Resolved in practice by Conduit: neither — a native shell and chat renderer built from Shadcn primitives with Streamdown rendering over a custom Express + Pi RPC server, owning the flagship outright; Zetaphor's repo and pi-web-ui remain references only.)

**D2. Edge auth flavor** (S5). Operational zero-effort + a corporation in the path, vs sovereignty + you patch the edge. Decide by comfort with Cloudflare seeing traffic metadata.

**D3. VPS provider and region.** Latency and price only; trivially reversible thanks to S3.

**D4. Model/provider strategy and how auth reaches headless instances.** Subscription OAuth (cheaper at volume; ToS risk and refresh plumbing in always-on containers) vs API keys (clean, metered); one model for chat vs cheaper models for background runs. Invisible to the architecture; dominates cost.

**D5. Proactive notification channel.** Web push via PWA (one surface; iOS push mediocre), self-hosted ntfy (simple, separate app), email (boring, reliable), or a messaging app as a pure pager deep-linking back. Blocks nothing until the Assistant phase.

**D6. Memory mechanics and Assistant authority.** Topology is settled (S11); open: sync mechanism (git history vs Syncthing liveness), store layout, folder-pool implementation and timing, and whether the Assistant graduates into a canonical system role (report sink, dispatch mediator), which is deliberately reliability-contingent: decide after observing it in practice.

**D7. Chat instance lifecycle.** Long-lived (instant, accumulates cruft) vs per-conversation ephemeral (clean, cold start) vs warm-recycled nightly. Decide by feel during phase 1.

**D8. GenUI investment pace.** Iframe-on-completion v1 is cheap; streamed-morphdom v2 is the claude.ai magic and meaningfully more work inside the sandbox boundary. Decide by whether entrance quality matters early.

**D9. Widget return-channel scope and timing.** The commitment is declared (Journey F); open: how far (widgets sending conversation messages, approval widgets, persistent mini-apps) and when. The new attack surface (model-generated UI emitting messages as-if-from-you) prices the decision.

**D10. Assistant approval posture.** Full autonomy vs approval queue vs per-action-type policy (read freely, write with approval, escalate destructive). Interacts with D9 (approval buttons are the killer widget). Recommendation to react to: per-type, default write-approval, relax with trust. Decide before the Assistant gets runline write scopes (early, given basic claw mode ships at phase 5).

**D11. Default harness for seeded async repo work.** pi + pi-goal (consistent with T5, observable via tau, extensions travel) vs Claude Code/Codex via ACP (arguably stronger long-horizon coding today, subscription economics). Per-task override always; the template needs a default. Bake off on real tasks at phase 3.

**D12. Search provider.** Exa / Brave / Tavily / Firecrawl; several exist as runline plugins; markit handles fetch regardless. Pick one, revisit never unless annoyed.

**D13. Home daemon ergonomics on Windows.** WSL2 autostart vs manual start; Wake-on-LAN "wake my machine" affordance vs the stated posture of turning it on when planning to use it.

**D14. Budget and bound numbers** (the bounds themselves are invariant 10). Token caps per surface (the Assistant's runs are the risk), codespace spending limit ($0 hard cap is legitimate), max concurrent instances, idle teardown, max run durations. Set numbers before the Assistant runs unattended overnight.

**D15. Tau posture: upstream vs fork.** Teaching tau to render show_widget benefits every mirrored pi session everywhere (highest-leverage upstream contribution available) vs a private fork for velocity.

**D16. License for the platform code.** MIT/Apache (adoption) vs AGPL (cloud-hijack deterrence, enterprise friction) vs BSL/FSL (source-available, protects a hosted offering). Upstream dependencies keep their own licenses either way. MIT is the right default while this is a personal project seeking contributors; decide only if productisation becomes real.

**D17. Which review agent.** OSS candidate: Qodo PR-Agent (self-hostable, per-repo). Commercial: CodeRabbit, Copilot review, Gemini Code Assist. Criteria: self-hostable, per-repo config, approve-gating you control. Low coupling; swap freely.

## 7. Coverage check

"Chat online, single pi on VPS" → Journey A, the complete minimum experience. "Remote into one or multiple agents on home machine(s)" → Journey B, the core loop; multiple machines = multiple target daemons on the tailnet, rows in Remotes. "The Assistant instructs existing or spins up home instances or codespaces" → Journey D → the control plane (S12: instruct/attach cover existing sessions; ACP session/load or pi's extension API underneath; a later-phase authority per S13; richer agent-to-agent dialogue is long-term, hcom-shaped buses the watchlist reference). "Directly seed a pi goal loop on a codespace, fire-and-forget with a landing template" → Journey C; output is the PR; parallelism owned by the endpoint. "Chat calls a tool to enter this flow, transferring context" → Journey A's seed branch (invariant 8; v0 = seed-and-start only). "Connect to Codex or Claude Code on the home machine" → Journey B, PTY now, ACP later. "Generative UI in terminal, web UI, or both" → Journey F, all renderers.

Deliberately unspecified at this stage: control-plane and seed schemas, the event-contract wire format, the ACP↔shell bridge shape, widget sandbox policy details, store directory templates, profile image definitions.

## 8. Future productisation (optional; documented so the architecture doesn't foreclose it)

For users, the value proposition is continuity: one place to talk to, launch, observe, and return to your agents, wherever they run. "Neutral, self-hosted-first control plane for personal agents" is company positioning for contributors and technical buyers, not the user pitch. The ownable layer is the Interface, state continuity, and adapters (T4); upstream OSS (pi, tau, napkin, runline, markit, ACP adapters) is depended on, never forked into ownership.

**M1. Hosted control plane + relay (the core, open-core pattern).** Paid tier = exactly what the self-hosted build makes you sweat: edge auth, relay/NAT traversal, push, sync, backup; agents, credentials, and code stay on the customer's hardware. Happy proves the privacy-preserving variant (E2E-encrypted relay moving only ciphertext, self-hostable for skeptics). The relay is the natural SaaS chokepoint: the one component that must be public and always on. Free self-host forever; ~$8-15/mo personal cloud; hybrid base-fee + usage pricing per current agent-SaaS norms.

**M2. Managed compute targets: optional expansion, strategically heavy.** A fourth target ("managed") with metered margin fits the target abstraction with zero redesign, but it changes the business (infra cost, abuse, isolation, billing, support). Treat as expansion, never assumed revenue; sandbox vendors (E2B/Daytona-style) already productize the substrate.

**M3. Team tier: explicitly outside the core vision.** D10's approvals and D14's budgets are the eventual enterprise feature list (plus SSO, RBAC, audit trails capturing what and why), and the market converges on compliance-first, scoped-access, audited agent deployment. The only present-tense obligation is invariant 15.

**M4. Templates and profiles.** Indirect monetization (awareness, funnel); if ever a real marketplace, the product is verification and trust, per the ClawHub malicious-skill cautionary tale. Not monetized: agents, models, inference.

Productisation back-pressure on open decisions: D2 tilts toward portable auth primitives, D5's answer becomes the hosted relay, D6's sync graduates into a sellable service, D16 becomes live. None force different choices today.

## 9. Landscape watchlist (known, deliberately not adopted)

agentapi (HTTP control of TUI agents; candidate PTY-tier implementation detail), AgentBox / Daytona / E2B (sandbox targets; M2-relevant), sortie / lalph (issue-driven dispatch shapes for long-term Journey C), hcom (agent-to-agent bus; long-term "instruct existing session"), agent-of-empires and Agent Orchestrator (multi-harness session managers, both pi-aware; the benchmark Remotes must beat), vibe-kanban / cmux / Claude Squad et al. (the orchestration lane the platform stays out of), Happy (the remote-access slice, and the E2E relay reference for M1), Open WebUI / LibreChat (the model-chat-webapp shape this project deliberately is not).
