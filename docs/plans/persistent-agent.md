# Persistent agent

Status: first slice built 2026-10-27; vision set 2026-10-29 (below), which supersedes decisions 6 and 8 where
they differ. Target v0.8.9.

The persistent agent is the Conduit durable agent (pi-durable) running as one
always-on agent per hub: it keeps working between conversations, wakes itself,
and comes to you when something needs you. It is modelled on Claude Duet, Meta
Muse, Instinct and OpenAI Dots (one agent), not on Grok Bot or open-duet (a
roster of named bots).

## Vision (decided 2026-10-29)

Under every one of these products is a harness thread in a loop with tools; what makes it an assistant is the
parts around the loop. jbot is one agent, so it leans on one long thread, runs for discrete work, and routines.
It remembers what you tell it; it does not mine your other chats.

```
 feeds ──▶ inbox ──▶ heartbeat ──▶ quiet │ act (runs, check-backs) │ tell jbot ──▶ you
   ▲                    ▲                                                   ▲
 scripts, integrations  urgent entries wake jbot at once                  home thread, push
```

**The home thread is the relationship.** One conversation for good: you talk to it there and it talks to you
there. It plans, delegates and tells; heavy work goes to runs. The UI shows days; underneath it is continuous,
kept bounded by compaction. A model or tool change starts a new session with a handoff, unseen in the transcript.

