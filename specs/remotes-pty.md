# Remotes PTY streaming

Tracks GitHub issue #28. This is a temporary implementation queue; delete it
when the issue closes.

## Boundary

The server owns every PTY. The browser chooses only an approved template and a
registered Workspace; it never supplies a program, arguments, environment, or
unresolved working directory. A server restart terminates v0 PTYs. Terminal
bytes are binary WebSocket frames; JSON is control-plane only.

## Slices

1. **Terminal-ready work area** — add the linked-Workspace-only secondary pane,
   its palette and session context-menu entry points, desktop split resizing,
   and phone full-work-area fallback. No terminal process or transport.
   **Complete.**
2. **Server authority and records** — pin `node-pty`, add a testable PTY
   manager and durable `remotes.json` registry. Enforce template-only commands,
   allow-listed canonical Workspace roots, an eight-PTY cap, lifecycle states,
   bounded scrollback, and shutdown semantics. No HTTP/UI exposure yet.
3. **Authenticated API and transport** — add create/list/rename/delete routes
   plus an authenticated per-PTY WebSocket upgrade. Replay scrollback at
   attach; transmit terminal output/input as binary frames; validate resize
   controls and bound slow-client delivery.
4. **Client state and navigation** — add typed contracts, a Remotes sidebar
   group, create/delete controls, and reconnecting transport state. Exited
   sessions remain read-only until deletion.
5. **Terminal renderer** — pin and lazy-load `ghostty-web`, wire bytes and
   resize, apply Conduit tokens, and add desktop/mobile behavior including
   touch focus and modifier access.
6. **Hardening and contract** — add flow-control acknowledgement if real
   terminal workloads show a need, Kitty keyboard negotiation tracking,
   documentation, browser protocol tests, and manual terminal workload checks.

## Non-goals

No arbitrary command execution API, SSH relay, terminal survival across a
server restart, or multiplexed multi-PTY WebSocket in v0.
