---
name: routines
description: Before setting up anything that repeats or watches a source (new mail, a calendar, a page, a repository, a price) - writing, testing, changing or removing a routine. The routine file format, task kinds and gates; schedule is only for a one-off check-back.
# Only jbot writes routines: its runs and subagents do not.
subagents: false
load: auto
nudge:
  - routine: save
  - routine: test
---

# Routines

A routine is a file in `routines/<name>.md` (lowercase, digits, dashes). It
fires on its own clock: its tasks gather without a model, its gate says
whether its run starts, and the body is that run's instructions. Use the
`routine` tool: `list`, `read`, `test` (runs the tasks once and shows the run's
first message; changes nothing), `save` and `remove`. Saving and removing ask
the person. Routines are theirs: propose a change, do not make one unasked.

For a single check-back at a time, use `schedule` instead.

## The file

```markdown
---
title: New releases
trigger: { every: 360 }
tasks:
  - id: releases
    kind: executor
    code: |
      // The real path comes from searching Executor: never guess one.
      const items = await tools.app.list_releases({ repo: "…" });
      return items.map((item) => ({ id: String(item.id), title: item.name, url: item.url }));
gate: when-new
output: jbot
---
What the run should do with what was gathered, and what to tell jbot.
```

- **trigger**: `{ every: minutes }` (5 to 1440), `{ at: "HH:MM" }` in the
  person's time zone, `{ at: quiet }` as their quiet hours start (23:00 when
  quiet hours are off), or `{ once: <ISO time with zone> }`. A daily routine
  whose time passed while the hub was off fires on return only if less than two
  hours late; otherwise it waits for its next slot.
  A trigger can also be a nonempty list of these rules. Each rule can have
  `during: quiet` or `during: "HH:MM-HH:MM"`, in the person's time zone.
  Windows include their start and exclude their end, and can cross midnight.
  Quiet windows follow settings and do not apply when quiet hours are off.
  A matching window overrides a rule without a window. The narrower window
  wins when windows overlap; equal widths use list order. Only the winning
  rule can fire. An interval counts from the window start or the last firing,
  whichever is later. A daily time outside its window does not fire.
  For example, the heartbeat uses:

  ```yaml
  trigger:
    - { every: 60 }
    - { every: 120, during: quiet }
  ```

  This means hourly outside quiet hours and every two hours inside them.
  A rule can instead name an event, `{ on: held-mail }`: an email to your
  address from someone who does not wake you. The event only starts the
  routine; its tasks gather what came (a `held-mail` task), so add a clock rule
  too (`{ every: 720 }`) for what arrives while a run is busy.
