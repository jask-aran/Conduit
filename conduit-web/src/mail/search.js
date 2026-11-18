import { matches, parseFilter } from "./filter.js";

/*
 * The hub's mail search: one box where plain words search and the filter language's operators (filter.js) narrow. Words
 * drive the store's FTS5 table `search`; every other term is decided by `matches` on each candidate. When the words find
 * fewer than a handful of threads, a trigram table over senders and subjects (owned here) finds what a typo missed.
 */
const MAX_TEXT = 1000, MAX_WORDS = 16, MAX_TRIGRAMS = 12;
const POOL = 200, POOL_FILTERED = 2000;
const SHORTLIST = 10, HANDFUL = 5, FUZZY_POOL = 200, FUZZY_MIN = 0.5, FUZZY_MAX = 10, COMMON_GRAM = 2000;
// The newest messages an operators-only search reads: enough for months of a busy inbox, with `describe` on each.
const WALK = 2000;
// bm25 column weights in `search` (subject, sender, recipients, body); recipients are 0 because `matches` never reads them.
const WEIGHTS = { subject: 8, sender: 10, recipients: 0, body: 1 };
const REL = 1, RECENT = 0.5, HALF_LIFE_DAYS = 30, KNOWN = 0.3;
const DAY = 86_400_000;

const squash = (s) => String(s).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
const hasWord = (s) => /[\p{L}\p{N}]/u.test(s);
const quoteFts = (s) => `"${s.replace(/"/g, '""')}"`;
const fresh = (date, now) => 0.5 ** (Math.max(0, now - date) / DAY / HALF_LIFE_DAYS);

/**
 * How a candidate ranks. `rel`: its bm25 relevance over the best in the pool (0..1), or its trigram similarity (0..1)
 * when `fuzzy`; `date` and `now` in ms; `known`: the person has written to the sender. An exact hit scores at least 1
 * and a fuzzy one below 1, so every fuzzy hit ranks under every exact one.
 */
export function rankOf({ rel, date, now, known, fuzzy = false }) {
  const boost = RECENT * fresh(date, now) + KNOWN * (known ? 1 : 0);
  return fuzzy ? 0.999 * rel * (1 + boost) / (1 + RECENT + KNOWN) : 1 + REL * rel + boost;
}

