# Making the backend's transcript authoritative

## The problem

Conduit keeps two transcripts. The backend's — Pi's JSONL, correct by
construction — and a live model the client assembles from a stream of deltas:
`record.generation`, `activeGeneration`, and on the client `messages()`,
`buildTurnRows`, optimistic `user_*` entries, `pendingMessages`,
`promotePendingUser`. The second is a speculative reconstruction of the first.

Every transcript bug this work has hit is a divergence between the two, not a
bug in the backend:

| Symptom | Divergence |
| --- | --- |
| Interrupted turn goes blank until reload | Assistant text lived only in the live structure; the next turn replaced it |
| "Invalid Date" on a live message | Pi timestamps messages in epoch ms; the session file timestamps entries in ISO |
| Queue bubble always empty | Pi reported `steering`/`followUp` as top-level arrays; the mapping read `event.queue` |
| Output rendered above its own user message | `buildTurnRows` re-derives turn ownership from message order |
| Interrupt raced the stop | The client inferred when the abort landed from derived signals |

The tell is consistent: **it is always right after a reload.** `messagesFromEntries`
projects the session file and is correct every time. The live path computes what
should be the same answer by another route, and drifts.

Slice 1 (commit `a1952b8`) closed the worst instance by publishing assistant
messages as transcript entries. It did not remove the duplication — it made the
mirror more faithful. This document is the plan to remove it.

## The target

One projection, two triggers.

- The backend's transcript is the only source of message identity, order,
  timestamps, stop reasons and attachments.
- Live events are *notifications that the session changed*, plus deltas for the
  tail of the message currently in flight.
- The streaming structure renders only that tail. It never owns committed text.

Concretely: `messagesFromEntries` becomes the single projection, fed both by the
initial load and by live updates, instead of being one of two readers.

## Why this is not simply "reload more often"

A full re-read per event is too expensive, and a reload drops the streaming tail.
The design has to keep three properties the current live path provides: sub-frame
delta rendering, no flicker on commit, and no round trip on an ordinary send.

## Slices

### 2a. A transcript read on the adaptor contract

Add to `ChatBackendAdapter`:

```
readTranscript(id, { sinceEntryId }) -> { entries, nextEntryId }
```

Pi implements it by reading its session file from the last known entry —
`readHeadRecords` in `src/harnesses/session-store.js` already shows the shape,
and needs a tail-read counterpart. Codex and chatgpt-web implement it from their
own stores. This is a better contract than today's, where every backend is
obliged to *simulate* a transcript through events.

This is the load-bearing slice. Nothing else can land first.

### 2b. Reconcile on settle

On `agent_settled`, read the tail and replace the turn wholesale. Any residual
live drift becomes self-healing within one turn rather than surviving until F5.
Cheap, independently valuable, and it can ship before 2c — at which point most
remaining divergences stop being user-visible even though the duplication
remains.

### 2c. Collapse the client's second model

Delete `promotePendingUser`, the optimistic `user_*` ids, and the
timestamp-and-fallback-index sort in `buildTimeline`. `buildTurnRows` consumes
projected entries and stops inferring turn ownership from message order.

The care needed here is the optimistic send: a user message must still appear
instantly. It becomes a *pending tail* the projection replaces on the next read,
rather than an entry the client invents and later reconciles by content match.

Do this last, and behind the harness metrics in `createTimelineStore`, so a
regression in perceived latency is measurable rather than felt.

## What stays

Streaming deltas, the structured generation view, and `activeGeneration` all
stay. The change is what they *own*: the tail of the message in flight, and
nothing that has already been written down.
