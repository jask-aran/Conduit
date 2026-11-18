import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { splitQuoted } from "../email-quote.js";
import { BUILT_IN, CATEGORIES as SORTS, categoryId, conditionFault, factsOf, sortOf } from "./sorting.js";

/*
 * The hub's copy of mail (mail.d.ts MailStore). Each thread's roll-up is rewritten whenever one of its messages or
 * drafts is, so a list page is one indexed read and never a GROUP BY over messages.
 */
const SNIPPET = 200;
const TEXT_MAX = 100_000;
const CHUNK = 500;
const ROLES = ["inbox", "category", "sort", "starred", "important", "sent", "drafts"];
// A source's own sorting of the inbox (Gmail's tabs), in the order it shows them; a label's id is `category-<name>`.
const CATEGORIES = ["primary", "promotions", "social", "updates", "forums"];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  account TEXT NOT NULL, key TEXT NOT NULL, thread TEXT NOT NULL, seq INTEGER,
  message_id TEXT NOT NULL, in_reply_to TEXT, refs TEXT NOT NULL,
  sender TEXT NOT NULL, recipients TEXT NOT NULL, reply_to TEXT NOT NULL,
  subject TEXT NOT NULL, date INTEGER NOT NULL, size INTEGER NOT NULL,
  unread INTEGER NOT NULL, draft INTEGER NOT NULL, labels TEXT NOT NULL, attachments INTEGER NOT NULL,
  snippet TEXT NOT NULL, held INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account, key));
CREATE INDEX IF NOT EXISTS messages_thread ON messages (account, thread, date);
CREATE INDEX IF NOT EXISTS messages_seq ON messages (account, seq);
CREATE INDEX IF NOT EXISTS messages_date ON messages (account, held, date);
CREATE INDEX IF NOT EXISTS messages_age ON messages (account, date);
CREATE INDEX IF NOT EXISTS messages_id ON messages (account, message_id);
CREATE TABLE IF NOT EXISTS threads (
  account TEXT NOT NULL, thread TEXT NOT NULL, subject TEXT NOT NULL, date INTEGER NOT NULL,
  parties TEXT NOT NULL, snippet TEXT NOT NULL, count INTEGER NOT NULL, unread INTEGER NOT NULL, labels TEXT NOT NULL,
  starred INTEGER NOT NULL, attachments INTEGER NOT NULL, draft INTEGER NOT NULL,
  PRIMARY KEY (account, thread));
CREATE INDEX IF NOT EXISTS threads_date ON threads (account, date, thread);
CREATE INDEX IF NOT EXISTS threads_unread ON threads (account, date, thread) WHERE unread > 0;
CREATE INDEX IF NOT EXISTS threads_attachments ON threads (account, date, thread) WHERE attachments = 1;
CREATE TABLE IF NOT EXISTS thread_labels (
  account TEXT NOT NULL, label TEXT NOT NULL, thread TEXT NOT NULL, date INTEGER NOT NULL, unread INTEGER NOT NULL,
  PRIMARY KEY (account, label, thread));
