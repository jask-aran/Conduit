# Surfaces roadmap: panes, browser, agents and settings

Status: directions and review decisions from 2026-11-02, after studying a comparable self-hosted agent workspace.
Not all decided; shape into issues before building. Newest last.

## Empty pane primitive

Conduit's primitive is panes holding documents, but there is no empty pane: a pane with no document in it.
Today one only appears when broken (opening an old URL to a chat that no longer exists: a bug to look into).
An `EmptyPane` would show a greeting, the hub and version, and quick starts (new chat, open workspace, recent),
and a pane's + would offer documents to open in it: chat, terminal, browser, …

## Browser document — ASAP

A browser document beside chats and terminals. Main use: agents driving it.

## Agents drive Conduit's UI

Big next target: Conduit's UI and backend drivable by the agents it runs, through an MCP server or a CLI inside
code mode. An agent can know what the user is seeing, open and close panes, open a browser, and work next to
the chat.

## A new-chat screen, not the dashboard

DESIGN.md says "the Conduit dashboard is the new-chat screen". Thinking of moving away from that: the
dashboard is cluttered, and composing there (attachments, long messages) clashes with its curated layout.
A dedicated new-chat screen still exists under the hood; chats would start there, and starting one from a
dashboard would mean moving into it. **Not to change yet.**

## Settings to study

Comparable products expose primitives Conduit has decided implicitly: a Chat page (title model, compaction, title
generation), a Tools page (exactly which tools are available — important), Memory, Git.

## A harnesses page

An agent-integrations page would list harnesses (Codex, Claude Code, Pi). Conduit's word is **harness**.
Other products treat harnesses as model providers in the model picker; Conduit puts harnesses in the
profile picker and requires mapping a profile to a backend harness. Keep Conduit's decision, and add an
explicit harnesses page: the third-party integrations page, where each is set up the first time and enabled or
disabled. Complexity: harnesses available on the hub versus on particular clients (devices); the client/hub
work is parked but this page has to allow for it.

## Account primitive

Who's signed in, and Log out, in the server switcher's menu. A single-machine product can skip this; Conduit,
with several hubs and clients, can't.

## Review of the settings study (2026-11-02)

The user's calls on the study's ranked list:

- **Browser document:** a default browser document always open on the hub first. Then browsers on clients,
  reachable from any other client, proxied through the hub. Explore proxying the browser itself instead of
  video streaming (proxying by rewriting pages can strip CSP; streaming sends H.264 from a real Chrome).
- **Compaction:** not a policy page. Conduit takes what Pi and the adapted harnesses do; the job is making it
  visually clear, already started with the compaction summary row in the transcript.
- **Harnesses:** devices declare harnesses, not the other way round. Availability belongs on the device
  (Devices), not on a harness-first page.
- **Usage page:** could be interesting.
- **Tool availability and approval:** add to Settings.
- **The rest (helper models, empty pane, memory view, tool servers, skills, commit drafting):** reasonable.
- **Notifications:** only for jbot (the persistent agent) today; to be expanded later.

## Review of the build plan (2026-11-02)

- **Account stays in Settings.** Only a profile picture goes in the server switcher's menu. An account is a
  registration with a network (the hub and its nodes); accounts following you across hubs is a later, very low
  priority idea.
- **All new UI is built from components v2**, extended only with the user's approval.
- **Browser transport plan approved** (proxy with per-site origins, streaming fallback). Look for existing
  projects to take instead of building: Vercel's agent-browser for the browser, and add Vercel's
  agent-desktop (https://github.com/vercel-labs/agent-desktop: Apache-2.0, Rust CLI, desktop apps through
  the OS accessibility tree, snapshot refs, JSON output; macOS, Windows, Linux with at-spi2) to Conduit in
  general, for driving desktop apps on devices.
- **Acting as you:** the hub browser signing in as the hub is fine for now. Later, make it easy for Conduit to
  act as you, perhaps only jbot, with you choosing which client (device) web actions run from. For reference:
  Meta's Muse runs a browser you and the agent share and keeps credentials in a separate store the model
  doesn't see; Grok Bot gives each agent a cloud computer where you take over to sign in, then hand back.
- **Empty pane:** needs a way to open an empty pane directly, and panes stay open and become empty when their
  last document closes.

