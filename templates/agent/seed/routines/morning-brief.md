---
title: Morning brief
before: [{ routine: reflect, ifMissedSince: last }]
trigger: { at: "08:00" }
tasks:
  - { id: email, kind: email }
  - { id: inbox, kind: inbox, all: true, except: [heartbeat] }
  - { id: chats, kind: chats }
gate: always
output: jbot
---
Gather what jbot needs to give the person a full look at their day. Your first
message carries the person's email since the last brief (`<email>`: one line
each, with the path to its `message.md`, the whole email as Markdown), what
came into the inbox since (handled or not: the brief covers the whole day
before) and the chats that finished since. The heartbeat's hourly reports are
left out on purpose: read the mail yourself and make your own call. Then look
wider: their calendar for today and the next few days, messages that need
them, devices, and jbot's schedules.

Report in full, with the specifics (times, people, order and tracking numbers,
amounts, deadlines), the links that do the next thing, and the context you
found around each, under Today, Needs them, Mail and messages, Coming up;
leave out a heading with nothing under it. Mark the inbox entries the brief
covers handled. When a Reflection entry came in since the last brief, end with
one line, "Learned overnight: <its summary>"; otherwise say nothing of it.

Where an item has an obvious next step outside the folder (a reply to send, an
invite to answer, a chat to start on something), prepare it in full and make
the call: it is asked, not done, and the person approves it under the brief.
Prepare at most three, only ones they would likely want, and say which. A
next step answers something that came in. Never prepare a call that deletes or
tidies what the person already has (a calendar entry that looks stale or
doubled, old mail, a file): say what you noticed under Needs them and leave
it to them.
