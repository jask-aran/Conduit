# Distributed Nodes, Remote Workspaces, and Durable Execution

Status: architecture proposal / shaping; **not implemented by this document**.
Scope: Conduit server, installed clients, Conduit Pi, third-party harness adapters, workspaces, tasks, and security.
Date: 2026-10-08.
Repository: `jask-aran/Conduit`. Related references: [web runtime](../../conduit-web/README.md), [harness contract](../chat-backend-contract.md), [installation and client model](../DEPLOYMENT.md), [testing](../TESTING.md).

## Purpose and core decision

Conduit currently assumes that the server runs on the environment whose files, processes, and installed tools matter. Clients access that server's environment, whether they are remote or on the same machine. This proposal separates **intelligence and coordination** from **where actions happen**.

**The Conduit server owns harnesses, model interaction, orchestration, persistent tasks, chats, authoritative event records, and scheduling. Nodes expose explicitly authorised files, execution environments, and device capabilities. UI clients let people observe and direct work.**

A Node can be a Windows PC, a WSL environment, a Linux server, a phone, or a later headless companion. The server's own environment is represented through the same Node model, with a local adapter where appropriate. A workspace's home is independent of the client used to access it.

The agreed direction has **two execution strategies**:

1. **Conduit Pi: direct remote tools.** Pi's harness process and model context reside on the central server. Its Conduit-provided file, search, edit, and shell tools act on the Node that hosts the workspace. Remote file contents and tool output are streamed as needed; no complete editable replica is required.
2. **Third-party harnesses: server-side materialised mirrors.** Codex, Claude Code, OpenCode and other harnesses continue to run unmodified core processes on the server, using real local directories that Conduit has populated from a remote Node. Conduit performs controlled incremental synchronisation and conflict-checked write-back to the authoritative workspace. The harness's ordinary shell and builds therefore execute on the **server**, not on the source device.

These modes are **properties of how a particular run accesses a workspace**, not different kinds of workspace. A single workspace can be opened using Conduit Pi or a supported mirrored harness. Local server workspaces continue to work normally.

This also changes the unit of ongoing work: a **Task** is a durable server-owned activity that may span Nodes, workspaces, runs, and intermittent availability. A chat can create or observe tasks; a task does not stop because its initiating UI session closes.

## Product outcomes

A user can open Conduit on Android, instruct server-resident Conduit Pi to inspect and change a workspace on their Windows PC, close the phone, and later inspect the task from a browser. With the necessary grant, Pi reads files and executes shell operations on the PC while orchestration, context, and model requests remain on the server.

The same Windows workspace can be used by server-resident Codex or Claude Code. Conduit first materialises a checked snapshot locally, starts the harness against it, and later synchronises its resulting edits back to Windows if revisions still match. The mirrored harness can continue working while the Windows device is temporarily unavailable, but cannot claim a fresh view of remote state or publish changes until the Node reconnects.

A task may need a Windows workspace for tests and a VPS workspace for its final report. Each action goes to the applicable Node. All connected UI clients can follow the same task's state. Conduit should clearly show where data lives, where commands execute, and whether changes are pending synchronisation.

## Invariants

- **One server is authoritative for each task.** There is no automatic multi-server federation or harness migration. Tasks, runs, scheduling decisions, approvals, and event history are owned by one Conduit server.
- **A UI connection is not a Node connection.** Closing a web tab or desktop window does not necessarily detach an installed device's background capability provider.
- **A workspace has one authoritative home.** A mirror is an explicitly versioned working copy, not an alternate source of truth.
- **A local workspace is a local Node workspace.** Maintain one resource vocabulary and local/remote implementations rather than scattering "is remote" branches across every feature.
- **Where an operation executes is never implicit.** Pi remote shell runs on the workspace Node; a normal third-party harness shell runs on the server mirror. The UI and logs must tell the truth about this difference.
- **Connectivity and task state are independent.** Offline devices can make tasks wait; cached server-only work may continue.
- **Remote actions are permissioned capabilities, not arbitrary paths and commands available because a UI logged in.**
- **No blind mutating retries.** Action IDs, durable receipts, leases, and reconciliation are required; arbitrary shell commands cannot be promised exactly-once execution across failure boundaries.
- **Existing chat/harness transcript contracts survive.** The current server-authoritative record and droppable paint architecture stays intact. Task history is an additional domain, not a replacement for transcripts.

