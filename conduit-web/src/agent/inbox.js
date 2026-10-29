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
  const sweep = due && (await fs.readFile(path.join(agent.folder, "HEARTBEAT.md"), "utf8").catch(() => ""))
    .replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/).some((row) => /^\s*(?:[-*+]|\d+[.)])\s+\S/.test(row));
  return inbox || sweep ? { inbox, waiting: waiting.length, newest: fresh[0]?.at ?? null, sweep } : null;
}

/** A heartbeat run's task, for what its tick found. */
export const heartbeatTask = ({ inbox, waiting = inbox, sweep }) => ["Heartbeat.",
  inbox ? `${inbox} new ${inbox === 1 ? "entry" : "entries"} in your inbox (${waiting} unhandled in all): read them (inbox list; inbox read for a `
    + "whole report). For each decide: nothing to do, act (a check-back with schedule, a chat to start), or tell the person; "
    + "then mark it with inbox handle and what you did." : "",
  sweep ? "Go through HEARTBEAT.md in your folder and check each item." : "",
  "When nothing needs the person, call nothing_to_report; otherwise report only what needs them."].filter(Boolean).join(" ");

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
        return result(`${line(item, Date.now())}\n\n${answer || item.headline || "(The run left no text.)"}`);
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
    if (!items.length) return undefined;
    const now = Date.now();
    return [`Unhandled in your inbox (${items.length}). Tell the person what matters when it fits, then mark it with inbox handle:`,
      ...items.slice(0, 12).map((item) => line(item, now)),
      ...(items.length > 12 ? [`… and ${items.length - 12} more (inbox list).`] : [])].join("\n");
  });
  return { tools: [quiet, failed, inbox], sections: [waiting] };
}
