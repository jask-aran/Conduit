import { compile } from "html-to-text";
import { defineTool } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { Type } from "@earendil-works/pi-ai";
import { createHash } from "node:crypto";
import { AgentDoc, nextId } from "./agent-doc.js";
import { appendEntry } from "./inbox.js";
import { isReadAction, programPaths } from "./policy.js";
import { sandboxHelper, sandboxedEnv } from "./sandbox.js";

/*
 * Feeds (docs/plans/persistent-agent.md, Vision): sources that fill the inbox, mostly without a model. A feed is a
 * schedule item (schedule.js) with a `feed`, so its clock, its next time and its cancelling are a schedule's:
 *
 *   feed: { source, level, seen, primed, lastRunAt, lastCount, lastError }
 *   source: { kind: "executor", code }   a read-only Executor program, run by the hub (the person's accounts)
 *         | { kind: "script", command }  bash in jbot's sandboxed folder
 *         | { kind: "run", task }        a model run, for what needs judgement; it reports as a run does
 *
 * An executor program or a script prints (returns) JSON: an array of items, or `{ items }`, each
 * `{ id, title, detail?, text?, encoded?, at?, level?, url? }`: `detail` one line (a sender), `text` the content itself
 * (a mail's body, cut short), so whoever reads the inbox decides without going back to the source. A program may hand
 * the content over still encoded instead, `encoded: { data, mimeType }` (base64 or base64url, as Gmail gives a part):
 * the hub decodes it and turns HTML into text, which in Executor's sandbox took a minute for one large mail. The hub keeps the ids it has seen (the last 500) and puts what is new
 * into one inbox entry per tick; the first run only learns what is already there. An executor program is handed those
 * ids as `seen` (a Set), so it can skip fetching the details of what was already reported. jbot adds a feed through the
 * `feed` tool, which asks the person (policy.js): it runs on its own from then on, so a program may only read.
 */
const MAX_ITEMS = 100;
export const SEEN_KEPT = 500;
const LEVELS = ["fyi", "attention", "urgent"];
const EVERY = { min: 15, max: 1440 };

/** Why a source cannot be a feed, or null. */
export function sourceProblem(source) {
  if (!source || typeof source !== "object") return "A source is required: { kind: executor, code } | { kind: script, command } | { kind: run, task }.";
  if (source.kind === "executor") {
    if (typeof source.code !== "string" || !source.code.trim() || source.code.length > 8000) return "An Executor program of up to 8,000 characters is required.";
    const paths = programPaths(source.code);
    if (!paths) return "The program must call its tools by literal path (tools.app.action(...)), so what it does can be read before it runs.";
    const writes = paths.filter((path) => !isReadAction(path));
    if (writes.length) return `A feed only reads; the program also calls ${writes.join(", ")}.`;
    return null;
  }
  if (source.kind === "script") return typeof source.command === "string" && source.command.trim() && source.command.length <= 4000 ? null : "A command of up to 4,000 characters is required.";
  if (source.kind === "run") return typeof source.task === "string" && source.task.trim() ? null : "A task is required.";
  return "The source kind is executor, script or run.";
}

