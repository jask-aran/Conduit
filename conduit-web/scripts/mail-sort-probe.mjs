#!/usr/bin/env node
/**
 * Tries mail sorting (src/mail/sorting.js) on the hub's own copy, changing nothing: reads the newest inbox messages from
 * mail.db (read-only), asks Jev about each, and prints the category the rules give with the answers behind it.
 * Sends each message's sender, subject and the start of its text to api.typesafe.ai.
 * Run from conduit-web/: TYPESAFE_API_KEY=… node --max-old-space-size=1024 scripts/mail-sort-probe.mjs [count=40] [--json out.json] [--label inbox]
 * Without a key it prints the facts and the state it would send for the first three messages, and sends nothing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { categorise, factsOf, judge, QUESTIONS, stateOf } from "../src/mail/sorting.js";

const args = process.argv.slice(2);
const option = (name) => { const at = args.indexOf(name); return at < 0 ? null : args.splice(at, 2)[1]; };
const out = option("--json"), label = option("--label") ?? "inbox";
const count = Number(args[0]) || 40;
const dir = path.join(process.env.CONDUIT_DATA_ROOT || path.join(os.homedir(), ".conduit", "data"), "mail");
const key = process.env.TYPESAFE_API_KEY;
const account = JSON.parse(fs.readFileSync(path.join(dir, "accounts.json"), "utf8")).accounts[0];
const own = account.address.toLowerCase();
const db = new DatabaseSync(path.join(dir, "mail.db"), { readOnly: true });
const rows = db.prepare(`SELECT m.rowid, m.*, s.body FROM messages m JOIN search s ON s.rowid = m.rowid
  WHERE m.account = ? AND m.held > 0 AND m.draft = 0 AND EXISTS (SELECT 1 FROM json_each(m.labels) WHERE value = ?) ORDER BY m.date DESC LIMIT ?`).all(account.id, label, count);
const sent = db.prepare(`SELECT 1 FROM messages WHERE account = ? AND recipients LIKE ? AND EXISTS (SELECT 1 FROM json_each(labels) WHERE value = 'sent') LIMIT 1`);
const wroteTo = (address) => Boolean(sent.get(account.id, `%"${address.replace(/[%_"]/g, "")}"%`));
const messages = rows.map((row) => { const to = JSON.parse(row.recipients); return {
  from: JSON.parse(row.sender), to: to.to, cc: to.cc, subject: row.subject, text: row.body || row.snippet, labels: JSON.parse(row.labels),
  category: row.category, attachments: Boolean(row.attachments), date: row.date }; });

if (!key) {
  for (const message of messages.slice(0, 3)) { const facts = factsOf(message, { own, wroteTo }); console.log(JSON.stringify({ facts, state: stateOf(message, facts) }, null, 1).slice(0, 1500), "\n"); }
  console.log(`No TYPESAFE_API_KEY: nothing sent. ${messages.length} messages would be asked ${Object.keys(QUESTIONS).length} questions each.`);
  process.exit(0);
}
const results = [];
let tokens = 0, next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let at = next++; at < messages.length; at = next++) {
    const message = messages[at], facts = factsOf(message, { own, wroteTo });
    const judged = await judge(message, facts, { key });
    tokens += judged.tokens;
    const [category, why] = categorise(facts, judged.answers);
    results[at] = { category, why, source: facts.source, from: message.from.name || message.from.address, subject: message.subject, facts, answers: judged.answers, model: judged.model };
  }
}));
const short = (text, width) => text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);
for (const one of results) console.log(`${one.category.padEnd(10)}${short(one.source ?? "-", 11)}${short(one.from, 24)} ${short(one.subject, 52)} ${Object.entries(one.answers).filter(([id, value]) => id !== "urgency" && value > 0.3).map(([id, value]) => `${id} ${value.toFixed(2)}`).join(", ")} · urgency ${one.answers.urgency.toFixed(1)}`);
const tally = Object.groupBy(results, (one) => one.category);
console.log(`\n${Object.entries(tally).map(([name, list]) => `${name} ${list.length}`).join(", ")} · ${tokens.toLocaleString()} input tokens (${(tokens / 1e6 * 0.042).toFixed(4)} USD at 0.042 per million) · ${results[0]?.model}`);
if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1));
