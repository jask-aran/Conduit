# Distributed Nodes, Remote Workspaces, and Durable Execution

Status, on branch `distributed-nodes`: milestone 1 built (the
`conduit-runtime` profile: pi-durable chats with restart resume, forks, queue,
questions, attachments, web research and usage). Milestone 3 built:
`scripts/conduit-node.mjs` is the node role, Settings › Devices pairs and
shows devices, a shared folder becomes a workspace whose runtime chats run on
the device and wait while it is offline. Node track (a) and the terminal half
of (b) built: Conduit's files, editing, Git and dashboard act on a device
workspace through one inspector over a host (main's disk or the device), and
its terminals are shells the device keeps across disconnects. Not yet: device
harnesses (the rest of b), the ownership record (c), Windows (d); the agent's
own bash calls still end when a connection drops; nothing watches a device's
folder (it is polled). Milestones 2, 4 and 5 not started.

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
3. **Node role + one remote device.** Node mode in the install, tailnet
   pairing, root grants, remote read/edit/search/shell `env`, device status
   in the UI, offline wait.
   *Gate:* from phone, a thread works in a desktop-declared folder; the
   desktop going offline pauses and resumes the thread.
4. **Typed device capabilities**, starting with notify/clipboard, then
   Android screen share.
5. **Cut over** default Pi to pi-durable; freeze old Pi.

Node track after milestone 3, in order (agreed 2026-10-21):
a. **Main as a device** (decision 22): workspace files, Git and the
   dashboard act on `{device, path}` through an environment; main is the
   local device. Device workspaces stop being read-only special cases.
b. **Remote spawn** on the node protocol: processes with stdio/PTY relay,
   then terminals on devices and third-party harnesses on devices.
c. **Thread ownership record** and the continue-without control.
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

### 2026-10-21: the model

**Framing.** First sketched as "work on any client from any other client".
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

**Is main's machine just another device?** Weighed: yes, trusted by default
(one code path, nothing changes for existing users); yes with explicit grants
(uniform, but every workspace needs a migration and a grant); no, keep local
special (least work, but Conduit's file browser, Git and terminals stay two
paths for good). Chosen: a device, trusted by default. → decision 22.

**May third-party harnesses work in a device's folders?** Recommended: never,
runtime only, on the reading that devices only lend capabilities. Rejected:
installed harnesses are properties of the devices that have them; a device
offers them, Conduit drives them there, and can drive harnesses on several
devices at once towards one outcome; main's own harnesses work as today. This
revised decision 5 (which had made remote environments runtime-only).

**Who approves a write or a command on a device?** Weighed: the grants are
the approval; an approval card on any client per call (safe, but long tasks
become babysitting); a prompt on the device itself (strongest consent,
useless when away from it -- the point of the feature). Chosen: grants are
the approval; the chat shows every call. → decision 23.

**Who owns a thread typed on the phone in a desktop folder?** Weighed: the
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

### 2026-10-21: from the security review of the node path

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
