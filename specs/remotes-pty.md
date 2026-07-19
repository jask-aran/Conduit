# Spec: Remotes v0 — local PTY panes

Status: draft · Priority: 4 · Requires: edge-auth. Vision: Journey B,
invariant 14, S9 (terminal tier ships first).

## Goal

The Remotes surface exists, populated by terminal sessions on the local
target: server-owned PTYs (a shell, `claude`, `codex`, terminal `pi`, tmux —
anything with a CLI) rendered as xterm.js panes inside the shell. This
delivers the original motivating scenario — attach to your CLI agents from a
phone — on one machine, before any broker or remote host exists.

## Model (vision-aligned)

- A PTY session is **opaque by design** (invariant 14): terminal bytes,
  process state, connection state, metadata. No parsing of terminal text, no
  semantic inference, no title-guessing from output.
- Sessions outlive browser connections (invariant 1): the server owns the PTY;
  detach never kills it. Server restart does end v1 PTYs (unlike Pi chats) —
  the UI must say so honestly; users wanting restart-survival run tmux inside.

## Server

`src/pty-manager.js`, deliberately parallel to `PiManager` in ownership style:

- Dependency: `node-pty` (the one new native dependency; pin exactly).
- Record: `{ id, title, command, args, cwd, cols, rows, status:
  running|exited, exitCode, createdAt, lastAttachedAt }`, kept in a runtime
  registry (in-memory map + `data/remotes.json` for metadata so the list — not
  the processes — survives restart, rows marked `exited`).
- Scrollback: per-session ring buffer (default 256 KiB) replayed on attach;
  reconnect never replays byte-by-byte history beyond the buffer.
- API: create (command template + cwd restricted to allow-listed roots: a
  Workspace, a project directory, or `$HOME` when explicitly enabled by
  `CONDUIT_PTY_HOME=1`), list, attach (WS: binary PTY bytes both ways +
  JSON control frames for resize/status), kill, rename, delete-row.
- Command templates, not free-form argv from the browser: shipped presets
  (`shell`, `pi`, `claude`, `codex`, `tmux attach`) defined server-side in
  config; the browser picks a preset + cwd. Free-form commands are typed into
  the running shell, not passed through the API.
- Caps: max PTY sessions (default 8), reuse the auth gate from edge-auth on
  both the routes and the upgrade path.

## Interface

- Sidebar gains a **Remotes** group listing PTY sessions with status dots;
  create action offers preset + workspace picker. Palette entries included.
- The pane: lazy-loaded xterm.js (+ fit addon), themed to the app tokens,
  attach/detach lifecycle, reconnect-with-scrollback, mobile-usable (on-screen
  modifier bar can wait; pinch/scroll must work).
- Header shows command, cwd, status, and kill/rename actions with
  confirmation. Exited sessions render their final scrollback read-only until
  the row is deleted.
- The attention signal is out of scope v1 (opaque tier cannot know an agent is
  waiting — that arrives with ACP; vision S8's "crude until ACP" note).

## Verification

Node tests: manager lifecycle (create/attach/kill/exit), scrollback ring
replay, cwd allowlisting, preset validation, caps, registry persistence of
exited rows. Browser test: mocked-WS pane renders bytes and resizes; a single
real-server test covers the byte round-trip. Auth tests extend to the new
routes/upgrade. Build within budgets (xterm is lazy).