// The words that drive the index (the bare words and phrases ANDed at the top) and the rest of the tree, which `matches` decides.
function readQuery(input) {
  const text = String(input ?? "").slice(0, MAX_TEXT);
  let parsed;
  try { parsed = parseFilter(text); } catch { parsed = { error: true }; }
  if (parsed.error) {
    const words = text.replace(/"/g, " ").split(/\s+/).filter(hasWord).slice(0, MAX_WORDS);
    return { words, prefix: words.length > 0 && !/[\s"]$/.test(text), rest: null };
  }
  const node = parsed.node;
  if (!node) return { words: [], prefix: false, rest: null };
  const top = node.kind === "and" ? node.children : [node];
  const driving = top.filter((c) => c.kind === "text" && hasWord(c.value)).slice(0, MAX_WORDS);
  const others = top.filter((c) => !driving.includes(c));
  const last = driving.at(-1);
  // A word is a prefix while it is being typed: the last thing in the box, bare, with nothing after it.
  const prefix = !!last && last === top.at(-1) && !/[\s"]$/.test(text) && text.endsWith(last.value);
  const rest = others.length ? others.length === 1 ? others[0] : { kind: "and", children: others } : null;
  return { words: driving.map((c) => c.value), prefix, rest };
}

/**
 * Mail search over a store's open database. `db`: its `node:sqlite` DatabaseSync, holding `messages` and the FTS5 table
 * `search`. `describe(row)`: a `messages` row (with `rowid`) → `{ message, facts }` as filter.js `matches` reads them.
 */
export function openMailSearch({ db, describe }) {
  const cache = new Map();
  const q = (sql) => {
    let statement = cache.get(sql);
    if (!statement) cache.set(sql, statement = db.prepare(sql));
    return statement;
  };
  const tx = (fn) => {
    if (db.isTransaction) return fn();
    db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); db.exec("COMMIT"); return result; } catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  const fuzzyText = (row) => {
    const from = JSON.parse(row.sender);
    return { sender: `${squash(from.name ?? "")} ${squash(from.address ?? "")}`, subject: squash(row.subject) };
  };
  const bm25 = `bm25(search, ${WEIGHTS.subject}, ${WEIGHTS.sender}, ${WEIGHTS.recipients}, ${WEIGHTS.body})`;
  const scored = (order) => `SELECT search.rowid AS rowid, m.thread, m.date, ${bm25} AS bm FROM search JOIN messages m ON m.rowid = search.rowid
    WHERE search MATCH ? AND m.account = ? ${order} LIMIT ?`;

  // Accepts candidates best first, one per thread, until `want` threads pass `rest`.
  function accept(candidates, rest, want, now, fuzzy, taken = new Set()) {
    const out = [];
    for (const row of candidates) {
      if (out.length >= want) break;
      if (taken.has(row.thread)) continue;
      const full = row.recipients ? row : q("SELECT rowid, * FROM messages WHERE rowid = ?").get(row.rowid);
      const read = describe(full);
      if (rest && !matches(rest, read.message, read.facts, {}, now)) continue;
      taken.add(row.thread);
      out.push({ thread: row.thread, key: full.key, date: row.date, score: rankOf({ rel: row.rel, date: row.date, now, known: read.facts.known, fuzzy }) });
    }
    return out;
  }

  // Up to POOL matches are all ranked by bm25. Past that, scoring every match costs about 2 µs each, so the pool is the
  // strongest sender and subject matches by bm25 and the newest matches anywhere (found through the date index), and a
  // newest match that is only in the body ranks by recency alone.
  function exact(account, words, prefix, rest, want, now) {
    const expr = words.map((word, i) => quoteFts(word) + (prefix && i === words.length - 1 ? "*" : "")).join(" AND ");
    let rows;
    try {
      const all = `{subject sender body} : (${expr})`;
      rows = q(scored("")).all(all, account, POOL + 1);
      if (rows.length > POOL) {
        const pool = new Map(q(scored("ORDER BY bm")).all(`{subject sender} : (${expr})`, account, POOL).map((row) => [row.rowid, row]));
        for (const row of q(`SELECT rowid, thread, date, 0 AS bm FROM messages WHERE account = ? AND rowid IN (SELECT rowid FROM search WHERE search MATCH ?)
          ORDER BY date DESC LIMIT ?`).all(account, all, rest ? POOL_FILTERED : POOL)) if (!pool.has(row.rowid)) pool.set(row.rowid, row);
        rows = [...pool.values()];
      }
    } catch { return []; }
    const best = Math.max(...rows.map((row) => -row.bm), 1e-9);
    for (const row of rows) {
      row.rel = -row.bm / best;
      row.stage = rankOf({ rel: row.rel, date: row.date, now, known: false });
    }
    rows.sort((a, b) => b.stage - a.stage || b.date - a.date);
    return accept(rows, rest, want, now, false);
  }

  // A typo'd word is looked up by its trigrams (any may hit; every word must hit one), and kept when at least FUZZY_MIN of
  // them are in the message's squashed sender or subject in their places: the word's i-th trigram found at p says the
  // word starts at p - i, and only trigrams agreeing on a start within one letter count, so trigrams scattered over other
  // words never add up. One wrong, missing or extra letter costs a word at most three trigrams and shifts the rest by one.
  // A phrase (a value with a space, which only quotes give) is never fuzzed: it must be in them whole.
  const inPlace = (grams, live) => {
    const starts = grams.map(({ g, at }) => {
      const found = [];
      for (let p = live.indexOf(g); p >= 0; p = live.indexOf(g, p + 1)) found.push(p - at);
      return found;
    });
    let best = 0;
    for (const s of starts.flat()) best = Math.max(best, starts.filter((list) => list.some((t) => Math.abs(t - s) <= 1)).length);
    return best / grams.length;
  };
  function fuzzy(account, words, rest, want, now, taken) {
    const terms = words.map(squash).filter(Boolean), whole = new Set(words.filter((w) => /\s/.test(w)).map(squash));
    const long = terms.filter((t) => t.length >= 3 && !whole.has(t));
    if (!long.length) return [];
    const gramsOf = (t) => {
      const all = Array.from({ length: t.length - 2 }, (_, at) => ({ g: t.slice(at, at + 3), at })).filter(({ g }, i, list) => list.findIndex((x) => x.g === g) === i);
      return all.length <= MAX_TRIGRAMS ? all : Array.from({ length: MAX_TRIGRAMS }, (_, i) => all[Math.floor(i * all.length / MAX_TRIGRAMS)]);
    };
    // A trigram in most senders and subjects (com, the domain everyone shares) finds nothing and costs a bm25 for every row,
    // so the lookup leaves those out and keeps a word's rarest; they still count when a candidate is scored.
    const docs = (g) => q("SELECT doc FROM search_fuzzy_terms WHERE term = ?").get(g)?.doc ?? 0;
    const lookup = (t) => {
      const grams = gramsOf(t).map(({ g }) => ({ g, n: docs(g) })).sort((a, b) => a.n - b.n);
      return grams.filter((x, i) => i === 0 || x.n <= COMMON_GRAM).map((x) => quoteFts(x.g));
    };
    let rows;
    try {
      const match = long.map((t) => `(${lookup(t).join(" OR ")})`).join(" AND ");
      // Ranked on the trigram table alone (CROSS JOIN keeps the planner from scanning messages instead), then joined back
      // on rowid and key so a row whose message is gone, or whose rowid was reused, never surfaces; scored on the
      // message's own sender and subject, never the indexed copy.
      rows = q(`SELECT m.rowid AS rowid, m.key, m.thread, m.date, m.sender, m.subject FROM
        (SELECT rowid, key, bm25(search_fuzzy) AS bm FROM search_fuzzy WHERE search_fuzzy MATCH ? AND account = ? ORDER BY bm LIMIT ?) f
        CROSS JOIN messages m ON m.rowid = f.rowid AND m.account = ? AND m.key = f.key ORDER BY f.bm`).all(match, account, FUZZY_POOL, account);
    } catch { return []; }
    const kept = [];
    for (const row of rows) {
      const { sender, subject } = fuzzyText(row);
      const live = `${sender} ${subject}`;
      let sum = 0;
      const ok = terms.every((t) => {
        if (live.includes(t)) return sum += 1;
        if (t.length < 3 || whole.has(t)) return false;
        const share = inPlace(gramsOf(t), live);
        sum += share;
        return share >= FUZZY_MIN;
      });
      if (ok) kept.push(Object.assign(row, { rel: sum / terms.length }));
    }
    kept.sort((a, b) => b.rel - a.rel || b.date - a.date);
    return accept(kept, rest, Math.min(want, FUZZY_MAX), now, true, taken);
  }

  function walk(account, rest, want, now) {
    const out = [], taken = new Set();
    for (const row of q("SELECT rowid, * FROM messages WHERE account = ? ORDER BY date DESC LIMIT ?").iterate(account, WALK)) {
      if (taken.has(row.thread)) continue;
      const read = describe(row);
      if (!matches(rest, read.message, read.facts, {}, now)) continue;
      taken.add(row.thread);
      out.push({ thread: row.thread, key: row.key, date: row.date, score: fresh(row.date, now) });
      if (out.length >= want) break;
    }
    return out;
  }

  return {
    /** Creates the tables this module owns, if they are missing: the trigram table and its vocabulary. */
    ensure() {
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS search_fuzzy USING fts5 (sender, subject, account UNINDEXED, key UNINDEXED,
        tokenize = "trigram remove_diacritics 1");
        CREATE VIRTUAL TABLE IF NOT EXISTS search_fuzzy_terms USING fts5vocab (search_fuzzy, row);`);
    },

    /** Indexes up to `limit` messages the trigram table lacks, oldest rowid first; returns how many it wrote, 0 when level. */
    catchUp(limit = 500) {
      return tx(() => {
        let done = 0;
        // A deleted message's rowid is handed to the next one inserted: drop our rows at the top until they match the message there.
        for (;;) {
          const top = q("SELECT rowid, account, key FROM search_fuzzy ORDER BY rowid DESC LIMIT 1").get();
          if (!top) break;
          const live = q("SELECT account, key FROM messages WHERE rowid = ?").get(top.rowid);
          if (live && live.account === top.account && live.key === top.key) break;
          q("DELETE FROM search_fuzzy WHERE rowid = ?").run(top.rowid);
          if (++done >= limit) return done;
        }
        const after = q("SELECT rowid FROM search_fuzzy ORDER BY rowid DESC LIMIT 1").get()?.rowid ?? 0;
        const insert = q("INSERT INTO search_fuzzy (rowid, sender, subject, account, key) VALUES (?, ?, ?, ?, ?)");
        for (const row of q("SELECT rowid, account, key, sender, subject FROM messages WHERE rowid > ? ORDER BY rowid LIMIT ?").all(after, limit - done)) {
          const { sender, subject } = fuzzyText(row);
          insert.run(row.rowid, sender, subject, row.account, row.key);
          done++;
        }
        return done;
      });
    },

    /**
     * One search box: plain words, a quoted phrase, any filter operator. Returns threads best first, each by its best
     * message: `[{ thread, key, score, fuzzy? }]` (the `messages` columns `thread` and `key`); `now` in ms.
     */
    search({ account, text, limit = 50, now = Date.now() }) {
      const want = Math.min(Math.max(Number(limit) || 50, 1), 500);
      const { words, prefix, rest } = readQuery(text);
      if (!words.length) return rest ? walk(account, rest, want, now).map(({ date, ...hit }) => hit) : [];
      // `known` is read through `describe`, so it reorders only the SHORTLIST threads best by bm25 and recency.
      const found = exact(account, words, prefix, rest, want + SHORTLIST, now)
        .sort((a, b) => b.score - a.score || b.date - a.date).slice(0, want);
      if (found.length < HANDFUL) {
        const taken = new Set(found.map((hit) => hit.thread));
        const more = fuzzy(account, words, rest, want - found.length, now, taken).sort((a, b) => b.score - a.score || b.date - a.date);
        found.push(...more.map((hit) => ({ ...hit, fuzzy: true })));
      }
      return found.map(({ date, ...hit }) => hit);
    },
  };
}
