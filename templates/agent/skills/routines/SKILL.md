---
name: routines
description: Before setting up anything that repeats or watches a source (new mail, a calendar, a page, a repository, a price) - writing, testing, changing or removing a routine. The routine file format, task kinds and gates; schedule is only for a one-off check-back.
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
  person's time zone, or `{ once: <ISO time with zone> }`.
- **tasks**, each `{ id, kind }`:
  - `inbox` (`all: true` to include handled entries)
  - `calendar` (`account`, `calendars?`, `days?` 1 to 14)
  - `chats`
  - `executor`: `code`, a read-only program that returns a JSON list of
    `{ id, title, detail?, text?, at?, url? }`. Call tools by literal path
    (`tools.app.action(…)`); a program that writes is refused.
  - `script`: `command`, printing that JSON list.
- **gate**: `when-new` (run only when a task found something new), `always`, or
  `never` (gather into the inbox, no run).
- **output**: `jbot`, `inbox` or `both`.
- Optional: `model` (provider/model), `effort`, `level` (fyi, attention,
  urgent), `quiet`, `enabled`, `context` (soul, user, memory, diary: the files
  its run sees).

## Building one

1. Find the tool paths first (the executor skill), and try the program in
   `codemode` until it returns the list you want.
2. `test` the whole file before proposing it.
3. Tell the person in a line what it watches, how often, and when it would
   bother them; then `save`.