const TEXT_MAX = 2500;
const BODY_MAX = 30_000;
/** Content kept as paragraphs: runs of blank lines and spaces folded, cut short. */
const prose = (value, max) => { const kept = String(value ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim(); return kept.length > max ? `${kept.slice(0, max - 1)}…` : kept; };
/** Links nobody opens a mail for. */
const SKIP_LINK = /unsubscribe|preferences|privacy|terms|view (it )?(online|in (your )?browser)|view image|contact us|help cent|manage (your )?(email|subscription)|^https?:/i;
const LINKS_MAX = 8;
const altOf = (elem) => elem.attribs?.alt || (elem.children || []).map(altOf).find(Boolean) || "";
/** An anchor as its words and a numbered reference, its address kept in the item's links (the text stays short). */
function emailAnchor(elem, walk, builder) {
  const href = String(elem.attribs?.href || "").trim();
  let words = "";
  builder.pushWordTransform((word) => { if (word) words += `${words ? " " : ""}${word}`; return word; });
  walk(elem.children, builder);
  builder.popWordTransform();
  const label = (words || altOf(elem)).replace(/\s+/g, " ").trim();
  if (!/^https?:\/\//i.test(href) || !label || SKIP_LINK.test(label)) return;
  const links = builder.metadata.links;
  let number = links.findIndex((link) => link.url === href) + 1;
  if (!number && links.length < LINKS_MAX) number = links.push({ label: label.slice(0, 60), url: href.slice(0, 600) });
  if (!number) return;
  if (!words) builder.addInline(label);
  builder.addInline(` [${number}]`, { noWordTransform: true });
}
const toText = compile({
  wordwrap: false,
  limits: { maxInputLength: 400_000 },
  formatters: { emailAnchor },
  selectors: [
    { selector: "a", format: "emailAnchor" },
    { selector: "img", format: "skip" },
    // A mail's preheader: hidden text for the inbox preview, repeated or padded with invisible characters.
    { selector: "[style*='display:none']", format: "skip" },
    { selector: "[style*='display: none']", format: "skip" },
    ...["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({ selector, options: { uppercase: false } })),
    { selector: "table", options: { uppercaseHeaderCells: false } },
  ],
});

/**
 * An encoded mail part as `{ text, links }`: decoded (base64url); HTML through html-to-text, its links numbered in the
 * text and kept in `links`; a plain part's addresses taken out the same way. Quoted replies and a signature are cut.
 */
export function decodeContent(encoded) {
  if (!encoded || typeof encoded.data !== "string") return { text: "", links: [] };
  const raw = Buffer.from(encoded.data.slice(0, 400_000), "base64url").toString("utf8");
  const links = [];
  let body;
  if (/html/i.test(encoded.mimeType || "") || /<\/?(?:p|div|br|table|a|span)\b/i.test(raw)) body = toText(raw, { links });
  else body = raw.replace(/<?(https?:\/\/[^\s<>]+)>?/g, (url, bare) => {
    if (links.length >= LINKS_MAX) return "";
    return ` [${links.push({ label: "Link", url: bare.slice(0, 600) })}]`;
  });
  const text = body.replace(/[\u034F\u00AD\u200B-\u200F\u2060\uFEFF]/g, "").replace(/\r/g, "")
    .replace(/\n>.*$/gs, "").replace(/\n-- \n[\s\S]*$/, "").replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n");
  return { text, links };
}

const text = (value, max) => { const flat = String(value ?? "").replace(/\s+/g, " ").trim(); return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat; };

/** JSON items out of a program's or script's output: an array, `{ items }`, or Executor's `{ result }` around either. */
export function itemsOf(output) {
  let value = output;
  if (typeof value === "string") {
    const trimmed = value.trim();
    try { value = JSON.parse(trimmed); }
    catch {
      const start = trimmed.search(/[[{]/);
      if (start < 0) throw new Error("The feed printed no JSON.");
      value = JSON.parse(trimmed.slice(start));
    }
  }
  const parsed = value;
  for (let depth = 0; depth < 4 && value && !Array.isArray(value); depth++) {
    // Executor's execute answers { status, execution: { ok, value | error } }.
    if (value.execution?.ok === false || (value.status && !["completed", "ok", "success"].includes(value.status) && !value.execution)) {
      throw new Error(`The program did not complete: ${JSON.stringify(value.execution?.error ?? value).slice(0, 300)}`);
    }
    value = value.items ?? value.execution ?? value.result ?? value.value ?? value.output ?? null;
    if (typeof value === "string") return itemsOf(value);
  }
  if (!Array.isArray(value)) throw new Error(`The feed's JSON has no list of items: ${JSON.stringify(parsed).slice(0, 400)}`);
  return value.slice(0, MAX_ITEMS).map((item) => {
    const raw = item && typeof item === "object" ? item : { title: item };
    const title = text(raw.title ?? raw.subject ?? raw.name ?? raw.summary ?? "", 160);
    const detail = text(raw.detail ?? raw.from ?? raw.snippet ?? raw.description ?? "", 200);
    const id = text(raw.id ?? raw.key ?? raw.url ?? "", 200) || createHash("sha256").update(`${title}\n${detail}`).digest("hex").slice(0, 24);
    const decoded = raw.encoded ? decodeContent(raw.encoded) : null;
    const body = prose(decoded?.text || (raw.text ?? raw.body ?? raw.content ?? ""), TEXT_MAX);
    const links = decoded ? decoded.links : Array.isArray(raw.links) ? raw.links.filter((link) => link?.url).slice(0, LINKS_MAX).map((link) => ({ label: text(link.label || "Link", 60), url: text(link.url, 600) })) : [];
    return { id, title, ...(detail ? { detail } : {}), ...(body ? { text: body } : {}), ...(links.length ? { links } : {}), ...(raw.at ? { at: text(raw.at, 40) } : {}), ...(raw.url ? { url: text(raw.url, 300) } : {}),
      ...(LEVELS.includes(raw.level) ? { level: raw.level } : {}) };
  });
}

/** Run a feed's source once: `{ items }` or `{ items: [], error }`. Never throws. */
export async function runSource(agent, source, { signal, seen = [] } = {}) {
  try {
    if (source.kind === "executor") {
      // A check that fires as the hub starts found Executor still connecting, and failed until the next one.
      await agent.connectors.ready("executor");
      const tool = agent.connectors.tools().find((item) => item.name === "mcp__executor__execute");
      if (!tool) return { items: [], error: "Executor is not connected." };
      const code = `const seen = new Set(${JSON.stringify(seen)});\n${source.code}`;
      const result = await tool.execute({ code }, { signal: signal || AbortSignal.timeout(90_000) });
      const output = (result.output || []).filter((part) => part.type === "text").map((part) => part.text).join("");
      if (result.isError) return { items: [], error: text(output || "The program failed.", 300) };
      return { items: itemsOf(output) };
    }
    if (source.kind === "script") {
      const env = sandboxedEnv(new NodeExecutionEnv({ cwd: agent.folder, shellEnv: agent.runtime.shellEnv }), {
        folder: agent.folder, dataRoot: agent.runtime.dataRoot, shellEnv: agent.runtime.shellEnv, helper: () => sandboxHelper(agent.runtime.dataRoot) });
      let stdout = "";
      let stderr = "";
      const ran = await env.exec(source.command, { timeout: 60, onOutput: (chunk, _context, info) => {
        if (info.stream === "stdout") { if (stdout.length < 1_000_000) stdout += chunk; } else if (stderr.length < 4000) stderr += chunk;
      } }, agent.context);
      if (!ran.ok) return { items: [], error: text(ran.error?.message || "The script could not run.", 300) };
      if (ran.value.exitCode !== 0) return { items: [], error: text(`Exit ${ran.value.exitCode}: ${stderr || stdout}`, 300) };
      return { items: itemsOf(stdout) };
    }
    return { items: [], error: "A run feed has no output to read." };
  } catch (error) { return { items: [], error: text(error?.message || "The feed failed.", 300) }; }
}

/**
 * Take one tick's outcome into the feed, in the clock's commit: remember what it saw, and put what is new into the
 * inbox as one entry. The first good tick only learns what is there.
 */
export function applyOutcome(doc, schedule, outcome, slot) {
  const feed = schedule.feed;
  const seen = new Set(feed.seen || []);
  const fresh = outcome.items.filter((item) => !seen.has(item.id));
  feed.lastRunAt = slot;
  feed.lastError = outcome.error || null;
  if (outcome.error) return;
  feed.seen = [...new Set([...outcome.items.map((item) => item.id), ...(feed.seen || [])])].slice(0, SEEN_KEPT);
  feed.lastCount = feed.primed ? fresh.length : 0;
  if (feed.primed && fresh.length) fileItems(doc, { key: `${schedule.id}:${slot}`, title: schedule.title, feedId: schedule.id, level: feed.level }, fresh, slot);
  feed.primed = true;
}

/** One item as the inbox and a run's task block show it: what it is, when, where, its links, then its text. */
export const itemText = (item) => `- ${item.title || "(untitled)"}${item.detail ? ` — ${item.detail}` : ""}${item.at ? ` (${item.at})` : ""}`
  + `${item.url ? ` ${item.url}` : ""}${item.links?.length ? `\n  Links: ${item.links.map((link, index) => `[${index + 1}] ${link.label} <${link.url}>`).join(" · ")}` : ""}`
  + `${item.text ? `\n${item.text.replace(/^/gm, "  ")}` : ""}`;

/** New items into the inbox as one entry (a feed's tick, a routine whose output is the inbox). */
export function fileItems(doc, { key, title, feedId = null, level = "fyi" }, fresh, slot) {
  const top = fresh.reduce((best, item) => LEVELS.indexOf(item.level) > LEVELS.indexOf(best) ? item.level : best, LEVELS.includes(level) ? level : "fyi");
  const line = (item) => `${item.title || "(untitled)"}${item.detail ? ` — ${item.detail}` : ""}`;
  appendEntry(doc, { key, kind: "feed", title, feedId, subagentId: null, conversationId: null, level: top, status: "unhandled",
    headline: text(fresh.length === 1 ? line(fresh[0]) : `${fresh.length} new: ${fresh.map((item) => item.title || "(untitled)").join("; ")}`, 160),
    body: fresh.map(itemText).join("\n\n").slice(0, BODY_MAX) }, Date.parse(slot));
}

/** A feed's schedule item, ready for `addClocked` (schedule.js). */
export function feedItem(doc, { title, everyMinutes, source, level }, by = null) {
  return { id: nextId(doc, "f"), kind: "every", at: null, everyMinutes, title: text(title, 80), task: null, by,
    feed: { source, level: LEVELS.includes(level) ? level : "fyi", seen: [], primed: false, lastRunAt: null, lastCount: 0, lastError: null } };
}

/** Why a feed cannot be added, or null. */
export function feedProblem({ title, everyMinutes, source }) {
  if (typeof title !== "string" || !title.trim()) return "A title is required.";
  if (!Number.isInteger(everyMinutes) || everyMinutes < EVERY.min || everyMinutes > EVERY.max) return `everyMinutes is a whole number from ${EVERY.min} to ${EVERY.max}.`;
  return sourceProblem(source);
}

const result = (value, isError = false) => ({ output: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) });
const preview = ({ items, error }) => error ? `Failed: ${error}`
  : `${items.length} item${items.length === 1 ? "" : "s"}${items.length ? ":\n" : "."}${items.slice(0, 10).map((item) => `- [${item.id}] ${item.title}${item.detail ? ` — ${item.detail}` : ""}`).join("\n")}`;

export function FeedTools(runtime, { addClocked }) {
  const feed = defineTool({
    name: "feed",
    description: "Feeds fill your inbox on their own, mostly without a model: list them, test a source (runs it once, saves "
      + "nothing), or add one (the person approves it). A source is { kind: \"executor\", code } (a read-only Executor "
      + "program that returns a JSON list of { id, title, detail?, text?, encoded?, at?, level?, url? }; put the content itself in text, or a mail part still encoded as encoded: { data, mimeType } for the hub to decode (decoding in the program is slow), so the heartbeat need not fetch it again), { kind: \"script\", command } "
      + "(bash in your folder that prints that JSON) or { kind: \"run\", task } (a model run every time, for judgement). "
      + "The first run learns what is there; later runs put only new items in the inbox. Remove one with schedule cancel and its id.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list"), Type.Literal("test"), Type.Literal("add")]),
      title: Type.Optional(Type.String()),
      everyMinutes: Type.Optional(Type.Number()),
      source: Type.Optional(Type.Object({
        kind: Type.Union([Type.Literal("executor"), Type.Literal("script"), Type.Literal("run")]),
        code: Type.Optional(Type.String()), command: Type.Optional(Type.String()), task: Type.Optional(Type.String()),
      })),
      level: Type.Optional(Type.Union(LEVELS.map((value) => Type.Literal(value)))),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
      const agent = runtime.agent;
      if (!agent?.enabled()) return result("The agent is not enabled.", true);
      if (args.action === "list") {
        const feeds = Object.values((await api.snapshot(AgentDoc, context))?.schedules || {}).filter((item) => item.feed);
        return result(feeds.map((item) => `${item.id}: ${item.title} — every ${item.everyMinutes} min, ${item.feed.source.kind}`
          + `${item.feed.lastError ? `; last failed: ${item.feed.lastError}` : item.feed.lastRunAt ? `; last ${item.feed.lastCount} new` : "; not run yet"}`).join("\n") || "No feeds.");
      }
      const problem = args.action === "test" ? sourceProblem(args.source) : feedProblem(args);
      if (problem) return result(problem, true);
      if (args.action === "test") {
        if (args.source.kind === "run") return result("A run feed has nothing to test: its task runs as a run.");
        return result(preview(await runSource(agent, args.source, { signal: api.signal })));
      }
      const home = (await agent.state()).home;
      if (!home?.conversationId) return result("The agent's home conversation is unavailable.", true);
      const added = await api.memo("added", context) ?? await api.memo("added", await api.commit(async (tx) => {
        const doc = await tx.doc(AgentDoc);
        const existing = Object.values(doc.schedules).find((item) => item.feed && item.callId === api.callId);
        if (existing) return existing.id;
        const item = { ...feedItem(doc, args, api.conversationId), callId: api.callId };
        await addClocked(tx, doc, item, home.conversationId);
        return item.id;
      }, context), context);
      return result(`Added feed ${added}: ${args.title.trim()}, every ${args.everyMinutes} min. Its first run learns what is there.`);
    },
  });
  return { tools: [feed] };
}
