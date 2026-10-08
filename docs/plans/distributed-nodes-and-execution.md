# Distributed Nodes, Remote Workspaces, and Durable Execution

Status: shaping; decisions agreed 2026-10-08, **nothing implemented**.
Supersedes the earlier long-form proposal (see git history of this file for
the full survey of mirrors, task engines and failure matrices).
Related: [web runtime](../../conduit-web/README.md),
[harness contract](../chat-backend-contract.md),
[deployment](../DEPLOYMENT.md), [testing](../TESTING.md),
[pi-durable](https://earendil.com/posts/pi-durable/).

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
5. **Remote environments are Pi-only.** A pi-durable conversation's `env` is
   built from its workspace: the local node is the zero-network path, a remote
   node routes read/edit/search/shell to that device. Third-party harnesses do
   not get remote workspaces (no mirrors, no MCP bridge) until missed.
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

## Open questions

- How Pi history edits map onto pi-durable forks.
- Node protocol shape: pi-durable's remote `env` adapter vs a Conduit
  WebSocket protocol over the tailnet.
- Remote shell lifetime when a node disconnects mid-command.
- Whether Android can hold the node role in the background at all, or only
  while foregrounded.
- Future: federation (any device can be main) needs replicated storage and
  loss protection; explicitly deferred.

## Non-goals (for now)

Mirrors for third-party harnesses; a Conduit-owned task engine; federation;
browser tabs as nodes; exactly-once arbitrary shell execution.
