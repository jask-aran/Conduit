import fs from "node:fs/promises";
import { defineDoc } from "@earendil-works/pi-durable";
import { withConduitNote } from "../attachment-envelope.js";
import { renderVars } from "../agent/routine-files.js";

export async function notice(store, name, vars = {}) {
  if (store) return store.notice(name, vars);
  const text = await fs.readFile(new URL(`../../../templates/notices/${name}.md`, import.meta.url), "utf8");
  return renderVars(text, vars);
}

/** A fork starts without its parent's pending notes; placed entries retain what that branch was told. */
const initialNotes = () => ({ prompt: null, told: null, time: null, pending: [], lastEntry: 0 });
export const ConduitNotices = defineDoc({
  checkpointWhen: () => false, kind: "conduit.notices", version: 1, scope: "conversation", history: "latest", fork: "initial",
  initial: initialNotes,
});

/** Only placed input counts as told: a withdrawn queued input must not suppress a later notice. */
async function deliveredNotes(conversation, state, context, consumedStops) {
  const entries = [];
  let cursor;
  do {
    const page = await conversation.entries({ minEntryId: (state.lastEntry || 0) + 1 }, 100, cursor, context);
    entries.push(...page.items);
    cursor = page.next;
  } while (cursor);
  for (const entry of entries.sort((a, b) => a.id - b.id)) {
    const told = entry.data?.noticeState;
    if (told?.fixed) state.told = told.fixed;
    if (told?.time) state.time = told.time;
    if (told?.stop) {
      consumedStops.add(told.stop);
      state.pending = (state.pending || []).filter((note) => note.id !== told.stop);
    }
    state.lastEntry = entry.id;
  }
  return state;
}

/** All person inputs and notices use one prefix; only a fresh person input consumes a stop note. */
/** Whether the person stopped the conversation's last turn and has not spoken since (the stop note still waits). */
export async function stopPending(runtime, conversation, context) {
  const saved = await runtime.harness.snapshot(ConduitNotices, conversation.id, context);
  const state = await deliveredNotes(conversation, JSON.parse(JSON.stringify(saved || initialNotes())), context, new Set());
  return Boolean(state.pending?.some((note) => note.name === "stop"));
}

export async function submitWithNotes(runtime, conversation, draft, context, { jbot = false, freshPerson = false, opensWithTime = false, prepare = (text) => text, admit = (input) => conversation.submit(input, context) } = {}) {
  // Reports and chat inputs can arrive together. Keep their checks and admissions in conversation order.
  runtime.noteSubmissions ||= new Map();
  const previous = runtime.noteSubmissions.get(conversation.id) || Promise.resolve();
  const work = previous.catch(() => {}).then(async () => {
    if (draft.requestId) {
      const existing = await runtime.harness.commit((tx) => tx.submissionByRequest(conversation.id, draft.requestId), context);
      if (existing) return runtime.harness.submission(existing.id, context);
    }
    const saved = await runtime.harness.snapshot(ConduitNotices, conversation.id, context);
    const consumedStops = new Set();
    const state = await deliveredNotes(conversation, JSON.parse(JSON.stringify(saved || initialNotes())), context, consumedStops);
    const role = !jbot && !state.prompt && runtime.agent?.describe ? await runtime.agent.describe(conversation.id) : null;
    jbot ||= Boolean(state.prompt) || role?.role === "home" || role?.role === "side";
    const notes = [];
    const told = {};
    const stop = freshPerson && state.pending?.find((note) => note.name === "stop");
    if (stop) {
      notes.push(await notice(runtime.contextStore, "stop"));
      told.stop = stop.id;
    }
    if (jbot && runtime.agentVars) {
      const { now: _now, ...fixed } = await runtime.agentVars();
      const before = state.told || state.prompt || fixed;
      const changes = [];
      for (const [oldValue, newValue, label] of [[before.person?.name, fixed.person?.name, "the person's name"], [before.person?.home, fixed.person?.home, "the person's home"], [before.assistant?.name, fixed.assistant?.name, "your name"], [before.timezone, fixed.timezone, "your time zone"]]) {
        if (oldValue !== newValue) changes.push(newValue ? `${label} is now ${newValue}` : `${label} is no longer set`);
      }
      if (changes.length) notes.push(await notice(runtime.contextStore, "update", { changes: changes.join("; ") }));
      const now = Date.now();
      const day = (at) => new Date(at).toLocaleDateString("en-CA", { timeZone: fixed.timezone });
      if (opensWithTime || !state.time || now - state.time >= 1800000 || day(now) !== day(state.time)) {
        if (!opensWithTime) notes.push(await notice(runtime.contextStore, "time", { ...fixed, now: new Date(now).toLocaleString("en-AU", { timeZone: fixed.timezone, dateStyle: "full", timeStyle: "short" }) }));
        told.time = now;
      }
      told.fixed = fixed;
    } else if (opensWithTime) told.time = Date.now();
    let content = draft.content;
    if (notes.length) {
      const note = notes.join("\n\n");
      content = typeof content === "string" ? withConduitNote(note, content) : [{ type: "text", text: withConduitNote(note, "") }, ...content];
    }
    const submission = await admit({ ...draft, content: await prepare(content),
      entry: { ...draft.entry, data: { ...draft.entry?.data, noticeState: told } },
    });
    const { pending: _pending, ...next } = await deliveredNotes(conversation, state, context, consumedStops);
    await conversation.commit(async (tx) => {
      const doc = await tx.doc(ConduitNotices, conversation.id);
      Object.assign(doc, next);
      doc.pending = (doc.pending || []).filter((note) => !consumedStops.has(note.id));
    }, context);
    return submission;
  });
  runtime.noteSubmissions.set(conversation.id, work);
  try { return await work; }
  finally { if (runtime.noteSubmissions.get(conversation.id) === work) runtime.noteSubmissions.delete(conversation.id); }
}
