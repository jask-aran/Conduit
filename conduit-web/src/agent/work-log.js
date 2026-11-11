import { defineDoc } from "@earendil-works/pi-durable";

/**
 * Written by what does the work, in the commit that moves it on, so it never disagrees with it. `number` counts from
 * `counters`, so it never repeats once older items are pruned.
 */
export const WorkLog = defineDoc({
  checkpointWhen: () => false, kind: "conduit.agent.work", version: 1, scope: "session",
  initial: () => ({ items: {}, seeded: false, counters: {} }),
});

const KEEP_DAYS = 60;
const KEEP_ITEMS = 2000;
const iso = (at) => new Date(at ?? Date.now()).toISOString();

// A write a replay repeats tells again, harmlessly.
let listener = null;
export const onWorkChanged = (fn) => { listener = fn; };
const changed = () => { try { listener?.(); } catch { /* telling never fails a write */ } };

function settleNumbers(doc) {
  if (doc.counters) return;
  doc.counters = {};
  const items = Object.values(doc.items).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const item of items.filter((entry) => entry.id.startsWith("seed:"))) doc.counters[item.kind] = Math.max(doc.counters[item.kind] || 0, item.number || 0);
  for (const item of items.filter((entry) => !entry.id.startsWith("seed:"))) item.number = doc.counters[item.kind] = (doc.counters[item.kind] || 0) + 1;
}

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

export async function phaseWork(tx, id, label, at) {
  const item = (await tx.doc(WorkLog)).items[id];
  if (!item || item.endedAt || item.phase === label) return;
  item.phase = label;
  item.phases.push({ label, at: iso(at) });
  changed();
}

export async function noteWork(tx, id, outcome, extra = {}) {
  const item = (await tx.doc(WorkLog)).items[id];
  if (!item) return;
  item.outcome = { ...(item.outcome || {}), ...outcome };
  Object.assign(item, extra);
  changed();
}

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

export const listWork = (doc) => Object.values(doc?.items || {}).sort((a, b) => b.startedAt.localeCompare(a.startedAt));

export const GATHER_WORDS = { email: "Collecting emails", "held-mail": "Reading held mail", notes: "Reading its notes", inbox: "Reading the inbox",
  executor: "Checking connected accounts", script: "Running its script", calendar: "Reading the calendar", chats: "Reading chats" };
