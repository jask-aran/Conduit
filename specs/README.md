# Conduit roadmap and implementation specs

Companion to `personal-agent-platform-design.md` (the vision). The vision says
where the product ends up; this directory says what gets built next and in what
order. Each spec is self-contained enough to hand to a coding agent.

## Where we are (2026-07)

Chat is deep and real: durable chats over Pi RPC, profiles, projects,
Workspaces (managed/linked/cloned host directories), and a dual runtime
(bundled Isolated Pi vs the user's native Host Pi). This is the vision's
**local target** — a first-class tier as of the 2026-07 amendment — built
before any remote machinery because the immediate need is controlling one's
own coding agents on one's own machine from anywhere, without the vendor
lock-in of Claude Code / Codex remote control.

What does not exist yet: authentication (the server is currently reachable via
a Tailscale funnel with no login — this is the single blocking risk), the
Remotes/Assistant/Dashboard surfaces, any broker or dispatch machinery, and a
long tail of interface parity gaps (tool-call legibility, thinking UX,
/commands, diff/file viewing, settings).

## Order of work

| # | Spec | What it delivers | Depends on |
|---|------|------------------|------------|
| 1 | [edge-auth.md](edge-auth.md) | Password login gating every route and socket; CLI provisioning | nothing — **do first, blocks funnel exposure** |
| 2 | [ui-parity.md](ui-parity.md) | Tool-call legibility, thinking UX, native tool components (question tool first), /commands, settings overhaul | nothing; parallelizable in independent PRs |
| 3 | [rhs-panel.md](rhs-panel.md) | Right-hand panel: file navigator/preview, diff viewer, artifact viewer | nothing; pairs with ui-parity |
| 4 | [remotes-pty.md](remotes-pty.md) | Remotes v0: server-owned PTY sessions rendered as terminal panes | edge-auth (a shell in the browser must sit behind login) |
| 5 | [broker-registry.md](broker-registry.md) | In-process control plane: one session registry across chats and PTYs, spawn/attach/stop/status verbs | remotes-pty (its sessions are the second registry client) |
| 6 | [seed-tool.md](seed-tool.md) | v0 seed tool: chat escalates work into a Coding session on the local target, with lineage | broker-registry |

Rationale for the order: auth is a precondition for everything reachable
off-machine. The parity work (2–3) continues the flagship investment and is
independent, so it can proceed in parallel PRs with disjoint file ownership.
Remotes-as-local-PTY (4) delivers the original motivating scenario — attach to
CLI agents from a phone — without any multi-host machinery. The broker (5)
starts as an in-process module that unifies what `PiManager` and the PTY
manager already track, defining the registry record and verb contracts the
remote phase will reuse. The seed tool (6) then dispatches to the local target
through those verbs; remote targets (home daemon, codespaces) come after, as
S20 phase 2–3 proper.

## Conventions

- Specs describe behavior contracts and constraints, not line-by-line diffs.
  `AGENTS.md` remains the implementation contract (style, testing, Solid/Kobalte boundaries,
  data ownership); specs do not restate it.
- Each spec ends with a verification section listing the checks a PR must
  pass. Per `AGENTS.md`, every spec's PR additionally restarts the managed
  server before handback and ends its report with a manual smoketest
  checklist for the user.
- When a spec ships, fold its durable behavior into `README.md`/`AGENTS.md`
  (stateless, per the documentation contract) and delete or mark the spec
  shipped; specs are not long-term documentation.
