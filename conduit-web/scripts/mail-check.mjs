#!/usr/bin/env node
/**
 * Mail's hub side against the fixture mailbox (src/mail/fixture-adapter.js), in a temporary data root that it removes:
 * the inbox before the backfill ends, thread roll-ups and label counts, search times, triage and its rollback, a draft
 * from save to send, the cleaned HTML, limits and types at the edge, the routes, and removing or stopping an account
 * mid-backfill; the sync choices (a shorter reach drops nothing, reading in again to a reach, a longer one backfilled, the text reach, pause, an old accounts.json).
 * Exits 1 at the first wrong answer.
 * Run from conduit-web/: node --max-old-space-size=4096 scripts/mail-check.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import express from "express";

process.env.CONDUIT_MAIL_FIXTURE = "1";
const { createMail } = await import("../src/mail/service.js");
const { registerMailRoutes } = await import("../src/server/routes/mail.js");
const { openMailStore, reachStart } = await import("../src/mail/store.js");
const { readBody } = await import("../src/mail/parse.js");
process.on("unhandledRejection", (error) => {
  console.error("unhandled rejection:", error);
  process.exit(1);
});

const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-mail-check-"));
const events = [];
const mail = await createMail({ dataRoot, changed: (event) => events.push(event) });
const step = (text) => console.log(`ok  ${text}`);
const waitFor = async (what, test, ms = 20_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await test();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const timed = async (fn) => {
  const start = performance.now();
  const value = await fn();
  return [value, performance.now() - start];
};
const descending = (threads) => threads.every((thread, index) => !index || threads[index - 1].date >= thread.date);
const allThreads = (query) => {
  const out = [];
  let before = null;
  do {
    const page = mail.threads({ ...query, before, limit: 40 });
    out.push(...page.threads);
    before = page.next;
  } while (before);
  return out;
};
/** Every thread's roll-up against its messages, and every label's unread count against its threads; the threads and labels. */
const checkRollups = (account) => {
  const threads = allThreads({ account, label: "all" });
  assert.ok(descending(threads));
  assert.equal(new Set(threads.map((thread) => thread.id)).size, threads.length, "paging repeats no thread");
  for (const listed of threads) {
    const { thread, messages } = mail.thread(listed.id);
    assert.deepEqual(thread, listed);
    assert.equal(thread.count, messages.length);
    assert.equal(thread.unread, messages.filter((message) => message.unread).length);
    assert.deepEqual(new Set(thread.labels), new Set(messages.flatMap((message) => message.labels)));
    const senders = messages.map((message) => message.from).filter((party, index, all) => all.findIndex((other) => other.address.toLowerCase() === party.address.toLowerCase()) === index);
    assert.deepEqual(thread.from, senders);
    assert.equal(thread.date, messages[messages.length - 1].date);
    assert.equal(thread.starred, messages.some((message) => message.starred));
  }
  const labels = mail.labels(account);
  for (const label of labels) {
    const inLabel = allThreads({ account, label: label.id });
    assert.ok(inLabel.every((thread) => thread.labels.includes(label.id)));
    assert.equal(label.unread, inLabel.filter((thread) => thread.unread).length, `unread count of ${label.name}`);
    assert.equal(allThreads({ account, label: label.id, unread: true }).length, label.unread);
  }
  return { threads, labels };
};
const DAY = 86_400_000;
const rawFiles = async (dir) => (await fs.readdir(dir, { recursive: true }).catch(() => [])).filter((name) => name.endsWith(".eml")).length;