## Logical architecture

```text
             UI sessions: browser / Windows / Android
                         |   read, prompt, approve
                         v
   +-----------------------------------------------------+
   |                CONDUIT SERVER                       |
   | auth, Node registry, Workspace registry, Task engine|
   | durable state, chat/event logs, model providers     |
   |                                                     |
   |  Conduit Pi        Third-party harnesses             |
   |  server-resident   server-resident                   |
   |       |                    |                         |
   |  remote-capable       local mirrored cwd             |
   |  tool providers       and sync engine                |
   |       |                    |                         |
   |       +---------+----------+                         |
   |                 | Node Gateway / transfer service    |
   +-----------------+-----------------------------------+
                     | outbound authenticated channels
          +----------+--------------+--------------+
          v                         v              v
    Windows Node(s)             VPS Node       Android Node
    files, shell, OS            files, shell    bounded OS actions
    authoritative roots        roots          intermittent
```

The Node Gateway is the server-side routing layer; a native companion or runtime-specific adapter implements the same capability interface on each Node. The local Node need not loop network traffic through a WebSocket.

### Identity and ownership

Treat the following as separate durable concepts:

| Concept | Meaning |
| --- | --- |
| Device | User-recognisable physical device, such as "Desktop PC". Can contain multiple Nodes. |
| Node | A particular execution/security environment that advertises granted capabilities, e.g. Windows host, WSL distro, container, or server process. |
| Node registration | A server-specific pairing, cryptographic identity, permission policy, and revocation relationship for a Node. |
| Node connection | One ephemeral authenticated transport instance; can reconnect without changing Node identity. |
| UI client session | One visible browser tab or installed app/window connection used to issue commands and render output. |
| Workspace | Stable identity for an authorised root on a particular Node, with chat ownership and metadata. |
| Task | Durable desired work with dependencies, policy, lifecycle, and outcomes, owned by the server. |
| Run | A concrete execution attempt or harness session belonging to a Task, chat, or both. |
| Action | One typed operation issued to a Node, identified independently of transport and retries. |
| Mirror | A server-side materialised snapshot/working copy of a workspace, tied to base revisions and a specific consumer. |

A Windows desktop may offer a Windows Node and a WSL Node. Running the Conduit server inside WSL does not imply that the server automatically has all capabilities of the Windows host. A Node may exist without a visible client, and a client can view a server without granting its own device any Node capabilities.

### Proposed workspace reference

Sketch, not a final persisted schema:

```ts
interface Workspace {
  id: string;
  name: string;
  nodeId: string;
  rootId: string;          // exported root, not a client-supplied absolute path
  origin: "linked" | "created" | "cloned" | "managed";
  capabilities: string[]; // snapshot for UI; enforce grants on every action
}

type WorkspaceAccess =
  | { kind: "direct"; workspaceId: string }
  | { kind: "mirror"; workspaceId: string; mirrorId: string };
```

A Node registration maps `rootId` to a validated platform-specific path. The Conduit server stores the portable identity and selected metadata. It should not store an arbitrary client path and later assume it may execute there. Root grants are revocable. Imported existing projects are attached to the built-in local Node without changing their public workspace IDs.

## Node service and protocol

Installed clients gain a **background capability provider** separate from their UI shell. For Windows this can be a user-level companion controlled by the installed application but running independently of its window. A WSL/server Node can use a local service or an in-process adapter. An Android companion is opportunistic: background restrictions mean it should not promise a continuously connected shell. The browser is a UI plus user-initiated uploads, microphone, and explicitly permitted browser APIs; it is **not** an always-on filesystem/shell Node.

The first implementation should use outbound authenticated, identity-bound, bidirectional connections from Nodes to the server. This avoids requiring inbound ports on laptops and phones behind NAT. Keep this separate from the existing UI runtime SSE/chat sockets. UI server switching should not implicitly unregister or redirect an independently paired Node companion.

The Node protocol should have:

- Stable node identity, negotiated protocol version, ephemeral connection/generation ID, capability advertisement, and grant revision.
- Typed correlated requests with `actionId`, `taskId`, `workspaceId`/`rootId`, deadlines, cancellation, and optional approval constraints.
- Accepted/rejected acknowledgements, progress, terminal outcome receipts, and replay/reconciliation of known action IDs after reconnect.
- Bounded flow-controlled binary streams for files and stdout/stderr, resumable chunk transfers where justified, cancellation and size limits.
- Explicit status distinctions such as online, reconnecting, offline, permission revoked, capability unavailable, and Node version incompatible.
- Path validation on the Node itself, including traversal/symlink rules, write preconditions, and capability checks; never trust only the server-side resolver.

