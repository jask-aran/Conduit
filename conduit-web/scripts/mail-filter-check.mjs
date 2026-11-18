#!/usr/bin/env node
/**
 * The mail filter language (src/mail/filter.js) on hand-made messages: parsing and precedence, forgiving reads, canonical
 * round-trips, each field's matching, errors and where they point, what saving refuses, and askTerms.
 * Exits 1 at the first wrong answer.
 * Run from conduit-web/: node --max-old-space-size=1024 scripts/mail-filter-check.mjs
 */
import assert from "node:assert/strict";
import { askTerms, canonicalFilter, filterGuide, matches, parseFilter, parseFilterForSaving } from "../src/mail/filter.js";

const group = (name, run) => {
  try { run(); console.log(`ok  ${name}`); } catch (e) { console.error(`FAIL ${name}\n${e.stack}`); process.exit(1); }
};
const full = (text) => { const { node, error } = parseFilter(text); assert.equal(error, null, `${text}: ${error?.message}`); return canonicalFilter(node); };
const errorOf = (text, read = parseFilter) => { const { node, error } = read(text); assert.equal(node, null, text); return error; };

const NOW = new Date(2026, 10, 18, 12).getTime(), DAY = 86_400_000;
const mail = (over = {}) => ({
  from: { name: "Amazon Orders", address: "orders@amazon.com" }, to: [{ name: "Jask", address: "me@x.com" }], cc: [{ name: "Jo Bloggs", address: "jo@y.org" }],
  subject: "Your order has shipped", text: "Tracking: AB-123. Thanks for shopping.", date: NOW - 3 * DAY, labels: ["l1"], labelNames: ["Work stuff"],
  category: null, attachments: false, unread: true, starred: false, ...over,
});
const FACTS = { important: false, known: false, bulk: true, robot: true, mine: false, direct: false, listed: false, receipt: true, logistics: true, security: false, action: false };
const pass = (text, message = mail(), facts = FACTS, answers = {}) => matches(parseFilter(text).node, message, { ...FACTS, ...facts }, answers, NOW);

group("parsing and precedence", () => {
  assert.deepEqual(parseFilter(""), { node: null, error: null, hints: [] });
  assert.deepEqual(parseFilter("   ").node, null);
  assert.deepEqual(parseFilter("a b OR c").node, { kind: "or", children: [{ kind: "and", children: [{ kind: "text", value: "a" }, { kind: "text", value: "b" }] }, { kind: "text", value: "c" }] });
  assert.equal(full("a b OR c"), "(a AND b) OR c");
  assert.equal(full("NOT a b"), "NOT a AND b");
  assert.equal(full("a (b OR c)"), "a AND (b OR c)");
  assert.equal(full("NOT (a b)"), "NOT (a AND b)");
  assert.equal(full("NOT NOT a"), "NOT NOT a");
  assert.equal(full("{a b} c"), "(a OR b) AND c");
  assert.equal(full("{a}"), "a");
  assert.equal(full("from:(amazon ebay)"), "from:amazon AND from:ebay");
  assert.equal(full("subject:{sale deal} x"), "(subject:sale OR subject:deal) AND x");
  assert.equal(full("subject:weekly plan from:bob"), "subject:weekly AND plan AND from:bob");
  assert.equal(full('subject:"weekly plan" from:bob'), 'subject:"weekly plan" AND from:bob');
  assert.equal(full("ask:a bill to pay from:bob"), 'ask:"a bill to pay" AND from:bob');
  assert.equal(full("FROM:bob IS:UNREAD"), "from:bob AND is:unread");
  assert.equal(full('"uber eats" x'), '"uber eats" AND x');
});

group("forgiving reads", () => {
  const hints = (text) => parseFilter(text).hints;
  assert.equal(full("a or b"), "a OR b");
  assert.ok(hints("a or b").includes("reading or as OR"));
  assert.equal(full("or a"), '"or" AND a');
  assert.equal(full("uber -eats"), "uber AND NOT eats");
  assert.equal(full("-from:bob -(a b) -{c d}"), "NOT from:bob AND NOT (a AND b) AND NOT (c OR d)");
  assert.equal(full("-50 Coca-Cola"), "-50 AND Coca-Cola");
  assert.equal(full("a OR"), "a");
  assert.equal(full("a AND NOT"), "a");
  assert.equal(full("(a OR b"), "a OR b");
  assert.equal(full("{a b"), "a OR b");
  assert.equal(full("older_than: 7 d"), "older_than:7d");
  assert.equal(full("after:2026-10-01"), "after:2026/10/01");
  assert.equal(full("12:30 re:hello"), '"12:30" AND "re:hello"');
  assert.ok(hints("subjct:x").some((h) => h.includes("did you mean subject:")));
  assert.ok(hints("in:inbox")[0].includes("Gmail search operator"));
  assert.equal(full("http://x.com"), '"http://x.com"');
  assert.deepEqual(hints("http://x.com"), []);
});

