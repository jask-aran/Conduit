#!/usr/bin/env node
/**
 * The hub's mail search (src/mail/search.js) over a temporary database of 25,000 generated messages and hand-made ones
 * for each case: prefix as you type, AND of words, phrases, sender and subject over body, recent and known over old and
 * unknown, operators with words and alone, an unreadable query read as words, typos through the trigram table (ranked
 * under exact hits), catchUp in pages, deleted and reused rowids, hostile input, and timings.
 * Exits 1 at the first wrong answer.
 * Run from conduit-web/: node --max-old-space-size=1024 scripts/mail-search-check.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseFilter } from "../src/mail/filter.js";
import { openMailSearch } from "../src/mail/search.js";
import { factsOf } from "../src/mail/sorting.js";

const group = (name, run) => {
  try { const note = run(); console.log(`ok  ${name}${note ? `: ${note}` : ""}`); } catch (e) { console.error(`FAIL ${name}\n${e.stack}`); cleanup(); process.exit(1); }
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-search-check-"));
const cleanup = () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); };

// As store.js has them.
const db = new DatabaseSync(path.join(dir, "mail.db"));
db.exec(`
CREATE TABLE messages (
  account TEXT NOT NULL, key TEXT NOT NULL, thread TEXT NOT NULL, seq INTEGER,
  message_id TEXT NOT NULL, in_reply_to TEXT, refs TEXT NOT NULL,
  sender TEXT NOT NULL, recipients TEXT NOT NULL, reply_to TEXT NOT NULL,
  subject TEXT NOT NULL, date INTEGER NOT NULL, size INTEGER NOT NULL,
  unread INTEGER NOT NULL, draft INTEGER NOT NULL, labels TEXT NOT NULL, attachments INTEGER NOT NULL,
  snippet TEXT NOT NULL, held INTEGER NOT NULL DEFAULT 0, category TEXT,
  PRIMARY KEY (account, key));
CREATE INDEX messages_age ON messages (account, date);
CREATE VIRTUAL TABLE search USING fts5 (subject, sender, recipients, body, tokenize = "unicode61 remove_diacritics 2");`);

const NOW = new Date(2026, 10, 18, 12).getTime(), DAY = 86_400_000, OWN = "me@home.example", ACCOUNT = "a1";
const KNOWN = new Set(["jo@friends.example"]);
let seed = 7;
const random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; };
const pick = (list) => list[Math.floor(random() * list.length)];
// Generated words are consonant-vowel runs over letters none of the hand-made cases' trigrams need, so noise never answers a case.
const word = () => Array.from({ length: 2 + Math.floor(random() * 3) }, () => pick("bdglmnptvz") + pick("aeiou")).join("");
const VOCAB = Array.from({ length: 3000 }, word);
const SENDERS = Array.from({ length: 400 }, () => { const name = `${word()} ${word()}`; return { name, address: `${name.replace(" ", ".")}@${word()}.example` }; });
const sentence = (n) => Array.from({ length: n }, () => pick(VOCAB)).join(" ");

const insertMessage = db.prepare(`INSERT INTO messages (account, key, thread, message_id, refs, sender, recipients, reply_to, subject, date, size, unread, draft, labels, attachments, snippet)
  VALUES (?, ?, ?, ?, '[]', ?, ?, '[]', ?, ?, 0, ?, 0, ?, 0, ?) RETURNING rowid`);
const insertSearch = db.prepare("INSERT INTO search (rowid, subject, sender, recipients, body) VALUES (?, ?, ?, ?, ?)");
let count = 0;
function add({ key = `k${count}`, thread = key, from, subject, body = "", date = NOW - 10 * DAY, unread = false, account = ACCOUNT }) {
  const recipients = { to: [{ name: "Me", address: OWN }], cc: [], bcc: [] };
  const { rowid } = insertMessage.get(account, key, thread, `<${key}@x>`, JSON.stringify(from), JSON.stringify(recipients), subject, date, unread ? 1 : 0, "[]", body.slice(0, 200));
  insertSearch.run(rowid, subject, `${from.name} ${from.address}`, `Me ${OWN}`, body);
  count++;
  return rowid;
}
const removeMessage = (rowid) => { db.prepare("DELETE FROM search WHERE rowid = ?").run(rowid); db.prepare("DELETE FROM messages WHERE rowid = ?").run(rowid); };

const OFFICE = { name: "Officeworks", address: "orders@officeworks.com.au" };
const someone = (name) => ({ name, address: `${name.toLowerCase().replace(/\s+/g, ".")}@mail.example` });
let started = performance.now();
db.exec("BEGIN");
for (let i = 0; i < 25_000; i++) {
  const thread = `g${Math.floor(i / (1 + Math.floor(random() * 3)))}`;
  add({ thread, from: pick(SENDERS), subject: sentence(3 + Math.floor(random() * 6)), body: sentence(60 + Math.floor(random() * 340)), date: NOW - Math.floor(random() * 1095 * DAY) });
}
add({ key: "office-order", from: OFFICE, subject: "Your order is ready for pickup", body: "Bring your receipt.", date: NOW - 2 * DAY });
add({ key: "office-invoice-new", from: OFFICE, subject: "Tax invoice 4471", body: "Thanks for shopping.", date: NOW - 20 * DAY });
add({ key: "office-invoice-old", from: OFFICE, subject: "Tax invoice 1022", body: "Thanks for shopping.", date: NOW - 400 * DAY });
add({ key: "other-invoice", from: someone("Bunnings"), subject: "Tax invoice 9001", body: "Thanks.", date: NOW - 5 * DAY });
add({ key: "lantern-both", from: someone("Town Hall"), subject: "Lantern festival this weekend", body: "Bring a torch." });
add({ key: "lantern-only", from: someone("Glow Repairs"), subject: "Lantern repairs", body: "Your lamp is fixed." });
add({ key: "phrase-yes", from: someone("Port Office"), subject: "Moorings at blue harbour", body: "See the map." });
add({ key: "phrase-no", from: someone("Paint Shop"), subject: "Harbour paint in blue", body: "Two coats." });
add({ key: "quokka-sender", from: someone("Quokka Tours"), subject: "Booking held", body: "Departing at nine." });
add({ key: "quokka-subject", from: someone("Island Ferry"), subject: "Quokka sighting", body: "Departing at nine." });
add({ key: "quokka-body", from: someone("Parks Board"), subject: "Island notes", body: "Departing at nine, and a quokka was seen near the jetty on the way back." });
add({ key: "zephyr-recent", from: someone("Wind Club"), subject: "Zephyr regatta", body: "Same text.", date: NOW - 2 * DAY });
add({ key: "zephyr-old", from: someone("Wind Club"), subject: "Zephyr regatta", body: "Same text.", date: NOW - 700 * DAY });
add({ key: "zephyr-known", from: { name: "Jo", address: "jo@friends.example" }, subject: "Zephyr regatta", body: "Same text.", date: NOW - 700 * DAY });
add({ key: "cumulus", from: someone("Weather Desk"), subject: "Cumulus report", body: "An unclosed tab remains." });
add({ key: "wombatt-literal", from: someone("Zoo Keeper"), subject: "Note", body: "The sign says wombatt, spelt wrong." });
add({ key: "wombat-1", from: someone("Wombat Supplies"), subject: "Burrow kit dispatched", body: "Thanks." });
add({ key: "wombat-2", from: someone("Wombat Supplies"), subject: "Spring catalogue", body: "Thanks." });
add({ key: "zep-decoy", from: someone("Science Club"), subject: "Zep met Joseph at physics with a hyrax" });
add({ key: "common-subject-old", from: someone("Old Friend"), subject: `About ${VOCAB[0]} again`, body: "Hello.", date: NOW - 900 * DAY });
add({ key: "common-office-30", from: OFFICE, subject: "Store news", body: `We stock ${VOCAB[0]} now.`, date: NOW - 30 * DAY });
add({ key: "common-office-900", from: OFFICE, subject: "Store news", body: `We stock ${VOCAB[0]} now.`, date: NOW - 900 * DAY });
add({ key: "elsewhere-office", account: "a2", from: OFFICE, subject: "Officeworks for another account", body: "No." });
db.exec("COMMIT");
const filled = performance.now() - started;

let described = 0;
const describe = (row) => {
  described++;
  const recipients = JSON.parse(row.recipients), from = JSON.parse(row.sender), labels = JSON.parse(row.labels);
  const message = { from, to: recipients.to, cc: recipients.cc, subject: row.subject, date: row.date, labels, labelNames: labels, category: row.category,
    attachments: !!row.attachments, unread: !!row.unread, starred: labels.includes("starred"),
    text: db.prepare("SELECT body FROM search WHERE rowid = ?").get(row.rowid)?.body || row.snippet };
  return { message, facts: factsOf(message, { own: OWN, wroteTo: (address) => KNOWN.has(address), now: NOW }) };
};
const mail = openMailSearch({ db, describe });
mail.ensure();
const find = (text, limit = 50) => mail.search({ account: ACCOUNT, text, limit, now: NOW });
const threads = (text, limit) => find(text, limit).map((hit) => hit.thread);
const exactOf = (text) => find(text).filter((hit) => !hit.fuzzy).map((hit) => hit.thread);
const before = (list, a, b) => { assert.ok(list.includes(a) && list.includes(b), `${a}, ${b} in ${list}`); assert.ok(list.indexOf(a) < list.indexOf(b), `${a} before ${b} in ${list}`); };

group("catchUp in pages", () => {
  started = performance.now();
  let pages = 0, total = 0;
  for (let done; (done = mail.catchUp(1000)); pages++) total += done;
  assert.equal(total, count);
  assert.equal(pages, Math.ceil(count / 1000));
  assert.equal(mail.catchUp(1000), 0);
  return `${count} messages in ${pages} pages, ${((performance.now() - started) / pages).toFixed(0)} ms a page (filling took ${(filled / 1000).toFixed(1)} s)`;
});

group("prefix as you type", () => {
  assert.ok(exactOf("offi").includes("office-order"));
  assert.ok(!exactOf("offi ").includes("office-order"), "a word followed by a space is whole");
  assert.ok(exactOf("officeworks ord").includes("office-order"));
  assert.ok(!exactOf("ord officeworks").includes("office-order"), "only the last word is a prefix");
  assert.ok(!exactOf("offi from:officeworks").includes("office-order"), "a word with a term after it is whole");
  assert.ok(!threads("offi").includes("elsewhere-office"), "another account's mail");
});

group("AND of words", () => {
  const found = threads("lantern festival");
  assert.ok(found.includes("lantern-both"));
  assert.ok(!found.includes("lantern-only"), found.join());
});

group("phrases", () => {
  assert.deepEqual(threads('"blue harbour"'), ["phrase-yes"]);
  const loose = threads("blue harbour");
  assert.ok(loose.includes("phrase-yes") && loose.includes("phrase-no"));
});

group("sender and subject outrank body", () => {
  const found = threads("quokka");
  before(found, "quokka-sender", "quokka-body");
  before(found, "quokka-subject", "quokka-body");
});

group("recent and known outrank old and unknown", () => {
  const found = threads("zephyr");
  before(found, "zephyr-recent", "zephyr-old");
  before(found, "zephyr-known", "zephyr-old");
});

group("operators with words", () => {
  assert.deepEqual(threads("invoice from:officeworks newer_than:3m"), ["office-invoice-new"]);
  assert.deepEqual(threads("invoice -from:officeworks"), ["other-invoice"]);
  assert.deepEqual(threads("invoice from:officeworks").sort(), ["office-invoice-new", "office-invoice-old"]);
});

group("operators alone", () => {
  // Newest first, and only from the newest 2000 messages (about 3 months here): the 400-day-old invoice is past the walk.
  assert.deepEqual(threads("from:officeworks"), ["office-order", "office-invoice-new", "common-office-30"]);
  assert.deepEqual(threads("from:officeworks newer_than:10d"), ["office-order"]);
  const either = threads("from:wombat OR from:quokka", 2);
  assert.ok(either.length === 2 && either.every((t) => ["wombat-1", "wombat-2", "quokka-sender"].includes(t)), either.join());
  assert.deepEqual(threads(""), []);
});

group("an unreadable query is searched as words", () => {
  assert.ok(parseFilter('cumulus "unclosed').error);
  assert.deepEqual(threads('cumulus "unclosed'), ["cumulus"]);
  assert.ok(parseFilter("cumulus is:banana").error);
  assert.deepEqual(exactOf("cumulus is:banana"), []);
});

group("typos through the trigram table, under exact hits", () => {
  for (const text of ["oficeworks", "ofice works", "offiecworks", "officewroks"]) {
    const found = find(text);
    assert.ok(found.some((hit) => hit.thread === "office-order" && hit.fuzzy), `${text}: ${JSON.stringify(found)}`);
    assert.ok(!found.some((hit) => hit.thread === "elsewhere-office"), text);
  }
  assert.ok(find("oficeworks from:officeworks newer_than:10d").every((hit) => hit.thread === "office-order"));
  const found = find("wombatt");
  assert.equal(found[0].thread, "wombatt-literal");
  assert.ok(!found[0].fuzzy);
  assert.ok(found.slice(1).every((hit) => hit.fuzzy && hit.score < found[0].score), JSON.stringify(found));
  assert.deepEqual(found.slice(1).map((hit) => hit.thread).sort(), ["wombat-1", "wombat-2"]);
  assert.deepEqual(threads("zq"), [], "a word under 3 characters is never fuzzed");
  const zephyr = find("zephyx");
  assert.ok(zephyr.some((hit) => hit.thread === "zephyr-recent" && hit.fuzzy), JSON.stringify(zephyr));
  assert.ok(!zephyr.some((hit) => hit.thread === "zep-decoy"), "trigrams scattered over other words do not add up");
});

group("a word in thousands of messages", () => {
  const common = VOCAB[0];
  const n = db.prepare("SELECT count(*) AS n FROM search WHERE search MATCH ?").get(`"${common}"*`).n;
  assert.ok(n > 2000, `${common} is in ${n} messages`);
  assert.ok(threads(common).includes("common-subject-old"), "an old subject match is in the strong pool");
  // With an operator, only the newest 2000 matches are tried: the 900-day-old one is past them (the word is typed, so a prefix).
  assert.deepEqual(threads(`from:officeworks ${common}`), ["common-office-30"]);
  return `${n} match ${common}*`;
});

group("a deleted message never surfaces; a reused rowid is indexed again", () => {
  const order = db.prepare("SELECT rowid FROM messages WHERE key = 'office-order'").get().rowid;
  removeMessage(order);
  assert.ok(!threads("oficeworks").includes("office-order"));
  assert.ok(!threads("offi").includes("office-order"));
  const first = add({ key: "zanzibar", from: someone("Zanzibar Spice Co"), subject: "Saffron" });
  mail.catchUp(1000);
  assert.ok(threads("zanzibarr").includes("zanzibar"));
  removeMessage(first);
  const second = add({ key: "quillon", from: someone("Quillon Kites"), subject: "Kite string" });
  assert.equal(second, first, "SQLite hands the deleted top rowid to the next message");
  assert.ok(!threads("zanzibarr").includes("zanzibar"));
  assert.equal(mail.catchUp(1000), 2, "drops the stale row and indexes the new one");
  assert.ok(threads("quillonn").includes("quillon"));
});

group("hostile input never throws", () => {
  const cases = ['"', '""', '"""', "*", "**", "a*", "NEAR", "NEAR(a b)", "a NEAR b", ":", "::", "from:", "a:b:c", "(", ")", "((((", "))))", "{", "}",
    "AND", "OR", "NOT", "- -", "-", "^a", "a + b", "col:x", "subject : x", "'; DROP TABLE messages; --", "\\", "\\\"", "\u0000", "é", "😀",
    "x".repeat(10_000), "officeworks ".repeat(2000), "(".repeat(5000), "NOT ".repeat(2500) + "a", "\"a ".repeat(3000), "a OR ".repeat(2000) + "b",
    Array.from({ length: 3000 }, (_, i) => `w${i}`).join(" ")];
  for (const text of cases) assert.ok(Array.isArray(find(text)), text.slice(0, 40));
  for (const text of ["offi*", "invoice (", "tax:invoice", '"tax invoice"', "invoice)", "(invoice"]) assert.ok(exactOf(text).includes("office-invoice-new"), text);
  assert.ok(db.prepare("SELECT count(*) AS n FROM messages").get().n > 25_000);
});

group("timings at 25,000 messages", () => {
  const time = (text) => {
    const runs = [];
    described = 0;
    for (let i = 0; i < 30; i++) { const at = performance.now(); find(text); runs.push(performance.now() - at); }
    runs.sort((a, b) => a - b);
    return `${JSON.stringify(text)} ${runs[15].toFixed(2)}/${runs.at(-1).toFixed(2)} ms (${described / 30} described)`;
  };
  const common = VOCAB[0];
  const lines = ["offi", "officeworks ord", common, `${common.slice(0, 2)}`, `${pick(VOCAB)} ${pick(VOCAB)}`, "invoice from:officeworks newer_than:3m",
    "oficeworks", "ofice works", `${common}x`, "exampel", "sampel", "from:officeworks", "is:unread newer_than:30d"].map(time);
  return `median/worst of 30\n    ${lines.join("\n    ")}`;
});

cleanup();
