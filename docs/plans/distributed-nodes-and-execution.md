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

1. **A new server-owned system: the Conduit runtime.** Built on
   `@earendil-works/pi-durable`, it is not a profile or a plain harness: it
   hosts all its conversations in one in-process Harness and owns pi-durable
   storage, tasks, subagents, documents, node `env`s and persistent
   assistants. Conduit does **not** build its own Task/Action engine.
   Its chats appear in the normal chat list through a **thin adapter** on the
   existing [harness contract](../chat-backend-contract.md); runtime-only
   things (assistants, devices, tasks) get their own surfaces.
   **pi-durable's record is authoritative**; Conduit's ChatLog for these chats
   is a projection rebuilt from it. Codex/Claude Code/OpenCode keep their
   current adapters.
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

## Milestones

1. **Conduit runtime on main, local env only.** pi-durable host + thin chat adapter; durable
   across server restarts; any client can attach to a running conversation;
   transcript projected through the existing chat contract.
   *Gate:* kill the server mid-turn, restart, the turn resumes or reports
   interruption honestly; two clients watch the same stream.
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

- How pi-durable storage relates to `~/.conduit/data`, backup/restore and the
  Effect v4 server runtime's process/scope ownership.
- How pi-durable's transcript/watch events project onto Conduit's existing
  chat delivery contract without a second transcript model.
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
