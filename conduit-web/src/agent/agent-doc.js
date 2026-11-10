import { defineDoc } from "@earendil-works/pi-durable";

/**
 * The hub's persistent agent, as pi-durable keeps it: one Session document, so
 * its schedules, watches and proposals commit with the work that changes them
 * and survive a restart with it. Each part has one owner module:
 *
 * - `home`: `{ chatId, conversationId }` of the home thread (agent.js).
 * - `schedules`: id → schedule and the clock task that keeps it (schedule.js).
 * - `watches`, `hooks`: Conduit events and webhook tokens that wake it (events.js).
 * - `proposals`: id → memory a run proposed, waiting for the person (memory.js).
 * - `declined`: the proposals the person declined, `{ file, op, text, at }`, oldest first, at most 100 (memory.js); the
 *   routine's `notes` task shows them so they are not proposed again (routines.js).
 * - `routineRuns`: task id → active routine lifecycle, including its guarded fork (routine-task.js).
 * - `routineState`: name → last firing, successful run, full completion and failure.
 * - `spend`: `YYYY-MM-DD` (the agent's time zone) → USD its runs spent (subagents.js reporter).
 * - `notices`: what the attention list says beside the work itself, newest last, at most 20 (agent.js).
 * - `tainted`: conversation id → true once it read private data (policy.js).
 * - `readOutside`: conversation id → when it last read a connector (outside content), kept while it counts (policy.js).
 * - `rules`: id → saved outward approval (policy.js).
 * - `approvalPolicy`: the person's standing approval policy, or null for the starter (approval-policy.js).
 * - `inbox`: id → what a run reported, waiting for the heartbeat or the person (inbox.js): the index only, each
 *   entry's text a document of its own (InboxText) and then its file (inbox-files.js).
 * - `next`: the counter every part numbers its ids from (`sc-3`, `w-4`, `p-5`).
 */
export const AgentDoc = defineDoc({
  checkpointWhen: () => false, kind: "conduit.agent",
  version: 1,
  scope: "session",
  initial: () => ({ home: null, schedules: {}, watches: {}, hooks: {}, proposals: {}, spend: {}, notices: [], tainted: {}, readOutside: {}, rules: {}, approvalPolicy: null, asks: {}, inbox: {}, next: 1 }),
});

/** A new id for one part of the agent's document: `${prefix}-${n}`. Call inside the commit that stores it. */
export const nextId = (doc, prefix) => `${prefix}-${doc.next++}`;
