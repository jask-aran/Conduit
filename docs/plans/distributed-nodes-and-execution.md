# Distributed Conduit

Nodes, remote workspaces, and durable execution: one server acts on every
device, and any client controls it. Its agent is the **Conduit durable
agent** (below, under Names).

Status (2026-10-23, on main since v0.8.5, PR #66): milestones 1, 3 and 5
built, and the node track (a)-(d): the node role (`scripts/conduit-node.mjs`,
the Windows app's companion), device workspaces acting through one host
(files, Git, dashboard, terminals, checkpoints, watching), harness CLIs on
devices through their adapters, the ownership record, environments of one
device relayed (decision 25), tmux wherever it exists (decision 28) and the
head's feature list (decision 30). Milestone 2's backend is built (roaming
conversations, subagents, bounded context); its product is not designed.
Milestone 4 is deferred (device features are later), as are further harnesses
on devices. Two networks run (decision 29): dev, headed by the desktop's WSL
(device Desktop-Dev: Linux, the head, and Windows over loopback), and prod,
headed by the VPS (device Desktop: Windows, and WSL relayed by it). Not yet:
a node on another machine reaching a head that serves only its self-signed
HTTPS (a LAN laptop on the dev network) -- it has no way to check that
certificate; pinning the head's identity in the pairing would.

## Names

- **Distributed Conduit**: this roadmap.
- **Conduit durable agent** (2026-10-21, the user's terms): the harness
  that powers the core Conduit experience: the Assistant profile, any other
  first-party profile, and the persistent agent (milestone 2). It is the
  pi-durable implementation and, during the transition (until milestone 5),
  standard Pi 1.3.0. It replaces "Conduit Pi" as the name. In code the
  pi-durable half is still `durable-adapter.js` and profile id
  `conduit-runtime`.
- **Conduit runtime**: the server backend, above all the part that handles
  interaction with agents (adapters, live sessions, the node protocol). Not a
  name for the agent; the `conduit-runtime` profile id is a leftover.

## Vision

My devices are reachable from each other no matter which one I am using or
which one hosts Conduit. Agents are the intermediary: they take actions on a
device's files, shell and capabilities on my behalf, rather than crude screen
mirroring. Initially this is chat-shaped (a thread picks a workspace exposed
by another device); later any thread can reach any available device's
environments.

## Decisions

1. **Conduit runtime on pi-durable, in one harness registry.** pi-durable
   (`@earendil-works/pi-durable`) enters as a **manifest entry** like the
   other harnesses (a "Conduit" harness with a normal Assistant profile) for
   ordinary chats. The manifest stays the **single registry** long-term: a
   durable harness declares `recordAuthority: "harness"`, and Conduit's
   ChatLog for its chats is a projection rebuilt from pi-durable's record,
   which is authoritative. The browser sees one chat contract regardless.
   Its wider features (persistent assistants, subagents, documents, node
   `env`s, tasks) are **runtime services beside the registry**, not manifest
   concerns. Conduit does not build its own Task/Action engine.
   The pi-durable Harness is one resource in the server's Effect Scope; its
   storage is SQLite under `~/.conduit/data/runtime/`, included in
   backup/restore; its turns and subagents count against the same
   live-process and generation caps as every harness. Codex/Claude
   Code/OpenCode keep their current adapters.
2. **Side by side, then cut over.** The runtime ships next to today's Conduit
   Pi harness. Once at parity it becomes the default for new chats; old Pi
   stays to read/continue existing chats and is removed when nothing active
   uses it. No transcript conversion.
3. **One install, two roles.** A single Conduit server install runs as
   either the **main** (owns chats, harnesses, pi-durable storage, persistent
   assistants, auth, UI) or a **node** (exposes its environment to main).
   Desktop/Android apps run the node role while open. Exactly one main per
   network; put it on the most persistent device. Federation is out of scope.
4. **Tailnet for nodes.** Nodes reach main only over Tailscale, authenticated
   by tailnet identity plus a pairing key. The public tunnel stays for UI
   clients reaching main.
5. **Harnesses run where they are installed** (revised 2026-10-21). A
   pi-durable conversation's `env` is built from its thread's device: main's
   own machine is the zero-network path, another device's calls go over the
   node protocol. Third-party harnesses (Codex, Claude Code, …) are
   properties of the devices that have them installed: a device offers its
   harnesses, Conduit drives them there, in that device's folders, and can
   drive harnesses on several devices at once towards one outcome. Main's own
   harnesses work as today. No mirrors or MCP bridges. Mechanism: **remote
   spawn** -- the node starts the harness process and relays its stdio (or
   local port) over its socket, and main's existing adapters run unchanged
   against it; the node stays thin and there is one adapter per harness.
   Built for Claude Code (its SDK's `spawnClaudeCodeProcess`, `src/nodes/
   remote-spawn.js`): a node with a shell-granted root advertises the
   harnesses it has, runs its own install by name in the workspace's place,
   and serves the saved session back for history and resume. Codex and the
   others follow the same shape.
   Terminals use the same spawn.
6. **Workspaces declared by nodes.** A node mounts and declares folders to
   main; existing workspaces are simply main's local node and are unaffected.
7. **Grants: per root + typed capabilities.** The device owner grants
   read / write / shell per declared root. Apps additionally advertise a fixed
   catalogue of Conduit-owned typed tools (e.g. `device.notify`,
   `device.clipboard`, Android `device.screenshare.start`), each grantable.
   Pi sees them as ordinary tools; replay-unsafe ones are marked so.
8. **Offline = wait and notify.** A tool call needing an offline node pauses
   its pi-durable task; the thread shows "waiting for <device>" and resumes on
   reconnect. Interrupted unsafe calls are reported to the model, not replayed.
9. **Short threads by default.** Ordinary chats are short runtime
   conversations that happen to survive restarts. A **persistent assistant**
   is an explicit, separately listed long-lived conversation that never ends, bounded by compaction/reset, spawning
   subagent conversations for work and able to use any node.

10. **Two delegation shapes.**
    - *Thread subagent*: owned by a tool call in one chat, may outlive the
      turn. The chat shows it as a disclosure (spend, preview stream or
      spinner); its status beyond the turn lives in the agent sidebar. Not a
      chat-list row.
    - *Orchestrator / worker threads* (cf. Claude Code Projects): a persistent
      runtime conversation splits a goal into **worker threads** that are real
      chats on **any harness**, grouped under it in the chat list. The
      coordinator chooses per job whether a worker gets its own worktree and
      hands back a reviewable diff, or works in the shared tree. Shared memory
      is coordinator-owned pi-durable documents (notes, decisions, task board)
      that workers read and write through tools.
11. **Projection rules.** Messages sent mid-turn map onto the existing queued
    strip (now durable). A reply interrupted by a crash keeps its partial
    text marked "interrupted by restart"; the turn resumes or reports.

12. **pi-durable is the north star for new backend concepts.** When the
    contract gains a concept it lacks (subagents, compaction, interruption,
    documents), pi-durable's model shapes the neutral vocabulary, kept
    harness-neutral so other harnesses can map equivalents.
13. **Agent identity is native only for Conduit's own harnesses.** Conduit Pi
    and the pi-durable harness have deep agent identity (subagent/worker
    records with parent, status, spend, preview) owned by the runtime and
    shown in the agent sidebar. Third-party harnesses run their agents
    natively; Conduit may visualise their reporting but owns no identity.
14. **Coordinators drive workers through Conduit chat tools**
    (`chat.create(harness, workspace, prompt)`, `chat.send`, `chat.wait`,
    `chat.read_outcome`) over the existing contract, so any harness can be a
    worker. A worker's outcome is its final message, status
    (done / failed / needs input) and its worktree diff if any.
15. **ChatLog projection.** The adapter appends neutral events live as
    pi-durable emits them; on boot or a detected gap it rebuilds that chat's
    log from pi-durable storage and clients get a normal reset.

16. **History edits fork in place.** Editing an earlier message forks the
    pi-durable conversation there; the chat switches to the fork and the old
    branch stays reachable, like Pi's tree today.
17. **Conduit-owned node protocol.** A versioned Conduit protocol over a
    tailnet WebSocket, independent of pi-durable's experimental API so
    installed apps survive upstream changes. Its initial op set mirrors what
    pi-durable's `env` needs; main provides a thin pi-durable remote-env
    adapter onto it. Device capabilities, action ids/reattach and Conduit's
    file browser/viewer share the same protocol. Remote browsing is
    **read-only** in v1; editor writes, git panel and terminals come later.
18. **Remote shell survives disconnects.** The node keeps the process and
    buffered output; on reconnect the tool reattaches by action id. If the
    node itself restarted, the call is reported interrupted.
19. **Android is push-wakeable.** Main sends an FCM push to wake the Android
    node for a capability call (Firebase messaging in the app, key on main);
    otherwise the thread waits per decision 8.
20. **The server acts, any client controls.** Clients (phone, browser,
    desktop UI) are interchangeable controls of the server; devices lend the
    server what they have (folders, shell, harnesses, capabilities). A device
    can be both, but the phone never drives the desktop: it drives the server,
    which acts on the desktop.
21. **A thread is owned by a device.** A thread belongs to its workspace's
    device, whoever typed (a chat in a desktop folder is the desktop's, even
    from the phone); a chat outside any workspace belongs to the device it
    was started on. Its tool calls and capabilities default there, and it
    knows that owner durably (a record beside the conversation, not agent
    context). A persistent assistant instead picks a device per call. A
    thread whose device is unreachable waits ("Waiting for Laptop") and any
    client can choose to continue without it: the model is told the device is
    unavailable and may use another; the thread keeps its owner.
22. **Main's machine is a device**, trusted by default: one path for every
    file, shell and Conduit feature (browser, Git, terminals) through an
    environment on `{device, path}`, main's own with full grants on its
    workspaces unless narrowed.
23. **Grants are the approval.** Within a device's shared roots and grants,
    calls run without per-call approval; the chat shows every call.
24. **The device is the unit; client, node and head are roles on it.** A
    device runs a client, a node (the daemon), or both; most run both, and a
    web client or a device whose owner declines runs only the client. Devices
    and clients are the same thing seen from two sides. One device is the
    head (the brain: chats, agent state, model calls). The head is a role,
    not a kind of machine: a headless VPS today, possibly a headed desktop
    that is also a client and a node. Nothing may assume the head is
    headless or that it is the only device with a screen.
25. **A device is a grouping of environments, each its own node.** Windows
    and WSL on one machine are two nodes (different homes, paths, installs)
    in one device. An environment reaches the head either by its own
    connection or relayed by another environment's daemon on the device
    (Windows relaying WSL over a stdio child), chosen per environment. The
    node id, key and grants are the same either way: each environment keeps
    its own pairing key and the relay forwards its hello untouched, so the
    head checks every environment alike. The relay is trusted: the relayed
    key passes through it, so it could speak for that environment, but it
    is the same machine and user, which can read that key on disk anyway
    (the 2026-10-22 review). Only WSL distros now; the frame tags
    stay generic so containers and SSH hosts behind a device fit later.
    *(Built 2026-10-22: nodes/node-relay.js; `conduit-node relay add <env>
    -- <command>` on the relay, `relayed on` and `run --stdio` on the relayed
    side. Measured from the head, WSL relayed through the Windows app against
    WSL dialling directly: a folder listing 71 vs 70 ms, a 2.7 MB file 749 vs
    725 ms -- within noise.)*
26. **The same files shared from two environments are two places.**
    `C:\Users\x\proj` from Windows and `/mnt/c/Users/x/proj` from WSL are
    separate workspaces, since the environment decides the shell, tools and
    paths a chat gets. Revisit if it confuses.
27. **A home terminal follows the shell grant.** A shell in any shared folder
    can already reach everything its user can, so an environment with any
    shell-granted folder offers a terminal in its home; no separate grant.
28. **Terminals live in tmux wherever it exists; the head is Unix.** tmux
    outlives both the server and its own client, which matters most on the
    head, so the head needs Linux (WSL counts) or macOS with tmux, and a
    Windows machine is never the head. Nodes on Linux and macOS keep their
    shells in tmux too, surviving a restart or update of the node; Windows
    nodes keep ConPTY shells in the node daemon.
29. **Two networks: dev and prod, both plain Conduit.** Prod's head is the
    VPS; dev's head is this desktop (WSL), whose existing data
    (`~/.conduit/data`) becomes the dev head's. The desktop is a device of
    both, pairing each with its own folders and grants. Neither holds chats
    the user relies on today. After the merge there is no "Conduit Durable":
    dev and prod are two instances of Conduit, picked in the client's server
    list.
30. **Nodes learn what the head supports from its reply to hello**: a list of
    features (the relay first), so a node uses only what the head offers and
    new features do not refuse older nodes; the protocol version is bumped
    only for breaking changes.

## Architecture

As built on `distributed-nodes`, and where it is going (agreed 2026-10-21).
Nothing changes for anyone until a device shares a folder that becomes a
workspace; from then a chat there must feel exactly like a chat anywhere
else. That is the test every piece below is held to.

### Topology

```
  DEVICE (any)                       DEVICE holding the HEAD role          DEVICE (any)
 ┌──────────────────────┐           ┌──────────────────────────────┐      ┌──────────────────────┐
 │ client  (optional)   │ HTTP+WS   │ Conduit runtime              │      │ client  (optional)   │
 │ node    (optional)   │──────────▶│  routes, live sessions,      │◀─────│ node    (optional)   │
 │  most devices: both  │◀──────────│  adapters, node hub          │      │                      │
 │  web client: client  │  node WS  │ Conduit durable agent        │      │ phone, laptop,       │
 │  only                │ (device   │ state: data root             │      │ desktop, browser...  │
 └──────────────────────┘  dials    │ client? node? (it may be a   │      └──────────────────────┘
                           out)     │  headed desktop: both local) │
                                    └──────────────────────────────┘
```

- Control: a client on any device drives the head. Action: the head acts on
  a device through that device's node. The phone never drives the laptop
  directly: it drives the head, which acts on the laptop (decision 20).
- The head is a device too (decision 22): its own folders are a local node,
  reached in process rather than over a socket.
- A node dials the head, best route first (the address the pairing client
  used when a device can dial it, the tailnet name, a public tunnel when the
  head allows devices through it), so no device opens a port.

### Data

```
HEAD (data root)                                       DEVICE (node.json, per pairing)
projects { id, name, kind, workingRoot (label only),  { name, pairings: [{ mainUrl, routes[], key,
           nodeId, place { root: r_…, path },             nodeId, roots: [{ id: r_…, path, read,
           chatRoot (head-owned chat files) }              write, shell, allow[], deny[] }] }] }
nodes.json { devices { id, name },                      device paths never leave the device;
             nodes { id, deviceId, keyHash, platform,   the head knows roots by id only
                     roots[], harnesses[] },
             pendingKills[] }
chats { id, projectId, backend, opaqueSession, ... }    one record wherever the work runs
```

A **place** `{root, path}` is the only address the head sends a device, so
Windows paths and every other OS's rules stay on the device.

### The three seams

```
            a chat turn / a file view / a terminal          <- one body of code above
                 |               |                |
              HOST             ENV            PROCESSES
          files, Git,     agent tools:     spawn, exec, tunnel,
          tree, search    read/edit/bash   PTY (harness CLIs,
          (inspector)                      terminals)
                 |               |                |
   local:   localHost       local env       child_process / pty
   device:  deviceHost      RemoteExecEnv   spawnOnDevice / tunnelTo / remote PTY
                 \_______________|________________/
                         node protocol: action ids + receipts, boot id,
                         seq/resume, offline wait
```

The inspector, the durable agent's tools, and every harness adapter's
translation into Conduit's internal representation exist once. A Claude
Code chat on a device is the same Claude Code adapter; only its process
starts elsewhere.

### Where a device workspace still differs (to remove)

| Where | Difference | Cause |
|---|---|---|
| chats.js (profile default) | forced to pi-durable | Pi 1.3.0 runs on the head only (ends at milestone 5) |
| projects.js turn-artifact | no turn checkpoints, so no Chat review of a turn | checkpoints snapshot the head's disk |
| sessions.js move | chat moves into/out of a device workspace refused | no ownership record yet |
| dashboard menu | no "delete workspace and files" | safety rule, kept |
| live-session-launcher, chats.js | "harness not on this device" | right outcome, written as a device check |
| file watching | a device folder is polled | no watch call in the protocol |
| adapters | `nodeId` threaded through each one | remote spawn added per adapter |

### Making it general

1. **Every workspace has a place.** *(Built 2026-10-22.)* The head is an
   ordinary device in the hub's list (`adoptHead`), named from the server's
   identity; its node's roots are the folders it holds workspaces in, and
   unscoped chats (the chat experience) live on it. Every project view
   carries its device's node and place; stored records are unchanged (a
   record names a node only for another device), so an older build still
   reads them. The one difference left is transport: the head's own folders
   are reached in process (`local`), so the seams ask `remoteNode(project)`
   and nothing else asks whether a place is the head's.
2. **Refusals become capabilities.** *(Built.)* `capabilities(place)` → harnesses,
   checkpoints, watch, git, delete. A device with Claude Code and a head
   without it become the same question, and the UI shows what is offered.
3. **Close the real gaps:** checkpoints through the host (snapshotted on
   whichever device holds the folder), a watch call on the node, chat moves
   once ownership is recorded. *(Built 2026-10-22.)* The checkpoint store reads
   the workspace only through its host (`projectWorkspace`, workspace-host.js),
   keying a device checkpoint by its place; a device offers checkpoints on a
   Git workspace with the shell grant (a plain folder's snapshot would read
   all of it over the link before every turn). Device folders are watched on
   the device, falling back to polling while it is away. Moves change the
   record and the conversation's place, not files.
4. **Adapters take a `processes(place)` handle at launch** and never learn
   that devices exist. *(Built 2026-10-22: `placeProcesses`,
   nodes/place-processes.js, used by Claude Code, Codex, fx, OpenCode and the
   durable runtime; the head reads harness state with the node's own readers.
   Device terminals start, reattach and are killed through its `shells`;
   this server's own stay tmux sessions, since both must outlive it.)*
   *Device terminals (2026-10-22):* besides a terminal in a mounted
   workspace, an environment with any folder shared with commands offers a
   terminal in its home (decision 27); `device:<nodeId>` is that place, as
   `computer` is this server's, opened from Settings › Devices.
5. Pi 1.3.0 is not generalised: milestone 5 retires it as the default.

## Milestones

1. **pi-durable harness for normal chats, local env only.** Manifest entry
   with an Assistant profile; reuses Pi's provider auth and model catalogue;
   Conduit Pi's tools (read/edit/write/grep/find/bash, questions, history)
   ported as pi-durable extensions with replay flags; background compaction.
   *Gate:* killing the server mid-tool-call resumes or honestly reports the
   turn; phone and desktop watch the same live turn; parity with Pi chat
   basics (model switch, approvals/questions, attachments, stop, history
   edits); compaction runs on a long chat without blocking the turn.
2. **Persistent assistant** on the same runtime (compaction, reset, subagents).
   *Backend built 2026-10-22; the product (how it is listed, opened, named,
   what it remembers, what starts it) is still to be designed.* The pieces,
   each usable without the others:
   - **Roaming conversations** (decision 21): `POST /v0/chats` with
     `roaming: true` makes a chat with no home device. Its tools are
     `device-tools` (src/server/device-tools.js): `devices` lists every
     device with its shared folders; read/write/edit/bash take `device` and
     `folder` per call, waiting while a device is offline, with
     continue-without as in owned threads.
   - **Subagents** (decision 10, thread subagent; src/server/subagents.js):
     a `subagent` tool runs a task in a child conversation owned by the call
     (pi-durable's pattern: stop and restart reach the child; no nested
     delegation or question card). Offered to roaming chats and templates
     listing `subagent`. `GET /v0/chats/:id/subagents[/:conversationId]`
     lists children and reads one's transcript.
   - **Bounded context**: pi-durable's automatic compaction (already on),
     `POST /v0/chats/:id/reset {handoff?}`, and a `handoff` tool for roaming
     chats that restarts the agent's context from its own note. The
     transcript always keeps everything.
   Not built: worker threads on other harnesses (decision 10's second shape),
   background subagents that outlive the turn, a persistent agent record or
   listing, scheduled or event-driven turns.
3. **Node role + one remote device.** Node mode in the install, tailnet
   pairing, root grants, remote read/edit/search/shell `env`, device status
   in the UI, offline wait.
   *Gate:* from phone, a thread works in a desktop-declared folder; the
   desktop going offline pauses and resumes the thread.
4. **Typed device capabilities**, starting with notify/clipboard, then
   Android screen share.
5. **Cut over first-party profiles to the Conduit durable agent.** *(Built 2026-10-22.)*
   Assistant, Coding and Runtime are templates applied to pi-durable
   conversations. Each template supplies the prompt, tools, extensions, skills
   and model scope. Classic Pi chats are converted at startup from their active
   JSONL branch, preserving message ids; the old "Conduit runtime" chats became
   Assistant chats. The fork tree follows chat lineage, template skills appear
   as slash commands, and template `models` supplies scope when settings have
   no enabled list. The classic process and `pi_rpc` adapter are removed. The
   JSONL reader remains only for conversion and legacy cleanup.

Node track after milestone 3, in order (agreed 2026-10-21):
a. **Main as a device** (decision 22): workspace files, Git and the
   dashboard act on `{device, path}` through an environment; main is the
   local device. Device workspaces stop being read-only special cases.
b. **Remote spawn** on the node protocol: processes with stdio/PTY relay,
   then terminals on devices and third-party harnesses on devices.
c. **Thread ownership record** and the continue-without control, together
   with steps 1, 2 and 4 under Architecture › Making it general (they touch
   the same records: every workspace gets a place, refusals become
   capabilities, adapters take a processes handle).
d. Windows node and the phone gate on real hardware.

## Open questions

- Future: federation (any device can be main) needs replicated storage and
  loss protection; explicitly deferred.

## Non-goals (for now)

Mirrors for third-party harnesses; a Conduit-owned task engine; federation;
browser tabs as nodes; exactly-once arbitrary shell execution.

## Decision log

Each decision as it was put: the question, what was weighed, what was chosen
and why. The numbered decisions above are the conclusions; this is the
reasoning to interrogate when one of them stops fitting.

**Sources.** This plan was condensed from a fuller proposal of 2026-10-08,
still the best statement of the node model, its invariants, identity
concepts, protocol requirements, security posture and failure matrix:
`git show e066e6e2:docs/distributed-nodes-and-execution.md`. The older vision
it descends from (targets running harnesses, Remotes, lineage) is
`git show 1f2d06d1^:personal-agent-platform-design.md`. Several 2026-10-21
questions below were already answered there; each says so.

### 2026-10-21: the model

**Framing.** *(Restates the October proposal's core decision: the server
owns intelligence and coordination, nodes are where actions happen, UI
clients observe and direct.)* First sketched as "work on any client from any
other client".
Corrected: harnesses run on the server, so it is two relationships with the
server in the middle -- *control* (any client drives the server: the chat
contract) and *action* (the server acts on devices: the node protocol). A
phone never drives the desktop; it drives the server, which acts on the
desktop. → decision 20.

**How does a tool call pick its device?** Weighed: a device per call with the
workspace as default (needed for a persistent assistant); one device per
conversation (today's code); a subagent bound to each other device. Chosen:
a thread is owned by a device and its calls default there; a persistent
assistant picks per call; an owned thread may go on if its device is
unreachable but knows durably where it belongs (a record beside the
conversation, not agent context). Why: a thread has a home, which keeps short
chats simple, while the assistant gets the reach it needs. → decision 21.

**Is main's machine just another device?** *(Already adopted in October:
"Local server environment represented as a Node", one vocabulary, no "is
remote" branches.)* Weighed: yes, trusted by default
(one code path, nothing changes for existing users); yes with explicit grants
(uniform, but every workspace needs a migration and a grant); no, keep local
special (least work, but Conduit's file browser, Git and terminals stay two
paths for good). Chosen: a device, trusted by default. → decision 22.

**May third-party harnesses work in a device's folders?** *(Changes the
October proposal, which ran them on the server against mirrors of device
folders and made "moving Codex/Claude Code's core loops onto remote devices"
a non-goal; matches the July vision, where targets run harnesses.)* Recommended: never,
runtime only, on the reading that devices only lend capabilities. Rejected:
installed harnesses are properties of the devices that have them; a device
offers them, Conduit drives them there, and can drive harnesses on several
devices at once towards one outcome; main's own harnesses work as today. This
revised decision 5 (which had made remote environments runtime-only).

**Who approves a write or a command on a device?** *(October left
"device-local approval for sensitive classes" open; this settles it.)* Weighed: the grants are
the approval; an approval card on any client per call (safe, but long tasks
become babysitting); a prompt on the device itself (strongest consent,
useless when away from it -- the point of the feature). Chosen: grants are
the approval; the chat shows every call. → decision 23.

**Who owns a thread typed on the phone in a desktop folder?** *(October:
"a workspace's home is independent of the client used to access it".)* Weighed: the
workspace's device; the device typed on (tools would default to a phone with
no folders); a picker at start. Chosen: the workspace's device, whoever
typed; outside any workspace, the device it was started on. → decision 21.

**How does main drive a harness on a device?** Weighed: remote spawn -- the
node starts the process and relays its stdio or local port, main's existing
adapters run unchanged; adapters on the node, relaying chat-contract events
(lower latency, survives main restarts, but two places run adapters and
versions skew); defer. Chosen: remote spawn. Why: one adapter per harness,
a thin node, and terminals need the same thing. → decision 5.

**What does a thread do when its device is unreachable?** Weighed: wait, with
a control on any client to continue without it; always wait; fall back
automatically after a timeout (keeps moving, but does work somewhere you did
not expect). Chosen: wait, and offer to continue; the model is told the
device is unavailable and the thread keeps its owner. → decision 21.

**What ships next in the node track?** Weighed: main as a device; the
Windows node and phone gate on real hardware; the ownership record; remote
spawn. Chosen: main as a device first, because it makes device workspaces
first-class rather than read-only special cases and is what remote harnesses
and ownership build on. → the node track order under Milestones.

### 2026-10-21: second round, against the October proposal

**Does a workspace store a device path or a root id?** October said a root
id, never "an arbitrary client path" main later executes in; the first build
stored the path. Chosen: root ids -- a workspace is `{node, rootId, subpath}`
and the device maps the root to its real path. Main never holds a path it
runs things in, a device can move the folder, and unsharing invalidates it.

**How is one PC with several environments modelled?** October separated
Device from Node (Windows host and a WSL distro as two nodes on one desktop).
Weighed against one node per device (what was built). Chosen: a device
groups nodes, each with its own key, roots, grants and installed harnesses;
the UI groups by device and a thread is owned by a node.

**What happens to server-side mirrors for third-party harnesses?** They
existed because October kept harnesses on the server. With harnesses running
where they are installed, chosen: drop mirrors. A harness works in its own
device's folder with that device's toolchain, the truthful environment.
(Revisit only if a device has the folder but not the harness.)

**How does the node role run on a desktop?** Weighed: a background companion
separate from the window (October's proposal); only while the app is open; a
standalone CLI only. Chosen: a background companion that keeps serving with
the window closed, starts at login (a setting in Devices), and is paired
independently of which server the UI points at. Android serves while open,
then by push wake. Built for the desktop app: the shell runs the
same `conduit-node`, bundled with Node and node-pty's prebuilt binaries as an
app resource (`scripts/build-node-companion.mjs`, `src-tauri/src/
node_companion.rs`), while "Serve this computer" is on; Settings › Devices
adds this computer to the server in one step (the server's key, handed to
the shell's node) and shares folders through the system picker. A real
Windows node ran the runtime, file browsing and a ConPTY terminal.

### 2026-10-21: third round, on what October left open

**What is a Task?** October proposed a server Task domain (queued,
waiting_for_node, waiting_for_approval, …) beside chats. Weighed: pi-durable's
tasks, projected; a Conduit task layer above every harness (uniform, but a
second durable engine); defer. Chosen: pi-durable's, projected -- no Conduit
task engine (decision 1); a task is a runtime conversation or subagent with
its pi-durable state, shown across chats; third-party harness work appears
as worker threads (decision 14).

**How far do we go on knowing whether a cut-off action happened?** October
required action ids, receipts and reconciliation, and no blind retries.
Weighed against reporting "cut off" and letting the model decide (what
exists). Chosen: receipts for writes and commands -- every mutating call
carries an action id, the node records its outcome, and after a reconnect
main asks what happened; writes become exactly-once, commands report their
exit or "unknown" truthfully. Built: `src/nodes/receipts.js`; a command
keeps running on the node through a dropped socket and its output resumes
where it broke off; only a restarted node (another `boot`) yields "unknown".

**Can a device pair with more than one server?** Weighed: independently,
each pairing with its own key, roots and grants (October's model); one
server per device. Chosen: independently; switching the server a UI shows
never moves a device's pairing. Built: node.json holds a pairing per server, each
with its own key and folders, and `run` keeps a connection to each.

**Which files never leave a device?** Weighed: a default deny-list, editable
per root; nothing excluded; respect .gitignore (surprises when an agent needs
a generated file). Chosen: a default deny-list (`.env*`, keys, `.ssh/`,
credential stores) that the node refuses to read through browsing,
attachments and agent file tools unless a root allows it. Shell is unaffected
-- it has the user's full access by decision. Built: `src/nodes/secrets.js`; names
still list, contents are refused for reads and writes; `conduit-node share
--allow/--deny` edits a root's list.

### 2026-10-21: which harnesses run on devices

**Every adapter on devices?** Built for Claude Code, Codex, fx (ACP) and
OpenCode: main's adapter keeps its translation into Conduit's internal
representation and only its launch and saved-state reads move to the
device (spawned process, a tunnel to the harness's own socket or loopback
service, or a `harness` read on the node). Not for Conduit Pi: it runs
Conduit's pinned Pi with Conduit's agent folder and the server's
credentials, which would have to leave the server, and the Conduit runtime
-- already acting through devices -- is replacing it. Not for ChatGPT web:
it has no workspace or file tools, so a device adds nothing.

### 2026-10-21: from the security review of the node path

*(Its first finding restates October's "narrow shell cwd alone is not a
sandbox".)*

An adversarial review of the first node protocol found these, and each fix
is a decision as much as a patch:

- **`shell` is full access as the device's user.** A command starts in a
  shared root, but nothing confines it; the grant says so (CLI warning,
  Devices label). Sandboxing commands (per-OS) is later. It also makes the
  check-then-use gap in file calls moot: only a command can plant a link.
- **File calls never resolve through a link that resolves nowhere.** A
  dangling link inside a root could have created its target outside it.
- **Temporary files are not created on a device for main.** They live in the
  device's temp directory, outside its roots.
- **A device workspace never reaches main's own filesystem.** Its path is the
  device's: unlinking it touches nothing on main, deleting its files is
  refused, terminals and chat moves into or out of it are refused, and the
  dashboard reads no Git or recent files for it. Until decision 22 lands, its
  files browse read-only through the device.
- **Handles are never reused** across reconnects, and waiting for a device
  listens before it looks, so a reconnect is never missed.

### 2026-10-21: devices, roles and the head

The architecture sketch drew clients and devices as separate boxes and the
server as a headless brain. Corrected by the user: a device and a client are
the same thing; client and node (daemon) are properties of a device, most
devices run both, a web client or a declining owner runs only the client.
The head is usually the VPS but a headed desktop may hold it, so nothing may
assume a headless head. → decision 24, the Architecture section. The user
accepted the rest of the sketch (seams, the differences table, making it
general) to be folded in here; steps 1, 2 and 4 join node track (c).

### 2026-10-22: the cutover (milestone 5)

Asked how the first-party profiles move from Pi 1.3.0 to pi-durable.
- **History.** pi-durable's history is linear; editing or forking an earlier
  message makes a new chat. Accepted, with the tree still drawn by walking
  chats' fork lineage (each fork knows the chat and message it came from).
- **Coding's codemode** uses pi-durable's own codemode extension (the Pi
  extension cannot run in the bridge).
- **No dual support.** On the switch, every existing Assistant, Coding and
  Runtime chat on classic Pi is converted to the durable agent once; classic
  Pi is not kept for them. The user is the only user and nothing needs
  preserving beyond what a conversion carries. (This replaces decision 2's
  "old Pi stays to continue existing chats".)
- **The "Conduit runtime" profile is folded in**: the templates are the
  durable agent's profiles; its chats show as Assistant.

### 2026-10-22: environments on one machine

**Does each environment need its own connection?** The socket itself is
cheap (an idle WebSocket); the cost is two pairings, routes and online states
for one machine. Proposed: one connection per device, the Windows daemon
relaying WSL as a stdio child. Answered: the device is a grouping and must
handle both -- someone may expose only WSL headlessly -- and relaying all WSL
traffic through Windows may prove too costly. → decision 25: either path,
chosen per environment (not "direct when available", not "always relay").

**Who holds a relayed environment's credentials?** Weighed: a device key
held by the relay (simpler pairing, but the relay speaks for WSL and a direct
connection needs pairing anyway) vs each environment's own key (the relay
only forwards). Chosen: each its own key. → decision 25.

**How does WSL get conduit-node?** Weighed: the Windows app shipping a Linux
build and Node (zero setup, bigger installer), the distro's own Node
(breaks without one; node-pty needs a Linux build), or the user installing it.
Chosen: the user installs it, and the Windows client offers to download and
install it.

**Does a relayed WSL child keep the WSL2 VM awake?** Only while Serve is on:
on-demand starts pay VM boot and kill watches and shells on idle.

**Which environments does the model cover?** WSL now; dev containers and SSH
hosts behind a device later, so frame tags and the relay are not WSL-shaped.

**The same files from Windows and from WSL?** Weighed: separate, detected
and linked (one workspace opened in either environment), or discouraging
`/mnt` shares. Chosen: separate for now. → decision 26.

**Does a terminal outside shared folders need its own grant?** It was built
with one (`conduit-node terminal on`), but a shell grant on any folder already
reaches the whole home. Chosen: follow the shell grant. → decision 27.

### 2026-10-22: the head, terminals and the two networks

**Should the head run its own node daemon, dropping tmux?** Proposed to make
decision 24 literal (one terminal implementation) and allow a Windows head.
Answered: tmux is too important for recovery, especially on the head; a
Linux-only head is acceptable. Weighed: tmux on the head only, tmux on Unix
nodes too, or a flexible head with a daemon fallback. Chosen: tmux wherever
it exists. → decision 28.

**What is the desktop after the merge?** Weighed: the VPS as the only head
(the desktop a device), two networks, or the desktop as the head. Chosen: a
dev network headed by the desktop and a prod network headed by the VPS, the
desktop a device of both. Dev's head takes over this machine's existing data;
nothing in either is relied on, so a migration such as the classic-chat
conversion may run on dev at the merge. "Conduit Durable" ends with the
merge. → decision 29.

**How does a node learn what the head supports?** A feature list in the
head's reply to hello, rather than bumping the protocol version for each
addition. → decision 30.

**The relay's security review:** run now, in the background, rather than at
the merge.

### 2026-10-23: the desktop on both networks

**Which folders, which grants?** One projects folder on Windows
(`C:\Users\jaska\Projects`), read, write and commands, with each network. WSL
joins prod relayed by the Windows app (decision 25), sharing nothing until its
owner shares a folder there (`conduit-node share` in WSL; the Windows app does
not manage a relayed environment's folders yet).

**How does Windows reach a head in this machine's WSL?** The head serves HTTPS
with its own self-signed certificate, which the apps accept through its
identity and a node could not check; its tailnet name was advertised to
devices though nothing served it, and Windows reaches WSL over the tailnet
only through a relay. Windows dials the head on loopback over plain HTTP,
which the port also answers; the tailnet route is offered only when Tailscale
serves it. The user chose to pin the head's identity in a pairing for the
case loopback does not cover (a node on another machine and a head with no
trusted certificate); not built yet.

### 2026-10-23: the hub, and nodes on the LAN

**What is the centre of a network called?** The hub, not the head. Every
client connects to the hub and never to another client; the hub is where
unscoped chats live and the network is named for it (Desktop-Dev). It is a
device like any other (decision 24); "hub" names its role. Earlier entries
say head; read it as hub. The code and API follow (`hub` on the hub's device
in `/v0/nodes`, `hubIds`, `adoptHub`).

**Can a node dial the hub over the LAN?** Yes (decision 4 widened): a node
may connect from loopback, the tailnet or a private LAN address, never a
public one, and its key still decides. A machine on the network but not the
tailnet (the laptop's Windows) pairs over the LAN; pairing hands it the
address the request came in by -- the LAN name over HTTPS, its certificate a
real one, or a private address over the plain HTTP the port also answers.

### 2026-10-23: browsing a client, coming and going, and the phone

A client may let the hub browse it (`conduit-node browse on`, or "Let <hub>
browse" on This device; set there only): the hub lists any folder by name and
kind, and mounting one asks the device to share it with the grants the device
gives new folders (`conduit-node new-folders`), which Mount a folder… uses
too. Home and drives are refused, as the hub refuses its own. A native client
chooses its own folders with its own picker; Conduit's explorer is for a
browser and for another machine's folders.

Availability is pushed: the runtime stream carries every paired environment's
presence and `devices_changed` as it changes. While one is away its workspaces
stay open (their chats are the hub's), the sidebar and the workspace's page say
so, a chat there says sends still go and its tools wait (decision 21), and what
could not be read is read again when it is back.

The phone, decided and parked: a native node in the Android app (the node
protocol in Kotlin, or Node itself embedded with nodejs-mobile to keep the
agent's code), serving while Share is on as a foreground service, its first
sources the media store (read only, by album), folders granted through
Android's picker, and files shared in to Conduit. No shell: Android gives apps
none.