Candidate interfaces should be small and reusable:

```ts
interface WorkspaceFiles {
  list(workspaceId: string, path: string, cursor?: string): Promise<DirectoryPage>;
  stat(workspaceId: string, path: string): Promise<FileVersion>;
  read(workspaceId: string, path: string, range?: ByteRange): AsyncIterable<Uint8Array>;
  write(workspaceId: string, path: string, bytes: AsyncIterable<Uint8Array>,
        expectedRevision: string): Promise<FileVersion>;
  // move, delete, watch, batch metadata/search: separately permissioned
}

interface WorkspaceProcesses {
  start(workspaceId: string, argv: string[], options: ProcessOptions): Promise<ProcessHandle>;
  attach(processId: string, cursor?: string): AsyncIterable<ProcessEvent>;
  signal(processId: string, signal: ProcessSignal): Promise<void>;
}

interface NodeGateway {
  files(workspaceId: string): WorkspaceFiles;
  processes(workspaceId: string): WorkspaceProcesses;
}
```

Types above are illustrative. For example, a real `write` operation needs an explicit create-if-absent precondition, action ID and atomic publish semantics; requiring an existing revision for all writes would prohibit file creation.

Do not build a chat-specific filesystem tunnel. The workspace editor, file explorer, Git inspection, attachments, Pi tools, and mirroring service should share this Node capability layer. Push directory searching and many small metadata operations down to the Node to avoid thousands of WAN round trips.

## Strategy A: Conduit Pi direct execution

Pi remains a server-resident harness, retaining server-side model/provider configuration, message context, session files, transcript handling, and scheduling. Conduit-owned tool providers resolve a workspace to its home Node for **read, edit, write, grep/find/search, and shell/process execution**. The local Node implementation is the zero-network path.

A remote read asks the Node for bytes or a bounded text window. Remote search executes against the Node's filesystem and returns bounded matches. A remote edit uses validated file revisions or another compare-and-swap precondition; no unchecked read-modify-write across multiple actors. Remote `bash` starts a process on the Node, streams output to the server, supports cancellation and bounded retention, and can reconcile a detached/reconnected process when the Node really retains it.

Distinguish the **server-based Pi session cwd/metadata needs** from the **tool execution root**. Do not pretend an arbitrary remote absolute path is a real server cwd. Pi extensions and arbitrary locally installed tools may assume local filesystem access; the initial remote-capable profile must explicitly describe which tools are redirected and what remains server-local. Audit Pi's extension/resource-loading and subprocess assumptions before advertising transparent remote coverage.

Environment-dependent work, such as a Windows build or an application-specific CLI, consumes CPU and installed tools on the remote Node. This does not contradict centralised harnessing: reasoning and orchestration are offloaded, while environment-specific actions happen where they must.

A Pi run that requires an offline Node can wait for reconnect. It may perform independent server-side reasoning, but must not fabricate fresh remote state. Cancellation and pause should propagate to actions where possible, with honest unknown state if the connection drops during a mutating action.

## Strategy B: third-party harnesses using materialised mirrors

A third-party harness continues running its normal server-side process against a real local working directory. Conduit materialises the remote workspace before the run, retaining source identity and base versions; subsequently it can transfer deltas rather than the whole tree. A consumer's workspace access is `mirror`, not `direct`.

A suggested lifecycle:

1. **Acquire source snapshot:** collect a consistent-enough manifest of paths, types, revisions/hashes, permissions as applicable, and a Git/source-control baseline. Define the snapshot boundary; if the source changes during collection, retry or represent the resulting revisions explicitly rather than calling it atomic.
2. **Materialise:** fill a server-side content cache and an isolated writable mirror/worktree. Honor exclusions and resource limits; never naively copy symlinks, device nodes, secrets, or unbounded directories.
3. **Run:** launch Codex, Claude Code, OpenCode, etc. with the mirror as their actual cwd. Native file and shell tools work normally. Local tests/builds run on server toolchains and OS.
4. **Capture changes:** calculate a changeset against the exact base, including adds, edits, deletions, and relevant metadata. Changes made by the harness are not automatically authoritative.
5. **Publish:** compare the remote Node's current revisions to the expected base before applying a transactional or staged set of mutations. Report conflicts with sufficient detail for review; do not silently overwrite newer device edits.
6. **Rebase/refresh:** update the mirror from source at safe boundaries when there are no conflicting unpublished local edits, or surface a merge workflow when there are.