group("canonical round-trips", () => {
  for (const text of ["a b OR c", "(a OR b) (c OR d)", "((a b)) OR (c OR (d e))", "NOT (a OR b) c", "{a b} {c d}", "-{a b}",
    'subject:"a \\"quoted\\" word" from:@amazon.com', 'text:"x:y" "and" "-x" "{}" ""', 'label:"Work stuff" OR category:social',
    "is:read has:attachment kind:delivery older_than:2m newer_than:1y after:2026/01/01 before:2026/12/31",
    "ask:a bill to pay -ask:spam", "from:(a OR b c)", "a OR b AND c OR d"]) {
    const { node } = parseFilter(text), written = canonicalFilter(node), again = parseFilter(written);
    assert.equal(again.error, null, `${text} → ${written}`);
    assert.deepEqual(again.node, node, `${text} → ${written}`);
    assert.equal(canonicalFilter(again.node), written);
  }
  assert.equal(canonicalFilter(null), "");
});

group("text and phrase matching", () => {
  assert.ok(pass("shipped"));
  assert.ok(pass("SHIPPED order"));
  assert.ok(pass("ab123"), "punctuation ignored");
  assert.ok(pass('"thanks for shopping"'));
  assert.ok(!pass('"shopping thanks"'));
  assert.ok(pass("amazon orders"), "sender name");
  assert.ok(pass("amazon.com"), "sender address");
  assert.ok(!pass("jo"), "bare words don't read recipients");
  assert.ok(pass('""'));
  assert.ok(matches(null, mail(), FACTS));
  assert.ok(pass("text:tracking") && !pass("text:shipped"));
  assert.ok(pass('subject:"order has"') && !pass("subject:tracking"));
});

group("from, to, cc", () => {
  assert.ok(pass("from:amazon") && pass("from:Amazon Orders") && !pass("from:ebay"));
  assert.ok(pass("from:@amazon.com") && !pass("from:@mazon.com") && !pass("from:@amazon.co"));
  assert.ok(pass("from:ORDERS@amazon.com") && !pass("from:rders@amazon.com"));
  assert.ok(!pass("from:me") && pass("from:me", mail(), { mine: true }));
  assert.ok(pass("to:jask") && pass("to:jo") && pass("to:@y.org") && !pass("to:amazon"));
  assert.ok(pass("cc:bloggs") && !pass("cc:jask"));
  assert.ok(pass("to:me") && !pass("to:me", mail(), { listed: true }));
});

group("label, category, is, has, kind", () => {
  assert.ok(pass("label:work-stuff") && pass("label:WORK-STUFF") && pass('label:"Work stuff"') && !pass("label:work"));
  assert.ok(pass("category:primary") && !pass("category:promotions"));
  assert.ok(pass("category:social", mail({ category: "social" })));
  assert.ok(pass("is:unread") && !pass("is:read") && pass("is:read", mail({ unread: false })));
  assert.ok(!pass("is:starred") && pass("is:starred", mail({ starred: true })));
  for (const [word, fact] of [["important", "important"], ["known", "known"], ["mailing", "bulk"], ["robot", "robot"], ["mine", "mine"], ["direct", "direct"]]) {
    assert.equal(pass(`is:${word}`, mail(), { [fact]: true }), true, word);
    assert.equal(pass(`is:${word}`, mail(), { [fact]: false }), false, word);
  }
  assert.ok(!pass("has:attachment") && pass("has:attachment", mail({ attachments: true })));
  for (const [word, fact] of [["receipt", "receipt"], ["delivery", "logistics"], ["security", "security"], ["action", "action"]]) {
    assert.equal(pass(`kind:${word}`, mail(), { [fact]: true }), true, word);
    assert.equal(pass(`kind:${word}`, mail(), { [fact]: false }), false, word);
  }
});