try {
  await assert.rejects(mail.addAccount({ kind: "fixture", address: "me@fixture.example", secret: "wrong" }), { reason: "credentials" });
  assert.equal(mail.accounts().length, 0);
  const { id: account } = await mail.addAccount({ kind: "fixture", address: "me@fixture.example", secret: "anything", name: "Me" });
  step("a refused sign-in saves nothing; an accepted one adds the account");

  const first = await waitFor("the first inbox page", () => mail.threads({ account }).threads.length && mail.threads({ account }));
  const status = mail.accounts()[0].status;
  assert.notEqual(status.state, "idle", "the backfill should still be running");
  assert.ok(descending(first.threads));
  step(`inbox lists ${first.threads.length} threads, newest first, while the backfill is at ${status.backfill?.done ?? 0}/${status.backfill?.total ?? "?"}`);

  await waitFor("the backfill", () => mail.accounts()[0].status.state === "idle");
  const total = mail.accounts()[0].status;
  const { threads, labels } = checkRollups(account);
  const messages = threads.reduce((sum, thread) => sum + thread.count, 0);
  step(`${messages} messages in ${threads.length} threads (backfill ${total.backfill?.total ?? "done"}): roll-ups match their messages; ${labels.length} labels' unread counts match (${labels.map((l) => `${l.name} ${l.unread}`).join(", ")})`);

  const held = mail.thread(threads[0].id).messages.at(-1);
  const old = threads.at(-1);
  const oldMessage = mail.thread(old.id).messages[0];
  assert.ok(held.held && !oldMessage.held, "recent bodies are held, old ones are not");
  const ref = (message) => `fx${message.id.split(".")[1]}`;
  const times = [];
  for (const q of [ref(held), "budget", "budget review", "from:ada", "is:unread", "label:receipts has:attachment", "\"quoted (phrase\" AND OR * NEAR"]) {
    const [found, ms] = await timed(() => mail.search({ account, q }));
    times.push(`${q} ${found.length} in ${ms.toFixed(1)} ms`);
    assert.ok(ms < 100, `search "${q}" took ${ms.toFixed(1)} ms`);
  }
  const byRef = await mail.search({ account, q: ref(held) });
  assert.equal(byRef[0]?.id, threads[0].id, "a held body's words find its thread");
  assert.ok((await mail.search({ account, q: "is:unread" })).every((thread) => thread.unread));
  assert.ok((await mail.search({ account, q: "from:ada" })).every((thread) => thread.from.some((party) => /ada/i.test(party.address))));
  assert.ok(!(await mail.search({ account, q: ref(oldMessage) })).some((thread) => thread.id === old.id), "an old body is not held");
  assert.ok((await mail.search({ account, q: ref(oldMessage), remote: true })).some((thread) => thread.id === old.id), "the source finds it");
  step(`search: ${times.join("; ")}; the source finds old body text`);

  const body = await mail.body(oldMessage.id);
  assert.ok(body.markdown && mail.thread(old.id).messages[0].held, "an old body is fetched and then held");
  const withFile = (await mail.search({ account, q: "label:receipts" }))[0];
  const receipt = mail.thread(withFile.id).messages[0];
  const receiptBody = await mail.body(receipt.id);
  assert.ok(receiptBody.html && !/<script/i.test(receiptBody.html) && receiptBody.attachments.length);
  assert.ok((await mail.attachment(receipt.id, 0)).content.length > 0);
  step(`bodies: an old one fetched and held; HTML cleaned; attachment ${receiptBody.attachments[0].filename} read`);

  const target = mail.threads({ account }).threads[0];
  const [archived] = await mail.change({ threads: [target.id], remove: ["inbox"] });
  assert.ok(!archived.labels.includes("inbox") && !mail.threads({ account }).threads.some((thread) => thread.id === target.id));
  await mail.change({ threads: [target.id], add: ["inbox"], unread: false });
  assert.equal(mail.thread(target.id).thread.unread, 0);
  const before = mail.thread(target.id).thread;
  await assert.rejects(mail.change({ threads: [target.id], add: ["fail", "starred"], unread: true }), { reason: "refused" });
  assert.deepEqual(mail.thread(target.id).thread, before, "a refused change is put back");
  await mail.change({ threads: [target.id], unread: false });
  const settled = mail.thread(target.id).thread;
  await assert.rejects(mail.change({ threads: [target.id], add: ["fail-after-sync"], unread: true }), { reason: "refused" });
  const after = mail.thread(target.id).thread;
  assert.ok(after.unread === 0 && after.labels.includes("important") && !after.labels.includes("fail-after-sync") && !settled.labels.includes("fail-after-sync"),
    "a rollback leaves what the sync changed since");
  for (const bad of [{ add: "inbox" }, { unread: "false" }, { threads: target.id }, { trash: 1 }]) {
    await assert.rejects(mail.change({ threads: [target.id], ...bad }), { code: "bad_request" });
  }
  assert.equal(mail.threads({ account, label: "all", limit: 1000 }).threads.length, 100);
  assert.equal((await mail.search({ account, q: "budget", limit: 1000 })).length <= 100, true);
  step("archive, read, a refused change rolled back but not over the sync's newer labels; bad changes and limits refused or clamped");

  const original = mail.thread(target.id).messages.at(-1);
  const draft = await mail.newDraft({ account, reply: original.id, replyAll: true });
  assert.ok(draft.subject.startsWith("Re: ") && !/^Re: Re:/.test(draft.subject) && draft.thread === target.id && draft.state === "saving");
  assert.ok(![...draft.to, ...draft.cc].some((party) => party.address === "me@fixture.example") && draft.to.length);
  assert.match(draft.text, /\nOn .+ wrote:\n> /);
  await mail.saveDraft(draft.id, { text: `Sounds right to me.${draft.text}` });
  const saved = await waitFor("the draft at the source", () => mail.drafts(account).find((item) => item.id === draft.id && item.state === "saved"), 8000);
  const open = mail.thread(target.id);
  assert.ok(open.drafts.some((item) => item.id === draft.id) && open.thread.draft && open.thread.count === before.count, "the source's copy hides behind the draft");
  const sends = await Promise.allSettled([mail.sendDraft(saved.id), mail.sendDraft(saved.id)]);
  assert.deepEqual(sends.map((result) => result.status).sort(), ["fulfilled", "rejected"], "a second send at once is refused");
  assert.ok(!mail.drafts(account).some((item) => item.id === draft.id));
  const sent = await waitFor("the sent message", () => mail.thread(target.id).thread.count === before.count + 1 && mail.thread(target.id));
  assert.ok(sent.messages.at(-1).labels.includes("sent") && !sent.thread.draft);
  step("reply-all draft: prefilled, saved at the source, shown in its thread, sent and filed in Sent");

  const sourceDraft = mail.threads({ account, label: "drafts" }).threads[0];
  const draftMessage = mail.thread(sourceDraft.id).messages.find((message) => message.draft);
  await assert.rejects(mail.newDraft({ account, adopt: original.id }), { reason: "refused" });
  const adopted = await mail.newDraft({ account, adopt: draftMessage.id });
  assert.ok(adopted.text && adopted.state === "saved" && mail.thread(sourceDraft.id).thread.count === sourceDraft.count - 1);
  assert.equal((await mail.newDraft({ account, adopt: draftMessage.id })).id, adopted.id, "adopting twice gives the same draft");
  await mail.removeDraft(adopted.id);
  assert.ok(!mail.thread(sourceDraft.id)?.messages.some((message) => message.draft), "removing the draft removes the source's copy");
  step("a source draft adopted once (twice gives the same; a message that is not a draft is refused), then removed at both ends");

  const loose = openMailStore({ dir: path.join(dataRoot, "loose") });
  const bare = (key) => ({ key, thread: "t", seq: null, messageId: "", inReplyTo: null, references: [], from: { name: "", address: "a@b.c" }, to: [], cc: [], bcc: [],
    replyTo: [], subject: "s", date: Number(key), size: 1, unread: false, draft: false, labels: ["inbox"], attachments: false });
  loose.upsertMessages("x", [bare("1"), bare("2")]);
  loose.putDraft({ id: "d", account: "x", thread: null, messageId: "", to: [], cc: [], bcc: [], subject: "", text: "", reply: null, forward: null, updated: "", state: "saved" });
  assert.equal(loose.thread("x.t").messages.length, 2, "an empty Message-ID hides nothing");
  loose.close();

  const hostile = Buffer.from(["From: a@b.c", "To: d@e.f", "Subject: h", "Content-Type: text/html", "", `<base href="https://evil.example/"><p onclick="x()">Hi
<a href=" java\tscript:alert(1)">link</a><iframe src="https://x"></iframe><object data="x"></object><embed src="x"><form action="https://x"><input name="p">Kept</form>
<img src="https://img.example/a.png" onerror="x()"><a href="https://ok.example/">ok</a></p>`].join("\r\n"));
  const cleaned = (await readBody(hostile)).html;
  assert.doesNotMatch(cleaned, /onclick|onerror|javascript|<iframe|<object|<embed|<form|<input|<base|action=/i);
  assert.match(cleaned, /Kept/);
  assert.match(cleaned, /https:\/\/img\.example\/a\.png/);
  assert.match(cleaned, /https:\/\/ok\.example\//);
  step("HTML loses handlers, script links, frames, embeds, forms and <base>; remote images and links stay");

  const app = express();
  app.use(express.json());
  registerMailRoutes(app, { mail });
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/v0/mail`;
  const call = async (route, init) => {
    const response = await fetch(`${base}${route}`, init && { method: init.method, headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) });
    return { status: response.status, body: response.status === 204 ? null : await response.json().catch(() => null) };
  };
  assert.equal((await call("/accounts")).body.accounts[0].id, account);
  assert.equal((await call(`/threads?account=${account}&limit=5`)).body.threads.length, 5);
  assert.deepEqual((await call(`/threads/${account}.nope`)).status, 404);
  assert.equal((await call("/threads")).status, 400);
  assert.deepEqual(await call("/change", { method: "POST", body: { threads: [target.id], add: ["fail"] } }),
    { status: 400, body: { error: "refused", message: "The fixture refuses the label \"fail\"." } });
  assert.equal((await call(`/search?account=${account}&q=budget`)).body.threads.length > 0, true);
  assert.equal((await call("/change", { method: "POST", body: { threads: [target.id], unread: "false" } })).body.error, "bad_request");
  const download = await fetch(`${base}/messages/${receipt.id}/attachments/0`);
  assert.match(download.headers.get("content-disposition"), /^attachment; filename="?receipt-/);
  for (const bad of [{ sync: { since: 0 } }, { sync: { since: "forever" } }, { sync: { bodies: 2.5 } }, { sync: { paused: "yes" } }, { sync: 5 }, { name: 5 }]) {
    assert.equal((await call(`/accounts/${account}`, { method: "PATCH", body: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call("/accounts/nope", { method: "PATCH", body: { sync: { paused: true } } })).status, 404);
  assert.deepEqual((await call(`/accounts/${account}`, { method: "PATCH", body: { name: "Me" } })).body.account.sync, { paused: false, since: 1095, bodies: 90, tabs: ["promotions", "social", "updates"] });
  server.close();
  step("routes answer, with 404, 400 and a source's refusal as { error, message }; a PATCH with a reach that is not days or \"all\" is 400");

  const look = new DatabaseSync(path.join(dataRoot, "mail", "mail.db"), { readOnly: true });
  const one = (sql, ...args) => look.prepare(sql).get(...args).n;
  const heldNow = () => mail.accounts().find((item) => item.id === account).held;
  const full = heldNow();
  assert.ok(full.messages === one("SELECT count(*) AS n FROM messages WHERE account = ?", account) && full.bodies > 0 && full.bytes > 0 && full.total >= full.messages && full.oldest);
  const cut90 = reachStart(90);
  const older = one("SELECT count(*) AS n FROM messages WHERE account = ? AND date < ?", account, cut90);
  assert.ok(older > 20, "the fixture has mail older than 90 days");
  const shrunk = await mail.updateAccount(account, { sync: { since: 90, bodies: "all" } });
  assert.deepEqual(shrunk.sync, { paused: false, since: 90, bodies: 90, tabs: ["promotions", "social", "updates"] }, "text is kept no further back than mail");
  assert.deepEqual([shrunk.held.messages, shrunk.held.bodies], [full.messages, full.bodies], "a shorter reach drops nothing held");
  assert.ok(mail.message(oldMessage.id)?.held);
  step(`keep mail from 90 days: the ${older} older messages and their text stay; text reaches no further than mail`);

  const kept = await mail.newDraft({ account, subject: "Kept through a read-in", text: "Still here." });
  events.length = 0;
  await mail.resync(account);
  assert.ok(events.some((event) => event.account === account && event.accounts && !event.threads), "clients re-read everything");
  assert.ok(mail.drafts(account).some((item) => item.id === kept.id), "hub drafts stay");
  const idle = () => waitFor("the sync to settle", async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return mail.accounts()[0].status.state === "idle";
  });
  await idle();
  await mail.removeDraft(kept.id);
  const reached = heldNow();
  assert.equal(one("SELECT count(*) AS n FROM messages WHERE account = ? AND date < ?", account, reachStart(91)), 0, "read in again, nothing older than the reach");
  assert.ok(reached.messages > 0 && reached.messages < reached.total);
  checkRollups(account);
  step(`read in again with 90 days: ${reached.messages} of ${reached.total} messages, the hub's draft kept`);

  await mail.updateAccount(account, { sync: { since: 1095 } });
  await waitFor("the backfill of the longer reach", () => heldNow().messages === heldNow().total && mail.accounts()[0].status.state === "idle");
  checkRollups(account);
  step(`keep mail from 3 years: the backfill read in the ${heldNow().messages - reached.messages} older messages`);

  const bodiesHeld = heldNow().bodies;
  await mail.updateAccount(account, { sync: { bodies: 30 } });
  assert.equal(heldNow().bodies, bodiesHeld, "a shorter text reach drops no text");
  await mail.updateAccount(account, { sync: { bodies: 365 } });
  await waitFor("bodies of the longer text reach", () => one("SELECT count(*) AS n FROM messages WHERE account = ? AND held = 0 AND date >= ?", account, reachStart(365)) === 0);
  await idle();
  assert.equal(await rawFiles(path.join(dataRoot, "mail", "raw", account)), one("SELECT count(*) AS n FROM messages WHERE account = ? AND held = 1", account), "a raw file for each held body");
  step("keep text of a month kept the text held; a year fetched the rest");

  const paused = await mail.updateAccount(account, { sync: { paused: true } });
  assert.equal(paused.status.state, "off");
  const quiet = await mail.newDraft({ account, to: [{ name: "", address: "ada@example.com" }], subject: "While paused", text: "Sent while sync is paused." });
  await mail.sendDraft(quiet.id);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.ok(!(await mail.search({ account, q: "subject:paused" })).length, "nothing arrives while paused");
  await mail.updateAccount(account, { sync: { paused: false } });
  await waitFor("the paused send to arrive", async () => (await mail.search({ account, q: "subject:paused" })).length);
  look.close();
  step("paused: sync off, a send still went; resumed: what arrived meanwhile came in");

  const oldRoot = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-mail-check-old-"));
  await fs.mkdir(path.join(oldRoot, "mail"), { recursive: true });
  await fs.writeFile(path.join(oldRoot, "mail", "accounts.json"), JSON.stringify({ accounts: [{ id: "old1", kind: "fixture", address: "old@fixture.example", name: "Old", secret: "x", status: { state: "idle" } }] }));
  const seeded = openMailStore({ dir: path.join(oldRoot, "mail") });
  seeded.upsertMessages("old1", [{ ...bare("9"), key: "ancient", date: Date.now() - 2 * 365 * DAY }]);
  seeded.close();
  const second_ = await createMail({ dataRoot: oldRoot, changed: () => {} });
  try {
    const [loaded] = second_.accounts();
    assert.deepEqual(loaded.sync, { paused: false, since: 1095, bodies: 90, tabs: ["promotions", "social", "updates"] });
    await waitFor("the backfill", () => second_.accounts()[0].status.state === "idle");
    assert.ok(second_.message("old1.ancient"), "what was held from before the reach stays");
  } finally {
    await second_.stop();
    await fs.rm(oldRoot, { recursive: true, force: true });
  }
  step("an accounts.json from before sync choices starts with the defaults and keeps what it held from before the reach");

  const { id: second } = await mail.addAccount({ kind: "fixture", address: "two@fixture.example", secret: "x" });
  await waitFor("the second backfill", () => mail.accounts().find((item) => item.id === second)?.status.backfill);
  await mail.removeAccount(second);
  await new Promise((resolve) => setTimeout(resolve, 400));

  await mail.removeAccount(account);
  const db = new DatabaseSync(path.join(dataRoot, "mail", "mail.db"));
  for (const table of ["messages", "threads", "thread_labels", "labels", "cursors", "drafts"]) {
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE account IN (?, ?)`).get(account, second).n, 0, table);
  }
  assert.equal(db.prepare("SELECT count(*) AS n FROM search").get().n, 0);
  db.close();
  await assert.rejects(fs.stat(path.join(dataRoot, "mail", "raw", account)));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataRoot, "mail", "accounts.json"), "utf8")).accounts, []);
  step(`removing an account, one of them mid-backfill, left no rows or files (${events.length} change events in all)`);
  await mail.addAccount({ kind: "fixture", address: "three@fixture.example", secret: "x" });
  await waitFor("the third backfill", () => mail.accounts()[0].status.backfill);
} finally {
  await mail.stop();
  await new Promise((resolve) => setTimeout(resolve, 400));
  console.log("ok  stopped mid-backfill with nothing written after");
  await fs.rm(dataRoot, { recursive: true, force: true });
}