**Preferred starting policy: snapshot plus checkpointed write-back**, rather than continuous transparent two-way writes. Publish at an explicit successful turn/task checkpoint or user request; the exact default is an open UX decision. Live source changes should not silently rewrite files underneath a running harness.

**Preferred longer-term strategy: persistent incremental materialisation.** Start with manifests and changed-file transfer; add content-addressed reuse, chunking and filesystem watchers only when measured demand warrants them. Watches are hints; reconnection must reconcile manifests since watches can miss changes. Avoid FUSE/lazy remote filesystem as the initial approach: arbitrary harness shell tools generate complex access patterns, and a mount does not reproduce the client machine's execution environment.

Each concurrently writable harness run should have its **own mirror or isolated worktree**, potentially sharing an immutable content cache. One global writable mirror shared between agents invites data races. The original workspace remains authoritative; publish requires source-version checks and a concurrency policy. Start with an exclusive workspace mutation lease or equivalent controlled reconciliation for publishing, and define how ordinary user edits interact with it.

### Git semantics

Do not treat `.git` as an ordinary bidirectional sync folder. A source repository may be dirty, have unpushed local commits, no remote, staged changes, worktrees, ignored data, hooks, and local-only refs. File copying alone does not preserve all of these.

Initial Git-capable mirroring must explicitly choose and document how it preserves a source commit/branch baseline, index state, working-tree edits, and local-only history. Plausible mechanisms include exchanging Git objects and a separately captured dirty overlay, or creating a server worktree seeded from a source-controlled bundle. Neither should silently push commits or rewrite the remote Node's Git metadata. Source publication and Git history updates must be separate, auditable operations.

A file-only mirror can be offered where Git fidelity is not required, but should be labelled accordingly. Do not pretend a Git-unaware copy can safely support all repository operations.

### Server environment trade-off

A mirrored Codex/Claude Code process executing `npm test` uses the **server's** Node/npm/toolchain, environment variables, OS and filesystem. Source synchronisation does not copy executable programs, local secrets, Windows APIs, running services or peripheral devices. A test may pass on the server and fail on the original machine. The UI should expose execution location and toolchain assumptions rather than implying equivalence.

Conduit Pi is the path for direct actions against the actual device environment. A future optional Conduit MCP toolset could allow third-party harnesses to invoke **explicit** remote actions on Nodes without replacing their native local filesystem tools. This is an extension, not an MVP dependency or a promise that remote workspaces are transparently supported by those harnesses.

## Durable asynchronous tasks

Existing server-owned chat process lifetime is useful groundwork, but a live process is not a durable Task. Introduce a server-persisted Task object separate from chat, Run, and Node connection. A chat can create multiple tasks, a task can involve several runs/workspaces, and any authorised UI can follow it.

Proposed task phases: `queued`, `running`, `waiting_for_node`, `waiting_for_approval`, `paused`, `completed`, `failed`, and `cancelled`. Represent individual action state separately (e.g. requested, accepted, executing, outcome-known, outcome-unknown). A transition back from waiting to running is normal.

A Task stores intent, references to chat(s), required resource IDs, permissions, dependency graph/checkpoints where needed, run IDs, pending actions, state transitions, and outcomes. Do not duplicate the entire agent transcript into the task database. Keep Conduit's current authoritative chat record/paint distinction; add a separate durable task event stream and projections suitable for reconnection and UI summaries.

### Reconnection and idempotency

When a Node disconnects mid-command, the server must not infer success, failure, or cancellation. The Node persists sufficient action receipts to reconcile the same `actionId` on reconnect. A server restart must reconcile task records, harness processes and Node receipts before dispatching replacements.

Reads and idempotent operations may be safely retried when their semantics support it. Writes need preconditions and stable operation IDs. **Arbitrary shell processes are not exactly-once operations**: a Node may have executed the command even if the response was lost. On uncertainty, report unknown/reconciling and require inspection rather than blindly replaying it.