group("older_than, newer_than, after, before", () => {
  assert.ok(pass("older_than:2d") && !pass("older_than:3d") && !pass("older_than:4d"));
  assert.ok(pass("newer_than:3d") && !pass("newer_than:2d"));
  const old = mail({ date: new Date(2026, 8, 17, 12).getTime() });
  assert.ok(pass("older_than:2m", old) && !pass("older_than:3m", old) && pass("newer_than:1y", old) && !pass("older_than:1y", old));
  const day = mail({ date: new Date(2026, 9, 1, 0, 0, 0).getTime() });
  assert.ok(pass("after:2026/10/01", day) && !pass("before:2026/10/01", day) && pass("before:2026/10/02", day));
  const lastMs = mail({ date: new Date(2026, 9, 1).getTime() - 1 });
  assert.ok(!pass("after:2026-10-01", lastMs) && pass("before:2026-10-01", lastMs));
  assert.ok(pass("after:2026/10/01 before:2026/10/02", day));
});

group("ask and three-valued NOT", () => {
  assert.ok(!pass("ask:a bill to pay"));
  assert.ok(!pass("-ask:a bill to pay"), "no answer: NOT doesn't pass either");
  assert.ok(pass("ask:a bill to pay", mail(), {}, { "a bill to pay": 0.7 }));
  assert.ok(!pass("ask:a bill to pay", mail(), {}, { "a bill to pay": 0.69 }));
  assert.ok(pass("-ask:a bill to pay", mail(), {}, { "a bill to pay": 0.2 }));
  assert.ok(pass("shipped OR ask:x"), "OR decided without the answer");
  assert.ok(!pass("ebay ask:x"), "AND decided without the answer");
  assert.ok(!pass("ask:toString"));
});

group("errors and where they point", () => {
  assert.deepEqual(errorOf("category:junk"), { message: "category: expects primary, promotions, social, updates or forums", at: 9 });
  assert.deepEqual(errorOf("a  is:nope"), { message: "is: expects unread, read, starred, important, known, mailing, robot, mine or direct", at: 6 });
  assert.deepEqual(errorOf("has:drive"), { message: "has: expects attachment", at: 4 });
  assert.equal(errorOf("x older_than:7").at, 13);
  assert.equal(errorOf("after:2026/02/30").at, 6);
  assert.equal(errorOf("before:yesterday").at, 7);
  assert.deepEqual(errorOf("from:"), { message: "from: missing value", at: 5 });
  assert.equal(errorOf("is:").at, 3);
  assert.deepEqual(errorOf("a )"), { message: 'unexpected ")"', at: 2 });
  assert.deepEqual(errorOf('x "abc'), { message: "unterminated quoted text", at: 2 });
  assert.equal(errorOf('"a\\n"').at, 2);
  assert.equal(errorOf("(a OR b}").at, 7);
  assert.equal(errorOf("{}").at, 0);
  assert.equal(errorOf("(").at, 1);
});

group("what saving refuses", () => {
  assert.deepEqual(errorOf("x subjct:hello", parseFilterForSaving), { message: "subjct: isn't a field: did you mean subject:?", at: 2 });
  assert.equal(errorOf("in:inbox", parseFilterForSaving).message, "in: is a Gmail search operator Conduit's filters don't have");
  assert.equal(errorOf("a bcc:jo", parseFilterForSaving).at, 2);
  for (const text of ["a or b", "uber -eats", "(a OR b", "12:30 re:hello http://x.com", "older_than:7 d"]) assert.equal(parseFilterForSaving(text).error, null, text);
  assert.ok(parseFilter("subjct:hello").node, "typing still searches it as text");
});

group("askTerms and the guide", () => {
  assert.deepEqual(askTerms(null), []);
  assert.deepEqual(askTerms(parseFilter("ask:a bill (x OR -ask:spam) ask:a bill").node), ["a bill", "spam"]);
  assert.deepEqual(askTerms(parseFilter('ask:"  padded "').node), ["padded"]);
  assert.deepEqual(askTerms(parseFilter("from:bob").node), []);
  const guide = filterGuide();
  assert.ok(guide.split("\n").length < 60);
  for (const word of ["from:", "to:", "cc:", "subject:", "text:", "label:", "category:", "is:", "has:", "kind:", "older_than:", "newer_than:", "after:", "before:", "ask:", "{a b}"]) assert.ok(guide.includes(word), word);
});
