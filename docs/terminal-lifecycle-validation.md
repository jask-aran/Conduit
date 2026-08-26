# Terminal lifecycle validation

## Accepted intent

- Treat this branch as a terminal-state correctness simplification with expected, unmeasured performance benefits.
- Let tmux own terminal process lifetime, terminal state, geometry, history and reattachment.
- Keep Conduit responsible for identity, authentication, creation, destruction, attachment policy and bounded byte transport.
- Keep one attached browser per terminal. Permit concurrent attachments to different terminals.
- Keep terminal sessions alive across browser, WebSocket and hidden-panel detach. End them on Conduit restart.

## Required reconciliation with current `main`

Completed:

- Preserved `terminalSocketUrl()` and Capacitor socket-ticket authentication while adding initial `cols` and `rows`.
- Added explicit terminal-stream shutdown. It rejects new attaches, closes clients with `1012`, disposes attachments and stops tmux.
- Suppressed reconnect after `1012` and `1013`. A failed disposable tmux client now uses retriable code `1011`.
- Preserved current `main` Workspace geometry and unrelated behavior.
- Removed `TerminalRenderer.drain()`.
- Removed startup and create-time compaction. Every valid prior row remains available; only records that were running become `server_restart`.
- Updated `conduit-web/README.md` for tmux ownership, no replay frames and exclusive attachment.
- Accepted current `main` removal of the obsolete panel-containment test.
- Added explicit terminal cleanup to the Linux and Windows managed launchers. Direct and container starts also clean stale sessions through `PtyManager.load()`.

## Evidence required before merge

- Run typecheck, build and focused PTY tests with tmux 3.3 or newer.
- Validate create, input, resize, detach, reattach, multiple terminals, exclusive same-terminal attach, destroy and server shutdown.
- Remaining focused coverage: split CSI/OSC, OSC 52, resize/output races, slow-client `1013` and native terminal socket-ticket URLs.
- Record comparative performance only if performance is used as a merge claim. Current evidence does not prove CPU, memory, throughput or latency gains.

## Local validation

- Fixed fresh startup on tmux 3.4 by accepting its missing-socket response only when `tolerateMissingServer` is enabled. Added a regression test.
- Fixed terminal and Workspace deletion when no browser socket exists.
- Fixed the active-terminal menu crash by placing `MenuLabel` inside `MenuGroup`.
- Fixed browser terminal paste so `Ctrl+V`, `Ctrl+Shift+V` and macOS `Cmd+V` paste clipboard text once. Terminal OSC 52 remains output-only; browser paste is a separate user action.
- OpenCode showed fixed-position vertical seams between full-screen TUI cells at every tested browser scale. Enabled the xterm WebGL renderer with automatic DOM-renderer fallback after WebGL failure or context loss.
- Typecheck and production build pass.
- The focused desktop Chromium xterm test passes and verifies that `Ctrl+V` and `Ctrl+Shift+V` each send clipboard text exactly once.
- Merged current `main` into the branch in `10d4cae`.
- Server tests: 560 pass, one skip and no failures.
- Real-tmux transport tests: ten pass. They include service restart `1012`, disposable-client recovery through `1011`, transient `pty_in_use` retry, parser-level input rejection, multiple sessions and TUI control sequences.
- Split UTF-8 input now uses one streaming decoder per attachment. Parser-level oversized input closes only the browser attachment and leaves the tmux session available for reattach.
- Production build and typecheck pass. The focused Chromium Workspace, xterm paste/WebGL and resident-reattach tests pass.
- Browser validation passes for terminal creation, input, hidden-panel detach/reattach, screen restoration, second-terminal creation and switching between terminals.

## Known product limits

- Workspace terminals require tmux 3.3 or newer on the server host.
- Native Windows Node hosts do not have a supported tmux backend.
- The 4 MiB input frame limit is a generous paste limit, not a measured memory budget.
