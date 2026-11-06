import path from "node:path";
import { runSource, SEEN_KEPT } from "./feeds.js";
import { INVISIBLE, readMail } from "./mail-pipeline.js";

/*
 * The `email` task: the person's new Gmail, for a routine (the heartbeat's first task). An Executor program lists the
 * inbox and fetches each message it has not seen whole, as its raw RFC 822 bytes still base64url-encoded (Executor's
 * sandbox decodes slowly); the hub decodes them and reads each through the mail pipeline (mail-pipeline.js), so the
 * mail lands in jbot's folder as mail/<date>/<id>/message.md beside its original. What the routine's run is given is an
 * index: one line per email with a gist and the path to its message.md, for the run to open what needs a closer look.
 *
 * In a routine's front matter: `- { id: email, kind: email }`, optionally `query` (Gmail search, default the inbox of
 * the last two days without promotions or social) and `max` (messages fetched a firing, default 25). Like any stream
 * task, its first firing only learns what is there.
 */
export const DEFAULT_QUERY = "in:inbox newer_than:2d -category:promotions -category:social";
const MAX = 25;
/** A message bigger than this is not fetched whole: its headers and snippet, and a link to open it in Gmail. */
const RAW_MAX = 8 * 1024 * 1024;

/** The program: every Gmail account connected in Executor; `seen` (the ids already gathered) is handed in by the hub. */
export const gmailProgram = ({ query = DEFAULT_QUERY, max = MAX } = {}) => `
const found = await tools.search({ query: "gmail users messages list", limit: 10 });
const lister = (found.items ?? []).find((item) => item.path === "tools.gmail.api.users.gmailUsersMessagesList");
const accounts = [...new Set(String(lister?.input ?? "").split('"').filter((part) => part.startsWith("acc_")))];
if (!accounts.length) throw new Error("No Gmail account is connected in Executor: connect one there, then this runs.");
const one = accounts.length === 1;
const listed = await Promise.all(accounts.map(async (accountId) => {
  const list = await tools.gmail.api.users.gmailUsersMessagesList({ accountId, input: { path: { userId: "me" },
    query: { q: ${JSON.stringify(query)}, maxResults: 50 } } });
  return (list.messages ?? []).map((message) => ({ accountId, id: one ? message.id : accountId + ":" + message.id, gmailId: message.id }));
}));
const fresh = listed.flat().filter((message) => !seen.has(message.id)).slice(0, ${Number(max) || MAX});
const get = (message, format) => tools.gmail.api.users.gmailUsersMessagesGet({ accountId: message.accountId,
  input: { path: { userId: "me", id: message.gmailId }, query: { format } } });
const sized = await Promise.all(fresh.map((message) => get(message, "minimal").then((small) => ({ message, small }))));
return Promise.all(sized.map(async ({ message, small }) => {
  const item = { id: message.id, gmailId: message.gmailId, account: one ? null : message.accountId, thread: small.threadId,
    labels: small.labelIds ?? [], at: new Date(Number(small.internalDate)).toISOString(), snippet: small.snippet ?? "" };
  if ((small.sizeEstimate ?? 0) > ${RAW_MAX}) {
    const head = await get(message, "metadata");
    const header = (name) => head.payload?.headers?.find((entry) => entry.name === name)?.value ?? "";
    return { ...item, large: true, subject: header("Subject"), from: header("From"), size: small.sizeEstimate };
  }
  const whole = await get(message, "raw");
  return { ...item, raw: whole.raw };
}));`;

/** Gmail's labels a reader cares about, as words: its categories, important, starred, unread. */
const labelWords = (ids) => ids.filter((label) => /^CATEGORY_|^IMPORTANT$|^STARRED$|^UNREAD$/.test(label))
  .map((label) => label.replace(/^CATEGORY_/, "").toLowerCase()).filter((label) => label !== "personal");
const linkOf = (item) => `https://mail.google.com/mail/u/0/#all/${item.gmailId}`;
const sender = (from) => String(from || "").replace(/\s*<.*>$/, "").replace(/^"|"$/g, "") || String(from || "");
/** Gmail's snippet is HTML-escaped (`&amp;`, `&#39;`), and padded with invisible characters after a preheader. */
const unescape = (text) => String(text || "").replace(/&(amp|lt|gt|quot|#39|#(\d+));/g, (_, name, code) =>
  code ? String.fromCodePoint(Number(code)) : { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" }[name]).replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
const when = (at, zone) => new Intl.DateTimeFormat("en-AU", { timeZone: zone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(at));

/**
 * One firing: `{ fresh, cursor, items, sources, block }` as routines.js's tasks give it; `sources` the message.md
 * files the run's report should point back to.
 */
export async function mailTask(agent, task, cursor, { block, now = Date.now() } = {}) {
  const zone = agent.settings().timezone;
  const outcome = await runSource(agent, { kind: "executor", code: gmailProgram(task) }, { seen: cursor.seen || [], raw: true });
  if (outcome.error) return { fresh: 0, cursor, items: [], error: outcome.error, block: block(task.id, { error: "yes" }, outcome.error) };
  const got = outcome.items.filter((item) => item && typeof item.id === "string");
  const next = { primed: true, seen: [...new Set([...got.map((item) => item.id), ...(cursor.seen || [])])].slice(0, SEEN_KEPT) };
  // The first firing learns what is there; the inbox the person already has is not news.
  if (!cursor.primed) return { fresh: 0, cursor: next, items: [], sources: [], block: block(task.id, { new: 0 }, "Nothing new (first look: what is there now is known).") };
  const lines = [];
  const sources = [];
  for (const item of got.sort((a, b) => String(b.at).localeCompare(String(a.at)))) {
    const labels = labelWords(item.labels || []);
    const meta = { labels, link: linkOf(item), thread: item.thread, ...(item.account ? { account: item.account } : {}) };
    if (item.large || typeof item.raw !== "string") {
      lines.push(`- ${sender(item.from)} — ${item.subject || "(no subject)"}${labels.length ? ` · ${labels.join(", ")}` : ""} · ${when(item.at, zone)}`
        + `\n  ${unescape(item.snippet)}\n  Too large to fetch whole (${Math.round((item.size || 0) / 1048576)} MB): ${meta.link}`);
      continue;
    }
    try {
      const mail = await readMail(Buffer.from(item.raw, "base64url"), { folder: agent.folder, meta });
      const file = path.join(mail.dir, "message.md");
      const files = mail.attachments.length ? ` · ${mail.attachments.length} attachment${mail.attachments.length === 1 ? "" : "s"}` : "";
      lines.push(`- ${sender(mail.header.from)} — ${mail.header.subject}${labels.length ? ` · ${labels.join(", ")}` : ""} · ${when(mail.at, zone)}`
        // Gmail's snippet first: the line the sender wrote to be seen first (a marketing email's preheader), from the
        // text it shows; the pipeline's gist when there is none.
        + `${unescape(item.snippet) || mail.gist ? `\n  ${unescape(item.snippet) || mail.gist}` : ""}\n  ${file}${files}`);
      sources.push({ path: file, title: `${sender(mail.header.from)}: ${mail.header.subject}` });
    } catch (error) {
      lines.push(`- (an email that could not be read: ${error.message}) ${meta.link}`);
    }
  }
  return { fresh: lines.length, cursor: next, items: [], sources,
    block: block(task.id, { new: lines.length, at: when(now, zone) }, lines.join("\n") || "Nothing new.") };
}
