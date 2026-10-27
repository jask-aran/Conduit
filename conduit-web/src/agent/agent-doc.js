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
 * - `spend`: `YYYY-MM-DD` (the agent's time zone) → USD its runs spent (subagents.js reporter).
 * - `notices`: what the attention list says beside the work itself, newest last, at most 20 (agent.js).
 * - `tainted`: conversation id → true once it read private data (policy.js).
 * - `rules`: id → saved outward approval (policy.js).
 * - `next`: the counter every part numbers its ids from (`sc-3`, `w-4`, `p-5`).
 */
export const AgentDoc = defineDoc({
  kind: "conduit.agent",
  version: 1,
  scope: "session",
  initial: () => ({ home: null, schedules: {}, watches: {}, hooks: {}, proposals: {}, spend: {}, notices: [], tainted: {}, rules: {}, next: 1 }),
});

/** A new id for one part of the agent's document: `${prefix}-${n}`. Call inside the commit that stores it. */
export const nextId = (doc, prefix) => `${prefix}-${doc.next++}`;
