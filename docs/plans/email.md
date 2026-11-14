# Email: a mail client in Conduit, synced by the hub

A plan, 2026-11-15. Evidence is marked **read** (in this repo's source) or **guess** (from memory, unchecked; the build
run confirms each one first). Phase 1 has a starter prompt at the end; phase 2 is recorded here so phase 1 is built
toward it.

## What exists today (read)

Two separate mail paths, neither of them a client:

- **jbot's mailbox** (`jbot@jask-aran.com`). The Cloudflare worker `templates/agent/mailbox/worker.js` stores each
  inbound message in R2 and wakes the hub; `conduit-web/src/agent/email.js` (`EmailChannel`) polls it, parses with
  `mail-pipeline.js` (postal-mime) into the agent folder `mail/<date>/<id>/`, and delivers it to the jbot message log as
  a mail room. Sending is the worker's `send_email` binding, which can only reach verified addresses (in practice the
  person). Config and secret: `<dataRoot>/agent/email.json`; routes in `server/routes/agent.js:272-314`; settings UI
  `client/settings/email-settings.tsx`; mail rooms drawn in `client/dashboard/jbot-messages.tsx` with `EmailItem`.
- **Your Gmail, through Executor.** `agent/mail-task.js` runs a program in the Executor sandbox (about 30 s a program,
  at most 25 messages a run, every byte base64 through the sandbox) and `agent/mailbox.js` appends to
  `mail/index.jsonl`. Sending as you is Executor's `gmail send` with its approval flow. All third-party accounts go
  through the one Executor MCP connector (`agent/connectors.js`); Conduit has no Google OAuth of its own.

Executor is too slow and too narrow for a client: a client needs a synced local copy and instant search.

## Decisions

- **One mail primitive, an adapter per source.** Account, thread, message, draft, label are Conduit shapes; nothing
  Gmail-specific (label ids, history ids, API error shapes) reaches the browser. Phase 1 builds the Gmail adapter;
  phase 2 adds jbot's mailbox as a second account. The same IMAP adapter later serves non-Gmail accounts.
- **IMAP and SMTP with a Gmail app password**, chosen 2026-11-15 as the least setup: no Google Cloud project, no
  consent screen, nothing that expires until revoked. Needs 2-Step Verification on; the owner creates the password at
  myaccount.google.com/apppasswords and pastes it into Conduit. The Gmail API with Conduit's own OAuth client stays a
  later adapter if IMAP falls short (its catch: a "Testing" app's sign-in expires every 7 days, **guess**).
- **The hub keeps a copy in SQLite**: headers, snippet, labels and thread for all mail; full raw bodies for recent
  months; older bodies fetched on open and cached. Search is FTS5 over what is held.
- **Sync** over Gmail's IMAP extensions (which extensions Gmail supports, its bandwidth limits, and the Node library,
  likely `imapflow`, are **guess**):
  - Sync `[Gmail]/All Mail`, keyed by `X-GM-MSGID`, threaded by `X-GM-THRID`, labelled by `X-GM-LABELS`; track
    `UIDVALIDITY`.
  - Backfill: `FETCH` envelope, flags, labels and size in UID ranges, newest first so the inbox is usable at once.
    Raw bodies (`BODY.PEEK[]`) for recent months, parsed by the existing `mail-pipeline.js`. Streamed and paged, never
    held whole in memory.
  - Incremental: `IDLE` on one connection for new mail within seconds; `CONDSTORE` (`CHANGEDSINCE` a stored
    `HIGHESTMODSEQ`) for flag and label changes; a UID comparison for deletions. A `UIDVALIDITY` change triggers a
    resync.
  - Search: local FTS first; for body text the hub does not hold, also Gmail's `X-GM-RAW` search and merge.
  - Writes: triage changes the local copy at once and sends `STORE` flags or `X-GM-LABELS` behind it, rolling back on
    failure. Sending over SMTP (`smtp.gmail.com`), which Gmail files in Sent itself; drafts by `APPEND` to
    `[Gmail]/Drafts`.
- **The client is a Work pane kind**, beside papers and sheets, so the agent can sit next to it and Markup works over
  it. Built only from v2 library pieces (`components/ui`). Layout and feel are decided after a throwaway prototype.
