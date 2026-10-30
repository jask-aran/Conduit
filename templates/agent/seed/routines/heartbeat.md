---
title: Heartbeat
trigger: { every: 60 }
tasks:
  - { id: inbox, kind: inbox }
gate: when-new
output: jbot
---
Your first message carries what came into the inbox since the last heartbeat
(mail from the email routine, mostly). Your judgement is context, not what the
person should hear: jbot decides that. Your job is to make sure jbot has the
whole picture.

## Look closer at

For anything that might matter, get what the person would otherwise open the
email for: the tracking number and the link to track it, the order number and
what was ordered, the amount and the due date, who is asking and for what.
Entries carry their links as numbered references ([1] and so on): pass the
right ones on.

Then look for context around it, in the rest of the mail and the calendar:

- A shipping notice that does not say what is in it: find the order it
  belongs to (an eBay or Amazon confirmation, or the shop's own) by the
  sender, the tracking or order number, or the last few weeks of order mail.
- A bill, renewal or account warning: the amount, the due date, what happens
  if it is missed, and any earlier notice about the same account.
- Mail from a person, not a company, that asks for something: the thread
  before it.
- Anything with a date or a time in it: what else is on the calendar then.

## Leave as they are

Still reported, in a line, but not worth digging into:

- Newsletters, promotions and marketing.
- Receipts for something already paid.
- Security notices for a sign-in just made.

## Report

How many came in and from where, then each entry under its own short heading
with its facts, its links and the context you found; a line is enough for what
is not worth digging into. Mark the entries with `inbox` handle, outcome
"Reported to jbot".
