# Surfaces roadmap: what is still open

The open items from the 2026-11-02 task list (panes, browser, agents, settings). Done items and the study notes behind
them are in git history (before 2026-11-11). Tick an item by deleting it.

### Browser and agents

- [ ] 10. Acting as you: jbot uses your browser on a device you choose.
- [ ] 12. Add Vercel's agent-desktop for driving desktop apps on devices.

### Chat, agents and voice (decided 2026-11-02)

- [ ] 29. Voice: extend Settings › Voice beyond dictation with text-to-speech (reading replies aloud) and voice memos.
- [ ] 30. jbot channels: messaging apps (Telegram, Discord, Slack, WhatsApp, Signal, SMS, email) as jbot's channels,
  grown through the jbot message log (`persistent-agent.md`). Worth keeping from the study: a conversation in a
  messaging app attaches to a thread, and a command there starts a fresh one.
- [ ] 31. A single drawer pane from the bottom, later. Not recursive splits.
- [ ] 32. Browser tabs as pane tabs, a setting (2026-11-03): today a browser is one document, a tab beside chats and
  pages in any pane. A person who keeps many sites open may want each browser tab to be one of the pane's tabs instead;
  offer it as a setting, off by default.
- [ ] 33. Native browser in the desktop clients (2026-11-03): in the Windows (and later macOS) app, "Open browser here"
  shows real pages in a Tauri child webview laid over the pane's body -- no stream, no proxy, the client's own network
  and sign-ins. Orca does this with Electron's `<webview>` tag (composited in the page, so menus draw over it; a partition
  per profile; CDP through `webContents.debugger` in-process). Tauri has no composited equivalent: `Window::add_child`
  (the `unstable` feature) makes a native view that paints over Conduit's HTML, so the pane hides or shrinks it while a
  menu, dialog or drag is over it; its bounds follow the pane by ResizeObserver; title and URL come from
  `on_document_title_changed` / `on_navigation` as events; back and forward by script; its own `data_directory`; agents
  drive it through WebView2's in-process DevTools protocol (`CallDevToolsProtocolMethod`), never a debugging port.

### Later or lower priority

- [ ] 19. Memory view with scope and provenance. Prototype 2026-11-02 on jbot's page, a Remembered group over its
  Memory files: each list line of SOUL (only what it added), USER, MEMORY and 14 days of diary, newest learned first;
  where it is kept and how long ago, with what reads it and who wrote it from which chat on hover; its chat opens
  from the row; forget asks twice and removes that exact line (`GET /v0/agent/memory`, `POST .../memory/forget`).
- [ ] Render tools (generative UI): a model calls `render_table`, `render_chart` or `render_choice` with structured data
  and Conduit draws it as a native transcript block from library components; a Conduit-owned tool, over MCP for Codex
  and Claude Code. No model-written HTML. From the deleted component-system plan, never built.
- [ ] 21. Generic tool servers (MCP, OpenAPI, stdio), only if Connectors prove too narrow.
- [ ] 22. Commit message drafting with its own model.
- [ ] 23. Notification destinations. jbot-only for now.
- [ ] 25. A new-chat screen instead of the dashboard. Deferred.
