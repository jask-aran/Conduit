# Terminal lifecycle validation

## Accepted intent

- Treat this branch as a terminal-state correctness simplification with expected, unmeasured performance benefits.
- Let tmux own terminal process lifetime, terminal state, geometry, history and reattachment.
- Keep Conduit responsible for identity, authentication, creation, destruction, attachment policy and bounded byte transport.
- Keep one attached browser per terminal. Permit concurrent attachments to different terminals.
- Keep terminal sessions alive across browser, WebSocket and hidden-panel detach. End them on Conduit restart.

## Required reconciliation with current `main`

- Preserve `terminalSocketUrl()` and Capacitor socket-ticket authentication while adding initial `cols` and `rows`.
- Add explicit terminal-stream shutdown. Reject new attaches, close clients with `1012`, then dispose attachments and stop tmux.
- Do not reconnect a terminal after close code `1012` or `1013`.
- Preserve current `main` workspace geometry, renderer improvements and unrelated behavior.
- Remove `TerminalRenderer.drain()` unless a real caller requires it.
- Remove `latestPerProject()` startup compaction. Retain every valid prior row as `server_restart`, or clear all rows deliberately.
- Update `conduit-web/README.md` to describe tmux ownership, no replay frames and exclusive attachment.
- Remove the obsolete panel-containment test change unless its matching CSS behavior is intentionally included.

## Evidence required before merge

- Run typecheck, build and focused PTY tests with tmux 3.3 or newer.
- Validate create, input, resize, detach, reattach, multiple terminals, exclusive same-terminal attach, destroy and server shutdown.
- Add or run coverage for split UTF-8, split CSI/OSC, OSC 52, resize/output races, slow-client `1013`, large-input rejection and native socket-ticket URLs.
- Record comparative performance only if performance is used as a merge claim. Current evidence does not prove CPU, memory, throughput or latency gains.

## Local validation

- Fixed fresh startup on tmux 3.4 by accepting its missing-socket response only when `tolerateMissingServer` is enabled. Added a regression test.
- Fixed terminal and Workspace deletion when no browser socket exists.
- Fixed the active-terminal menu crash by placing `MenuLabel` inside `MenuGroup`.
- Fixed browser terminal paste so `Ctrl+V`, `Ctrl+Shift+V` and macOS `Cmd+V` paste clipboard text once. Terminal OSC 52 remains output-only; browser paste is a separate user action.
- OpenCode showed fixed-position vertical seams between full-screen TUI cells at every tested browser scale. Enabled the xterm WebGL renderer with automatic DOM-renderer fallback after WebGL failure or context loss.
- Typecheck and production build pass.
- The focused desktop Chromium xterm test passes and verifies that `Ctrl+V` and `Ctrl+Shift+V` each send clipboard text exactly once.
- Server tests: 533 pass, one skip and one fail. The failure opens a replacement WebSocket immediately after the prior client closes. The product client retries the transient `pty_in_use` response.
- Browser validation passes for terminal creation, input, hidden-panel detach/reattach, screen restoration, second-terminal creation and switching between terminals.

## Known product limits

- Workspace terminals require tmux 3.3 or newer on the server host.
- Native Windows Node hosts do not have a supported tmux backend.
- The 4 MiB input frame limit is a generous paste limit, not a measured memory budget.