**Memory** has four layers, files in its folder: essentials (who you are, how you work, current priorities;
always loaded, kept small), topics (people, projects, places; searched, not loaded), a dated diary, and open
loops (what it is tracking, what it promised, what waits on you or on someone else: Duet's running list, and what
the heartbeat works from). What it learns from you and its own thread it writes directly, each change shown as a
memory-changes line you can undo; what comes from outside content (mail, the web, a run's findings) is a
proposal you keep or discard. Lines you wrote outrank its own. A memory review on a cheap model reads its own
thread every so many turns; it never reads your other chats.

**Runs are the work.** Anything that is not conversation is a run: a subagent conversation with a brief, a
model and effort, a tool scope, a budget, and a required end: report (news), quiet (nothing to say, a tool call,
not a phrase) or failed (with a reason). Runs never talk to you; they write to the inbox.

**Feeds fill the inbox.** A feed is a source that appends entries (source, time, one-line headline, the full
report, urgent or not). By default it watches mail and calendar (Executor), the chats it started or steered, and
Conduit itself through a Conduit integration (devices, hub health, the network it runs on). Anything else it
watches because you asked: a new routine, a line on the heartbeat's checklist, or a feeding run. Feeds are
scripts first: a small script in its sandboxed folder, written by it and approved once, that the hub runs on a
schedule with no model call (call Executor or Conduit, diff against last time, append entries). A feed that needs
judgement ("is this mail important?") is a cheap-model run instead. Only deciding spends tokens.

**The inbox is where context waits.** Append-only. An urgent entry wakes jbot at once (and may push); the rest
waits for the heartbeat. When you talk to jbot first, its turn starts with the unhandled headlines, so it is never
behind. Handled entries stay a week, visible on its page with what became of each.

**The heartbeat decides.** It ticks every 30 minutes in your active hours, but calls a model only when the inbox
has entries or an open loop is due: most ticks cost nothing. It reads the entries and due loops, then stays quiet,
acts (starts runs, sets check-backs) or tells jbot something worth saying, and marks the entries handled. What it
did shows as a quiet, collapsed line in the home thread ("Heartbeat · 4 handled · 1 run started"). It runs on a
cheap model in its own conversation, never the home thread's (see "Mind Your HEARTBEAT").

**Routines are saved triggers.** A routine is a record: trigger (schedule, event, webhook), brief, tool scope,
model, what it may say, who made it, and its run history. The morning brief is one with an always-report end; the
heartbeat is one too. jbot sets one-off check-backs for itself freely ("look again Friday"); a recurring routine
it wants is an approval card showing trigger, brief and budget. You can make or change any routine yourself.

**Night is upkeep ("dreaming").** Quiet hours are its maintenance window: memory review and consolidation
(diary into topics, stale loops closed), then, about an hour before quiet hours end, compaction of the home
thread, so each day starts compacted; then the built-in routines that gather context for the morning brief, then
the brief.

Built (2026-10-29): **quiet runs and the inbox** (`conduit-web/src/agent/inbox.js`). A run ends with
`nothing_to_report` (no entry, only its history) or `run_failed` (a reason), else its first word sets the level as
before. The reporter appends every other result to `AgentDoc.inbox`; a brief, a task the person started, the
heartbeat's own decision, an urgent report and a run with asks waiting are told at once and land handled. The rest
wait unhandled, shown each turn of the home thread (section `agent-inbox`) and handled with the `inbox` tool;
the page lists them under Inbox. The heartbeat makes no model call when the inbox is empty and HEARTBEAT.md lists
nothing.

Built (2026-10-29): **the gated heartbeat.** It ticks every 30 minutes outside quiet hours (a setting, default
23:00 to 07:00, the agent's time zone) and starts a run only when the inbox has unhandled entries or the checklist
sweep is due (`heartbeat.everyMinutes`, shown as Checklist every; `heartbeatSweptAt` records the last). Its task
names what it found. A beat that tells no one but handled entries or set check-backs leaves a quiet line in the
home thread, a display entry (`conduit.agent-beat`, "Heartbeat · 2 handled · 1 check-back set") that opens its run
and starts no turn.

Built (2026-10-29): **feeds** (`conduit-web/src/agent/feeds.js`). A feed is a schedule item with a `feed`: a
read-only Executor program (checked: literal tool paths, read actions only), a script in jbot's sandboxed folder,
or a model run for what needs judgement. The hub runs a program or script on the feed's clock without a model; the
output is a JSON list of `{ id, title, detail?, at?, level?, url? }`. Ids seen are kept (500); the first run only
learns what is there; later runs put what is new in one inbox entry a tick (its lines in the entry's body). jbot
adds feeds with the `feed` tool (list, test, add), and adding one asks the person (a card with the program, no
Always); the person adds and removes them over `/v0/agent/feeds`. The page lists them under Feeds. First feed:
Email, every 30 minutes, the inbox's last two days without promotions and social. Not yet: an urgent feed entry
waking jbot at once (it waits for the next beat), open loops, night upkeep.

**It asks only when it needs something.** No small-talk check-ins: a task or open loop that needs your input
asks, batched, never in quiet hours.

**Budget** is cost per day across runs, feeds and the heartbeat (subscription models counted at API price);
past it, it waits for you.

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
- **OpenBot** (nightly-labs, PolyForm Noncommercial: ideas only): routines run in throwaway sessions that read
  a short handoff of the chat and leave a digest for its next turn; `routine_no_update` and
  `routine_report_failure` tools end a run quiet or failed; memories are entries, essential ones always loaded
  (8 KB) and the rest searched; a background memory review on a cheaper model every 20 turns or 15 idle
  minutes; a replacement session gets a bounded handoff (32k characters) with search tools for the rest.
- **Open Muse** (chyroc, MIT): one main session on a hosted agent service, continued into a new "chapter"
  only when its configuration changes (earlier turns archived to memory); reminders live in `UPCOMING.md`;
  check-ins only in waking hours, once a day, never while something waits; each message carries local time and
  the device written from.
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

### Its own machine: sandboxed

Its local file tools are limited to its folder (paths canonicalised, so `..` and links cannot leave it). Its bash
runs through a small helper (`conduit-web/src/agent/sandbox/landlock.c`, built on first use with `cc`) that applies
Landlock: its folder writable, system and tool directories read-only, nothing else under the home directory (not
`~/.conduit`, `~/.ssh`, the person's code), HOME its folder and an environment without secrets. A seccomp filter in
the same helper refuses unix-domain sockets, io_uring and foreign-ABI syscalls, since Landlock does not govern
connecting to a socket by path (the session bus would otherwise let `systemd-run --user` escape). Reading another
process's `/proc/<pid>/environ` is denied by Landlock's ptrace scoping. About 1 ms per command. It fails closed: no
helper, no bash. Not covered: outbound network, including services on loopback (a browser's debugging port, say);
closing that needs a network namespace. To work elsewhere it uses a device and folder, which asks first.

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

Built: **Connectors.** Executor connects the person’s accounts over MCP. The agent calls its tools from codemode; outward calls need approval.

Built: **Asynchronous approvals.** Outward calls return at once with a saved ask. The person can answer in the thread, on the agent page or through Android push. The decision reaches the owning thread as a message; an allowed call must be made again with the same arguments. Runs send their asks to the home thread. Saved rules remain listed and removable through the agent API.

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
- **A brief with actions.** The brief prepares at most three first steps (a
  reply, an invite answer, a chat to start) by making the call, which is asked,
  not done. A run's asks are not pushed one by one: its report reaches the
  person whatever the setting, its push says how many wait, and in the home
  thread its cards sit under the agent's reply to the report. Allowed, the
  thread runs the hub's copy of the call with `approved` (an ask id), once,
  whoever made it. Built 2026-10-27.

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

- What the heartbeat's checklist starts with.
- The Conduit integration's shape (what it exposes about the hub and network).
- How the attention list, inbox and side threads appear in Chat and Work (UI pass, with the user).

Sources: claude.com/resources/articles/claude-duet; every.to/vibe-check/
vibe-check-duet-anthropic-s-always-on-agent; testingcatalog.com/meta-introduces-
muse-as-a-proactive-personal-agent; github.com/Anil-matcha/open-duet;
arxiv.org/html/2610.08699v1 (nanoMuse); github.com/CopilotKit/openmuse;
docs.openclaw.ai/releases; arxiv.org/abs/2603.23064.