For tasks with mirrors, an offline remote Node does not necessarily prevent further harness reasoning or local builds. It prevents refresh or conflict-safe publication. For direct Pi tools, the remote operation may have to wait, fail with a retriable availability error, or be resumed if its process remains on the Node. These are capability-specific outcomes, not a universal "task offline" state.

Tasks must support cancellation, user approvals, bounded queueing, maximum concurrency, resource ownership, stalled-action expiry and explicit failure reasons. Server restarts should not silently drop pending work. Provider/harness restart capabilities differ; task durability does **not** imply every interrupted model generation can resume at the exact token position.

## Client and Node state UX

Node registration and state are first-class management features. The interface should distinguish device, environment/Node, transport connectivity, capability grants, registered workspace roots, last seen, incompatible client versions, and tasks currently blocked on that Node.

- UI sessions can independently connect/disconnect or change selected server; the background companion keeps its own registrations.
- A server-hosting machine appears as a Node just like others. Windows and WSL may appear as two environments under one device.
- Workspace pages show the authoritative Node and whether the view is live, stale, mirrored, pending publish, or conflicted.
- Task pages/chat rows show progress, waiting reason, remote action location, approvals, and unpublished mirror changes.
- Node registration and root sharing must have a clear grant/revoke path; "signed in as a client" is not blanket remote execution permission.
- Android support must indicate intermittent availability, not promise always-on background shell access. Browser capabilities stay user-initiated.
- Existing desktop/mobile/web chat and terminal UI surfaces remain; the architecture is not a demand for a new visual design or alternate design document. Follow root `DESIGN.md` for any UI implementation.

Avoid UI claims of "synced" merely because the mirror has local changes or because a watcher fired. Show source revision, mirror base, publish state, and explicit conflicts as necessary.

## Security and trust boundaries

Moving actions to user devices expands Conduit's authority dramatically. Pairing and normal UI login must be separate from granting a Node permission to execute operations. Each Node has server-specific cryptographic identity, scoped capability grants, an allowlist of exported root IDs, and a local revocation mechanism. Registration with multiple Conduit servers must use separate keys/policies; switching an active UI server must not hand over another server's authority.

Distinguish grants for filesystem read, write/delete, shell/process execution, Git/source-control mutation, and platform actions (clipboard, open app/URL, notifications, etc.). Enforce on the Node even if the server is compromised or sends forged paths. Narrow shell cwd alone is **not a sandbox**: shell processes can often access everything permitted to their OS user. True isolation requires a restricted OS identity, sandbox or container and explicit product support. Do not market cwd restrictions as security.

Use secure authenticated transport and version negotiation; maintain a bounded resource budget (max file size/transfer, rate, concurrent actions, output length, disk footprint, process lifetime), sanitise paths and stream content, record auditable action provenance, and support local approval for sensitive classes of action. Design for session/key revocation while actions are outstanding. A compromised orchestrator should not acquire arbitrary new local capabilities without the Node's own policy permitting them.

Mirrors may contain private source and secrets on the server. Make retention, cleanup, encryption at rest where applicable, ignored-file policies, and server backup exposure explicit. Users should understand that tool outputs and selected contents can be sent to configured model providers.

## Multi-server model

Keep Conduit's existing per-server identities and multiple-server UI support. Each server independently owns its registered Nodes, workspace references, tasks and credentials. A Node may deliberately register with more than one server, with independent permissions and long-running background sessions, but **server federation, shared task scheduling and cross-server trust propagation are out of scope** initially.

Server identity, Node identity and UI session identity are different. An installed client's active UI server is a navigation decision; it is not a reassignment of the device companion to another controller.

## File transfer, consistency and performance

The baseline transfer path is Node -> central server -> consumer (and reverse for writes). Separate binary data transfer from JSON control messages, with bounded streaming, backpressure and cancellation. File manifests/hashes and revision tokens reduce repeat copies; optional range reads and resumable chunks improve large transfers. Do not stream an entire directory just to populate file-tree UI.

For direct Pi, run directory scans and searches on the Node, returning bounded structured results. For mirrors, reuse unchanged file blobs across refreshes but keep independently writable working copies and per-run base manifests.

For writes, enforce expected-revision compare-and-swap or an equivalent safe precondition at the authoritative Node. Bulk publish should stage content and validate all expected revisions before commit; define partial-commit recovery if a fully atomic filesystem transaction is unavailable. A disconnected publish must queue or fail visibly, never count as delivered. Distinguish source file changes, mirror-only edits, and task artifacts.

