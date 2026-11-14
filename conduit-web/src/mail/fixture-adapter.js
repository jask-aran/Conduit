import MailComposer from "nodemailer/lib/mail-composer";
import PostalMime from "postal-mime";
import { reachStart } from "./store.js";

/*
 * A made-up mailbox behind the MailAdapter contract, for scripts/mail-check.mjs and the pane before a real account is
 * added. The same seed always gives the same mail; dates count back from the hour the account first started.
 */
const DAY = 86_400_000;
const PAGE = 50;
const PAUSE = 150;
const LIVE_EVERY = 20_000;

const PEOPLE = ["Ada Lovelace", "Grace Hopper", "Alan Turing", "Katherine Johnson", "Linus Pauling", "Rosalind Franklin",
  "Tim Berners-Lee", "Hedy Lamarr", "Claude Shannon", "Barbara Liskov", "Edsger Dijkstra", "Margaret Hamilton",
  "Donald Knuth", "Frances Allen", "Ken Thompson", "Radia Perlman", "John McCarthy", "Mary Somerville",
  "Niklaus Wirth", "Sophie Wilson"].map((name, index) => ({
  name, address: `${name.split(" ")[0].toLowerCase()}@${["example.com", "example.org", "example.net", "mail.example"][index % 4]}`,
}));
const SHOPS = [{ name: "Northwind Books", address: "orders@northwind.example" }, { name: "Corner Grocer", address: "receipts@grocer.example" }];
const TRAVEL = { name: "Harbour Air", address: "bookings@harbourair.example" };
const NEWS = { name: "The Weekly Byte", address: "news@weeklybyte.example" };
const TOPICS = ["quarterly plan", "garden fence", "conference talk", "budget review", "birthday dinner", "server migration",
  "book club", "kitchen renovation", "hiring loop", "launch checklist", "camping trip", "piano lessons", "tax return",
  "design critique", "board meeting", "moving house", "research draft", "team offsite", "car service", "wedding photos"];