## Machine readout

A per-device System info (CPU, memory, disk, network, top processes): one per hub/node in Distributed Conduit.

## Task list (2026-11-02)

Ticked as done. The empty pane is on the `empty-pane` branch (`.claude/worktrees/empty-pane`), previewed on
:4320 with its own data root.

### The `empty-pane` branch

- [ ] 1. Approve `PaneHome` as a v2 extension: only the container that centres Home and styles the headings and
  status line inside it.
- [x] 2. Terminals as documents: a tab with a × (a new header), or keep their header and only gain a ×. Kept the
  header (it holds the shell, shortcuts and sessions) and gave it a document's ×: v2's `TermIdentity` takes `onClose`,
  a × after the terminal's name drawn as a lit tab's, closing the document as any is (`closeDocument`: the pane
  stays, empty; the shell runs on). Gallery: Panes › TermIdentity · onClose. The slide-over dock keeps its own
  behaviour: its Terminal tool and a terminal moved into it show the dock's controls (Move to a pane, Close) and no
  second ×, and any document closed in the dock closes its docked pane rather than leaving an empty one there.
- [ ] 3. Merge the branch into `main` and restart :4310 (`--force` while the stuck "Slow Spawn Narration" test chat
  still waits).

### Bugs and loose ends

- [x] 4. Possible data loss: a brand-new chat may be deleted if left while its first reply streams. Seen while
  seeding, not confirmed. Confirmed in a headless browser with the agent's start slowed: a chat left while its agent
  was starting still read as a draft, so leaving deleted it (`DELETE ?ifEmpty`) and its first message was dropped.
  Fixed: such a draft is no longer abandoned (`client/main.tsx`, `currentDraftId`); the message goes by
  `POST /v0/chats/:id/prompt` instead (`client/state/active-chat.ts`, `routes/live-sessions.js`,
  `live-session-stream.js` `promptChat`), waiting for the browser's own launch; and the empty-draft delete no longer
  stops the processes of a chat that is not a draft (`routes/chats.js`).
- [x] 5. Pane corners and a sideways shift after closing a chat back to the empty pane. Parked. Measured in a headless
  browser: the corners hold; the shift was the split jumping in one frame (two panes at 1280px: 528/400 to 464/464), a
  chat pane's 528px minimum ending as it emptied. Decided: ease to equal shares. `closeDocument` (`client/main.tsx`)
  holds the panes at their shares while the document goes, then eases them to the row's own (`easePaneWeights`): a
  glide of about 240ms, frame by frame.
- [ ] 6. The body of commit `9ed79305`'s message names the studied product. Reword before pushing `main`, with the
  other session idle.

### Browser and agents

- [ ] 7. Browser document `browser:<id>`, version 1: a managed Chrome on the hub, always open; person and agent share
  one page by its id; shown by streaming (H.264); evaluate Vercel's agent-browser as the engine; check what v2's
  existing `ui-browser` family (`browser.css`) covers first. Built, with two differences to confirm: agent-browser
  (Apache-2.0, a Rust daemon over CDP) is the engine, and its own viewport stream is the transport -- JPEG frames over
  a WebSocket with mouse, key and touch input, not H.264 -- proxied through the hub behind Conduit's sign-in
  (`server/browser-host.js`, `routes/browsers.js`, `/v0/browsers/hub/stream`); and the session starts on first use
  rather than at boot, then stays open, across a restart of Conduit too. The person opens it from an empty pane
  (Browser) or an agent with `ui` (`browser:hub`); the pane (`client/browser/browser-pane.tsx`) has back, forward,
  reload and an address bar, follows the page's URL and title, and sets the page's viewport to its size. Agents share
  the page through agent-browser's own MCP server on the same session, not a tool of Conduit's, so the engine can be
  swapped (Browser Use, a cloud browser) later: Conduit's agents load its tools into codemode (a `browser` namespace;
  about 20k tokens of schema, so never in the model's direct list; `close` withheld; not in subagents), and harnesses
  are given the server itself. `ui-browser` is the Computer's file explorer, so the pane is a new v2 family,
  Web (`WebView`, `WebAddress`, `WebScreen`; gallery Web). agent-browser is vendored (a dependency, 0.41.1; its native
  binaries come in the package, about 54 MB); `CONDUIT_AGENT_BROWSER` names another.