## Migration from the current repository

The present codebase has a server-local project store, a `workingRoot`-based workspace inspector/file/Git route layer, server-owned PTYs, and server-resident harness adapters. Its client runtime already handles server process streams and reconnects. Build on these rather than replacing the chat/transcript architecture.

Likely areas to adapt, subject to a fresh code review at implementation time:

| Area | Current entry points | Proposed boundary |
| --- | --- | --- |
| Workspace registry | `conduit-web/src/project-store.js` | Store Node/root identity while retaining existing workspace IDs and managed/linked semantics. |
| Workspace APIs | `conduit-web/src/server/routes/projects.js`, workspace inspector helpers | Route file, search, Git, and version operations through workspace resource providers rather than assuming server `workingRoot`. |
| Terminal/PTY | `conduit-web/src/pty-manager.js` and `conduit-web/src/server/routes/ptys.js` | Distinguish server-local terminals from Node-owned remote process/PTY handles and their lifetimes. |
| Harness lifecycle | `conduit-web/src/server/routes/live-sessions.js`, harness adapters, Pi manager | Select direct vs mirror access and report actual capabilities/execution location. |
| Agent records | `docs/chat-backend-contract.md`, chat log/delivery implementations | Preserve existing transcript events; introduce separate durable task/action records. |
| UI runtime | `conduit-web/src/client/state/runtime.ts` and native platform bridges | Keep UI connectivity separate from background Node connectivity; project task/Node state to all clients. |
| Native platforms | `conduit-web/src-tauri/`, `conduit-web/android/` | Add user-level companion/capability adapters with OS-specific lifecycle and permission models. |

Do not place distributed-execution state into local browser storage merely because the original client runtime store lives there. The server owns the Node registry, tasks and authoritative workspace identities. Capability grants also require Node-local enforcement.

## Delivery plan and acceptance gates

Design the transport, mirroring and task/event models together, but land them in bounded slices that preserve the existing server-local product.

### Phase 1 — Node vocabulary with no behaviour regression

Introduce server-local Node identity, registry, local filesystem/process adapters, and workspace location references. Migrate existing managed/linked workspaces in place. Local Pi, third-party harnesses, editor, Git tools and PTYs must behave unchanged. Cover backup/restore and migration, as well as disallowing orphaned workspace references.

**Gate:** Existing local workspaces and chats are still addressable by the same IDs, and ordinary local operations work through the new abstraction without a network service.

### Phase 2 — Remote Node transport and files

Implement background Windows companion, server pairing/registrations, root grants, node status, safe remote list/stat/read/write/search, streaming and reconnection. Add remote workspace registration, browsing, editor and source-control inspection where supported. Keep server and client connections separate. Other platforms can be deferred.

**Gate:** A remote workspace can be browsed and version-checked edited from a different UI; UI closure does not silently revoke the Node; disconnect/reconnect and revoked grants behave deterministically.

### Phase 3 — Conduit Pi direct tools

Provide remote-capable Conduit Pi tool implementations, remote shell lifecycle, action receipt/reconciliation, explicit remote tool availability, and the server-local fast path. Treat unredirectable Pi extensions as unsupported or restricted rather than pretending transparent remote access.

**Gate:** Server Pi can read/edit/search/test against an authorised Windows workspace while its model/harness stay on the server; command location is correct; a network partition does not duplicate mutating actions.

### Phase 4 — Mirror service and third-party harnesses

Implement manifest/transfer cache, isolated writable mirrors, run baselines, content changesets, publish preconditions, conflict handling, and cleanup. Start with checkpointed write-back, not unconditional live two-way sync. Add Git-specific handling only to the extent explicitly supported. Integrate Codex/Claude Code first; extend others based on actual adapters.

**Gate:** A remote workspace can be materialised for an unchanged third-party harness; local server builds run against its mirror; edits reach the source only after safe publication; independent source modifications result in conflicts, not data loss.

### Phase 5 — Durable tasks and cross-device workflows

Persist Task/Run/Action transitions, queueing, dependency resources, approvals, retries and reconciliation. Expose task dashboards and chat associations, then enable a task to operate across multiple workspaces/Nodes. Node-unavailability handling must be specific to the required capability and execution strategy.