const WORDS = ("the a we should could maybe next week friday morning meeting notes draft plan budget numbers review idea "
  + "thanks again quick question about schedule update attached version change prefer earlier later works fine sounds good "
  + "please confirm details tomorrow agenda summary follow decision options cost timeline lunch call sorry delay happy").split(" ");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const mailError = (reason, message) => Object.assign(new Error(message), { reason });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function world(own, anchor) {
  const rng = random(20261115);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const sentence = () => {
    const words = Array.from({ length: 6 + Math.floor(rng() * 10) }, () => pick(WORDS));
    return `${words.join(" ").replace(/^./, (c) => c.toUpperCase())}.`;
  };
  const paragraph = () => Array.from({ length: 2 + Math.floor(rng() * 3) }, sentence).join(" ");
  const me = { name: "Fixture Owner", address: own };
  const threads = [];
  for (let index = 0; index < 150; index++) {
    const roll = rng();
    const kind = roll < 0.12 ? "receipt" : roll < 0.2 ? "travel" : roll < 0.25 ? "news" : "person";
    const r = rng();
    const length = kind === "receipt" || kind === "news" ? 1
      : r < 0.3 ? 1 : r < 0.6 ? 2 : r < 0.82 ? 3 + Math.floor(rng() * 2) : r < 0.94 ? 5 + Math.floor(rng() * 3) : 9 + Math.floor(rng() * 6);
    const others = kind === "person" ? [...new Set(Array.from({ length: 1 + Math.floor(rng() * 3) }, () => pick(PEOPLE)))] : [kind === "travel" ? TRAVEL : kind === "news" ? NEWS : pick(SHOPS)];
    const topic = pick(TOPICS);
    const subject = { person: `${topic.replace(/^./, (c) => c.toUpperCase())}`, receipt: `Your receipt #${1000 + index}`,
      travel: `Booking confirmed: flight ${100 + index}`, news: `This week: ${topic}` }[kind];
    let at = anchor - rng() * 240 * DAY;
    const archived = anchor - at > 30 * DAY && rng() < 0.6;
    const starred = rng() < 0.08;
    const important = kind === "person" && rng() < 0.2;
    const messages = [];
    for (let at2 = 0; at2 < length; at2++) {
      const from = at2 === 0 ? (kind === "person" && rng() < 0.3 ? me : others[0]) : messages[at2 - 1].from === me ? pick(others) : rng() < 0.6 ? me : pick(others);
      const html = kind !== "person";
      const files = kind === "receipt" ? [{ filename: `receipt-${1000 + index}.pdf`, contentType: "application/pdf", content: Buffer.from(`%PDF-1.4\n% receipt ${index}\n%%EOF\n`) }]
        : kind === "travel" && at2 === 0 ? [{ filename: "itinerary.ics", contentType: "text/calendar", content: Buffer.from(`BEGIN:VCALENDAR\nSUMMARY:Flight ${100 + index}\nEND:VCALENDAR\n`) }]
        : kind === "person" && rng() < 0.06 ? [rng() < 0.5 ? { filename: "notes.txt", contentType: "text/plain", content: Buffer.from(paragraph()) } : { filename: "photo.png", contentType: "image/png", content: PNG }]
        : [];
      messages.push({ from, html, files, text: Array.from({ length: 1 + Math.floor(rng() * 3) }, paragraph).join("\n\n"), at: Math.min(at, anchor - 600_000), roll: rng() });
      at += rng() * 36 * 3_600_000;
    }
    threads.push({ kind, others, subject, archived, starred, important, messages });
  }
  const all = threads.flatMap((thread) => thread.messages.map((message, position) => ({ thread, message, position })))
    .sort((a, b) => a.message.at - b.message.at);
  const byThread = new Map();
  const out = all.map(({ thread, message, position }, index) => {
    const key = String(1_000_000 + index);
    if (!byThread.has(thread)) byThread.set(thread, []);
    const earlier = byThread.get(thread);
    const recipients = message.from === me ? thread.others : [me, ...thread.others.filter((party) => party !== message.from)];
    const mine = message.from === me;
    const age = anchor - message.at;
    const previous = earlier[earlier.length - 1];
    const labels = mine ? ["sent"] : thread.archived ? [] : ["inbox"];
    if (thread.important) labels.push("important");
    if (thread.kind === "receipt") labels.push("l-receipts");
    if (thread.kind === "travel") labels.push("l-travel");
    if (thread.starred && position === thread.messages.length - 1) labels.push("starred");
    const text = `${message.text}\n\nref fx${key}${previous ? `\n\nOn ${new Date(previous.date).toUTCString()}, ${previous.from.name} wrote:\n${previous.text.split("\n").map((line) => `> ${line}`).join("\n")}` : ""}`;
    const entry = {
      key, thread: earlier[0]?.key ?? key, seq: index + 1, messageId: `<fx${key}@fixture.example>`,
      inReplyTo: previous?.messageId ?? null, references: earlier.map((item) => item.messageId),
      from: message.from, to: recipients.slice(0, 2), cc: recipients.slice(2), bcc: [], replyTo: [],
      subject: previous ? `Re: ${thread.subject}` : thread.subject, date: message.at, unread: !mine && (age < 14 * DAY ? message.roll < 0.5 : message.roll < 0.04),
      draft: false, labels, text, html: message.html, files: message.files,
    };
    earlier.push(entry);
    return entry;
  });
  const recent = [...byThread.values()].reverse().find((list) => list[list.length - 1].from !== me && list.length > 1);
  if (recent) {
    const last = recent[recent.length - 1];
    out.push({ ...last, key: String(1_000_000 + out.length), seq: out.length + 1, messageId: `<fx-draft@fixture.example>`, from: me, to: [last.from], cc: [], inReplyTo: last.messageId,
      references: [...last.references, last.messageId], subject: last.subject.replace(/^(Re: )?/, "Re: "), date: anchor - 3_600_000, unread: false, draft: true,
      labels: ["drafts"], text: "Half a reply, written at the source and not sent yet.", html: false, files: [] });
  }
  return { me, messages: out };
}

async function build(entry) {
  const address = (party) => ({ name: party.name, address: party.address });
  const html = entry.html ? `<html><head><style>p{color:#333}</style></head><body><table role="presentation"><tr><td>${entry.text.split("\n\n").map((part) => `<p>${part}</p>`).join("")}</td></tr></table></body></html>` : undefined;
  return new MailComposer({
    from: address(entry.from), to: entry.to.map(address), cc: entry.cc.map(address), subject: entry.subject, date: new Date(entry.date),
    messageId: entry.messageId, ...(entry.inReplyTo ? { inReplyTo: entry.inReplyTo, references: entry.references } : {}),
    text: entry.text, html, attachments: entry.files,
  }).compile().build();
}