CREATE INDEX IF NOT EXISTS thread_labels_date ON thread_labels (account, label, date, thread);
CREATE TABLE IF NOT EXISTS labels (account TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, role TEXT, PRIMARY KEY (account, id));
CREATE TABLE IF NOT EXISTS rules (account TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY (account, id));
CREATE TABLE IF NOT EXISTS cursors (account TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (account, name));
CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, account TEXT NOT NULL, thread TEXT, message_id TEXT NOT NULL, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS drafts_account ON drafts (account, message_id);
CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5 (subject, sender, recipients, body, tokenize = "unicode61 remove_diacritics 2");
`;

const json = (text) => JSON.parse(text);
const hubId = (account, key) => `${account}.${key}`;
const splitId = (id) => {
  const at = String(id).indexOf(".");
  return at > 0 ? { account: id.slice(0, at), key: id.slice(at + 1) } : null;
};
const iso = (ms) => new Date(ms).toISOString();
// The invisible characters a sender pads its preview line with (and a joiner that joins no picture), which a list would show as a gap.
const PADDING = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b\u200c\u200e\u200f\u2007\u202a-\u202e\u2060-\u2064\u206a-\u206f\u3164\ufeff\uffa0]|\u200d(?!\p{Extended_Pictographic})/gu;
const unpadded = (text) => text.replace(PADDING, "").replace(/\s+/g, " ").trim();
const snippetOf = (text) => {
  const plain = unpadded(splitQuoted(text).own);
  return plain.length > SNIPPET ? `${plain.slice(0, SNIPPET - 1)}…` : plain;
};
const sameList = (a, b) => a.length === b.length && a.every((item) => b.includes(item));
const partyText = (parties) => parties.map((party) => `${party.name} ${party.address}`).join(" ");
const chunks = (list) => Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, index) => list.slice(index * CHUNK, (index + 1) * CHUNK));
const marks = (list) => list.map(() => "?").join(",");
const DAY = 86_400_000;

/** Where a reach (MailSync's `since` or `bodies`) starts, in ms: the UTC midnight that many days back; null for "all". */
export const reachStart = (reach, now = Date.now()) => reach === "all" ? null : Math.floor((now - reach * DAY) / DAY) * DAY;

export function openMailStore({ dir }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const db = new DatabaseSync(path.join(dir, "mail.db"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;");
  db.exec(SCHEMA);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('messages') WHERE name = 'category'").get()) db.exec("ALTER TABLE messages ADD COLUMN category TEXT");
  // A subject match outranks a sender's, which outranks the body's; `rank` is the one place bm25 can be read in a GROUP BY.
  db.exec("INSERT INTO search (search, rank) VALUES ('rank', 'bm25(8, 4, 2, 1)')");
  const rawDir = (account) => path.join(dir, "raw", account);
  // A source's key may hold anything; the shard spreads numeric keys that would all start alike.
  const rawFile = (account, key) => {
    const name = String(key).replace(/[^\w.-]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
    return path.join(rawDir(account), crypto.createHash("sha1").update(String(key)).digest("hex").slice(0, 2), `${name}.eml`);
  };

  const cache = new Map();
  const q = (sql) => {
    let statement = cache.get(sql);
    if (!statement) cache.set(sql, statement = db.prepare(sql));
    return statement;
  };
  let depth = 0;
  const tx = (fn) => {
    if (depth) return fn();
    db.exec("BEGIN IMMEDIATE");
    depth++;
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally { depth--; }
  };

  const toThread = (row) => ({
    id: hubId(row.account, row.thread), account: row.account, subject: row.subject, from: json(row.parties),
    date: iso(row.date), snippet: unpadded(row.snippet), count: row.count, unread: row.unread, labels: json(row.labels),
    starred: Boolean(row.starred), attachments: Boolean(row.attachments), draft: Boolean(row.draft),
  });
  const toMessage = (row) => {
    const recipients = json(row.recipients);
    return {
      id: hubId(row.account, row.key), thread: hubId(row.account, row.thread), account: row.account,
      from: json(row.sender), to: recipients.to, cc: recipients.cc, bcc: recipients.bcc,
      subject: row.subject, date: iso(row.date), snippet: unpadded(row.snippet),
      unread: Boolean(row.unread), starred: json(row.labels).includes("starred"), draft: Boolean(row.draft), labels: json(row.labels),
      attachments: Boolean(row.attachments), held: Boolean(row.held),
    };
  };

  // What sorting needs of each account (setSorting): its address, its rules in the order tried, and who the person has written to.
  const sorting = new Map();
  const rulesOf = (account) => {
    const saved = q("SELECT value FROM rules WHERE account = ? ORDER BY position, id").all(account).map((row) => json(row.value));
    const off = new Set(saved.filter((rule) => rule.by === "conduit" && rule.on === false).map((rule) => rule.id));
    return [...saved.filter((rule) => rule.by !== "conduit"), ...BUILT_IN.map((rule) => off.has(rule.id) ? { ...rule, on: false } : rule)];
  };
  const writtenTo = (account, own) => {
    const known = new Set();
    for (const row of q("SELECT recipients FROM messages WHERE account = ? AND draft = 0 AND lower(json_extract(sender, '$.address')) = ?").iterate(account, own)) {
      const all = json(row.recipients);
      for (const party of [...all.to, ...all.cc, ...all.bcc]) known.add(party.address.toLowerCase());
    }
    return known;
  };
  function sortThread(account, row) {
    const state = sorting.get(account);
    if (!state || row.draft) return null;
    state.known ??= writtenTo(account, state.own);
    const recipients = json(row.recipients), from = json(row.sender);
    if (from.address.toLowerCase() === state.own) for (const party of [...recipients.to, ...recipients.cc, ...recipients.bcc]) state.known.add(party.address.toLowerCase());
    const message = { from, to: recipients.to, cc: recipients.cc, subject: row.subject, date: row.date, labels: json(row.labels), category: row.category, attachments: Boolean(row.attachments),
      text: q("SELECT body FROM search WHERE rowid = ?").get(row.rid)?.body || row.snippet };
    return sortOf(state.rules, message, factsOf(message, { own: state.own, wroteTo: (address) => state.known.has(address) })).category;
  }

  // The categories each account keeps as tabs (MailSync's `tabs`, the first always among them); none said, all are.
  const tabsOf = new Map();
  // A message the hub has a draft for (same Message-ID) is the source's copy of it: the draft stands in its place.
  const HIDDEN = "(message_id <> '' AND message_id IN (SELECT message_id FROM drafts WHERE drafts.account = messages.account))";
  function rollup(account, thread) {
    const all = q(`SELECT rowid AS rid, *, ${HIDDEN} AS hidden FROM messages WHERE account = ? AND thread = ? ORDER BY date, key`).all(account, thread);
    const hubDrafts = q("SELECT count(*) AS n FROM drafts WHERE account = ? AND thread = ?").get(account, hubId(account, thread)).n;
    q("DELETE FROM thread_labels WHERE account = ? AND thread = ?").run(account, thread);
    if (!all.length) {
      q("DELETE FROM threads WHERE account = ? AND thread = ?").run(account, thread);
      return;
    }
    const visible = all.filter((row) => !row.hidden);
    const shown = visible.length ? visible : all;
    const newest = shown[shown.length - 1];
    const labels = [...new Set(all.flatMap((row) => json(row.labels)))];
    // A category sorts the inbox: a thread is in one only while it is in the inbox.
    // One the person does not keep as a tab shows in the first, as it does at the source.
    const tab = (category) => `category-${tabsOf.get(account)?.includes(category) === false ? CATEGORIES[0] : category}`;
    if (labels.includes("inbox")) for (const row of all) if (row.category && !labels.includes(tab(row.category))) labels.push(tab(row.category));
    // Sorted by its newest message: an inbox thread is in one category, and one the person wrote last may be waiting wherever it is.
    const sorted = sortThread(account, newest);
    if (sorted && (labels.includes("inbox") || sorted === "waiting")) labels.push(`sort-${sorted}`);
    const parties = new Map();
    for (const row of shown) {
      const party = json(row.sender);
      const address = party.address.toLowerCase();
      if (!parties.has(address)) parties.set(address, party);
    }
    const unread = visible.filter((row) => row.unread).length;
    q(`INSERT OR REPLACE INTO threads (account, thread, subject, date, parties, snippet, count, unread, labels, starred, attachments, draft)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(account, thread, shown[0].subject, newest.date,
      JSON.stringify([...parties.values()]), newest.snippet, visible.length, unread, JSON.stringify(labels),
      labels.includes("starred") ? 1 : 0, all.some((row) => row.attachments) ? 1 : 0,
      hubDrafts || all.some((row) => row.draft) ? 1 : 0);
    const insert = q("INSERT INTO thread_labels (account, label, thread, date, unread) VALUES (?, ?, ?, ?, ?)");
    for (const label of labels) insert.run(account, label, thread, newest.date, unread);
  }
  const rollupAll = (account, threads) => {
    for (const thread of threads) rollup(account, thread);
    return { threads: [...threads].map((thread) => hubId(account, thread)) };
  };
  const threadsOfKeys = (account, keys) => {
    const threads = new Set();
    for (const part of chunks(keys)) {
      for (const row of q(`SELECT DISTINCT thread FROM messages WHERE account = ? AND key IN (${marks(part)})`).all(account, ...part)) threads.add(row.thread);
    }
    return threads;
  };
  const rowidOf = (account, key) => q("SELECT rowid FROM messages WHERE account = ? AND key = ?").get(account, key)?.rowid;
  const dropRaw = (account, key) => fs.rmSync(rawFile(account, key), { force: true });

  const upsert = q(`INSERT INTO messages (account, key, thread, seq, message_id, in_reply_to, refs, sender, recipients, reply_to,
      subject, date, size, unread, draft, labels, attachments, snippet)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (account, key) DO UPDATE SET thread = excluded.thread, seq = excluded.seq, message_id = excluded.message_id,
      in_reply_to = excluded.in_reply_to, refs = excluded.refs, sender = excluded.sender, recipients = excluded.recipients,
      reply_to = excluded.reply_to, subject = excluded.subject, date = excluded.date, size = excluded.size,
      unread = excluded.unread, draft = excluded.draft, labels = excluded.labels, attachments = excluded.attachments,
      snippet = CASE WHEN held THEN snippet ELSE excluded.snippet END
    RETURNING rowid`);

  const draftThreads = (draft) => {
    const own = draft.thread ? splitId(draft.thread)?.key : null;
    const copies = draft.messageId ? q("SELECT DISTINCT thread FROM messages WHERE account = ? AND message_id = ?").all(draft.account, draft.messageId).map((row) => row.thread) : [];
    return new Set([own, ...copies].filter(Boolean));
  };

  // What the person typed, as FTS5 and SQL: every word quoted (so nothing they type is FTS syntax) and prefix-matched.
  function parseQuery(account, text) {
    const words = [];
    const filters = { unread: false, attachments: false, labels: [] };
    const phrase = (word) => `"${word.replace(/"/g, "\"\"")}"*`;
    for (const match of String(text || "").matchAll(/(-?)(?:(\w+):)?(?:"([^"]*)"|(\S+))/g)) {
      const [, , field, quoted, bare] = match;
      const known = ["is", "has", "label", "from", "to", "subject"].includes(field?.toLowerCase());
      const term = known ? field.toLowerCase() : undefined;
      const value = known ? (quoted ?? bare ?? "").trim() : `${field ? `${field}:` : ""}${quoted ?? bare ?? ""}`.trim();
      if (term === "is" && value === "unread") filters.unread = true;
      else if (term === "is" && value === "starred") filters.labels.push("starred");
      else if (term === "has" && /^attachments?$/.test(value)) filters.attachments = true;
      else if (term === "label") {
        const label = q("SELECT id FROM labels WHERE account = ? AND (id = ? OR lower(name) = lower(?))").get(account, value, value);
        filters.labels.push(label?.id ?? value);
      } else if (/[\p{L}\p{N}]/u.test(value)) {
        const column = { from: "sender", to: "recipients", subject: "subject" }[term];
        words.push(column ? `${column} : ${phrase(value)}` : phrase(value));
      }
    }
    return { match: words.join(" AND "), filters };
  }

  const store = {
    close: () => db.close(),

    upsertMessages(account, messages) {
      return tx(() => {
        const threads = new Set();
        for (const message of messages) {
          const before = q("SELECT thread FROM messages WHERE account = ? AND key = ?").get(account, message.key);
          if (before && before.thread !== message.thread) threads.add(before.thread);
          const recipients = { to: message.to, cc: message.cc, bcc: message.bcc };
          const { rowid } = upsert.get(account, message.key, message.thread, message.seq, message.messageId, message.inReplyTo,
            JSON.stringify(message.references), JSON.stringify(message.from), JSON.stringify(recipients), JSON.stringify(message.replyTo),
            message.subject, message.date, message.size, message.unread ? 1 : 0, message.draft ? 1 : 0, JSON.stringify(message.labels),
            message.attachments ? 1 : 0, message.snippet || "");
          const fields = [message.subject, partyText([message.from]), partyText([...message.to, ...message.cc, ...message.bcc])];
          if (!q("UPDATE search SET subject = ?, sender = ?, recipients = ? WHERE rowid = ?").run(...fields, rowid).changes) {
            q("INSERT INTO search (rowid, subject, sender, recipients, body) VALUES (?, ?, ?, ?, '')").run(rowid, ...fields);
          }
          threads.add(message.thread);
        }
        return rollupAll(account, threads);
      });
    },

    patchMessages(account, patches) {
      return tx(() => {
        const threads = new Set();
        for (const patch of patches) {
          const row = q("SELECT thread, unread, labels FROM messages WHERE account = ? AND key = ?").get(account, patch.key);
          if (!row) continue;
          q("UPDATE messages SET unread = ?, labels = ? WHERE account = ? AND key = ?").run(
            patch.unread === undefined ? row.unread : patch.unread ? 1 : 0,
            patch.labels === undefined ? row.labels : JSON.stringify(patch.labels), account, patch.key);
          threads.add(row.thread);
        }
        return rollupAll(account, threads);
      });
    },

    removeMessages(account, keys) {
      return tx(() => {
        const threads = threadsOfKeys(account, keys);
        for (const key of keys) {
          const rowid = rowidOf(account, key);
          if (rowid === undefined) continue;
          q("DELETE FROM search WHERE rowid = ?").run(rowid);
          q("DELETE FROM messages WHERE rowid = ?").run(rowid);
          dropRaw(account, key);
        }
        return rollupAll(account, threads);
      });
    },

    clearMessages(account) {
      tx(() => {
        q("DELETE FROM search WHERE rowid IN (SELECT rowid FROM messages WHERE account = ?)").run(account);
        for (const table of ["messages", "threads", "thread_labels"]) q(`DELETE FROM ${table} WHERE account = ?`).run(account);
      });
      fs.rmSync(rawDir(account), { recursive: true, force: true });
    },

    // held: 1 with its raw file kept, 2 with its text alone (read for search; the raw is fetched again when it is opened).
    holdBody(account, key, raw, parsed, keep = true) {
      const row = q("SELECT rowid, thread FROM messages WHERE account = ? AND key = ?").get(account, key);
      if (!row) return { threads: [] };
      if (keep) {
        const file = rawFile(account, key);
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(file, raw, { mode: 0o600 });
      }
      const text = String(parsed.text || "").slice(0, TEXT_MAX);
      return tx(() => {
        q("UPDATE messages SET held = CASE WHEN ? OR held = 1 THEN 1 ELSE 2 END, snippet = ?, attachments = max(attachments, ?) WHERE rowid = ?").run(keep ? 1 : 0, snippetOf(text), parsed.attachments ? 1 : 0, row.rowid);
        q("UPDATE search SET body = ? WHERE rowid = ?").run(text, row.rowid);
        return rollupAll(account, [row.thread]);
      });
    },

    heldKeys: (account, after, limit) => q("SELECT key FROM messages WHERE account = ? AND held = 1 AND key > ? ORDER BY key LIMIT ?").all(account, after, limit).map((row) => row.key),

    rawOf(account, key) {
      try { return fs.readFileSync(rawFile(account, key)); } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },

    /** Sorting starts for an account (its address in lower case); its threads are sorted as they are next rolled up, and `resort` does the rest. */
    setSorting(account, own) { sorting.set(account, { own, rules: rulesOf(account), known: null }); },
    /** An account's rules in the order tried: the person's and agents' own, then Conduit's (each `on` or not). */
    rules: (account) => sorting.get(account)?.rules ?? rulesOf(account),
    /** Keeps a rule (replacing the one of its id; a Conduit rule keeps only whether it is on) and returns it; throws a refusal for one that cannot be kept. */
    putRule(account, rule) {
      const built = BUILT_IN.find((one) => one.id === rule?.id);
      const kept = built ? { id: built.id, by: "conduit", on: rule.on !== false } : (() => {
        const fault = !rule || typeof rule !== "object" ? "A rule is an object." : typeof rule.name !== "string" || !rule.name.trim() || rule.name.length > 120 ? "A rule has a name of 120 characters at most."
          : typeof rule.then?.category !== "string" || !categoryId(rule.then.category) || rule.then.category.length > 40 ? "A rule gives a category: one of Conduit's ids or a name of your own, 40 characters at most."
          : conditionFault(rule.when);
        if (fault) throw Object.assign(new Error(fault), { status: 400, code: "bad_request" });
        return { id: typeof rule.id === "string" && /^[a-z0-9-]{1,40}$/.test(rule.id) ? rule.id : crypto.randomBytes(4).toString("hex"), name: rule.name.trim(), when: rule.when,
          then: { category: rule.then.category.trim() }, by: rule.by === "agent" ? "agent" : "person", on: rule.on !== false };
      })();
      // A new rule goes first: the latest word wins.
      const position = q("SELECT position FROM rules WHERE account = ? AND id = ?").get(account, kept.id)?.position ?? (q("SELECT min(position) AS at FROM rules WHERE account = ?").get(account).at ?? 0) - 1;
      q("INSERT OR REPLACE INTO rules (account, id, position, value) VALUES (?, ?, ?, ?)").run(account, kept.id, position, JSON.stringify(kept));
      if (sorting.has(account)) sorting.get(account).rules = rulesOf(account);
      return this.rules(account).find((one) => one.id === kept.id);
    },
    removeRule(account, id) {
      const gone = q("DELETE FROM rules WHERE account = ? AND id = ?").run(account, id).changes > 0;
      if (sorting.has(account)) sorting.get(account).rules = rulesOf(account);
      return gone;
    },
    /** Sorts again a page of the threads sorting covers (the inbox's and those already sorted), after `after`; returns the last thread it did, null at the end. */
    resort(account, after, limit) {
      const threads = q(`SELECT DISTINCT thread FROM thread_labels WHERE account = ? AND (label = 'inbox' OR label = 'sent' OR label LIKE 'sort-%') AND thread > ? ORDER BY thread LIMIT ?`).all(account, after, limit).map((row) => row.thread);
      if (threads.length) tx(() => rollupAll(account, threads));
      return threads.at(-1) ?? null;
    },

    /** The categories an account keeps as tabs; a change sorts its inbox threads again and returns them. */
    setTabs(account, tabs) {
      const now = [CATEGORIES[0], ...tabs];
      tabsOf.set(account, now);
      const kept = this.cursor(account, "tabs");
      if (kept ? sameList(kept, now) : now.length === CATEGORIES.length) return { threads: [] };
      return tx(() => {
        this.setCursor(account, "tabs", now);
        return rollupAll(account, q("SELECT thread FROM thread_labels WHERE account = ? AND label = 'inbox'").all(account).map((row) => row.thread));
      });
    },

    /** These messages (by `seq`) are in this category at the source; returns the threads it changed. */
    setCategory(account, category, seqs) {
      return tx(() => {
        const threads = new Set();
        for (let at = 0; at < seqs.length; at += 500) {
          const page = seqs.slice(at, at + 500);
          for (const row of q(`UPDATE messages SET category = ? WHERE account = ? AND seq IN (${page.map(() => "?").join(",")}) AND category IS NOT ? RETURNING thread`)
            .all(category, account, ...page, category)) threads.add(row.thread);
        }
        return rollupAll(account, [...threads]);
      });
    },

    putLabels(account, labels) {
      tx(() => {
        q("DELETE FROM labels WHERE account = ?").run(account);
        for (const label of labels) q("INSERT INTO labels (account, id, name, role) VALUES (?, ?, ?, ?)").run(account, label.id, label.name, label.role);
      });
    },

    cursor(account, name) {
      const row = q("SELECT value FROM cursors WHERE account = ? AND name = ?").get(account, name);
      return row ? json(row.value) : null;
    },
    setCursor(account, name, value) {
      q("INSERT OR REPLACE INTO cursors (account, name, value) VALUES (?, ?, ?)").run(account, name, JSON.stringify(value));
    },

    seqs: (account, from, to) => q("SELECT seq FROM messages WHERE account = ? AND seq BETWEEN ? AND ? ORDER BY seq").all(account, from, to).map((row) => row.seq),
    keysOfSeqs: (account, seqs) => chunks(seqs).flatMap((part) =>
      q(`SELECT seq, key FROM messages WHERE account = ? AND seq IN (${marks(part)})`).all(account, ...part).map((row) => ({ seq: row.seq, key: row.key }))),
    seqsOfKeys: (account, keys) => chunks(keys).flatMap((part) =>
      q(`SELECT seq, key FROM messages WHERE account = ? AND key IN (${marks(part)})`).all(account, ...part).map((row) => ({ seq: row.seq, key: row.key }))),
    // `unread`: those with no text at all; else those whose raw is not kept.
    bodiless: (account, since, limit, unread = false) => q(`SELECT key, seq, size FROM messages WHERE account = ? AND ${unread ? "held = 0" : "held != 1"} AND date >= ? ORDER BY date DESC LIMIT ?`)
      .all(account, since, limit).map((row) => ({ key: row.key, seq: row.seq, size: row.size })),
    count: (account) => q("SELECT count(*) AS n FROM messages WHERE account = ?").get(account).n,

    prune(account, before, limit) {
      const keys = q("SELECT key FROM messages WHERE account = ? AND date < ? ORDER BY date LIMIT ?").all(account, before, limit).map((row) => row.key);
      return { ...store.removeMessages(account, keys), count: keys.length };
    },
    held(account) {
      const one = (sql) => q(sql).get(account);
      return {
        messages: one("SELECT count(*) AS n FROM messages WHERE account = ?").n,
        threads: one("SELECT count(*) AS n FROM threads WHERE account = ?").n,
        bodies: one("SELECT count(*) AS n FROM messages WHERE account = ? AND held > 0").n,
        oldest: one("SELECT min(date) AS at FROM messages WHERE account = ?").at,
        // The raw files are the source's bytes, so their sizes add up to the held messages' own.
        raw: one("SELECT coalesce(sum(size), 0) AS n FROM messages WHERE account = ? AND held = 1").n,
        all: q("SELECT count(*) AS n FROM messages").get().n,
      };
    },
    dbBytes: () => ["mail.db", "mail.db-wal"].reduce((sum, name) => sum + (fs.statSync(path.join(dir, name), { throwIfNoEntry: false })?.size ?? 0), 0),
    clearCursors(account) {
      q("DELETE FROM cursors WHERE account = ?").run(account);
    },

    labels(account) {
      const counts = new Map(q("SELECT label, count(*) AS n, sum(unread > 0) AS unread FROM thread_labels WHERE account = ? GROUP BY label").all(account).map((row) => [row.label, row]));
      const order = (label) => label.role ? ROLES.indexOf(label.role) + (label.at ?? CATEGORIES.indexOf(label.id.slice("category-".length))) / 100 : ROLES.length;
      // A category is a label the hub makes: Conduit's own, and any a rule names.
      const named = new Map(SORTS.map((one) => [one.id, one.name]));
      for (const rule of this.rules(account)) if (!named.has(categoryId(rule.then?.category ?? "other"))) named.set(categoryId(rule.then.category), rule.then.category);
      const sorts = sorting.has(account) ? [...named].map(([id, name], at) => ({ id: `sort-${id}`, name, role: "sort", at })) : [];
      return [...q("SELECT id, name, role FROM labels WHERE account = ?").all(account), ...sorts]
        .filter((row) => row.role !== "category" || tabsOf.get(account)?.includes(row.id.slice("category-".length)) !== false)
        .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
        .map((row) => ({ id: row.id, name: row.name, role: row.role || null, unread: counts.get(row.id)?.unread || 0, threads: counts.get(row.id)?.n || 0 }));
    },

    threads({ account, label = "inbox", unread = false, before = null, limit = 50 }) {
      const size = Math.min(Math.max(Number(limit) || 50, 1), CHUNK);
      const at = before ? String(before).indexOf(":") : -1;
      const cursor = at > 0 ? [Number(before.slice(0, at)), before.slice(at + 1)] : null;
      const page = cursor ? "AND (t.date < ? OR (t.date = ? AND t.thread < ?))" : "";
      const params = cursor ? [cursor[0], cursor[0], cursor[1]] : [];
      const unreadOnly = unread ? "AND t.unread > 0" : "";
      const rows = label === "all"
        ? q(`SELECT * FROM threads t WHERE account = ? ${unreadOnly} ${page} ORDER BY date DESC, thread DESC LIMIT ?`).all(account, ...params, size + 1)
        : q(`SELECT th.* FROM thread_labels t JOIN threads th USING (account, thread) WHERE t.account = ? AND t.label = ? ${unreadOnly} ${page}
             ORDER BY t.date DESC, t.thread DESC LIMIT ?`).all(account, label, ...params, size + 1);
      const more = rows.length > size;
      const shown = rows.slice(0, size);
      const last = shown[shown.length - 1];
      return { threads: shown.map(toThread), next: more ? `${last.date}:${last.thread}` : null };
    },

    thread(id) {
      const parts = splitId(id);
      const row = parts && q("SELECT * FROM threads WHERE account = ? AND thread = ?").get(parts.account, parts.key);
      if (!row) return null;
      const messages = q(`SELECT * FROM messages WHERE account = ? AND thread = ? AND NOT ${HIDDEN} ORDER BY date, key`).all(parts.account, parts.key);
      return { thread: toThread(row), messages: messages.map(toMessage) };
    },

    threadsOf(ids) {
      return ids.map(splitId).filter(Boolean)
        .map((parts) => q("SELECT * FROM threads WHERE account = ? AND thread = ?").get(parts.account, parts.key))
        .filter(Boolean).map(toThread);
    },

    message(id) {
      const parts = splitId(id);
      const row = parts && q("SELECT * FROM messages WHERE account = ? AND key = ?").get(parts.account, parts.key);
      if (!row) return null;
      return { ...toMessage(row), key: row.key, seq: row.seq, messageId: row.message_id, inReplyTo: row.in_reply_to,
        references: json(row.refs), replyTo: json(row.reply_to) };
    },

    messagesFor({ threads = [], messages = [] }) {
      const found = new Map();
      const add = (row) => found.set(hubId(row.account, row.key), {
        account: row.account, id: hubId(row.account, row.key), key: row.key, unread: Boolean(row.unread), labels: json(row.labels),
      });
      for (const parts of threads.map(splitId).filter(Boolean)) {
        for (const row of q("SELECT account, key, unread, labels FROM messages WHERE account = ? AND thread = ?").all(parts.account, parts.key)) add(row);
      }
      for (const parts of messages.map(splitId).filter(Boolean)) {
        const row = q("SELECT account, key, unread, labels FROM messages WHERE account = ? AND key = ?").get(parts.account, parts.key);
        if (row) add(row);
      }
      return [...found.values()];
    },

    search({ account, q: text, limit = 50 }) {
      const size = Math.min(Math.max(Number(limit) || 50, 1), CHUNK);
      const { match, filters } = parseQuery(account, text);
      const { unread, attachments, labels } = filters;
      if (!match && !unread && !attachments && !labels.length) return [];
      if (!match) {
        // Filters alone ask about threads, which the roll-ups answer from an index, newest first, without reading messages.
        const [first, ...more] = labels;
        const where = [unread ? "AND th.unread > 0" : "", attachments ? "AND th.attachments = 1" : "",
          ...more.map(() => "AND EXISTS (SELECT 1 FROM thread_labels l WHERE l.account = th.account AND l.thread = th.thread AND l.label = ?)")].join(" ");
        const rows = first
          ? q(`SELECT th.* FROM thread_labels t JOIN threads th USING (account, thread) WHERE t.account = ? AND t.label = ? ${where}
               ORDER BY t.date DESC, t.thread DESC LIMIT ?`).all(account, first, ...more, size)
          : q(`SELECT * FROM threads th WHERE account = ? ${where} ORDER BY date DESC, thread DESC LIMIT ?`).all(account, ...more, size);
        return rows.map(toThread);
      }
      const where = [unread ? "AND m.unread = 1" : "", attachments ? "AND m.attachments = 1" : "",
        ...labels.map(() => "AND EXISTS (SELECT 1 FROM json_each(m.labels) WHERE value = ?)")].join(" ");
      // Best message per thread; rank is lower for a better match, and a newer thread wins a tie.
      const rows = q(`SELECT m.thread, min(search.rank) AS best, max(m.date) AS date FROM search JOIN messages m ON m.rowid = search.rowid
        WHERE search MATCH ? AND m.account = ? ${where} GROUP BY m.thread ORDER BY best, date DESC LIMIT ?`).all(match, account, ...labels, size);
      return store.threadsOf(rows.map((row) => hubId(account, row.thread)));
    },

    drafts(account, thread) {
      const rows = thread
        ? q(`SELECT value FROM drafts WHERE account = ? AND (thread = ? OR message_id <> '' AND message_id IN (SELECT message_id FROM messages WHERE account = ? AND thread = ?))`)
          .all(account, thread, account, splitId(thread)?.key ?? "")
        : q("SELECT value FROM drafts WHERE account = ?").all(account);
      return rows.map((row) => {
        const { messageId: _, ...draft } = json(row.value);
        return draft;
      }).sort((a, b) => b.updated.localeCompare(a.updated));
    },
    draft(id) {
      const row = q("SELECT value FROM drafts WHERE id = ?").get(id);
      return row ? json(row.value) : null;
    },
    putDraft(draft) {
      tx(() => {
        const before = store.draft(draft.id);
        q("INSERT OR REPLACE INTO drafts (id, account, thread, message_id, value) VALUES (?, ?, ?, ?, ?)").run(
          draft.id, draft.account, draft.thread, draft.messageId, JSON.stringify(draft));
        const threads = draftThreads(draft);
        if (before) for (const thread of draftThreads(before)) threads.add(thread);
        rollupAll(draft.account, threads);
      });
    },
    removeDraft(id) {
      tx(() => {
        const draft = store.draft(id);
        if (!draft) return;
        q("DELETE FROM drafts WHERE id = ?").run(id);
        rollupAll(draft.account, draftThreads(draft));
      });
    },

    dropAccount(account) {
      tx(() => {
        q("DELETE FROM search WHERE rowid IN (SELECT rowid FROM messages WHERE account = ?)").run(account);
        for (const table of ["messages", "threads", "thread_labels", "labels", "cursors", "drafts", "rules"]) q(`DELETE FROM ${table} WHERE account = ?`).run(account);
      });
      sorting.delete(account);
      fs.rmSync(rawDir(account), { recursive: true, force: true });
    },
  };
  return store;
}