- **jbot gets a mail tool** that reads and searches the hub store directly (milliseconds), instead of Executor.
- **Sending.** You send freely from the client. jbot sends when you asked it to in that conversation. An email jbot
  decides to send on its own waits for your approval (`agent/approval-policy.js`).

## Phases

1. **Phase 1**: the mail primitive, the Gmail adapter with sync and store, the client pane (read, threads, search,
   triage: archive, mark read, label, star; compose, reply, forward, drafts), and jbot's mail tool.
2. **Phase 2**: jbot's mailbox as a second account in the client (the jbot chat keeps its mail rooms over the same
   messages), and retiring the Executor Gmail routine (`mail-task.js`, `mailbox.js`, the `email` routine kind) once
   jbot reads from the store.

## Phase 1 starter prompt

Run settings: Claude Code, Fable 5.2 at `/effort high` (long unattended agentic work; most of the gain is already at
`high`). Subagents on Opus 5.5 at medium. Start it in a new conversation; put later instruction changes in the newest
message.

```markdown
# Email in Conduit, phase 1

## Goal
Build an email client inside Conduit. Today Conduit reads my Gmail only through Executor, which allows about 30 s and
25 messages a run, so it cannot back a client. The hub should talk to Gmail directly, keep its own copy of my mail,
and serve both a mail pane in Work and a fast mail tool for jbot. This is phase 1 of `docs/plans/email.md`; read that
plan first. Its Decisions section is agreed and its phase 2 is what you build toward, not what you build.

## Done means
- On conduit-local (:4310), I paste my Gmail address and app password once, open a mail pane in Work, and see my inbox within seconds while
  the backfill continues behind it.
- Search returns in well under a second for mail the hub holds, and also finds older body text through Gmail.
- I can read threads, archive, mark read, label, star, and compose, reply, forward and save drafts, and each shows in
  Gmail's own web interface.
- New mail arriving in Gmail appears in the pane within a minute without a reload.
- jbot answers "what did X send me about Y last month" from the hub's store through its new mail tool, without
  calling Executor.
- `npm run typecheck` passes in `conduit-web/` with no convention problems, the budgets in
  `conduit-web/budgets.json` hold, and `bash scripts/start-conduit.sh restart` leaves the server running.

## Context
Read `AGENTS.md` and the files it points to for UI work (`DESIGN.md`) and server work ("Changing the code" in
`README.md`). Existing mail code is mapped in the plan's "What exists today". Key decisions, already made:
- One Conduit mail primitive (account, thread, message, draft, label) with an adapter per source. Nothing
  Gmail-specific reaches the browser. Phase 2 will add jbot's mailbox (`agent/email.js`) as a second account, so
  shape the primitive to fit it.
- IMAP and SMTP with a Gmail app password, not the Gmail API: I chose the least setup. The app password is stored
  beside the existing connector credentials in `<dataRoot>`, written with `writePrivateJson`, never in the agent folder.
- The sync design in the plan (Gmail's IMAP extensions, backfill newest first, IDLE plus CONDSTORE for changes, local
  FTS5 with `X-GM-RAW` search merged in, optimistic writes). Which extensions Gmail supports, its limits and the
  library choice are from memory; check them before building on them.
- The client is a new Work pane kind, built only from v2 library pieces in `conduit-web/src/components/ui`. Its
  layout is yours to decide: build a throwaway prototype in the gallery first, pick, and give the reason in your
  report.
- jbot's mail tool is a `defineTool` part assembled in `conduit-web/src/agent/extension.js`.
- Out of scope: jbot's mailbox in the client, retiring `mail-task.js`, push notifications, non-Gmail providers.

## Ownership
This codebase is yours: what it's for and how it's built are your call, and you'll keep building on it.
You may raise the `src/` line ceiling in `conduit-web/scripts/check-conventions.mjs` rule 10 for this feature. Tests
and Markdown outside `docs/` only shrink, so any new test removes more test lines than it adds.

## Limits and approvals
- Never restructure jbot's mailbox code (`agent/email.js` `EmailChannel`, the mail rooms in the jbot message log,
  `templates/agent/mailbox/`) without a go-ahead from me in this conversation; phase 2 owns that change. Reading it
  and adding beside it need no approval.
- Never push to `main` without a go-ahead from me in this conversation: pushing deploys conduit-dev. Work and test on
  conduit-local only.
- Creating the app password and pasting it in are mine to do. When the settings form is ready, tell me where it is,
  then carry on with work that does not need it.
- jbot's sending rule, built into the mail tool: jbot sends when I asked it to in that conversation; an email jbot
  decides to send on its own waits for my approval through `agent/approval-policy.js`.
- Any node process that touches mail data runs with `--max-old-space-size=4096` or less, one heavy process at a time,
  and streams or pages the data. An out-of-memory kill stops all of WSL, every other agent included.
- These need no approval: editing anything under `conduit-web/` except the jbot mailbox code above, adding npm
  dependencies, committing your own files as you go with `git commit -- <paths>`, running
  `bash scripts/start-conduit.sh restart`, the gallery and the Chrome DevTools CLI, `curl` against `/v0/...`, sending
  test emails from my account to any address, and retrying IMAP reads after rate-limit or
  network errors, and reconnecting a dropped IMAP connection.

## How to work
# Finishing work
Please avoid stopping while you still owe work the user asked for. Be persistent and do not stop unless needed.

While status notes are welcome, as is clarifying with the user on open decisions, carry on with work that does not depend on the user's answer without unnecessary stops.

If you notice yourself inviting the user to redirect you or offering to wait, instead proceed on the next part of the task. You may meet ordinary obstacles like errors, timeouts, locked files, empty results or failing tools. Diagnose them first, and when they are not real blockers, work through them with the access you have (wait and retry, fix the request, use another tool or source) rather than stopping unnecessarily.

If someone clearly decided something is a hard blocker, such as a file marked not to be touched, access that was intentionally withheld, or a safety guardrail, leave it alone, say plainly what you found, and look for another safe way to finish the task. Stopping before the task is complete is very rarely merited, as in when the task can't move forward without user input, or where the blocker is deliberate and should not be worked past. This does not override the need for confirmation on risky or destructive actions.

Order the work so waiting for my app password costs nothing: the primitive, store schema and sync engine against
recorded fixtures first, the pane against the same fixtures, then live Gmail once I have pasted it.

Subagents: each one adds its own full context to the session's cost, and you see only its summary. Use them for
pieces that are bounded and independent once you have written the contract between them (for example the pane while
you build the sync engine), and for one review of the finished diff by an agent that has not seen your reasoning. Do
not use them for lookups you can do in a few tool calls. Run them on Opus 5.5 at medium effort. Brief each one with the
goal, the files it owns, the contract, the 4 GB heap rule, and that it must not run git writes, builds or restarts.

Every few tool calls, give me a one-line update on where things stand.

## Final report
# Communicating clearly
Write for an intelligent but low-context reader. The person reading has not seen your tool calls, your reasoning or the files you opened, and may be switching in from other work. Messages should generally be self-contained: the reader should understand what you mean without having to dig for other context. Put the key points in the first few sentences. Practice progressive disclosure in your sentence order, and do not use undefined references and ideas in line 1 that won't make sense until the reader reaches line 12.

Use plain words, and write in clear, understandable full sentences. Do not use a term or abbreviation that you made up during the work. Say what the thing is in a way any reader would understand. Write mostly in the style of ASD-STE100 Simplified Technical English: short sentences, one idea per sentence, active voice, and consistently using the same word for the same thing. Use a paragraph of flowing prose where ideas connect, and keep bullets for lists of separate items. Leave out unnecessary details unless the reader asks and practice concision, but do ensure that your messages have the key context. Aim to make your user-facing text as human-readable and clear as possible.

Then give: what I can try now and how; what changed, listing every change including small ones, because I review the
diff against your list; what you verified and how, kept apart from what you expect but did not run; what is left; and
the decisions you made for me (the pane layout, the IMAP library), each with its reason. Update the plan's Decisions
for anything that changed, and delete what phase 1 finished from its Phases list.
```

## First-run watch list

- **Stops while waiting for the app password.** It should build against fixtures and keep going. If it stops, reply
  "carry on with the fixture-backed work; I'll paste the password later."
- **Asks before routine steps** (commits, restarts, test sends). They are named as needing no approval; point at that
  list.
- **Adds a second Gmail path beside `mail-task.js`.** That is expected in phase 1; retiring it is phase 2.
- **Too many subagents.** More than about three builders for this size means the contract was not written first.
- **Silent stretches.** The one-line-update rule should cover them; if not, ask for a status line in the next message.
