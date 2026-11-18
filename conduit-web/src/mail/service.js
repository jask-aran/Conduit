import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { writePrivateJson } from "../private-file.js";
import { composeDraft, prefill } from "./compose.js";
import { attachmentOf, parseMail, readBody } from "./parse.js";
import { openMailStore } from "./store.js";

const NOTIFY_MS = 250;
const DRAFT_QUIET_MS = 2000;
const BODY_CACHE = 50;
const BODY_CACHE_BYTES = 16 * 1024 * 1024;
const LIMIT_MAX = 100;
// A page of 500 takes about 150 ms to drop on a 31k-message copy; 100 keeps each well inside what a request waits.
const PAGE = 100;
const HELD_MS = 2_000;
const SYNC = { paused: false, since: 1095, bodies: 90, tabs: ["promotions", "social", "updates"] };
const TABS = ["promotions", "social", "updates", "forums"];
const isTabs = (value) => Array.isArray(value) && value.every((tab) => TABS.includes(tab));

const notFound = (what) => Object.assign(new Error(`No such ${what}.`), { status: 404, code: "not_found" });
const refused = (message) => Object.assign(new Error(message), { reason: "refused" });
const badRequest = (message) => Object.assign(new Error(message), { status: 400, code: "bad_request" });
const clamp = (limit) => Math.min(Math.max(Math.trunc(Number(limit)) || 50, 1), LIMIT_MAX);
const strings = (value) => value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string"));
const flag = (value) => value === undefined || typeof value === "boolean";
const sameSet = (a, b) => a.length === b.length && a.every((item) => b.includes(item));
const tick = () => new Promise((resolve) => setImmediate(resolve));
const isReach = (value) => value === "all" || (Number.isInteger(value) && value > 0);
/** Whether reach `a` goes further back than `b`. */
const further = (a, b) => a === "all" ? b !== "all" : b !== "all" && a > b;
const clampBodies = (sync) => further(sync.bodies, sync.since) ? { ...sync, bodies: sync.since } : sync;
// A saved choice the hub cannot read falls back to the default rather than stopping the account.
const syncOf = (saved = {}) => clampBodies({
  paused: typeof saved.paused === "boolean" ? saved.paused : SYNC.paused,
  since: isReach(saved.since) ? saved.since : SYNC.since,
  bodies: isReach(saved.bodies) ? saved.bodies : SYNC.bodies,
  tabs: isTabs(saved.tabs) ? TABS.filter((tab) => saved.tabs.includes(tab)) : SYNC.tabs,
});
const parties = (list) => (Array.isArray(list) ? list : []).filter((party) => typeof party?.address === "string" && party.address.trim())
  .map((party) => ({ name: typeof party.name === "string" ? party.name : "", address: party.address.trim() }));
// What a client may write into a draft, each field checked; an absent field is left as it is.
const fields = (input = {}) => Object.fromEntries(Object.entries({
  to: input.to && parties(input.to), cc: input.cc && parties(input.cc), bcc: input.bcc && parties(input.bcc),
  subject: input.subject === undefined ? undefined : String(input.subject), text: input.text === undefined ? undefined : String(input.text),
}).filter(([, value]) => value !== undefined));

async function loadAdapter(kind) {
  if (kind === "gmail") return (await import("./gmail-adapter.js")).createGmailAdapter;
  if (kind === "fixture" && process.env.CONDUIT_MAIL_FIXTURE === "1") return (await import("./fixture-adapter.js")).createFixtureAdapter;
  throw Object.assign(new Error(`Conduit cannot read ${kind} accounts.`), { reason: "unsupported" });
}

