# Chat timeline controller

Make chat updates local, stable, and cheap. A live event must update only the
row that owns it. Settled rows must keep their object and DOM identity until
their persisted source changes.

## State boundary

Keep three inputs separate:

- Persisted transcript messages and tools.
- One live generation projection.
- Thread metadata such as title, unread state, and activity.

The timeline controller combines the first two for display. Catalogue updates
must not reload the transcript. A normal completed turn must not fetch the full
transcript. Reconnect, pagination, branching, sequence recovery, interruption,
and failed-turn repair can read authoritative transcript state.

## Controller contract

`createTimelineStore` remains the single owner of rendered rows. It provides a
keyed list of message and trace rows. Each row has a durable key derived from
the user message that owns the turn.

The controller must:

- Preserve unchanged settled row objects across full projections.
- Patch one live block or tool for narrow generation events.
- Replace the live turn with settled rows without replacing earlier rows.
- Report projection mode, duration, and changed row keys to the harness
  recorder.
- Keep source arrays outside the renderer. Components consume rows only.

## Migration slices

1. Stabilize unchanged rows after every full projection. Reuse the prior row
   when its type, metadata, message source, trace status, and segment sources
   are unchanged.
2. Split persisted-turn projection from live-turn projection. Cache the
   persisted projection while message and tool inputs are unchanged, and
   overlay only the live turn for structural generation events. A later slice
   can make transcript changes rebuild only their affected persisted turns.
3. Add explicit settlement. While a generation owns the current assistant
   turn, defer projection of assistant `message_end` updates. At the durable
   checkpoint, project the persisted transcript once and replace the live turn.
   Earlier rows retain their object identity.
4. Add a bounded per-chat transcript cache. Keep the 10 most recently used
   settled transcripts by catalogue revision. Show cached content immediately
   during repeat navigation, then reconcile a fresh response in the background.
   Active chats bypass the cache.
5. Make scroll ownership explicit: follow only at the end, preserve an anchor
   during prepend and row-height changes, and offer a return-to-latest control.
6. Virtualize settled rows only after stable identity and scroll ownership are
   proven. Keep the live turn mounted outside the evicted range.

## Acceptance criteria

- Streaming one block changes one timeline row.
- Settling a turn does not change any earlier row identity.
- A normal turn performs no end-of-turn transcript or catalogue GET.
- An interrupted turn keeps its partial thinking and tool state before and
  after reload.
- Switching chats shows cached content without an empty loading frame.
- Scrolling upward disables follow mode. New output does not move the viewport.
- Prepending older messages preserves the visible anchor.

## Risk order

Identity comes first. Scroll ownership depends on stable elements, and
virtualization depends on both. Do not add a second transcript store or mirror
harness state; Pi and each future harness remain authoritative.
