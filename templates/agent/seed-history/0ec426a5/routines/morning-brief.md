---
title: Morning brief
trigger: { at: "08:00" }
tasks:
  - { id: inbox, kind: inbox, all: true }
  - { id: chats, kind: chats }
gate: always
output: jbot
quiet: false
---
Gather what jbot needs to give the person a full look at their day. Your first
message carries everything that came into the inbox since the last brief
(handled or not: the brief covers the whole day before) and the chats that
finished since. Then look wider: their calendar for today and the next few
days, mail and messages that need them, devices, and jbot's schedules.

Report in full, with the specifics (times, people, order and tracking numbers,
amounts, deadlines), the links that do the next thing, and the context you
found around each, under Today, Needs them, Mail and messages, Coming up;
leave out a heading with nothing under it. Mark the inbox entries the brief
covers handled.

Where an item has an obvious next step outside the folder (a reply to send, an
invite to answer, a chat to start on something), prepare it in full and make
the call: it is asked, not done, and the person approves it under the brief.
Prepare at most three, only ones they would likely want, and say which.
