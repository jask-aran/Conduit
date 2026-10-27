# Persistent agent

Status: research and decisions, 2026-10-27. Target v0.8.9. Nothing built yet.

The persistent agent is the Conduit durable agent (pi-durable) running as one
always-on agent per hub: it keeps working between conversations, wakes itself,
and comes to you when something needs you. It is modelled on Claude Duet, Meta
Muse, Instinct and OpenAI Dots (one agent), not on Grok Bot or open-duet (a
roster of named bots).

## What the products converged on

| | Duet (Anthropic, 2026-10-21) | Muse (Meta) | Instinct | Dots (OpenAI) |
|---|---|---|---|---|
| Agents | one | one | one | one primary, teams later |
| Threads | one ongoing thread; recurring topics get channels | main thread + side chats per project | text/phone thread | one, parallel tasks |
| Computer | own VM and browser | own computer: files, terminal, browser | persistent cloud computer | own cloud computer |
| Proactivity | morning brief; checks apps every few hours (to save usage); alerts by judged urgency | scheduled and event-driven tasks; interruption dial down/up/off | works between messages | reportedly less proactive lately |
| Approvals | card before send, pay, sign, delete; some actions refused outright | approval cards, audit trail, watch its browser | concerns over security model | — |
| Memory | carries the account's memory, skills, connectors | memory files you can inspect and edit | — | — |

Duet keeps "a running list of what it's working on and what it needs from me"
(Every's review). Its gap, per the same review: it sees the Claude sessions on
your computers but cannot direct them. Conduit's hub can, which is this agent's
edge.

## Open-source reference points

- **open-duet** (Apache-2.0, ~6.2k stars): named agents, so the wrong shape, but:
  routines never approve an action themselves; delegated work runs in its own
  thread and reports back; memory reviewable and editable; one calendar of
  tasks and routine runs.
- **nanoMuse** (GPL-3.0, arXiv 2610.08699): one agent across every device, with
  a small self-hostable relay. Its Sentinel decides in a fixed order: denied
  tools, the person's rules, allow/ask lists, taint (after a conversation reads
  private data, outbound calls ask; it only tightens), tool risk against a mode,
  warnings nothing bypasses. Grants are once, this conversation, or always for a
  named target; payments and passwords are never remembered. It names memory
  provenance as an unshipped gap.
- **OpenMuse** (CopilotKit, alpha): durable background tasks with progress,
  approvals, input requests, pause, retry and receipts. pi-durable covers this.
- **OpenClaw** (still moving): approvals bound to the exact request, command,
  session and person; scheduled follow-ups keep their creator's authority; a
  heartbeat checklist (`HEARTBEAT.md`, `HEARTBEAT_OK`); Markdown identity and
  memory files.
- **Hermes Agent**: an AI reviewer for flagged commands, background delegation,
  `MEMORY.md`/`USER.md` loaded as a snapshot at session start.
- **Security:** "Mind Your HEARTBEAT" (arXiv 2603.23064): background checks in
  the same session as the user's chat let misinformation into long-term memory
  (promoted up to 91%, swaying later sessions up to 76%). Background work runs in
  its own conversation, and memory records its source.

## What pi-durable already gives

Durable conversations and tasks across restarts; background anchor tasks that
Esc and idle do not reach; a reporter task posting an answer back to a parent as
a follow-up (example 23, used for background subagents); request ids so a
restart never repeats a submission; a live task graph. It has no wall-clock
timers: the hub schedules wake-ups and submits them with a request id per slot.

## Decisions (2026-10-27)

1. **One agent per hub.** Dev and prod each have their own agent, memory and
   home thread; they do not know each other.
2. **Assistant profile chats stay separate**, ordinary chats without its memory.
3. **Its conversations:** a home thread that never ends (compaction keeps it
   going) plus side threads it or you open per project or recurring topic. All
   share its memory.
4. **Its computer:** its own folder on the hub for files and scripts. It acts on
   devices only through their grants, as any chat does. A browser comes later.
5. **Your chats:** it can read and search them, start chats in any workspace and
   harness, and steer existing ones. Steering is an outward action: it asks
   first, then its message is marked as the agent's. It never posts as you.
6. **Triggers:** schedule and heartbeat (morning brief, periodic checklist,
   one-off check-backs), Conduit events (a chat finishes or fails, a device
   comes or goes, a workspace changes), outside sources (email, calendar), and
   webhooks.
7. **Approvals for its own runs:** reading, drafting and work in its folder run
   freely; sending, deleting, paying, steering a chat and running on another
   device ask. A background run never approves itself, and once a run has read
   private data its outward actions ask.
