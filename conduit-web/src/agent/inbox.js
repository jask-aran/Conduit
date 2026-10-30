import fs from "node:fs/promises";
import path from "node:path";
import { defineDoc, defineTool, section } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { AgentDoc, nextId } from "./agent-doc.js";

/*
 * Block II's inbox (docs/plans/persistent-agent.md, Vision): where context waits. Every run that ends with something
 * to say appends one entry; an entry that matters now (urgent, asked for, waiting on an approval) is told to the
 * person at once and lands handled, the rest wait for the heartbeat, or for the person to talk to jbot first, whose
 * home thread sees the unhandled headlines each turn. A run with nothing to say ends with `nothing_to_report` and
 * leaves no entry, only its history. Handled entries stay a week.
 *
 * An entry: `{ id, key, at, kind, title, subagentId, conversationId, level, headline, status, handledAt?, outcome? }`,
 * `level` one of fyi, attention, urgent, failed; `status` unhandled or handled; `key` the run delivery it records;
 * `handledBy` the conversation that marked it (a heartbeat's run, for its line in the home thread).
 */
const KEPT_MS = 7 * 86400_000;
const KEPT_MAX = 200;
const LEVEL_WORD = /^\s*(?:[*_`#>\s]*)(?:URGENT|ATTENTION|FYI|NOTHING)\b[*_`]*\s*[:.-]?\s*/i;

/** How a run ended, if it said so with a tool: `{ outcome: "quiet" | "failed", reason?, at }`. */
export const RunEnd = defineDoc({ kind: "conduit.agent.run-end", version: 1, scope: "conversation", initial: () => ({ end: null }) });

/** A report's first line, without its level word, as the inbox and the home thread show it. */
export const headlineOf = (text, max = 160) => {
  const first = String(text || "").replace(LEVEL_WORD, "").split(/\r?\n/).map((line) => line.replace(/^[#>*\s-]+/, "").trim()).find(Boolean) || "";
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
};

/** Append a run's entry in the caller's commit; idempotent by `key`. Prunes what has been handled a week. */
export function appendEntry(doc, entry, now = Date.now()) {
  doc.inbox ||= {};
  const existing = Object.values(doc.inbox).find((item) => item.key === entry.key);
  if (existing) return existing;
  for (const [id, item] of Object.entries(doc.inbox)) {
    if (item.status === "handled" && Date.parse(item.handledAt || item.at) < now - KEPT_MS) delete doc.inbox[id];
  }
  const id = nextId(doc, "i");
  doc.inbox[id] = { id, at: new Date(now).toISOString(), ...entry };
  const all = Object.values(doc.inbox).sort((a, b) => a.at.localeCompare(b.at));
  for (const item of all.slice(0, Math.max(0, all.length - KEPT_MAX))) if (item.status === "handled") delete doc.inbox[item.id];
  return doc.inbox[id];
}

/** Entries newest first; `unhandled` only those still waiting. */
export const listInbox = (state, { unhandled = false } = {}) => Object.values(state?.inbox || {})
  .filter((item) => !unhandled || item.status === "unhandled")
  .sort((a, b) => b.at.localeCompare(a.at));

const LEVEL_LABEL = { fyi: "FYI", attention: "ATTENTION", urgent: "URGENT", failed: "FAILED" };
const ago = (at, now) => {
  const minutes = Math.max(0, Math.round((now - Date.parse(at)) / 60000));
  return minutes < 60 ? `${minutes} min ago` : minutes < 2880 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`;
};
const line = (item, now) => `- ${item.id} · ${LEVEL_LABEL[item.level] || item.level} · ${item.title}: ${item.headline || "(no text)"} (${item.kind}, ${ago(item.at, now)})`;

/** Whether it is the person's quiet hours, in the agent's time zone: `{ enabled, start, end }`, wrapping midnight. */
export function inQuietHours(settings, now = Date.now()) {
  const quiet = settings.quietHours;
  if (!quiet?.enabled) return false;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: settings.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  return quiet.start <= quiet.end ? time >= quiet.start && time < quiet.end : time >= quiet.start || time < quiet.end;
}

/**
 * What a heartbeat tick has to decide, or null when nothing: no model call (Block II's gated tick). It looks at the
 * inbox every tick but runs only for entries that came in since the last beat that saw it (`heartbeatSeenAt`): one
 * left unhandled is not decided again each tick; the home thread still shows it. It goes through HEARTBEAT.md once
 * its interval (`heartbeat.everyMinutes`) has passed since the last sweep. Neither in quiet hours.
 */
export async function heartbeatPlan(agent, state, now = Date.now()) {
  const settings = agent.settings();
  if (inQuietHours(settings, now)) return null;
  const waiting = listInbox(state, { unhandled: true });
  const seen = Date.parse(state?.heartbeatSeenAt || "") || 0;
  const fresh = waiting.filter((item) => Date.parse(item.at) > seen);
  const inbox = fresh.length;
  const due = now - (Date.parse(state?.heartbeatSweptAt || "") || 0) >= settings.heartbeat.everyMinutes * 60000;
  const guide = await heartbeatGuide(agent);
  const sweep = due && checklist(guide);
  return inbox || sweep ? { inbox, waiting: waiting.length, newest: fresh[0]?.at ?? null, sweep, timeZone: settings.timezone, guide,
    entries: fresh.slice(0, ENTRIES_IN_TASK).map(({ id, at, title, level, headline, body }) => ({ id, at, title, level, headline, body: body ? String(body).slice(0, ENTRY_BODY) : "" })) } : null;
}
/**
 * HEARTBEAT.md, the person's standing instructions to the heartbeat (what to look closer at, what to leave), without
 * its comments. Only its Checklist section makes a sweep: lines elsewhere are how to read, not things to check.
 */
export async function heartbeatGuide(agent) {
  const text = await fs.readFile(path.join(agent.folder, "HEARTBEAT.md"), "utf8").catch(() => "");
  return text.replace(/<!--[\s\S]*?-->/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000);
}
const checklist = (guide) => {
  const section = guide.split(/^## /m).find((part) => /^checklist\b/i.test(part)) || "";
  return section.split(/\r?\n/).some((row) => /^\s*(?:[-*+]|\d+[.)])\s+\S/.test(row));
};

/** What of the inbox a heartbeat's task carries, so its first call is not to read what the hub already holds. */
const ENTRIES_IN_TASK = 25;
const DIAL_WORDS = { quiet: "notify only what cannot wait", normal: "notify what they should see today", chatty: "notify anything worth knowing" };
const ENTRY_BODY = 1500;

const entryText = (entry, timeZone) => {
  const when = new Intl.DateTimeFormat("en-AU", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(entry.at));
  const body = entry.body && entry.body !== entry.headline ? `\n${entry.body.split("\n").map((row) => `    ${row}`).join("\n")}` : "";
  return `- [${entry.id}] ${when} · ${entry.title} · ${entry.level}: ${entry.headline}${body}`;
};

/**
 * A heartbeat run's task, for what its tick found. Its judgement is context, not what the person should hear: it reads
 * the new entries (here in the task), gathers what they leave unclear, and reports everything to jbot, which decides.
 */
export const heartbeatTask = ({ inbox, waiting = inbox, sweep, entries = [], timeZone, guide = "" }) => [
  guide ? `The person's instructions for you (HEARTBEAT.md):\n\n${guide}\n` : "",
  inbox ? `${inbox} new ${inbox === 1 ? "entry" : "entries"} came into your inbox since the last heartbeat (${waiting} unhandled in all)`
    + (entries.length ? `${entries.length < inbox ? `; the newest ${entries.length}` : ""}:\n\n${entries.map((entry) => entryText(entry, timeZone)).join("\n")}\n`
      : ": read them with inbox list.")
    + "\nYour judgement here is context, not what the person should hear: jbot decides that. For each entry decide whether "
    + "what it says is enough to understand it; where it is not and it might matter, gather what is missing from its source "
    + "(open the email, check the calendar or the chat). Then report to jbot: how many came in and from where, each entry "
    + "in a line or two of what it is (with what you found), and anything else you noticed. Mark them with inbox handle, "
    + "outcome \"Reported to jbot\"." : "",
  sweep ? "Your checklist is due: go through each item under Checklist and report what you found." : "",
  inbox ? "" : "When the checklist turns up nothing, call nothing_to_report."].filter(Boolean).join(" ");

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
  const inbox = defineTool({
    name: "inbox",
    description: "Your inbox: what your runs reported and has not been dealt with. list (unhandled; all:true for the week), "
      + "read (id: the run's whole report), handle (ids, outcome: what you did with them, in a few words).",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list"), Type.Literal("read"), Type.Literal("handle")]),
      id: Type.Optional(Type.String()),
      ids: Type.Optional(Type.Array(Type.String())),
      outcome: Type.Optional(Type.String()),
      all: Type.Optional(Type.Boolean()),
    }),
    replay: "safe",
    execute: async ({ action, id, ids, outcome, all }, api, context) => {
      const agent = runtime.agent;
      if (!agent?.enabled()) return result("The agent is not enabled.", true);
      const state = await api.snapshot(AgentDoc, context);
      if (action === "list") {
        const items = listInbox(state, { unhandled: !all });
        return result(items.map((item) => `${line(item, Date.now())}${item.status === "handled" ? ` [handled: ${item.outcome || "done"}]` : ""}`).join("\n")
          || (all ? "The inbox is empty." : "Nothing waits in the inbox."));
      }
      if (action === "read") {
        const item = id && state?.inbox?.[id];
        if (!item) return result("No such entry.", true);
        const answer = item.conversationId ? await runtime.lastAnswer(item.conversationId).catch(() => null) : null;
        return result(`${line(item, Date.now())}\n\n${answer || item.body || item.headline || "(The run left no text.)"}`);
      }
      const wanted = [...new Set([...(ids || []), ...(id ? [id] : [])])];
      if (!wanted.length || !outcome?.trim()) return result("ids and an outcome are required.", true);
      const done = await api.commit(async (tx) => {
        const doc = await tx.doc(AgentDoc);
        const marked = [];
        for (const key of wanted) {
          const item = doc.inbox?.[key];
          if (!item || item.status === "handled") continue;
          item.status = "handled";
          item.handledAt = new Date().toISOString();
          item.outcome = outcome.trim().slice(0, 200);
          item.handledBy = api.conversationId;
          marked.push(key);
        }
        return marked;
      }, context);
      return result(done.length ? `Handled ${done.join(", ")}.` : "Nothing to mark: those are handled or unknown.");
    },
  });
  // The home thread sees what waits, each turn, so a person who talks first is never told stale news.
  const waiting = section("agent-inbox", async (input) => {
    const agent = runtime.agent;
    if (!agent?.enabled()) return undefined;
    const state = await agent.state();
    if (state.home?.conversationId !== input.conversationId) return undefined;
    const items = listInbox(state, { unhandled: true });
    const now = Date.now();
    // Whether a report reaches the person's phone is jbot's call (`notify`), weighed against how often they want it.
    const dial = `How often the person wants to be interrupted: ${agent.settings().dial} (${DIAL_WORDS[agent.settings().dial] || DIAL_WORDS.normal}).`;
    if (!items.length) return dial;
    return [dial, `Unhandled in your inbox (${items.length}). Tell the person what matters when it fits, then mark it with inbox handle:`,
      ...items.slice(0, 12).map((item) => line(item, now)),
      ...(items.length > 12 ? [`… and ${items.length - 12} more (inbox list).`] : [])].join("\n");
  });
  // In a thread (the home thread above all), after a run's report: jbot decides whether the person hears it now.
  const notify = defineTool({
    name: "notify",
    description: "In a thread: send the person's phone and devices a notification of what you just wrote them, after a report "
      + "they should see now. A title and one line. It ends your turn, so call it last. Not for replies to their own messages.",
    parameters: Type.Object({
      title: Type.String({ description: "A few words: what it is about." }),
      text: Type.String({ description: "One line, as the lock screen shows it." }),
      urgent: Type.Optional(Type.Boolean({ description: "Only for what cannot wait." })),
    }),
    replay: "unsafe",
    execute: async ({ title, text, urgent }, api, context) => {
      if (await runOnly(api)) return result("A run does not notify: report, and jbot decides.", true);
      const key = await api.memo("notify", `note-${api.conversationId}-${Date.now()}`, context);
      runtime.notify?.({ kind: "report", conversationId: api.conversationId, title, text, level: urgent ? "urgent" : "attention", key });
      // The report is written before it; another model call after it only ever produced an empty message.
      return { ...result("Sent to their devices."), control: { terminate: true } };
    },
  });
  const stay = defineTool({
    name: "stay_quiet",
    description: "In a thread, after a run's report: the person need not hear it now. Ends your turn without a message; "
      + "what the report held stays in your context and its line in the thread.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async (_args, api) => {
      if (await runOnly(api)) return result("Only a thread stays quiet; a run calls nothing_to_report.", true);
      return { ...result("Quiet."), control: { terminate: true } };
    },
  });
  return { tools: [quiet, failed, inbox, notify, stay], sections: [waiting] };
}
