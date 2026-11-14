# Surfaces roadmap: what is still open

Open items and undecided questions, numbered ones from the 2026-11-02 task list. Done items and the plans and study
notes behind them are in git history. Tick an item by deleting it.

### Browser and agents

- [ ] 10. Acting as you: jbot uses your browser on a device you choose.
- [ ] 12. Add Vercel's agent-desktop for driving desktop apps on devices.

### Chat, agents and voice (decided 2026-11-02)

- [ ] 29. Voice: extend Settings › Voice beyond dictation with text-to-speech (reading replies aloud) and voice memos.
- [ ] 30. jbot channels: messaging apps (Telegram, Discord, Slack, WhatsApp, Signal, SMS, email) as jbot's channels,
  grown through the jbot message log (see jbot below). Worth keeping from the study: a conversation in a
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

- [ ] Render tools (generative UI): a model calls `render_table`, `render_chart` or `render_choice` with structured data
  and Conduit draws it as a native transcript block from library components; a Conduit-owned tool, over MCP for Codex
  and Claude Code. No model-written HTML. From the deleted component-system plan, never built.
- [ ] 21. Generic tool servers (MCP, OpenAPI, stdio), only if Connectors prove too narrow.
- [ ] 22. Commit message drafting with its own model.
- [ ] 23. Notification destinations. jbot-only for now.
- [ ] 25. A new-chat screen instead of the dashboard. Deferred.

### Keyboard

- [ ] Entering a jbot message's own links and controls by keyboard.
- [ ] The find bar sits over the text it searches.
- [ ] Go to transcript's Ctrl+Shift+4 is the macOS screenshot chord.

### jbot

- [ ] Memory layers not built: topics (people, projects, places; searched, not loaded) and open loops (what it is
  tracking, what it promised, what waits on the person or someone else; what the heartbeat works from).
- [ ] Push through an FCM relay, only if UnifiedPush delivery proves insufficient (a self-hosted hub can only send with
  the app's Firebase key).
- [ ] Limits per sender (queue and cap) once anyone other than the person can wake jbot.
- [ ] Sending into a room with others in it through approvals; today it is refused.
- [ ] Reports onto Conduit's artifact system.
- [ ] Code names follow "context inbox" (`AgentDoc.inbox`) when next touched.
- [ ] Retention: archival or compression of finished runs, asked of pi-durable upstream rather than written against
  its storage.
- [ ] jbot's bash sandbox does not cover outbound network, including loopback services; closing it needs a network
  namespace.
- Not now: routine conditions beyond the gate; routines chained into pipelines (an inbox-arrival trigger covers it).
- Open: what the heartbeat's checklist starts with; the Conduit integration's shape (what it exposes about the hub
  and network); how the attention list, context inbox and side threads appear in Chat and Work (a UI pass with the
  user).

### Screens and device control

Any client can see and drive any device's screens through the hub, and agents can too. Built: one `conduit` MCP
server, scoped calls and turn origin; clients naming their device; screens as one list (`server/screens.js`); the
device API declared once (`device-api.js`); the person's own browser (`conduit_browser`). Decisions still to build:

- **One contract for a screen**, through the hub: picture as H.264 to a `WebScreen` pane on any client; input the
  person's, from that pane; actions an agent's, per kind. A device's screen reaches the hub over the node tunnel.
- **The hub arbitrates**: one holder of a screen's input at a time, the person or an agent; the person takes it by
  touching the pane. Each kind is a typed capability granted per device.
- **A device's screen moves only in sight**: an agent acts on a device's desktop or phone only while some client shows
  that screen. Acting unseen is a later grant (per-device, saying which actions may run headless).
- [ ] `desktop:<device>`: a voxl spike on the Windows app, then the kind. voxl (MIT; its binary is GPL through x264, so
  a separate program) is plain HTTP and one WebSocket, so it fits the tunnel; its client is a whole page (an iframe
  under a hub path, the hub's proxy adding the bearer and filtering a viewer's commands); no accessibility tree or
  window capture; no prebuilt binaries. Unknown: video through the tunnel, the Windows build.
- [ ] `phone:<device>`: actions over adb (Conduit's own tool, from phone-harness's commands; not phone-harness itself,
  whose telemetry is on by default and scripts run unsandboxed; keep its rule: show the whole script, refuse what is
  too long to show), then a picture (unsolved).
- [ ] An origin lasts until the chat's next send, so a routine's turn in a thread a person wrote in still has one.
  Codex's MCP endpoint is added by hand, unscoped.
- [ ] The Android app has no node, so a phone names no device until `phone:<device>`; a browser tab names none.
- [ ] For the first new screen kind: the browsers' routes (`/v0/browsers`) and pane stay the browser kind's own until
  a second kind shows what is common; one holder of input; an agent's actions on a device's browser.
- [ ] The device API: the hub's own environment is listed by hand; a client names its environments by name
  (`peer.nodes`), not id.
- [ ] The person's own browser: the hop through a device's node has not run; it has no pane or picture (the person is
  asked instead); another harness over MCP cannot drive it (no thread to ask from); the relay stops with its hub or
  node; whether it replaces agent-browser for `browser:<device>`.

### Float

Float (Android's edge overlay, `ConduitFloatService`) sends anything to any chat from over any app. The hub does not
know about Float: the phone composes every send from the general routes. Panels are native, not a WebView.

- [ ] Errors that keep what was gathered and say what to do; a nudge toward the screen reader.
- [ ] On the phone: every gesture, panel and capture (hold, radial, locking, Workspace… and Recent…, answering from the
  reply view are untried on a device), then the look.
- [ ] `POST /v0/chats/:id/prompt` does not dedupe by `messageId`, so Float refuses a retry whose outcome is unknown.
  Fix: the hub recognises a `clientUserMessageId` it has already taken for that chat.
- [ ] jbot's routes take text only, so pictures go to chats, not to jbot.

### Artifact kinds

A kind is declared twice: on the client in `ARTIFACT_KINDS` (`client/document/artifact-kinds.ts`, with its `Surface`), on the hub in
`KINDS` (`server/documents.js`, the `ArtifactKind` typedef). Markup, the margin, comments, hand-off and the pane are written once
over those. What still knows a paper's blocks outside the paper's two entries:

- [ ] A seat carries `blocks`, on the hub (`sit`, `hear`, `readPartial`, the seat frame) and in the editor's `DocumentSeat`: a kind
  whose places are not blocks needs the field to be "places", which is a format change.
- [ ] The `/blocks` route's body and the `conduit_paper` tool (its actions, its `block` parameter, its description) are the paper's. A
  second editable kind needs its own place parameter there, or its own tool.
- [ ] `current` and the live socket assume a room with a Yjs `doc`.
- [ ] `artifact-kinds.ts` types `edit` as the paper's tool names; `artifact-rows.tsx` offers Copy as Markdown and Count by comparing
  the kind; `main.tsx` names the two file endings and passes "paper" as every artifact's modes; `connections.ts` types a hand-off's
  kind as the two.
- [ ] A kind this client does not know has no entry, where it used to be drawn as a paper.
- [ ] The paper as a plain Markdown file (the owner's direction, not started): `identify`, `made` and its places as the kind's own.