const stored = (entry) => ({
  key: entry.key, thread: entry.thread, seq: entry.seq, messageId: entry.messageId, inReplyTo: entry.inReplyTo, references: entry.references,
  from: entry.from, to: entry.to, cc: entry.cc, bcc: entry.bcc, replyTo: entry.replyTo, subject: entry.subject, date: entry.date,
  size: entry.raw?.length ?? entry.text.length + 600, unread: entry.unread, draft: entry.draft, labels: entry.labels,
  attachments: entry.files.length > 0, snippet: entry.text.slice(0, 120).replace(/\s+/g, " "),
});

export function createFixtureAdapter(ctx) {
  const { store } = ctx;
  const account = ctx.account.id;
  const anchor = store.cursor(account, "anchor") ?? Math.floor(Date.now() / 3_600_000) * 3_600_000;
  store.setCursor(account, "anchor", anchor);
  const { me, messages } = world(ctx.account.address, anchor);
  const byKey = new Map(messages.map((entry) => [entry.key, entry]));
  let next = messages.length;
  let running = false;
  // Reading in: started and not paused. `run` counts readings, so a pause or a new reach ends the one under way.
  let syncing = false;
  let run = 0;
  // Work the adapter started on its own; stop() waits for it, and a stopped account's store refusing it is no fault.
  const tasks = new Set();
  const track = (promise) => {
    const task = promise.catch((error) => running && ctx.status({ state: "error", error: error.message })).finally(() => tasks.delete(task));
    tasks.add(task);
  };
  let live = null;
  const pending = [];

  const rawOf = async (entry) => entry.raw ?? build(entry);
  async function sync(entries) {
    const change = store.upsertMessages(account, entries.map(stored));
    const threads = new Set(change.threads);
    const bodies = reachStart(ctx.sync().bodies) ?? 0;
    for (const entry of entries.filter((item) => item.date >= bodies || item.raw)) {
      const raw = await rawOf(entry);
      for (const id of store.holdBody(account, entry.key, raw, await ctx.parse(raw)).threads) threads.add(id);
    }
    ctx.changed({ threads: [...threads] });
  }
  /** What the reach holds and the store lacks, newest first, then the bodies the text reach lacks; then new mail as it comes. */
  async function read(reading) {
    const going = () => syncing && reading === run;
    pending.length = 0;
    ctx.status({ state: "connecting" });
    const since = reachStart(ctx.sync().since) ?? -Infinity;
    const reached = messages.filter((entry) => entry.date >= since).sort((a, b) => b.date - a.date);
    const keys = reached.map((entry) => entry.key);
    const have = new Set(Array.from({ length: Math.ceil(keys.length / 500) }, (_, index) => keys.slice(index * 500, (index + 1) * 500))
      .flatMap((part) => store.seqsOfKeys(account, part)).map((row) => row.key));
    const missing = reached.filter((entry) => !have.has(entry.key));
    for (let done = 0; done < missing.length && going(); done += PAGE) {
      ctx.status({ state: "syncing", backfill: { done: reached.length - missing.length + done, total: reached.length }, at: new Date().toISOString() });
      await sync(missing.slice(done, done + PAGE));
      await sleep(PAUSE);
    }
    const skip = new Set();
    while (going()) {
      const bodiless = store.bodiless(account, reachStart(ctx.sync().bodies) ?? 0, skip.size + PAGE).filter((row) => !skip.has(row.key));
      if (!bodiless.length) break;
      ctx.status({ state: "syncing", at: new Date().toISOString() });
      for (const row of bodiless) skip.add(row.key);
      await sync(bodiless.map((row) => byKey.get(row.key)).filter(Boolean));
    }
    if (!going()) return;
    ctx.status({ state: "idle", at: new Date().toISOString() });
    if (process.env.CONDUIT_MAIL_FIXTURE_LIVE === "1") {
      live = setInterval(() => {
        const from = PEOPLE[next % PEOPLE.length];
        const entry = { key: String(1_000_000 + next++), seq: next, messageId: `<fx-live-${next}@fixture.example>`, inReplyTo: null, references: [],
          from, to: [me], cc: [], bcc: [], replyTo: [], subject: `Just now: ${TOPICS[next % TOPICS.length]}`, date: Date.now(), unread: true,
          draft: false, labels: ["inbox"], text: `A new message, ref fx${next}.`, html: false, files: [] };
        entry.thread = entry.key;
        messages.push(entry);
        byKey.set(entry.key, entry);
        track(sync([entry]));
      }, LIVE_EVERY);
    }
  }
  async function arrive(raw, labels, draft) {
    const mail = await PostalMime.parse(raw);
    const parent = messages.find((entry) => entry.messageId === mail.inReplyTo);
    const key = String(1_000_000 + next++);
    const party = (item) => ({ name: item.name || "", address: item.address || "" });
    const entry = {
      key, thread: parent?.thread ?? key, seq: next, messageId: mail.messageId || `<fx${key}@fixture.example>`, inReplyTo: mail.inReplyTo || null,
      references: (mail.references || "").split(/\s+/).filter(Boolean), from: mail.from ? party(mail.from) : me,
      to: (mail.to || []).map(party), cc: (mail.cc || []).map(party), bcc: (mail.bcc || []).map(party), replyTo: [],
      subject: mail.subject || "", date: Date.now(), unread: false, draft, labels, text: mail.text || "", html: false,
      files: mail.attachments.map((part) => ({ filename: part.filename })), raw,
    };
    messages.push(entry);
    byKey.set(key, entry);
    return entry;
  }

  return {
    async verify() {
      if (ctx.secret === "wrong") throw mailError("credentials", "The fixture turns away the password \"wrong\".");
    },
    start() {
      running = true;
      store.putLabels(account, [
        { id: "inbox", name: "Inbox", role: "inbox" }, { id: "starred", name: "Starred", role: "starred" },
        { id: "important", name: "Important", role: "important" }, { id: "sent", name: "Sent", role: "sent" },
        { id: "drafts", name: "Drafts", role: "drafts" }, { id: "l-receipts", name: "Receipts", role: null }, { id: "l-travel", name: "Travel", role: null },
      ]);
      syncing = !ctx.sync().paused;
      if (syncing) track(read(++run));
      else ctx.status({ state: "off" });
    },
    configure() {
      if (!running) return;
      run++;
      clearInterval(live);
      syncing = !ctx.sync().paused;
      if (syncing) track(read(run));
      else ctx.status({ state: "off" });
    },
    total: () => messages.length,
    async stop() {
      running = false;
      syncing = false;
      run++;
      clearInterval(live);
      await Promise.all(tasks);
    },
    async apply(change) {
      const labels = change.kind === "labels" ? [...change.add, ...change.remove] : [];
      if (labels.includes("fail")) throw mailError("refused", "The fixture refuses the label \"fail\".");
      // As if a sync had marked these important at the source while the change was on its way, which then refused it.
      if (labels.includes("fail-after-sync")) {
        const moved = change.keys.map((key) => byKey.get(key)).filter(Boolean);
        for (const entry of moved) entry.labels = [...new Set([...entry.labels, "important"])];
        ctx.changed(store.patchMessages(account, moved.map((entry) => ({ key: entry.key, labels: entry.labels }))));
        throw mailError("refused", "The fixture changed these and then refused the change.");
      }
      for (const key of change.keys) {
        const entry = byKey.get(key);
        if (!entry) continue;
        if (change.kind === "trash") { byKey.delete(key); messages.splice(messages.indexOf(entry), 1); }
        else if (change.kind === "unread") entry.unread = change.unread;
        else entry.labels = [...new Set([...entry.labels.filter((label) => !change.remove.includes(label)), ...change.add])];
      }
    },
    async raw(key) {
      const entry = byKey.get(key);
      if (!entry) throw mailError("refused", "That message is no longer in the fixture.");
      return rawOf(entry);
    },
    async search(query, limit) {
      const words = query.toLowerCase().split(/\s+/).filter((word) => word && !word.includes(":"));
      if (!words.length) return [];
      const found = messages.filter((entry) => {
        const text = `${entry.subject} ${entry.from.name} ${entry.from.address} ${entry.text}`.toLowerCase();
        return words.every((word) => text.includes(word));
      }).sort((a, b) => b.date - a.date).slice(0, limit);
      store.upsertMessages(account, found.map(stored));
      return found.map((entry) => entry.key);
    },
    async send(raw) {
      pending.push(await arrive(raw, ["sent"], false));
    },
    async saveDraft(messageId, raw) {
      const old = messages.filter((entry) => entry.draft && entry.messageId === messageId);
      for (const entry of old) { byKey.delete(entry.key); messages.splice(messages.indexOf(entry), 1); }
      if (old.length) ctx.changed(store.removeMessages(account, old.map((entry) => entry.key)));
      if (raw) await sync([await arrive(raw, ["drafts"], true)]);
    },
    poke() {
      if (syncing) track(sync(pending.splice(0)));
    },
  };
}