**Gate:** Work remains inspectable when its initiating UI closes; server/Node reconnection reconciles known actions; tasks can wait and recover without silently replaying arbitrary shell commands; cross-Node artifact delivery is attributed and auditable.

### Validation and failure matrix

Test local versus remote file operations; two simultaneous UI clients; two Nodes on one device; two Conduit servers paired to one Node; Node disconnect while reading, writing, and executing; server restart during a pending action; Node power loss with a missing receipt; publish conflicts; source deletion; concurrent mirror writers; Git dirty state and local-only commits; large binary transfers/backpressure; permissions revoked mid-run; symlink/traversal attacks; platform shutdown/sleep; task cancellation; existing chat migration; and mobile app backgrounding.

Use unit tests for protocol and consistency, integration tests with a fake Node that injects faults, and end-to-end tests with actual Pi and at least one third-party harness. Claims of durability or "no duplicate execution" must match the actual tested failure model.

## Decisions made versus open questions

### Architectural direction adopted

- Central server for all harness/model execution and orchestration, regardless of where the UI is opened.
- Registered Nodes as capability providers; explicit persistent identities separate from UI sessions.
- Local server environment represented as a Node.
- Remote workspace ownership independent of UI clients.
- Conduit Pi as the principal first-class direct remote-tool harness.
- Third-party harness core processes remain server-local, using mirrored remote workspace content.
- Durable asynchronous tasks spanning devices are an intended end state.
- Browser remains principally a UI rather than an always-on privileged Node.
- Server federation is not part of the initial architecture.

### Decisions to resolve before implementation of their respective slices

1. **Node identity/granularity:** how Windows host, WSL and multiple isolated execution environments are discovered, named, registered, and displayed under one device.
2. **Node availability:** lifecycle of Tauri companion, Windows autostart/service ownership, mobile foreground/background limitations, and whether WSL has an independent Node companion.
3. **Pi tool coverage:** exact intercepted tool surface, extension and resource-loading support, remote cwd representation, subprocess semantics, and any explicit server-local tool escape hatches.
4. **Mirror consistency:** default publication boundary (end of turn, end of task, or explicit approval), freshness/staleness visibility, conflict resolution UX, change notification policy, and whether a mirror can be refreshed during a live run.
5. **Git fidelity:** source branch/index/dirty working-tree reconstruction, local-only objects, staged file handling, and whether Git publication changes history or only working-tree contents.
6. **Task persistence:** minimal durable state store, relationship to existing chat logs, action retention, scheduler policies, run restoration limits, and approval expiry.
7. **Security:** grant UX, remote shell posture, OS sandbox support, sensitive-file exclusions, device-local approval, recovery/revocation, and multi-server registrations.
8. **Transfer optimisations:** when content addressing, chunk resume, local discovery, or direct Node-to-Node transfers are worth implementing versus simple relayed streaming.
9. **Third-party remote actions:** optional MCP tool exposure to explicit Node APIs, without replacing mirrored ordinary harness tools.
10. **Rollout and migrations:** opt-in controls, compatibility with older client releases, and whether remote capabilities are unavailable until installed companions reach a minimum version.

## Non-goals

- Moving Codex/Claude Code's core harness loops onto remote user devices.
- Replacing every third-party harness's built-in filesystem and shell implementation.
- Pretending server-side mirrors reproduce local hardware, OS, credentials or services.
- Fully transparent live bidirectional filesystem synchronisation in the initial implementation.
- Treating browser tabs as durable execution agents or guaranteeing Android background execution.
- Server-to-server federation, global distributed scheduling, or automatic execution migration.
- Replacing the existing transcript contract, chat UX or Conduit's root `DESIGN.md` design authority.
- Promising exactly-once arbitrary shell execution across crashes and lost acknowledgements.

## Summary

Conduit becomes a **server-centred orchestration system with device-resident hands**. Devices expose explicit, permissioned capabilities through Nodes. Workspaces live wherever their authoritative resources live; any connected UI can access them through the server. Conduit Pi operates directly on Node resources, while existing third-party harnesses work against server-side mirrored snapshots with safe incremental publication. Durable tasks capture work that can outlive clients, pause on unavailable resources, reconcile uncertain actions and span multiple Nodes.

The primary architecture risk is not establishing a WebSocket: it is defining trustworthy execution semantics across two tool models, multiple filesystems, concurrent edits and partial failure. Implementation should first make those boundaries explicit, then optimise the transport and UI around them.