8. **Memory:** Markdown files in its folder (about you, facts, a dated diary),
   editable in Work. Every line it writes records which thread or run wrote it;
   background runs propose memory rather than writing it; lines you wrote
   outrank its own.
9. **Identity:** a name and persona file in its folder, set by you, with a
   default name changeable in Settings.
10. **Reaching you:** phone push as soon as possible, then text or WhatsApp.
    UnifiedPush first (the hub posts to the endpoint the phone registered: ntfy,
    self-hosted or ntfy.sh), FCM through a small relay as a fallback if
    delivery needs it. FCM is free but a self-hosted hub can only send with the
    app's Firebase key, hence the relay.
11. **Connectors:** to explore MCP servers on the hub, Executor (an MIT MCP
    gateway: one search-and-call tool over many integrations, credentials kept
    at the gateway) and a Composio-style gateway.
12. **Proactivity:** an interruption dial (quiet, normal, chatty) and a daily
    budget for background work, after which it waits for you.

## Its thread (decided 2026-10-27)

jbot is still a chat thread, with one curated profile and no profile picker,
but its turns read differently. Taken from Duet, Grok Bot, Muse and Open Duet
(research notes in the session of that date):

- **All its text shows.** Other chats fold the text an answer writes between
  tool calls into the trace and show only the last message as the answer. A
  persistent agent talks as it works -- between gathering, handoffs and
  approvals -- so in its threads every text block is drawn, in order, with the
  work between them.
- **Gathering: a live line, then sources.** While it works, one line under its
  name says what it is doing now ("Reading your Japan chats · 3 of 5") and opens
  into the steps. Settled, it becomes a quiet row of what it looked at (chats,
  memory, pages, files), each openable; claims in the answer link to them.
- **Delegation: rows in the thread.** Each handoff is a row where it happened
  ("→ Comparing flights · running · 2m"), opening the run's own thread; the
  report comes back as one line. Built on the agents rows chats already have.
- **Approvals: Allow once, Always, Don't.** Always saves a rule, listed on its
  page and removable there. A card raised by a run expires and says so.
- **Approvals don't block** (next): unanswered, it finishes the rest of the task
  and brings the question back later.
- **A brief with actions** (next): each item in the morning brief carries its
  prepared first step, with Approve / Not now in place.

## First slice

Backend loop end to end, minimal UI:

- the agent record per hub, its folder, identity file;
- home thread and side threads as pi-durable conversations;
- memory files with per-line sources, and proposals from background runs;
- the hub scheduler: morning brief, heartbeat against its checklist, one-off
  check-backs, each in its own conversation reporting to the home thread;
- Conduit events as triggers;
- the approval rule above, including taint;
- the attention list (working on, needs you) over the API.

Built (2026-10-27): the slice above, then push. The hub sends standard Web Push
(RFC 8291/8292, no third party of its own) to every device that turned on
Notifications in Settings › Devices: the Android app through UnifiedPush, with
Google's push service built in as its distributor (no Firebase project, no other
app; ntfy where there is no Play services), a browser through its own push
service and the service worker. What reaches a device: a report the interruption setting lets through,
and an approval waiting on the person. A morning brief is asked for, so it
reaches the person whatever the setting unless it says NOTHING.

Built (2026-10-27): its page, `/agent` (a pane document `page:agent`), under the
Conduit Dashboard in Chat's sidebar with how many things wait on the person. On
the dashboards' layout: the composer talks to it in its home thread; its threads;
Needs you (questions, memory to keep or discard, notices, dismissed with
`DELETE /v0/agent/notices/:id`), Working on, Schedules, Watching and Recent runs,
each opening its transcript; Run a task and New thread. Renaming it retitles the
home thread.

Next: settings on the page (dial, budget, brief, heartbeat), memory itself
(its files, not only proposals), what a push shows and offers (Allow/Don't on an
approval), then connectors, then outside sources.

## Open

- What the heartbeat's checklist starts with, and its default interval.
- How the attention list and side threads appear in Chat and Work (UI pass,
  with the user, after the loop works).
- Budget unit: tokens or cost, and per day or per rolling window.

Sources: claude.com/resources/articles/claude-duet; every.to/vibe-check/
vibe-check-duet-anthropic-s-always-on-agent; testingcatalog.com/meta-introduces-
muse-as-a-proactive-personal-agent; github.com/Anil-matcha/open-duet;
arxiv.org/html/2610.08699v1 (nanoMuse); github.com/CopilotKit/openmuse;
docs.openclaw.ai/releases; arxiv.org/abs/2603.23064.
