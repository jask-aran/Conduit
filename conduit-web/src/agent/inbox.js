import crypto from "node:crypto";
import { defineDoc, defineDocFamily, defineTool, section } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { AgentDoc, nextId } from "./agent-doc.js";
import { inboxEntryText } from "./inbox-files.js";

/*
 * Block II's inbox (docs/plans/persistent-agent.md, Vision): where context waits. Every run that ends with something
 * to say appends one entry; an entry that matters now (urgent, asked for, waiting on an approval) is told to the
 * person at once and lands handled, the rest wait for the heartbeat, or for the person to talk to jbot first, whose
 * home thread sees the unhandled headlines each turn. A run with nothing to say ends with `nothing_to_report` and
 * leaves no entry, only its history. Handled entries stay a week.
 *
 * An entry: `{ id, key, at, kind, title, subagentId, conversationId, level, headline, status, handledAt?, outcome?, for? }`,
 * `level` one of fyi, attention, urgent, failed; `status` unhandled or handled; `key` the run delivery it records;
 * `handledBy` the conversation that marked it (a heartbeat's run, for its line in the home thread).
 */
const KEPT_MS = 7 * 86400_000;
const KEPT_MAX = 200;
const LEVEL_WORD = /^\s*(?:[*_`#>\s]*)(?:URGENT|ATTENTION|FYI|NOTHING)\b[*_`]*\s*[:.-]?\s*/i;

/** How a run ended, if it said so with a tool: `{ outcome: "quiet" | "failed", reason?, at }`. */
export const RunEnd = defineDoc({ checkpointWhen: () => false, kind: "conduit.agent.run-end", version: 1, scope: "conversation", initial: () => ({ end: null }) });

/** A report's first line, without its level word, as the inbox and the home thread show it. */
/** Markdown as the words it shows, for where it cannot be drawn (a headline, a notification): links as their text,
 *  no emphasis, code or block marks. */
export const plainText = (text) => String(text || "")
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/`+([^`]*)`+/g, "$1")
  .replace(/(\*\*|__)(.+?)\1/g, "$2")
  .replace(/(^|[^\w*])\*([^*\n]+)\*(?![\w*])/g, "$1$2")
  .replace(/(^|[^\w_])_([^_\n]+)_(?![\w_])/g, "$1$2")
  .replace(/^[ \t]{0,3}(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+\.[ \t]+)/gm, "")
  .replace(/\*\*/g, "");
export const headlineOf = (text, max = 160) => {
  const first = plainText(String(text || "").replace(LEVEL_WORD, "")).split(/\r?\n/).map((line) => line.replace(/^[#>*\s-]+/, "").trim()).find(Boolean) || "";
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
};

export async function renderWaitingInbox(agent, state = null) {
    state ||= await agent.state();
    const items = listInbox(state, { unhandled: true });
    // Whether a report reaches the person's phone is jbot's call (`message` with notify), weighed against how often they want it.
    const dial = `How often the person wants to be interrupted: ${agent.settings().dial} (${DIAL_WORDS[agent.settings().dial] || DIAL_WORDS.normal}).`;
    if (!items.length) return dial;
    return [dial, `Unhandled in your inbox (${items.length}). Tell the person what matters when it fits, then mark it with conduit_inbox handle:`,
      ...items.slice(0, 12).map((item) => line(item, agent.settings().timezone)),
      ...(items.length > 12 ? [`… and ${items.length - 12} more (conduit_inbox list).`] : [])].join("\n");
}

/*
 * An entry's text is a document of its own, one per entry id (pi-durable's keyed family), written once when it is
 * filed: the agent's document keeps only the index (what the inbox lists, filters and marks handled in the same commit
 * as a routine's cursors), so it no longer grows with every report and email it records. The text becomes the entry's
 * file (inbox-files.js), which is what is read after that.
 */
export const InboxText = defineDocFamily({ family: true, checkpointWhen: () => false, kind: "conduit.agent.inbox-text", version: 1,
  scope: "session", initial: (seed) => ({ text: String(seed ?? "") }) });

/*
 * An entry's status moves only here. It is filed unhandled, or handled as it is filed when it records what was told at
 * once; handle and dismiss mark it handled once, with when, how and by which conversation; reopen takes it back to
 * unhandled.
 */
function markHandled(item, outcome, at, conversationId) {
  if (item.status === "handled") return;
  item.status = "handled";
  item.handledAt = at;
  item.outcome = outcome;
  if (conversationId !== undefined) item.handledBy = conversationId;
}
function markUnhandled(item, reopenedAt) {
  item.status = "unhandled";
  delete item.handledAt; delete item.outcome; delete item.handledBy;
  item.reopenedAt = reopenedAt;
}

/** File an entry in the caller's commit: its index in the agent's document, its text (`body`) beside it. `handled`
 *  (an outcome) files it already handled. */
export async function fileEntry(tx, entry, now = Date.now(), { handled } = {}) {
  const { body, status, handledAt, outcome, ...index } = entry;
  const doc = await tx.doc(AgentDoc);
  const before = new Set(Object.keys(doc.inbox || {}));
  const existing = Object.values(doc.inbox || {}).find((item) => item.key === entry.key);
  const item = appendEntry(doc, index, now);
  if (!existing && handled !== undefined) markHandled(item, handled, item.at);
  if (!existing && typeof body === "string" && body) await tx.doc(InboxText, item.id, body);
  for (const id of before) if (!Object.hasOwn(doc.inbox, id)) await tx.retireDoc(InboxText, id);
  return item;
}

/** An entry's text as filed, or "" (an entry from before texts were their own documents carries `body`). */
export async function filedText(reader, entry, context) {
  if (typeof entry.body === "string") return entry.body;
  return (await reader.snapshot(InboxText, entry.id, context))?.text || "";
}

/** Append an entry's index to the agent's document; idempotent by `key`. Prunes what has been handled a week. */
export function appendEntry(doc, entry, now = Date.now()) {
  doc.inbox ||= {};
  const existing = Object.values(doc.inbox).find((item) => item.key === entry.key);
  if (existing) return existing;
  for (const [id, item] of Object.entries(doc.inbox)) {
    if (item.status === "handled" && Date.parse(item.handledAt || item.at) < now - KEPT_MS) delete doc.inbox[id];
  }
  const id = nextId(doc, "i");
  doc.inbox[id] = { id, at: new Date(now).toISOString(), status: "unhandled", ...entry };
  const all = Object.values(doc.inbox).sort((a, b) => a.at.localeCompare(b.at));
  for (const item of all.slice(0, Math.max(0, all.length - KEPT_MAX))) if (item.status === "handled") delete doc.inbox[item.id];
  return doc.inbox[id];
}

/** Entries newest first; `unhandled` only those still waiting. */
export const listInbox = (state, { unhandled = false, for: recipient, kinds, addressed } = {}) => Object.values(state?.inbox || {})
  .filter((item) => (!unhandled || item.status === "unhandled")
    && (!kinds || kinds.includes(item.kind))
    && (recipient === undefined || (item.for?.length ? item.for.includes(recipient) : addressed !== "only")))
  .sort((a, b) => b.at.localeCompare(a.at));

const badInbox = (message) => Object.assign(new Error(message), { status: 400 });
// Copy entries before the commit closes their tracked overlays.
const entryCopy = (entry) => JSON.parse(JSON.stringify(entry));
const missingInbox = () => Object.assign(new Error("No such entry."), { status: 404 });
const inboxText = (value, name) => {
  if (typeof value !== "string" || !value.trim()) throw badInbox(`${name} is required.`);
  return value.trim();
};
const recipients = (value) => {
  if (value === null) return [];
  const names = typeof value === "string" ? [value] : value;
  if (!Array.isArray(names) || names.some((name) => typeof name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(name))) throw badInbox("for must contain routine names.");
  return [...new Set(names)];
};

/** Shared mutation functions. Caller identity comes from the route or tool, never the input. */
export async function addInboxEntry(tx, input, { author, by, key = `note:${crypto.randomUUID()}` }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw badInbox("An entry is required.");
  const title = inboxText(input.title, "title");
  const headline = inboxText(input.headline, "headline");
  if (!["fyi", "attention", "urgent"].includes(input.level)) throw badInbox("level must be fyi, attention or urgent.");
  if (input.body !== undefined && typeof input.body !== "string") throw badInbox("body must be text.");
  const kind = input.kind === undefined ? "note" : inboxText(input.kind, "kind");
  const addressed = input.for === undefined ? {} : { for: recipients(input.for) };
  return entryCopy(await fileEntry(tx, { key, title, headline, kind, level: input.level, author, by,
    ...(input.body === undefined ? {} : { body: input.body }), ...addressed }));
}

export function editInboxEntries(doc, input, { by, conversationId } = {}) {
  if (!input || !["handle", "reopen", "address", "dismiss"].includes(input.action)) throw badInbox("Invalid inbox action.");
  if (input.ids !== undefined && (!Array.isArray(input.ids) || input.ids.some((id) => typeof id !== "string" || !id.trim()))) throw badInbox("ids must contain entry ids.");
  if (input.id !== undefined && (typeof input.id !== "string" || !input.id.trim())) throw badInbox("id must be an entry id.");
  const ids = [...new Set([...(input.ids || []), ...(input.id ? [input.id] : [])])];
  if (!ids.length) throw badInbox("An entry id is required.");
  const outcome = input.action === "dismiss" ? "dismissed" : input.action === "handle" ? inboxText(input.outcome, "outcome").slice(0, 200) : undefined;
  const addressed = input.action === "address" ? recipients(input.for) : undefined;
  const entries = ids.map((id) => { const item = Object.hasOwn(doc.inbox || {}, id) ? doc.inbox[id] : undefined; if (!item) throw missingInbox(); return item; });
  for (const item of entries) {
    if (input.action === "address") item.for = addressed;
    else if (input.action === "reopen") {
      // Keep arrival time. Move eligibility past all existing routine cursors, even within the same millisecond.
      const cursors = Object.values(doc.cursors || {}).flatMap((tasks) => Object.values(tasks));
      markUnhandled(item, new Date(Math.max(Date.now(), ...cursors.map((cursor) => (Date.parse(cursor.since || "") || 0) + 1))).toISOString());
    } else markHandled(item, outcome, new Date().toISOString(), conversationId);
    if (by !== undefined) item.by = by;
  }
  return entries.map(entryCopy);
}

export async function deleteInboxEntry(tx, id) {
  const doc = await tx.doc(AgentDoc);
  const item = Object.hasOwn(doc.inbox || {}, id) ? doc.inbox[id] : undefined;
  if (!item) throw missingInbox();
  delete doc.inbox[id];
  await tx.retireDoc(InboxText, id);
}

const LEVEL_LABEL = { fyi: "FYI", attention: "ATTENTION", urgent: "URGENT", failed: "FAILED" };
/* An entry's line says when it came, not how long ago: a line that ages every turn would be a different section every
   turn, sent again each time (the prompt cache keeps only what does not change). */
const addressedTo = (item) => item.for?.length ? ` · for: ${item.for.join(", ")}` : "";
const line = (item, timeZone) => `- ${item.id} · ${LEVEL_LABEL[item.level] || item.level} · ${item.title}${addressedTo(item)}: ${item.headline || "(no text)"} (${item.kind}, ${new Intl.DateTimeFormat("en-AU", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(item.at))})`;

/** Whether it is the person's quiet hours, in the agent's time zone: `{ enabled, start, end }`, wrapping midnight. */
export function inQuietHours(settings, now = Date.now()) {
  const quiet = settings.quietHours;
  if (!quiet?.enabled) return false;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: settings.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  return quiet.start <= quiet.end ? time >= quiet.start && time < quiet.end : time >= quiet.start || time < quiet.end;
}

const DIAL_WORDS = { quiet: "push only what cannot wait", normal: "push what they should see today", chatty: "push anything worth knowing" };

export const entryText = (entry, timeZone) => {
  const when = new Intl.DateTimeFormat("en-AU", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(entry.at));
  const body = entry.body && entry.body !== entry.headline ? `\n${entry.body.split("\n").map((row) => `    ${row}`).join("\n")}` : "";
  return `- [${entry.id}] ${when} · ${entry.title}${addressedTo(entry)} · ${entry.level}${entry.author === "person" ? ` · author: person, via: ${entry.via || "unknown"}` : ""}: ${entry.headline}${body}`;
};

const result = (text, isError = false) => ({ output: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });

export function InboxTools(runtime) {
  const runOnly = async (api) => (await runtime.agent?.describe(api.conversationId))?.role === "run";
  const ending = (outcome) => async (args, api, context) => {
    if (!await runOnly(api)) return result("Only a run ends this way; in a thread, just answer.", true);
    await api.commit(async (tx) => {
      const doc = await tx.doc(RunEnd, api.conversationId);
      doc.end ||= { outcome, ...(args.reason ? { reason: String(args.reason).slice(0, 500) } : {}), at: new Date().toISOString() };
    }, context);
    return result(outcome === "quiet" ? "Noted: this run ends with nothing to report. Stop here." : "Noted: this run failed. Stop here.");
  };
  const quiet = defineTool({
    name: "nothing_to_report",
    description: "In a run: end it with nothing worth telling the person (all clear, no change). It leaves no report.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: ending("quiet"),
  });
  const failed = defineTool({
    name: "run_failed",
    description: "In a run: end it as failed when the task could not be done, with the reason and what would unblock it.",
    parameters: Type.Object({ reason: Type.String({ description: "What went wrong and what would unblock it, in a line or two." }) }),
    replay: "safe",
    execute: ending("failed"),
  });
  // The home thread sees what waits, each turn, so a person who talks first is never told stale news.
  const waiting = section("agent-inbox", async (input) => {
    const agent = runtime.agent;
    if (!agent?.enabled()) return undefined;
    const state = await agent.state();
    if (state.home?.conversationId !== input.conversationId) return undefined;
    return renderWaitingInbox(agent, state);
  });
  // conduit_inbox is the conduit MCP server's (server/conduit-mcp.js), which every profile's runtime mounts.
  return { tools: [quiet, failed], sections: [waiting] };
}

export function ConduitInboxTool(runtime) {
  return defineTool({
    name: "conduit_inbox",
    description: "The hub's context inbox, shared by all callers. No client parameter. "
      + "list (unhandled defaults true; kind and for filter), read (id), handle (id or ids, outcome), "
      + "reopen (clear handling), address (for: routine names; [] or null clears), add (title, headline, body?, "
      + "level: fyi|attention|urgent, kind defaults note, for?), dismiss (handle with outcome dismissed). There is no delete action.",
    parameters: Type.Object({
      action: Type.Union(["list", "read", "handle", "reopen", "address", "add", "dismiss"].map((value) => Type.Literal(value))),
      id: Type.Optional(Type.String()),
      ids: Type.Optional(Type.Array(Type.String())),
      outcome: Type.Optional(Type.String()),
      all: Type.Optional(Type.Boolean({ description: "Include handled entries (legacy shorthand for unhandled:false)." })),
      unhandled: Type.Optional(Type.Boolean()),
      kind: Type.Optional(Type.String()),
      for: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String()), Type.Null()], { description: "list: one routine name; add/address: names, [] or null to clear." })),
      title: Type.Optional(Type.String()),
      headline: Type.Optional(Type.String()),
      body: Type.Optional(Type.String()),
      level: Type.Optional(Type.Union(["fyi", "attention", "urgent"].map((value) => Type.Literal(value)))),
    }),
    replay: "safe",
    execute: async (args, api = {}, context) => {
      const agent = runtime.agent;
      if (!agent?.enabled()) return result("The agent is not enabled.", true);
      const state = await agent.state();
      try {
        if (args.action === "list") {
          if (args.for !== undefined && typeof args.for !== "string") throw badInbox("list for must be a routine name.");
          const items = listInbox(state, { unhandled: args.unhandled ?? !args.all, kinds: args.kind ? [args.kind] : undefined, for: args.for });
          return result(items.map((item) => `${line(item, agent.settings().timezone)}${item.status === "handled" ? ` [handled: ${item.outcome || "done"}]` : ""}`).join("\n") || "Nothing waits in the inbox.");
        }
        if (args.action === "read") {
          const item = Object.hasOwn(state.inbox || {}, args.id) ? state.inbox[args.id] : undefined;
          if (!item) throw missingInbox();
          const answer = item.conversationId ? await runtime.lastAnswer(item.conversationId).catch(() => null) : null;
          return result(`${line(item, agent.settings().timezone)}\n\n${await inboxEntryText(agent, item) || answer || item.headline || "(The run left no text.)"}`);
        }
        const change = async (tx) => {
          if (args.action === "add") return addInboxEntry(tx, args, { author: api.conversationId ?? "mcp", by: api.conversationId ?? "mcp", key: api.callId ? `inbox:${api.callId}` : undefined });
          return editInboxEntries(await tx.doc(AgentDoc), args, { by: api.conversationId ?? "mcp", conversationId: api.conversationId });
        };
        const done = api.commit ? await api.commit(change, context) : await agent.update((doc, tx) => change(tx));
        return result(JSON.stringify(done));
      } catch (error) {
        if (error.status === 400 || error.status === 404) return result(error.message, true);
        throw error;
      }
    },
  });
}
