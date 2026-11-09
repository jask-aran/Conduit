import { defineDoc } from "@earendil-works/pi-durable";

/**
 * jbot's work log: one item per unit of work -- a routine firing (Heartbeat #12, Morning brief, Reflection), a run it
 * was woken for (a check-back, an event, a webhook, one the person asked for), a background agent jbot sent from its
 * chat. What Working on (open items) and Recent (closed ones) read, and the jbot chat's run rows; never the agents a
 * unit uses, which roll up into it (a count, and what the one working now is doing).
 *
 * Written by what does the work, in the commit that moves it on, so it never disagrees with it: the routine task
 * (routine-task.js) at each of its steps, the run spawner and reporter (subagents.js). Items only grow (a phase
 * appended, an outcome set, then closed); closed ones go after KEEP_DAYS, or beyond KEEP_ITEMS.
 *
 * An item: `{ id, kind, title, origin, number, trigger, conversationId, startedAt, phase, phases: [{ label, at }],
 * outcome: { status, woke, level, summary, did, inboxId, compaction, reportedAt }, endedAt, log }`. `id` is its key: a
 * routine's `routine:<task id>`, a run's or an agent's `run:<roster key>` (the home thread's roster). `number` counts
 * each kind's items from `counters`, so it never repeats once older items are pruned.
 */
export const WorkLog = defineDoc({
  checkpointWhen: () => false, kind: "conduit.agent.work", version: 1, scope: "session",
  initial: () => ({ items: {}, seeded: false, counters: {} }),
});

const KEEP_DAYS = 60;
const KEEP_ITEMS = 2000;
const iso = (at) => new Date(at ?? Date.now()).toISOString();

// Told after a write (server.js publishes the agent view as changed); a write a replay repeats tells again, harmlessly.
let listener = null;
export const onWorkChanged = (fn) => { listener = fn; };
const changed = () => { try { listener?.(); } catch { /* telling never fails a write */ } };

/**
 * Each kind's counter, from the highest number its items carry when it has none: once, for the log as it was before
 * counters (items imported from before the log keep theirs; those numbered after them since come next).
 */
export function settleNumbers(doc) {
  if (doc.counters) return;
  doc.counters = {};
  const items = Object.values(doc.items).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const item of items.filter((entry) => entry.id.startsWith("seed:"))) doc.counters[item.kind] = Math.max(doc.counters[item.kind] || 0, item.number || 0);
  for (const item of items.filter((entry) => !entry.id.startsWith("seed:"))) item.number = doc.counters[item.kind] = (doc.counters[item.kind] || 0) + 1;
}

/** Open an item (idempotent by id): what it is and how it started. Returns it. */
export async function openWork(tx, { id, kind, title, origin = null, trigger = null, conversationId = null, startedAt, phase = null, log = true, label = null }) {
  const doc = await tx.doc(WorkLog);
  if (doc.items[id]) return doc.items[id];
  const at = iso(startedAt);
  settleNumbers(doc);
  const count = doc.counters[kind] = (doc.counters[kind] || 0) + 1;
  doc.items[id] = { id, kind, title, origin, trigger, number: count, conversationId, startedAt: at, phase: phase || "Starting",
    phases: [{ label: phase || "Starting", at }], outcome: null, endedAt: null, ...(log ? {} : { log: false }), ...(label ? { label } : {}) };
  prune(doc);
  changed();
  return doc.items[id];
}

/** Move an open item on to a phase (what it is doing now, in words: "Collecting emails"); a repeat is not appended. */
export async function phaseWork(tx, id, label, at) {
  const item = (await tx.doc(WorkLog)).items[id];
  if (!item || item.endedAt || item.phase === label) return;
  item.phase = label;
  item.phases.push({ label, at: iso(at) });
  changed();
}

/** Set what an item found or did (merged into what it had): its report, the inbox entry, a compaction. */
export async function noteWork(tx, id, outcome, extra = {}) {
  const item = (await tx.doc(WorkLog)).items[id];
  if (!item) return;
  item.outcome = { ...(item.outcome || {}), ...outcome };
  Object.assign(item, extra);
  changed();
}

/** Close an item: how it ended (finished, failed, stopped), with its last words. */
export async function closeWork(tx, id, status, at, outcome = {}) {
  const item = (await tx.doc(WorkLog)).items[id];
  if (!item || item.endedAt) return;
  item.endedAt = iso(at);
  item.outcome = { ...(item.outcome || {}), ...outcome, status };
  const label = status === "failed" ? "Failed" : status === "stopped" ? "Stopped" : "Done";
  item.phase = label;
  item.phases.push({ label, at: item.endedAt });
  changed();
}

function prune(doc) {
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const items = Object.values(doc.items);
  for (const item of items) if (item.endedAt && Date.parse(item.endedAt) < cutoff) delete doc.items[item.id];
  const closed = Object.values(doc.items).filter((item) => item.endedAt).sort((a, b) => a.endedAt.localeCompare(b.endedAt));
  for (const item of closed.slice(0, Math.max(0, Object.keys(doc.items).length - KEEP_ITEMS))) delete doc.items[item.id];
}

/** The items, newest first by when they started; open ones are those with no end. */
export const listWork = (doc) => Object.values(doc?.items || {}).sort((a, b) => b.startedAt.localeCompare(a.startedAt));

/** What a routine's gather task is doing, in words, by its kind. */
export const GATHER_WORDS = { email: "Collecting emails", "held-mail": "Reading held mail", notes: "Reading its notes", inbox: "Reading the inbox",
  executor: "Checking connected accounts", script: "Running its script", calendar: "Reading the calendar", chats: "Reading chats" };
