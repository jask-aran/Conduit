# Panes, browser and settings directions

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