/** The mail service of mail.d.ts. `changed(event)` publishes `{ account, threads?, accounts? }` on the runtime stream. */
export async function createMail({ dataRoot, changed }) {
  const dir = path.join(dataRoot, "mail");
  const file = path.join(dir, "accounts.json");
  const store = openMailStore({ dir });
  const saved = JSON.parse(await fs.readFile(file, "utf8").catch((error) => error.code === "ENOENT" ? "{\"accounts\":[]}" : Promise.reject(error))).accounts;
  const live = new Map();
  const persist = () => writePrivateJson(file, { accounts: [...live.values()].map(({ account: { status: _, ...account }, secret }) => ({ ...account, secret })) });

  // A backfill writes hundreds of threads a second; clients hear of them in one event per account every NOTIFY_MS.
  const queued = new Map();
  const flush = (account) => {
    const entry = queued.get(account);
    if (!entry) return;
    queued.delete(account);
    clearTimeout(entry.timer);
    // `all`: the account's mail was read in again from nothing, so clients re-read what they show rather than some threads.
    changed({ account, ...(entry.threads.size && !entry.all ? { threads: [...entry.threads] } : {}), ...(entry.accounts ? { accounts: true } : {}) });
  };
  const notify = (account, { threads = [], accounts = false, all = false } = {}, now = false) => {
    if (!threads.length && !accounts && !all) return;
    let entry = queued.get(account);
    if (!entry) queued.set(account, entry = { threads: new Set(), accounts: false, all: false, timer: setTimeout(() => flush(account), NOTIFY_MS) });
    for (const thread of threads) entry.threads.add(thread);
    entry.accounts ||= accounts;
    entry.all ||= all;
    if (now) flush(account);
  };

  // An adapter's task can still be running when its account is removed or the hub stops; from then on its store
  // refuses every call, so the task fails instead of writing rows for an account that is gone or a closed database.
  const guarded = (entry) => new Proxy(store, {
    get: (target, name) => typeof target[name] !== "function" ? target[name] : (...args) => {
      if (entry.closed) throw refused("This account has stopped.");
      return target[name](...args);
    },
  });
  async function connect(record, secret) {
    const entry = { account: { ...record, status: { state: "off" } }, secret, adapter: null, closed: false, held: null };
    const create = await loadAdapter(record.kind);
    entry.adapter = create({
      account: { id: record.id, kind: record.kind, address: record.address, name: record.name },
      sync: () => entry.account.sync,
      secret, store: guarded(entry), parse: parseMail,
      changed: (change) => entry.closed || notify(record.id, { threads: change.threads, all: Boolean(change.all) }),
      status: (status) => {
        if (entry.closed) return;
        entry.account.status = status;
        notify(record.id, { accounts: true });
      },
    });
    return entry;
  }
  async function close(entry) {
    entry.closed = true;
    await entry.adapter?.stop();
  }
  /** An account's entry, its adapter started; one whose adapter cannot load stands as an error. */
  async function open(record, secret) {
    const entry = await connect(record, secret).catch((error) => ({
      account: { ...record, status: { state: "error", error: error.message } }, secret, adapter: null, closed: false, held: null,
    }));
    live.set(record.id, entry);
    store.setTabs(record.id, syncOf(entry.account.sync).tabs);
    store.setSorting(record.id, record.address.toLowerCase());
    void resort(entry).catch((error) => console.warn("[mail] sorting failed:", error.message));
    entry.adapter?.start();
    void retext(entry).catch((error) => console.warn("[mail] re-reading held text failed:", error.message));
    return entry;
  }
  // Threads are sorted as they change; all of them again, a page at a time, when Conduit's rules or facts change (SORT_READ) or a rule is written (`again`).
  const SORT_READ = 1;
  async function resort(entry, again = false) {
    const id = entry.account.id;
    let at = again ? { read: 0, after: "" } : store.cursor(id, "sort") ?? { read: 0, after: "" };
    if (at.read >= SORT_READ) return;
    const mine = entry.sorting = {};
    for (;;) {
      if (entry.closed || entry.sorting !== mine) return;
      const last = store.resort(id, at.after, PAGE);
      at = last === null ? { read: SORT_READ, after: "" } : { read: 0, after: last };
      store.setCursor(id, "sort", at);
      if (last === null) return notify(id, { threads: [], all: true }, true);
      await tick();
    }
  }
  const sortAgain = (entry) => void resort(entry, true).catch((error) => console.warn("[mail] sorting failed:", error.message));

  // What a message's search text and snippet are read from changed (TEXT_READ): held ones are read again once, a page at a time.
  const TEXT_READ = 2;
  async function retext(entry) {
    const id = entry.account.id;
    let at = store.cursor(id, "text") ?? { read: 1, after: "" };
    if (at.read >= TEXT_READ) return;
    for (;;) {
      const keys = store.heldKeys(id, at.after, 25);
      for (const key of keys) {
        if (entry.closed) return;
        const raw = store.rawOf(id, key);
        if (raw) store.holdBody(id, key, raw, await parseMail(raw));
        await tick();
      }
      at = keys.length ? { read: at.read, after: keys.at(-1) } : { read: TEXT_READ, after: "" };
      store.setCursor(id, "text", at);
      if (!keys.length) return notify(id, { threads: [], all: true }, true);
    }
  }

  const publicAccount = (entry) => ({ ...entry.account, held: heldOf(entry) });
  function heldOf(entry) {
    if (entry.held && Date.now() - entry.held.at < HELD_MS) return entry.held.value;
    const found = store.held(entry.account.id);
    const total = entry.adapter?.total?.() ?? null;
    const value = {
      messages: found.messages, threads: found.threads, bodies: found.bodies,
      bytes: found.raw + Math.round(found.all ? store.dbBytes() * found.messages / found.all : 0),
      ...(found.oldest === null ? {} : { oldest: new Date(found.oldest).toISOString() }),
      ...(total === null ? {} : { total }),
    };
    entry.held = { at: Date.now(), value };
    return value;
  }

  for (const { secret, ...record } of saved) await open({ ...record, sync: syncOf(record.sync) }, secret);

  const entryOf = (account) => {
    const entry = live.get(account);
    if (!entry) throw notFound("account");
    return entry;
  };
  const adapterOf = (account) => {
    const { adapter } = entryOf(account);
    if (!adapter) throw Object.assign(new Error("This account is not connected."), { reason: "unsupported" });
    return adapter;
  };
  const messageOf = (id) => {
    const message = store.message(id);
    if (!message) throw notFound("message");
    return message;
  };
  // A message's raw bytes and one parse of them; a body fetched from the source is held with what that parse found.
  async function read(message, parse) {
    const kept = store.rawOf(message.account, message.key);
    const raw = kept ?? await adapterOf(message.account).raw(message.key);
    const parsed = await parse(raw);
    if (!kept) notify(message.account, store.holdBody(message.account, message.key, raw, parsed.hold ?? parsed));
    return { raw, parsed };
  }
  const rawOf = async (message) => store.rawOf(message.account, message.key) ?? (await read(message, parseMail)).raw;
  const textOf = async (message) => (await read(message, parseMail)).parsed.text;

  // Parsed bodies without their attachments' bytes, which are read from the raw again when one is asked for.
  const bodies = new Map();
  let cached = 0;
  const forget = (id) => {
    cached -= bodies.get(id)?.size ?? 0;
    bodies.delete(id);
  };
  async function parsedBody(id) {
    const hit = bodies.get(id);
    if (hit) {
      bodies.delete(id);
      bodies.set(id, hit);
      return hit.body;
    }
    const { parsed: body } = await read(messageOf(id), readBody);
    const size = 2 * (body.markdown.length + body.quoted.length + (body.html?.length ?? 0));
    bodies.set(id, { body, size });
    cached += size;
    while (bodies.size > BODY_CACHE || cached > BODY_CACHE_BYTES) forget(bodies.keys().next().value);
    return body;
  }

  // Drafts: the hub's copy is written at once; the source's follows once the person has paused typing.
  const timers = new Map();
  const pushing = new Map();
  const publicDraft = ({ messageId: _, ...draft }) => draft;
  const tellDraft = (draft) => {
    if (draft.thread) return notify(draft.account, { threads: [draft.thread] }, true);
    flush(draft.account);
    changed({ account: draft.account });
  };
  const fromOf = (account) => ({ name: entryOf(account).account.name, address: entryOf(account).account.address });
  async function rawDraft(draft, keepBcc) {
    const original = draft.reply ? store.message(draft.reply) : null;
    const forwarded = draft.forward ? store.message(draft.forward) : null;
    return composeDraft(draft, { from: fromOf(draft.account), original, forwardRaw: forwarded ? await rawOf(forwarded) : null, keepBcc });
  }
  const settle = async (id) => {
    clearTimeout(timers.get(id));
    timers.delete(id);
    await pushing.get(id)?.catch(() => {});
  };
  function schedule(id) {
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      const run = push(id).finally(() => pushing.get(id) === run && pushing.delete(id));
      pushing.set(id, run);
    }, DRAFT_QUIET_MS));
  }
  async function push(id) {
    await pushing.get(id)?.catch(() => {});
    const draft = store.draft(id);
    if (!draft || draft.state !== "saving") return;
    let failure = null;
    try {
      const adapter = adapterOf(draft.account);
      if (adapter.saveDraft) await adapter.saveDraft(draft.messageId, (await rawDraft(draft, true)).raw);
    } catch (error) {
      failure = error.reason ? error.message : "The draft could not be copied to the mail server; it is kept here.";
    }
    const now = store.draft(id);
    // A save that came in while this one was on its way has its own push coming.
    if (!now || now.updated !== draft.updated || now.state !== "saving") return;
    const next = { ...now, state: failure ? "failed" : "saved" };
    if (failure) next.error = failure;
    else delete next.error;
    store.putDraft(next);
    tellDraft(next);
  }

  // A restart can come between a save and its push, or in the middle of a send.
  for (const id of live.keys()) {
    for (const { id: draftId, state } of store.drafts(id)) {
      if (state === "saving") schedule(draftId);
      if (state === "sending") store.putDraft({ ...store.draft(draftId), state: "failed", error: "Conduit stopped while sending this; look in Sent before sending it again." });
    }
  }

  const service = {
    accounts: () => [...live.values()].map(publicAccount),

    async addAccount({ kind, address, secret, name }) {
      if (!["gmail", "fixture"].includes(kind) || typeof address !== "string" || !address.includes("@") || typeof secret !== "string" || !secret) {
        throw refused("An account needs its kind, an email address and its password.");
      }
      if ([...live.values()].some(({ account }) => account.kind === kind && account.address.toLowerCase() === address.trim().toLowerCase())) {
        throw refused("That account is already added.");
      }
      const record = { id: crypto.randomBytes(4).toString("hex"), kind, address: address.trim(), name: (name || "").trim() || address.trim(), sync: syncOf() };
      const entry = await connect(record, secret);
      await entry.adapter.verify().catch(async (error) => {
        await close(entry);
        throw error;
      });
      live.set(record.id, entry);
      await persist();
      entry.adapter.start();
      notify(record.id, { accounts: true }, true);
      return publicAccount(entry);
    },

    async updateAccount(id, input) {
      const entry = entryOf(id);
      if (entry.closed) throw refused("This account is being read in again; change it once that has started.");
      const { name, sync: asked } = input && typeof input === "object" ? input : {};
      if ((name !== undefined && typeof name !== "string") || (asked !== undefined && (!asked || typeof asked !== "object"))
        || !flag(asked?.paused) || ![asked?.since, asked?.bodies].every((reach) => reach === undefined || isReach(reach))
        || !(asked?.tabs === undefined || isTabs(asked.tabs))) {
        throw badRequest("A reach is a whole number of days above 0 or \"all\", and paused is true or false.");
      }
      const sync = syncOf({ ...entry.account.sync, ...Object.fromEntries(Object.entries(asked ?? {}).filter(([key, value]) => key in SYNC && value !== undefined)) });
      entry.account = { ...entry.account, ...(name === undefined ? {} : { name: name.trim() || entry.account.address }), sync };
      // A shorter reach only stops reading further back: what is already held stays.
      await persist();
      entry.adapter?.configure?.();
      entry.held = null;
      const sorted = store.setTabs(id, sync.tabs);
      if (sorted.threads.length) notify(id, { threads: [], all: true }, true);
      notify(id, { accounts: true }, true);
      return publicAccount(entry);
    },

    /** An account's sorting rules in the order tried, and the categories they give. */
    rules(id) {
      entryOf(id);
      return { rules: store.rules(id), categories: store.labels(id).filter((label) => label.role === "sort").map((label) => ({ id: label.id.slice("sort-".length), name: label.name, threads: label.threads })) };
    },
    /** Keeps a rule (a new one is tried first) and sorts the account's mail again. */
    putRule(id, rule) {
      const kept = store.putRule(id, rule);
      sortAgain(entryOf(id));
      return kept;
    },
    removeRule(id, rule) {
      if (!store.removeRule(entryOf(id).account.id, rule)) throw notFound("rule");
      sortAgain(entryOf(id));
    },

    async resync(id) {
      const old = entryOf(id);
      if (old.closed) throw refused("This account is being read in again already.");
      const { status: _, ...record } = old.account;
      await close(old);
      const pending = store.drafts(id).filter((draft) => draft.state === "saving").map((draft) => draft.id);
      for (const draft of store.drafts(id)) await settle(draft.id);
      for (let count = PAGE; count === PAGE;) {
        count = store.prune(id, Number.MAX_SAFE_INTEGER, PAGE).count;
        await tick();
      }
      store.clearCursors(id);
      for (const key of [...bodies.keys()]) if (key.startsWith(`${id}.`)) forget(key);
      if (live.get(id) !== old) return publicAccount(entryOf(id));
      const entry = await open(record, old.secret);
      for (const draft of pending) if (store.draft(draft)?.state === "saving") schedule(draft);
      notify(id, { all: true, accounts: true }, true);
      return publicAccount(entry);
    },

    async removeAccount(id) {
      const entry = entryOf(id);
      live.delete(id);
      await close(entry);
      for (const draft of store.drafts(id)) await settle(draft.id);
      queued.delete(id);
      store.dropAccount(id);
      for (const key of [...bodies.keys()]) if (key.startsWith(`${id}.`)) forget(key);
      await persist();
      changed({ account: id, accounts: true });
    },

    labels: (account) => (entryOf(account), store.labels(account)),
    threads: (query) => (entryOf(query.account), store.threads({ ...query, limit: clamp(query.limit) })),

    message(id) {
      const found = store.message(id);
      if (!found) return null;
      const { key: _key, seq: _seq, messageId: _id, inReplyTo: _reply, references: _references, replyTo: _replyTo, ...message } = found;
      return message;
    },

    thread(id) {
      const found = store.thread(id);
      return found && { ...found, drafts: store.drafts(found.thread.account, id) };
    },

    async body(id) {
      const { markdown, quoted, html, attachments } = await parsedBody(id);
      return { message: id, markdown, quoted, html, attachments };
    },

    async attachment(id, index) {
      const item = (await parsedBody(id)).attachments[index];
      if (!item) return null;
      const content = await attachmentOf(await rawOf(messageOf(id)), index);
      return content && { filename: item.filename, mimeType: item.mimeType, content };
    },

    async change(change) {
      if (!change || typeof change !== "object" || !["threads", "messages", "add", "remove"].every((key) => strings(change[key]))
        || !["unread", "trash"].every((key) => flag(change[key]))) {
        throw badRequest("A change takes lists of ids and labels, and unread and trash as true or false.");
      }
      const rows = store.messagesFor(change);
      const threads = new Set(rows.map((row) => store.message(row.id).thread));
      const byAccount = Map.groupBy(rows, (row) => row.account);
      for (const [account, list] of byAccount) {
        const adapter = adapterOf(account);
        const keys = list.map((row) => row.key);
        if (change.trash) {
          await adapter.apply({ kind: "trash", keys });
          notify(account, store.removeMessages(account, keys), true);
          continue;
        }
        const add = change.add || [];
        const remove = change.remove || [];
        const labelled = add.length > 0 || remove.length > 0;
        const set = new Map(list.map((row) => [row.key, {
          ...(change.unread === undefined ? {} : { unread: change.unread }),
          ...(labelled ? { labels: [...new Set([...row.labels.filter((label) => !remove.includes(label)), ...add])] } : {}),
        }]));
        notify(account, store.patchMessages(account, list.map((row) => ({ key: row.key, ...set.get(row.key) }))), true);
        let applied = false;
        try {
          if (labelled) await adapter.apply({ kind: "labels", keys, add, remove });
          applied = true;
          if (change.unread !== undefined) await adapter.apply({ kind: "unread", keys, unread: change.unread });
        } catch (error) {
          // Only what still reads as this change wrote it goes back: a field the sync has changed since is the source's word.
          const now = new Map(store.messagesFor({ messages: list.map((row) => row.id) }).map((row) => [row.key, row]));
          const back = list.map((row) => {
            const wrote = set.get(row.key);
            const current = now.get(row.key);
            const patch = { key: row.key };
            if (!current) return patch;
            if (wrote.labels && !applied && sameSet(current.labels, wrote.labels)) patch.labels = row.labels;
            if (wrote.unread !== undefined && current.unread === wrote.unread) patch.unread = row.unread;
            return patch;
          }).filter((patch) => Object.keys(patch).length > 1);
          notify(account, store.patchMessages(account, back), true);
          throw error;
        }
      }
      return store.threadsOf([...threads]);
    },

    async search({ account, q, remote = false, limit: asked }) {
      const limit = clamp(asked);
      const adapter = remote ? adapterOf(account) : (entryOf(account), null);
      const local = store.search({ account, q, limit });
      if (!adapter?.search) return local;
      const keys = await adapter.search(q, limit);
      const seen = new Set(local.map((thread) => thread.id));
      const found = [...new Set(keys.map((key) => store.message(`${account}.${key}`)?.thread).filter((id) => id && !seen.has(id)))];
      return [...local, ...store.threadsOf(found).sort((a, b) => b.date.localeCompare(a.date))].slice(0, limit);
    },

    drafts: (account) => (entryOf(account), store.drafts(account)),

    async newDraft({ account, reply, replyAll, forward, adopt, ...input }) {
      const { address } = fromOf(account);
      const base = { id: crypto.randomBytes(8).toString("hex"), account, thread: null, to: [], cc: [], bcc: [], subject: "", text: "",
        reply: null, forward: null, messageId: `<${crypto.randomUUID()}@${address.split("@")[1]}>` };
      const original = adopt || reply || forward ? messageOf(adopt || reply || forward) : null;
      if (original && original.account !== account) throw notFound("message");
      let draft;
      if (adopt) {
        if (!original.draft) throw refused("Only a draft can be taken over.");
        if (!original.messageId) throw refused("This draft cannot be taken over: it has no Message-ID.");
        const existing = store.drafts(account).map((item) => store.draft(item.id)).find((item) => item.messageId === original.messageId);
        if (existing) return publicDraft(existing);
        const text = await textOf(original);
        const answered = original.inReplyTo && store.thread(original.thread)?.messages.map((message) => store.message(message.id))
          .find((message) => message.messageId === original.inReplyTo);
        draft = { ...base, thread: original.thread, to: original.to, cc: original.cc, bcc: original.bcc, subject: original.subject,
          text, reply: answered?.id ?? null, messageId: original.messageId, state: "saved" };
      } else {
        const filled = original ? prefill(forward ? "forward" : replyAll ? "replyAll" : "reply", original,
          { own: address, text: await textOf(original) }) : {};
        draft = { ...base, ...filled, thread: original?.thread ?? null, reply: reply ? original.id : null, forward: forward ? original.id : null, state: "saving" };
      }
      const edits = fields(input);
      if (Object.keys(edits).length) Object.assign(draft, edits, { state: "saving" });
      draft.updated = new Date().toISOString();
      store.putDraft(draft);
      tellDraft(draft);
      if (draft.state === "saving") schedule(draft.id);
      return publicDraft(draft);
    },

    async saveDraft(id, input) {
      const before = store.draft(id);
      if (!before) throw notFound("draft");
      if (before.state === "sending") throw refused("This draft is being sent.");
      const draft = { ...before, updated: new Date().toISOString(), state: "saving" };
      delete draft.error;
      Object.assign(draft, fields(input));
      store.putDraft(draft);
      tellDraft(draft);
      schedule(id);
      return publicDraft(draft);
    },

    async removeDraft(id) {
      const draft = store.draft(id);
      if (!draft) throw notFound("draft");
      if (draft.state === "sending") throw refused("This draft is being sent.");
      await settle(id);
      await adapterOf(draft.account).saveDraft?.(draft.messageId, null);
      store.removeDraft(id);
      tellDraft(draft);
    },

    async sendDraft(id) {
      const before = store.draft(id);
      if (!before) throw notFound("draft");
      if (before.state === "sending") throw refused("This draft is already being sent.");
      if (![...before.to, ...before.cc, ...before.bcc].length) throw refused("Add someone to send this to.");
      const adapter = adapterOf(before.account);
      // Claimed before the first await, so a second send of the same draft is refused rather than sent again.
      const draft = { ...before, state: "sending" };
      delete draft.error;
      store.putDraft(draft);
      tellDraft(draft);
      await settle(id);
      try {
        const { raw, envelope } = await rawDraft(draft, false);
        await adapter.send(raw, envelope);
      } catch (error) {
        const failed = { ...draft, state: "failed", error: error.reason ? error.message : "The message could not be sent." };
        store.putDraft(failed);
        tellDraft(failed);
        throw error;
      }
      // Sent already: a source draft left behind is cleared up at the next save or sync, not worth failing the send for.
      await adapter.saveDraft?.(draft.messageId, null).catch(() => {});
      store.removeDraft(id);
      tellDraft(draft);
      adapter.poke?.();
    },

    async stop() {
      for (const id of timers.keys()) clearTimeout(timers.get(id));
      await Promise.all([...pushing.values()].map((run) => run.catch(() => {})));
      await Promise.all([...live.values()].map(close));
      for (const account of [...queued.keys()]) flush(account);
      store.close();
    },
  };
  return service;
}