- **tasks**, each `{ id, kind }`:
  - `inbox`: `for: <routine-name>` defaults to this routine's name. Entries
    with a nonempty `for` list are shown only when that list names the recipient.
    Entries without an address (including `for: []`) stay visible unless the task
    sets `addressed: only`. Optional `kinds: [feedback, ...]` selects entry kinds.
    `all: true` includes handled entries; it keeps the same address, kind and
    since-last-firing filters. For example:

    ```yaml
    - { id: feedback, kind: inbox, addressed: only, kinds: [feedback] }
    ```

    In `reflect.md`, this reads only feedback addressed to `reflect`. Heartbeat
    keeps its plain inbox task and receives unaddressed reports. Morning brief
    keeps `all: true` and receives unaddressed entries, handled or not (the
    heartbeat's reports among them). A routine never reads its own reports.
    The `conduit_inbox` tool and agent page still show all recipients. Each
    addressed entry carries `for` and retains its `headline`.
  - `email`: the person's new Gmail (every account connected in Executor),
    `query?` (a Gmail search; default the inbox of the last two days without
    promotions or social) and `max?` (1 to 50, default 25 a firing). Each email
    is saved in your folder as `mail/<date>/<id>/message.md` (its text as
    Markdown, headed by its parties, date, labels and Gmail link) beside the
    original `message.eml` and its attachments (documents also as `.md`); the
    run gets one line per email with that path. The first firing only learns
    what is there. The heartbeat's first task is `- { id: email, kind: email }`.
  - `held-mail`: email to your address from people who do not wake you, held
    in its mail room, since the last firing (the first looks back a day): one
    line each, marked untrusted, with the path to its `message.md`. The packaged
    Held mail routine uses it, off until the person turns it on.
  - `calendar` (`account`, `calendars?`, `days?` 1 to 14)
  - `chats`
  - `notes`: pending NOTES.md entries and recent declined proposals. Notes are
    consumed by call id only after that routine succeeds, in either mode.
  - `executor`: `code`, a read-only program that returns a JSON list of
    `{ id, title, detail?, text?, at?, url? }`. Call tools by literal path
    (`tools.app.action(…)`); a program that writes is refused.
  - `script`: `command`, printing that JSON list.
- **gate**: `when-new` (run only when a task found something new), `always`, or
  `never` (gather into the inbox, no run).
- **mode**: `run` (default) starts a background run. `fork` starts a private
  fork at the latest home-thread entry, with the home model, prompt and tools.
  It waits for an active home turn, up to 30 minutes. Only its memory tool
  has home rights. It can read local files, write its report file, and use
  `conduit_inbox` handle only for entries supplied by its inbox tasks. It cannot
  message, notify, post, ask for approval or start other work. The fork is
  discarded after it stops. Both modes fill the body variables and task blocks.
- **before**: an ordered list of `{ routine: name, ifMissedSince: last }`.
  Run that prerequisite, including its `after` steps, if it has not completed
  since this routine's previous firing. Wait up to 30 minutes. If it fails,
  times out, is missing or is disabled, record a notice and continue. The
  target uses its own tasks, gate and output.
- **after**: steps run in order after a successful run or fork:
  - `{ compact: {} }` compacts the idle home thread at or above
    `max(minTokens, minShare × context window)`. Override either threshold in
    the map. Defaults come from `nightlyCompaction`, including its enabled
    switch. Skip below the threshold, after a prior summary with no new usage,
    or at the automatic compaction threshold. Wait up to 30 minutes for idle
    home state and compaction; a failed or declined compaction fails the step.
  - `{ routine: name }` fires that routine with its own gate and tasks, and
    waits for its full lifecycle, including its `after` steps.
  - `{ message: jbot }` sends this routine's final text to jbot as a report,
    regardless of `output`. Repeated message steps each send one report.
  A failed step stops the list and appears as the routine's last failure in
  the attention list. A gate that starts no run also starts no `after` steps.
  Routine dependencies in both lists must have no cycles. Saving and starting
  validate the graph; runtime chains stop at 16 routines.
- **output**: `jbot`, `inbox` or `both`, delivered before `after` steps. A
  report told to jbot is also kept in the context inbox, handled, as
  `inbox/<date>-<id>-<title>.md` with the files its tasks gathered listed
  under it; what jbot is told ends with that path.
- Optional: `model` (provider/model), `effort`, `level` (fyi, attention,
  urgent), `enabled`, `context` (soul, user, memory, diary: the files its run sees).

Task cursors commit only after the run or fork succeeds. A failed `after`
step does not undo this commit: replaying the notes would repeat completed
memory work. If the gate starts no run, cursors still advance. Budget skips,
failed runs and failed forks leave cursors unchanged.

Body variables include `person.name`, `person.home`, `assistant.name`,
`timezone`, `now`, and each task's id (its escaped block). A notes task also
supplies `notesBlock` and `declinedBlock`. `windowStart` is this routine's last
successful run time, or the start of the home thread; `windowEnd` is the
current gathering time. `reportPath` is `reports/<name>/<local-date>.md`.
Unknown variables stay visible. These variables work in both modes.

Quiet hours hold back notifications and interruptions, never routine work.
The seeded Reflection is an ordinary routine: `mode: fork`, a notes task and
an inbox task for feedback addressed to `reflect`,
`output: inbox` and `after: [{ compact: {} }]`. The morning brief uses
`before: [{ routine: reflect, ifMissedSince: last }]`.
For a run, compaction, then a report to jbot, use:

```yaml
mode: run
output: inbox
after:
  - compact: {}
  - message: jbot
```

## Building one

1. Find the tool paths first (the executor skill), and try the program in
   `codemode` until it returns the list you want.
2. `test` the whole file before proposing it.
3. Tell the person in a line what it watches, how often, and when it would
   bother them; then `save`.

## App feedback

`POST /v0/agent/feedback` accepts `{ messageId, text }`. `messageId` must
name a jbot-sent message in the app message log. `text` must be a string of
1 to 2000 characters after trimming. Success returns HTTP 201 with `{ id }`,
the new inbox entry id. Invalid fields return 400 `invalid_feedback`; an
unknown message or a message from another sender or channel returns 404
`message_not_found`. A disabled agent returns 409 `agent_not_enabled`.

The entry has `kind: feedback`, `for: [reflect]`, `level: fyi`,
`status: unhandled`, `author: person` and `via: feedback`. Its `headline` is
the first feedback line. Its `text` holds only the person's feedback. Its
`body` includes that feedback and the quoted jbot message, limited to 600
characters, with the message time and id. Reflection treats the person's
feedback as their own words, keeps jbot's quote as context, and marks the
entry handled after processing it.