- [ ] 8. Browser transport, version 2: proxy pages instead of streaming, each site on its own origin under the hub,
  security headers kept (frame-ancestors rewritten, the injected script admitted by a CSP nonce); streaming as the
  fallback for sites that refuse framing. Spiked (`docs/plans/browser-proxy-spike.md`,
  `conduit-web/scripts/spikes/browser-proxy-spike.mjs`): the header surgery works (framing, a nonce'd injected script,
  rewritten links, redirects, fetch, WebSocket, cookies), but ports are not cookie boundaries -- Conduit's own session
  cookie reached the proxied site -- so per-site origins need per-site hosts (a wildcard domain the person owns, not
  Tailscale names), and URLs built at runtime escape without a service worker. Recommendation: keep streaming.
- [ ] 9. Browsers on client devices, reachable from any other client through the hub.
- [ ] 10. Acting as you: jbot uses your browser on a device you choose.
- [x] 11. Agents drive Conduit's UI through an MCP server or a code-mode CLI: know what the person is looking at;
  open, close and focus panes; use the browser. Every open tab tells the server its panes (what each shows, which has
  the keyboard, whether the tab is in use; `client/agent-ui.ts`), and the server sends a command to one tab over its
  runtime stream and waits for its answer (`server/ui-control.js`). Conduit's agents have `ui` (look, open, close,
  focus) in every profile, from codemode in Coding, not in subagents, and the browser through agent-browser's tools
  (#7). Other harnesses get `ui` from the conduit-ui MCP server (`server/mcp-endpoint.js`, `/v0/mcp/ui`, Streamable
  HTTP; a Conduit session or the hub's token, `data/mcp-token`) and the browser from agent-browser's own MCP server on
  the shared session: Claude Code chats Conduit starts on the hub are given both; Codex and other MCP clients take
  an entry for each copied from Settings › AI › Tools. Not yet: Claude Code running on a
  device (it cannot reach the hub's loopback).
- [ ] 12. Add Vercel's agent-desktop for driving desktop apps on devices.

### Settings

- [x] 13. AI › Tools: each profile's tools, where each comes from, and whether it asks. Read-only first. Built:
  `DurableRuntime.selectionFor` (the tool choice `agentFor` made, factored out without the prompt) and `toolsView`
  (`conduit-web/src/server/durable-runtime.js`), `askOf` in `conduit-web/src/agent/policy.js` (never, always or
  sometimes, with when), `GET /v0/profiles/tools` (`routes/chats.js`), and Settings › AI › Tools
  (`client/settings/tools-settings.tsx`, also in the palette): a profile picker, then its tools split into called by the
  model and called from codemode, each with its source (built-in, extension, connector, codemode) and whether it asks.
  Built from existing v2 setting pieces; no new component.
- [ ] 14. System › Devices: each device lists the harnesses it declares, with status, and a machine readout (CPU,
  memory, disk, network, top processes). Partly built: the hub's readout (`conduit-web/src/server/machine-readout.js`,
  `GET /v0/server/machine`; `client/settings/machine-readout.tsx` in the Server folder, read every 3s while open, as
  the Reading's tiles and the busiest processes as data lines). Rates are since the previous reading, as top's; Linux
  reads /proc, macOS `ps`, Windows has no process list yet. Left: a node serving its own readout, and each device's
  declared harnesses, which need paired devices to build against.
- [x] 15. System › Usage: tokens, cost and tools over time, from the ledger. pi-durable's `pi.usage` holds only
  running totals per conversation, so a dated record was added: `conduit-web/src/server/usage-ledger.js`, an
  append-only `data/usage/ledger.jsonl` that follows commits and appends each conversation's increase per model (and
  per tool that calls a model) with the hub's local day, plus a line per reply with its tool calls. Dollars are what
  pi-ai priced each call at when made (API list price; subscriptions carry the API's price; free tiers and token plans
  are $0), stored rather than rates, so later price changes never move past days. Exact and self-healing: totals only
  grow, so a line lost to a crash is caught at that conversation's next change. Served by `GET /v0/usage?days=` and
  shown in Settings › System › Usage (`client/settings/usage-settings.tsx`): totals, by day, by model, tool calls, for
  7, 30 or 90 days. Only Conduit's own agents are counted, not Codex, Claude Code or ChatGPT Web. No chart yet: v2 has
  none, and adding one needs approval.
- [ ] 16. Services › Browser: where the browser runs, stream or proxy, quality, clear browser data.
- [x] 17. Models & accounts: group the helper models (naming, summary, review), each showing what it inherits. Built
  in `conduit-web/src/client/settings/settings-core.tsx`: a Helper models group under Defaults. Naming keeps its model
  picker (moved from Defaults) and says it inherits nothing (unset, new chats stay untitled). Summary (compaction) has
  no model of its own: pi-durable summarizes with the chat's model and effort, shown read-only. Review does not exist
  yet (the approvals reviewer waits on pi-durable), shown as not available. Giving summary or review their own model is
  still to decide.
- [x] 18. Server switcher: a profile picture in its menu. Account itself stays in Settings. The picture is the hub
  account's name's initials (decided): v2 `Avatar` (Connection family; initials on the tint, three sizes; gallery
  Connection › Avatar), leading the switcher's Account section with the name (opening Settings › Account). The name
  is a hub preference (`accountName`), set in the new Settings › Personal › Account. A photo of one's own is later.

### Chat, agents and voice (decided 2026-11-02)

- [ ] 27. Message queue: rework what a message sent mid-turn does (queue, steer, interrupt); the current behaviour
  is not what the user wants. Design first.
- [x] 28. Sub-agent limits: extend the `subagent` tool with limits (concurrent and background runs, iterations,
  output size). Built in `conduit-web/src/server/subagents.js` (`SUBAGENT_LIMITS`, overridable by
  `runtime.subagentLimits`): 16 foreground agents at once per conversation, 10 background agents running at once
  (a spawn, or a message that wakes an idle one), 400 model turns per task (the child is stopped and the call or
  report says so), 100,000 characters of answer (cut, with a note). A refusal names the limit hit. jbot's own runs
  (`spawnBackground`) meet the turn and output limits but not the concurrency ones.
- [ ] 29. Voice: extend Settings › Voice beyond dictation with text-to-speech (reading replies aloud) and voice memos.
- [ ] 30. jbot channels: messaging apps (Telegram, Discord, Slack, WhatsApp, Signal, SMS, email) as jbot's channels,
  grown through the jbot message log (`persistent-agent.md`). Worth keeping from the study: a conversation in a
  messaging app attaches to a thread, and a command there starts a fresh one.
- [ ] 31. A single drawer pane from the bottom, later. Not recursive splits.

### Later or lower priority

- [ ] 19. Memory view with scope and provenance.
- [ ] 20. Skill discovery and status.
- [ ] 21. Generic tool servers (MCP, OpenAPI, stdio), only if Connectors prove too narrow.
- [ ] 22. Commit message drafting with its own model.
- [ ] 23. Notification destinations. jbot-only for now.
- [ ] 24. Compaction made visible in the transcript, building on the compaction summary row. No settings page.
- [ ] 25. A new-chat screen instead of the dashboard. Deferred.
- [x] 26. jbot message log (`persistent-agent.md`): add a delivery lifecycle per message: pending, sent, failed or
  uncertain, an idempotency key, the destination snapshotted. The user's call. Already there: `delivery.state`
  pending, sent and failed (and `held` for email from someone who does not wake jbot), and ids as idempotency keys.
  Added in `conduit-web/src/agent/messages.js` and `email.js`: a message still pending when the log loads becomes
  uncertain (the send was cut off; never resent on its own), and an outgoing email's `destination` (recipients,
  subject, the message it answers) is worked out as it is written and kept on it, so `send` uses that and a later
  settings change cannot redirect it. The app does not show delivery states yet.

Decided not to build: a compaction settings page, a harness-first page, users and roles, an OpenAI-compatible
gateway, notification targets beyond jbot, recursive splits in any direction, theming (import and export), image
generation settings (models handle it), installed-app share settings, transcript sound effects.

Waiting on pi-durable: an AI reviewer for approvals (a helper model approving or flagging tool calls); not before
pi-durable itself covers it.
