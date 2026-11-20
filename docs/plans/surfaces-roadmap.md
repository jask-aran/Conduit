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
- [ ] Email: what is left of `docs/plans/email.md` (the pane and sorting by splits are built): snooze, waiting-on and
  the keyboard set; jbot working a split on request or on a schedule; filing nothing automatically until the person has
  watched the splits for a week; jbot's `mail` tool on (`CONDUIT_AGENT_MAIL`); jbot's mailbox as a second account, then
  retiring the Executor Gmail routine (`mail-task.js`, `mailbox.js`).
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
  and Claude Code. No model-written HTML. Format (A2UI v1.0) and open questions in
  `docs/plans/generative-interfaces-research.md`.
- [ ] 21. Generic tool servers (MCP, OpenAPI, stdio), only if Connectors prove too narrow.
- [ ] 22. Commit message drafting with its own model.
- [ ] 23. Notification destinations. jbot-only for now.
- [ ] 25. A new-chat screen instead of the dashboard. Deferred.
- [ ] A release loop that runs by itself, drawn as its state machine: new commit, gate, internal build; a red gate
  goes to a fixer agent that lands a fix; a stall pauses it for a person; promotion to production by hand. The owner
  filed it with no words of their own: ask what they want before building.

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
over those. A kind also gets its listeners for free: `listeners(id)` gives each held one as a `Listener` (`server/markup-store.js`;
kind `thread`, `agent` or `chat`, the store adds each CLI `wait` as `session`), its lead first and marked `lead`. The lead is the hub's
(`PUT /v0/document/:id/lead`, kept in links.json as a `Lead`), and is the own thread (`thread`, once `conduit`) unless one is set.
What still knows a paper's blocks outside the paper's two entries:

- [ ] A seat carries `blocks`, on the hub (`sit`, `hear`, `readPartial`, the seat frame) and in the editor's `DocumentSeat`: a kind
  whose places are not blocks needs the field to be "places", which is a format change.
- [ ] The `/blocks` route's body and the `conduit_artifact` tool (its actions, its `block` parameter, its description) are the paper's. A
  second editable kind needs its own place parameter there, or its own tool.
- [ ] `current` and the live socket assume a room with a Yjs `doc`.
- [ ] `artifact-kinds.ts` types `edit` as the paper's tool names; `artifact-rows.tsx` offers Copy as Markdown and Count by comparing
  the kind; `main.tsx` names the two file endings and passes "paper" as every artifact's modes; `connections.ts` types a hand-off's
  kind as the two.
- [ ] A kind this client does not know has no entry, where it used to be drawn as a paper.
- [ ] The paper as a plain Markdown file (the owner's direction). The `markdown` kind (`.md`) is its first step: a paper's room, verbs and
  comments over a file of Markdown alone. Its block ids and its id are kept beside it, matched to the file's blocks by content when the file
  changes outside Conduit; front matter and what its schema cannot hold stay the file's text. A `.md` is one only when made or opened as one.
  Still the paper's own: properties, the extras, and a home beside the file for what Markdown cannot say.

### Panes

The model is DESIGN.md's "Places and panes", "Focus and opening" and "Tabs"; `npm run smoke:panes` checks it.

- [ ] The rest of the dock: overflow becomes the row's "more panes" control (today `foldedSlots` fold into the dock, as
  the rail's docked buttons); the dock's Chat tool goes once its review navigations (`REVIEW_NAVIGATION_EVENT`,
  `TURN_ARTIFACT_NAVIGATION_EVENT`) have another home. The phone keeps its tab strip.
- [ ] Alt in a pane's folder viewer leaves the keyboard on the page body, not where it was (cause unmeasured).
- [ ] A narrow folder viewer (the dock) folds its tree after a plain open, leaving the keyboard on the page body: a feel
  question for the owner.
- [ ] Not walked in a browser: "Move to a pane" carrying an unsaved edit; Files → Changes → Files with an edit;
  Ctrl-opening jbot and jbot in a side pane; closing the shown tab going to the one shown before.
- [ ] DeX: dragging handles with a mouse is poor (cause unmeasured; the drags are HTML5 drag and drop, which Android
  WebView may not start for a mouse: read `dragstart` and `pointerType` over the WebView devtools socket). The
  on-screen keyboard showing beside a physical one is Samsung's `show_ime_with_hard_keyboard`, not Conduit's.

### Sheet

The `sheet` kind (`.csv`, `server/sheets.js`, `sheet-format.js`), heading for Excel parity; Excel's behaviour and keys
are the reference unless there is a reason to differ. Storage and xlsx: `docs/plans/sheet-xlsx-and-tabs.md`.

- [ ] Data validation of every kind.
- [ ] Tables.
- [ ] Smart chips.
- [ ] The command palette's speed over a sheet.
- [ ] Typed-date entry: a date typed into a column read as that column's `date` type.
- [ ] Seats, suggestions, and keeping what an agent changed for a comment to take back.
- [ ] Notes and threaded comments from xlsx as Markup comments, waiting on the owner (16 notes would hand 16 items to
  agents); they are kept on their cells (`note:`) and not drawn, as pictures and page setup are not.
- [ ] OFFSET with cell arguments (frozen on import today); an `.xlsm` export that keeps its macros.
- [ ] Not built: Shift+F8 (add to the selection: Glide's `rangeStack` is never used), Ctrl+F3 (no names dialog).
- [ ] Undo stops waiting for a hub op after a timer (`history.ts`), so a slow op lets a queued Undo take the step
  before it: wait while the request is pending, and time only frames owed after the reply.
- [ ] Deleting a merge's top row or left column leaves the merge empty (the value goes with its line); check Excel.
- [ ] "Undo N steps" can undo more than N: Yjs skips steps others have overwritten, and the list still names them.
- [ ] Ctrl+Z does nothing while a ribbon button holds the focus (after Escape from its menu, or after the Undo several
  list shuts): the undo keys are the grid's alone.
- [ ] Find does not search again when a column is hidden or shown while it is open; More decimals on a General text
  cell gives the range `0.0`; Merge with an empty top-left blanks the only value (Excel's not checked).
- [ ] xlsx: where a styled row past the tab's cells crosses a styled column only the row's style is written
  (`xlsx-styles.js`); frozen formulas (`excel:`) are not rewritten by row and column changes outside `cells.edit`;
  `documents.js` passes the import report to `exportXlsx`, which ignores it.
- [ ] Gridlines cross overflowing text; Delete cells… and Insert cells… start on left/right where Excel starts on
  up/down for a block wider than tall; the dropdown options dialog draws each colour picker above its Up and Delete;
  at a 1,600 px window the ribbon folds into "Format" once the undo group gains its chevron.
- [ ] Opening a sheet: the grid, tabs and canvases appear about 350 ms after the pane's first paint, and the margin's
  height jumps; the cell menu's second frame is about 20 ms (its rows' icons are built as JSX by the caller).
- [ ] Charts, waiting on the owner: a selected chart's brightened edge (DESIGN's no-outline rule); series inks not run
  through a palette check; charts draw over frozen rows; a moved chart snaps to the cell under its corner; the ask box
  under the tools at 1,100 px covers the margin's top card.
- [ ] The owner's call: "View settings…" in the cell menu breaks DESIGN's rule that menu rows don't open settings.
- [ ] Unchecked on real devices: swiping the grid by touch on a phone; Ctrl+Shift+0 on Windows (which may switch the
  input language); a Windows trace of sideways scroll under frozen rows.
