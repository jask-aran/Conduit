import { ImapFlow as RealImapFlow } from "imapflow";
import { createTransport as realCreateTransport } from "nodemailer";

/*
 * Gmail over IMAP and SMTP with an app password (docs/plans/email.md). All Mail is the one mailbox synced: every
 * message is in it once, keyed by X-GM-MSGID, threaded by X-GM-THRID, labelled by X-GM-LABELS. A "watch" connection
 * idles there to hear of changes; a "work" connection runs every command, one at a time, the person's first.
 * Nothing Gmail-specific leaves this file.
 */
const IMAP = { host: "imap.gmail.com", port: 993, secure: true };
const SMTP = { host: "smtp.gmail.com", port: 465, secure: true };
const FIRST_WINDOW = 200;
const WINDOW = 500;
const PAGE = 500;
const BODY_BATCH = 25;
const BODY_MAX = 10 * 1024 * 1024;
const RECENT_MS = 90 * 24 * 3600_000;
const POLL_MS = 45_000;
const SWEEP_MS = 10 * 60_000;
const EXPUNGE_SETTLE_MS = 5_000;
const NO_CONDSTORE_TAIL = 2_000;
const BACKOFF_MIN_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;
const LIMIT_WAIT_MS = 5 * 60_000;
const READY_WAIT_MS = 30_000;
const STATUS_REPEAT_MS = 30_000;
const SEARCH_MAX = 100;
const SEARCH_PAGE = 25;

const SAY = {
  credentials: "Gmail refused the app password. Make a new one at myaccount.google.com/apppasswords and enter it again.",
  network: "Gmail can't be reached right now.",
  limit: "Gmail is limiting this account for now. Try again in a few minutes.",
  limitWaiting: "Gmail is limiting this account for now, so Conduit waits 5 minutes before trying again.",
  noAllMail: "Gmail hides All Mail from IMAP. In Gmail's settings, under Labels, turn on \"Show in IMAP\" for All Mail.",
  unsupported: "Gmail doesn't offer that.",
  refused: "Gmail refused that.",
  gone: "That message is no longer in Gmail.",
};

const mailError = (reason, message = SAY[reason]) => Object.assign(new Error(message), { name: "MailError", reason });

/** Gmail and nodemailer errors in the hub's terms; the server's own words never reach the message. */
function toMailError(err) {
  if (err?.name === "MailError") return err;
  const said = [err?.responseText, typeof err?.response === "string" ? err.response : "", err?.message].join(" ");
  if (err?.code === "ETHROTTLE" || err?.serverResponseCode === "THROTTLED" || /too many|bandwidth|limit|throttl/i.test(said)) return mailError("limit");
  if (err?.authenticationFailed || err?.code === "EAUTH" || err?.serverResponseCode === "AUTHENTICATIONFAILED") return mailError("credentials");
  if (err?.code === "MissingServerExtension") return mailError("unsupported");
  if (err?.responseStatus === "NO" || err?.responseStatus === "BAD" || err?.responseCode >= 500) return mailError("refused");
  return mailError("network");
}

// Gmail's system labels as X-GM-LABELS names them; a label the person made travels as its name in base64url.
const ROLES = { "\\Inbox": "inbox", "\\Sent": "sent", "\\Draft": "drafts", "\\Starred": "starred", "\\Important": "important" };
const ROLE_NAMES = { inbox: "Inbox", sent: "Sent", drafts: "Drafts", starred: "Starred", important: "Important" };
const GMAIL_OF = Object.fromEntries(Object.entries(ROLES).map(([gmail, id]) => [id, gmail]));
const USER = "l-";
const labelId = (gmail) => ROLES[gmail] ?? (gmail.startsWith("\\") ? null : USER + Buffer.from(gmail).toString("base64url"));
const gmailLabel = (id) => GMAIL_OF[id] ?? (id.startsWith(USER) ? Buffer.from(id.slice(USER.length), "base64url").toString() : null);
// Mailboxes that are not labels the person made: Gmail's own folders, and the parent that holds them.
const NOT_LABELS = ["\\all", "\\archive", "\\drafts", "\\flagged", "\\junk", "\\sent", "\\trash", "\\important", "\\noselect", "\\nonexistent"];
const hasFlag = (box, flag) => [...box.flags].some((f) => f.toLowerCase() === flag);

const FULL = { uid: true, flags: true, labels: true, emailId: true, threadId: true, envelope: true, size: true, internalDate: true, bodyStructure: true, headers: ["references"] };
const STATE = { uid: true, flags: true, labels: true, emailId: true };

const party = (a) => ({ name: a?.name || "", address: a?.address || "" });
const parties = (list) => (list || []).filter((a) => a?.address).map(party);
const references = (headers) => {
  const line = String(headers || "").replace(/\r?\n[ \t]+/g, " ").match(/^references:(.*)$/im)?.[1] || "";
  return line.match(/<[^>]+>/g) || [];
};
const hasAttachment = (node) => !!node && (node.disposition === "attachment"
  || (!node.childNodes && node.disposition !== "inline" && !!(node.dispositionParameters?.filename || node.parameters?.name))
  || (node.childNodes || []).some(hasAttachment));

/** Labels as the hub names them: the \Flagged flag is the star, the \Draft flag a draft. */
function labelsOf(msg) {
  const ids = new Set([...(msg.labels || [])].map(labelId).filter(Boolean));
  if (msg.flags?.has("\\Flagged")) ids.add("starred");
  if (msg.flags?.has("\\Draft")) ids.add("drafts");
  return [...ids];
}

function storedOf(msg) {
  if (!msg.emailId) return null;
  const env = msg.envelope || {};
  const labels = labelsOf(msg);
  return {
    key: msg.emailId, thread: msg.threadId || msg.emailId, seq: msg.uid,
    messageId: env.messageId || "", inReplyTo: env.inReplyTo || null, references: references(msg.headers),
    from: party(env.from?.[0]), to: parties(env.to), cc: parties(env.cc), bcc: parties(env.bcc), replyTo: parties(env.replyTo),
    subject: env.subject || "", date: new Date(msg.internalDate || env.date || 0).getTime() || 0, size: msg.size || 0,
    unread: !msg.flags?.has("\\Seen"), draft: labels.includes("drafts"), labels,
    attachments: hasAttachment(msg.bodyStructure),
  };
}

const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const tick = () => new Promise((resolve) => setImmediate(resolve));
/** Index of the first item not below `value` in an ascending list. */
const lowerBound = (list, value) => {
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid] < value) lo = mid + 1; else hi = mid; }
  return lo;
};

export function createGmailAdapter(ctx, deps = {}) {
  const { ImapFlow = RealImapFlow, createTransport = realCreateTransport } = deps;
  const { store } = ctx;
  const account = ctx.account.id;
  const auth = { user: ctx.account.address, pass: String(ctx.secret).replace(/\s+/g, "") };
  const smtp = () => createTransport({ ...SMTP, auth, logger: false });

  let stopped = true;
  let session = null;
  let connecting = null;
  let retry = null;
  let backoff = BACKOFF_MIN_MS;
  let fatal = null;
  let waiters = [];
  let said = { text: "", at: 0 };

  /** A status repeated only to move `at` on waits a while: bodies are read many a second. */
  const status = (value) => {
    const text = JSON.stringify({ ...value, at: undefined });
    if (stopped || (text === said.text && Date.now() - said.at < STATUS_REPEAT_MS)) return;
    said = { text, at: Date.now() };
    ctx.status(value);
  };
  const backfilling = (s) => !s.cursor.done && !s.backfilled;
  const progress = (s) => {
    if (!s.alive) return;
    const c = s.cursor;
    const at = s.at ? new Date(s.at).toISOString() : undefined;
    if (!backfilling(s) || !s.uids) return status({ state: s.busy || backfilling(s) ? "syncing" : "idle", at });
    const total = lowerBound(s.uids, c.top + 1);
    status({ state: "syncing", at, backfill: { done: total - lowerBound(s.uids, s.low), total } });
  };
  // Once a session has ended (stop() or a drop), nothing of it reaches the store or the clients. The service closes
  // the account's store after stop(), so a write it refuses then ends the task quietly: `fail` ignores a dead session.
  const write = (s, fn) => {
    if (!s.alive || stopped) throw mailError("network");
    return fn();
  };
  const changed = (s, change) => { if (change?.threads?.length && s.alive && !stopped) ctx.changed(change); };
  const saveCursor = (s) => write(s, () => store.setCursor(account, "gmail", s.cursor));

  // An unheard "error" event throws, so every connection has a listener from the start. connect() rejects for what fails
  // before it resolves, and a close then must not be taken for a dropped session, so the session's listeners go on after.
  const client = (options = {}) => new ImapFlow({ ...IMAP, auth, logger: false, ...options }).on("error", () => {});
  const watchOver = (s, c) => c.on("error", (err) => fail(s, err)).on("close", () => fail(s, mailError("network")));
  /** A store or move answers false when it fails; say whether the server refused or the connection went. */
  const ok = (c, result) => { if (!result) throw mailError(c.usable ? "refused" : "network"); return result; };
  const inBox = async (c, path, fn) => {
    const lock = await c.getMailboxLock(path);
    try { return await fn(); } finally { lock.release(); }
  };
  /** Gmail renumbered All Mail: what is held is cleared and read again on a new session, at once. */
  const sameNumbers = (s, c) => {
    if (String(c.mailbox.uidValidity) !== s.cursor.uidValidity) throw Object.assign(mailError("network"), { renumbered: true });
  };

  // The work queue: the person's operations go ahead of sync's, one command at a time.
  function enqueue(s, lane, fn) {
    if (!s.alive) return Promise.reject(mailError("network"));
    return new Promise((resolve, reject) => { s[lane].push({ fn, resolve, reject }); s.pumping ||= pump(s); });
  }
  async function pump(s) {
    await null;
    while (s.alive && (s.front.length || s.back.length)) {
      const task = s.front.shift() || s.back.shift();
      try { task.resolve(await task.fn(s.work)); s.at = Date.now(); } catch (err) { task.reject(err); }
    }
    s.pumping = null;
  }
  const later = (s, fn) => enqueue(s, "back", fn);

  function ready() {
    if (session?.ready) return Promise.resolve(session);
    if (stopped || fatal) return Promise.reject(fatal || mailError("network"));
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: setTimeout(() => { waiters = waiters.filter((w) => w !== waiter); reject(mailError("network")); }, READY_WAIT_MS) };
      waiters.push(waiter);
    });
  }
  const settle = (fn) => { for (const w of waiters) { clearTimeout(w.timer); fn(w); } waiters = []; };

  /** The person's operation on the work connection, in All Mail unless it says otherwise. */
  async function now(fn, path) {
    const s = await ready();
    try {
      return await enqueue(s, "front", (c) => inBox(c, path || s.boxes.all, () => fn(c, s)));
    } catch (err) {
      throw toMailError(err);
    }
  }

  function reconnect() {
    retry = null;
    connecting = connect().finally(() => { connecting = null; });
  }

  async function connect() {
    const s = { alive: true, ready: false, work: null, watch: null, front: [], back: [], pumping: null, looping: null, wants: new Set(["catchUp"]), wake: null, timers: [], skip: new Set(), failures: 0, at: 0, busy: true };
    session = s;
    status({ state: "connecting" });
    try {
      s.work = client({ disableAutoIdle: true });
      await s.work.connect();
      watchOver(s, s.work);
      const boxes = await s.work.list();
      const all = boxes.find((b) => hasFlag(b, "\\all"));
      if (!all) throw mailError("unsupported", SAY.noAllMail);
      s.boxes = { all: all.path, drafts: boxes.find((b) => hasFlag(b, "\\drafts"))?.path, trash: boxes.find((b) => hasFlag(b, "\\trash"))?.path };
      const own = boxes.filter((b) => b.path.toUpperCase() !== "INBOX" && !NOT_LABELS.some((f) => hasFlag(b, f)));
      write(s, () => store.putLabels(account, [
        ...Object.entries(ROLE_NAMES).map(([id, name]) => ({ id, name, role: id })),
        ...own.map((b) => ({ id: labelId(b.path), name: b.path, role: null })),
      ]));
      const box = await s.work.mailboxOpen(all.path);
      let cursor = write(s, () => store.cursor(account, "gmail"));
      if (cursor && cursor.uidValidity !== String(box.uidValidity)) {
        write(s, () => store.clearMessages(account));
        if (s.alive && !stopped) ctx.changed({ threads: [], all: true });
        cursor = null;
      }
      s.cursor = cursor || {
        uidValidity: String(box.uidValidity),
        modseq: box.highestModseq ? String(box.highestModseq) : null,
        top: box.uidNext - 1, low: box.uidNext, done: false,
      };
      // Where this session's backfill stands; the cursor follows it only while no window has been skipped.
      s.low = s.cursor.low;
      saveCursor(s);
      s.condstore = s.work.enabled.has("CONDSTORE") && !box.noModseq;

      s.watch = client({ autoIdleDelay: 1000, maxIdleTime: 4 * 60_000 });
      s.watch.on("exists", () => want(s, "catchUp"));
      s.watch.on("flags", () => want(s, "catchUp"));
      let settleExpunge = null;
      s.watch.on("expunge", () => {
        clearTimeout(settleExpunge);
        settleExpunge = setTimeout(() => want(s, "sweep"), EXPUNGE_SETTLE_MS);
      });
      await s.watch.connect();
      watchOver(s, s.watch);
      await s.watch.mailboxOpen(all.path, { readOnly: true });
      if (!s.alive) return;

      s.timers.push(setInterval(() => want(s, "catchUp"), POLL_MS), setInterval(() => want(s, "sweep"), SWEEP_MS), { clear: () => clearTimeout(settleExpunge) });
      s.ready = true;
      s.at = Date.now();
      settle((w) => w.resolve(s));
      s.looping = loop(s).catch((err) => fail(s, err));
    } catch (err) {
      fail(s, err);
    }
  }

  function fail(s, err) {
    if (!s.alive) return;
    s.alive = false;
    s.wake?.();
    for (const t of s.timers) t.clear ? t.clear() : clearInterval(t);
    for (const c of [s.work, s.watch]) { if (c) { c.removeAllListeners("close"); c.close(); } }
    const error = toMailError(err);
    for (const task of [...s.front, ...s.back]) task.reject(error);
    s.front = []; s.back = [];
    if (session === s) session = null;
    if (stopped) return;
    if (error.reason === "credentials") {
      fatal = error;
      settle((w) => w.reject(error));
      return status({ state: "error", error: SAY.credentials });
    }
    let wait = error.renumbered ? 0 : backoff;
    if (error.reason === "limit" || error.reason === "unsupported") {
      wait = LIMIT_WAIT_MS;
      status({ state: "error", error: error.reason === "limit" ? SAY.limitWaiting : error.message });
    } else {
      // Only work done resets this (see loop), so an error that comes back once connected waits longer each time.
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
      status({ state: "connecting" });
    }
    retry = setTimeout(reconnect, wait);
  }

  function want(s, what) {
    if (!s.alive) return;
    s.wants.add(what);
    s.wake?.();
  }

  async function loop(s) {
    let bodies = BODY_BATCH;
    while (s.alive) {
      s.busy = true;
      if (s.wants.delete("catchUp")) { await later(s, (c) => catchUp(s, c)); backoff = BACKOFF_MIN_MS; }
      else if (s.wants.delete("sweep")) await sweep(s);
      else if (backfilling(s) && bodies >= BODY_BATCH) { await backfill(s); bodies = 0; }
      else if (await body(s)) bodies++;
      else if (backfilling(s)) { await backfill(s); bodies = 0; }
      else {
        s.busy = false;
        progress(s);
        await new Promise((resolve) => { s.wake = resolve; });
        s.wake = null;
        continue;
      }
      progress(s);
      await tick();
    }
  }

  /** Every UID in All Mail, ascending: Gmail's UIDs are sparse, so windows are cut from this list, not from numbers. */
  async function uidList(c) {
    const uids = await c.search({ all: true }, { uid: true });
    if (!Array.isArray(uids)) throw mailError("refused");
    return uids.sort((a, b) => a - b);
  }

  const windowOf = (s) => {
    const end = lowerBound(s.uids, s.low);
    const first = end === lowerBound(s.uids, s.cursor.top + 1);
    return { start: Math.max(0, end - (first ? FIRST_WINDOW : WINDOW)), end };
  };

  /** The next window down, tried again once when the server refuses it, then passed over for this session as a failing body is. */
  async function backfill(s) {
    try {
      await later(s, (c) => backfillWindow(s, c));
      s.failures = 0;
      backoff = BACKOFF_MIN_MS;
    } catch (err) {
      if (!s.alive || !s.work.usable) throw err;
      if (++s.failures < 2) return;
      s.failures = 0;
      if (!s.uids) { s.backfilled = true; return; }
      s.low = s.uids[windowOf(s).start] ?? s.low;
      s.gap = true;
      if (s.low <= (s.uids[0] ?? 0)) s.backfilled = true;
    }
  }

  async function backfillWindow(s, c) {
    await inBox(c, s.boxes.all, async () => {
      sameNumbers(s, c);
      s.uids ||= await uidList(c);
      const { start, end } = windowOf(s);
      if (end > start) {
        const rows = [];
        for await (const msg of c.fetch(`${s.uids[start]}:${s.uids[end - 1]}`, FULL, { uid: true })) {
          const row = storedOf(msg);
          if (row) rows.push(row);
        }
        changed(s, write(s, () => store.upsertMessages(account, rows)));
        s.low = s.uids[start];
      }
      if (start === 0) s.backfilled = true;
      if (!s.gap) {
        s.cursor.low = s.low;
        s.cursor.done = start === 0;
        saveCursor(s);
      }
    });
    if (s.backfilled) { progress(s); s.uids = null; }
  }

  /** One recent message's raw body, newest first; false when none is left to read. */
  async function body(s) {
    const next = write(s, () => store.bodiless(account, Date.now() - RECENT_MS, s.skip.size + 1)).find((b) => !s.skip.has(b.key));
    if (!next) return false;
    if (next.seq == null || next.size > BODY_MAX) { s.skip.add(next.key); return true; }
    let raw;
    try {
      raw = await later(s, (c) => inBox(c, s.boxes.all, () => c.fetchOne(String(next.seq), { source: true }, { uid: true })));
    } catch (err) {
      if (!s.alive || !s.work.usable) throw err;
      s.skip.add(next.key);
      return true;
    }
    if (!raw?.source) { s.skip.add(next.key); return true; }
    let parsed;
    try {
      parsed = await ctx.parse(raw.source);
    } catch {
      s.skip.add(next.key);
      return true;
    }
    changed(s, write(s, () => store.holdBody(account, next.key, raw.source, parsed)));
    return true;
  }

  async function catchUp(s, c) {
    await inBox(c, s.boxes.all, async () => {
      sameNumbers(s, c);
      const box = c.mailbox;
      const cur = s.cursor;
      const modseq = box.highestModseq;
      const threads = new Set();
      const note = (change) => { for (const t of change?.threads || []) threads.add(t); };

      if (cur.low <= cur.top) {
        const patches = [];
        const query = s.condstore && cur.modseq
          ? c.fetch(`${cur.low}:${cur.top}`, STATE, { uid: true, changedSince: BigInt(cur.modseq) })
          : box.exists ? c.fetch(`${Math.max(1, box.exists - NO_CONDSTORE_TAIL + 1)}:*`, STATE) : [];
        for await (const msg of query) {
          if (msg.emailId && msg.uid <= cur.top) patches.push({ key: msg.emailId, unread: !msg.flags?.has("\\Seen"), labels: labelsOf(msg) });
        }
        for (const page of chunks(patches, PAGE)) note(write(s, () => store.patchMessages(account, page)));
      }

      // UID n:* names the newest message even when n is past it, so the filter is needed.
      let rows = [];
      let top = cur.top;
      for await (const msg of c.fetch(`${cur.top + 1}:*`, FULL, { uid: true })) {
        if (msg.uid <= cur.top) continue;
        const row = storedOf(msg);
        if (row) rows.push(row);
        top = Math.max(top, msg.uid);
        if (rows.length >= PAGE) { const page = rows; note(write(s, () => store.upsertMessages(account, page))); rows = []; }
      }
      if (rows.length) note(write(s, () => store.upsertMessages(account, rows)));
      cur.top = top;
      if (modseq) cur.modseq = String(modseq);
      saveCursor(s);
      changed(s, { threads: [...threads] });
    });
  }

  /** Messages gone from All Mail: what the store holds in [low, top] that the server no longer lists. */
  async function sweep(s) {
    const { server, low, top } = await later(s, (c) => inBox(c, s.boxes.all, async () => {
      sameNumbers(s, c);
      return { server: await uidList(c), low: s.cursor.low, top: s.cursor.top };
    }));
    if (low > top) return;
    const gone = [];
    let from = low;
    for (let i = lowerBound(server, low); from <= top; i += PAGE) {
      const part = server.slice(i, i + PAGE).filter((uid) => uid <= top);
      const to = part.length === PAGE && i + PAGE < server.length ? part[PAGE - 1] : top;
      const present = new Set(part);
      for (const seq of write(s, () => store.seqs(account, from, to))) if (!present.has(seq)) gone.push(seq);
      from = to + 1;
      await tick();
    }
    for (const page of chunks(gone, PAGE)) {
      const keys = write(s, () => store.keysOfSeqs(account, page)).map((row) => row.key);
      if (keys.length) changed(s, write(s, () => store.removeMessages(account, keys)));
    }
  }

  const uidsOf = (keys) => chunks(keys, PAGE).flatMap((page) => store.seqsOfKeys(account, page)).map((row) => row.seq).filter((seq) => seq != null);
  const gmailLabels = (ids) => ids.filter((id) => id !== "starred").map((id) => {
    const name = gmailLabel(id);
    if (!name) throw mailError("unsupported");
    return name;
  });

  return {
    async verify() {
      const c = client({ verifyOnly: true, includeMailboxes: true });
      try {
        await c.connect();
      } catch (err) {
        throw toMailError(err);
      }
      if (!(c.mailboxList || []).some((b) => hasFlag(b, "\\all"))) throw mailError("unsupported", SAY.noAllMail);
      const t = smtp();
      try { await t.verify(); } catch (err) { throw toMailError(err); } finally { t.close(); }
    },

    start() {
      if (!stopped) return;
      stopped = false;
      fatal = null;
      reconnect();
    },

    async stop() {
      if (!stopped) ctx.status({ state: "off" });
      stopped = true;
      clearTimeout(retry);
      retry = null;
      settle((w) => w.reject(mailError("network")));
      const s = session;
      if (s) fail(s, mailError("network"));
      await Promise.allSettled([connecting, s?.pumping, s?.looping]);
    },

    async apply(change) {
      const uids = uidsOf(change.keys);
      if (!uids.length) return;
      const add = change.kind === "labels" ? gmailLabels(change.add) : [];
      const remove = change.kind === "labels" ? gmailLabels(change.remove) : [];
      await now(async (c, s) => {
        if (change.kind === "trash" && !s.boxes.trash) throw mailError("unsupported");
        for (const page of chunks(uids, PAGE)) {
          const range = page.join(",");
          if (change.kind === "labels") {
            if (add.length) ok(c, await c.messageFlagsAdd(range, add, { uid: true, useLabels: true }));
            if (remove.length) ok(c, await c.messageFlagsRemove(range, remove, { uid: true, useLabels: true }));
            if (change.add.includes("starred")) ok(c, await c.messageFlagsAdd(range, ["\\Flagged"], { uid: true }));
            if (change.remove.includes("starred")) ok(c, await c.messageFlagsRemove(range, ["\\Flagged"], { uid: true }));
          } else if (change.kind === "unread") {
            ok(c, await (change.unread ? c.messageFlagsRemove : c.messageFlagsAdd).call(c, range, ["\\Seen"], { uid: true }));
          } else {
            ok(c, await c.messageMove(range, s.boxes.trash, { uid: true }));
          }
        }
      });
    },

    async raw(key) {
      const [seq] = uidsOf([key]);
      if (seq == null) throw mailError("refused", SAY.gone);
      const msg = await now((c) => c.fetchOne(String(seq), { source: true }, { uid: true }));
      if (!msg?.source) throw mailError("refused", SAY.gone);
      return msg.source;
    },

    /** Each page of headers the store lacks is its own task, so the person's other operations go between them. */
    async search(query, limit) {
      const count = Math.min(SEARCH_MAX, Math.max(1, Math.floor(Number(limit)) || 1));
      const { newest, keyOf } = await now(async (c, s) => {
        const found = await c.search({ gmraw: query }, { uid: true });
        if (!Array.isArray(found)) throw mailError("refused");
        const newest = found.sort((a, b) => b - a).slice(0, count);
        return { newest, keyOf: new Map(write(s, () => store.keysOfSeqs(account, newest)).map((row) => [row.seq, row.key])) };
      });
      for (const page of chunks(newest.filter((uid) => !keyOf.has(uid)), SEARCH_PAGE)) {
        await now(async (c, s) => {
          const rows = [];
          for await (const msg of c.fetch(page.join(","), FULL, { uid: true })) {
            const row = storedOf(msg);
            if (row) { rows.push(row); keyOf.set(msg.uid, row.key); }
          }
          changed(s, write(s, () => store.upsertMessages(account, rows)));
        });
      }
      return newest.map((uid) => keyOf.get(uid)).filter(Boolean);
    },

    async send(raw, envelope) {
      const t = smtp();
      try { await t.sendMail({ envelope, raw }); } catch (err) { throw toMailError(err); } finally { t.close(); }
    },

    async saveDraft(messageId, raw) {
      // A HEADER search for an empty value matches every message that has the header: the delete would empty Drafts.
      if (!String(messageId || "").trim()) throw mailError("refused");
      const s = await ready();
      if (!s.boxes.drafts) throw mailError("unsupported");
      await now(async (c) => {
        const old = await c.search({ header: { "message-id": messageId } }, { uid: true });
        if (!Array.isArray(old)) throw mailError("refused");
        if (old.length) ok(c, await c.messageDelete(old.join(","), { uid: true }));
        if (raw) ok(c, await c.append(s.boxes.drafts, raw, ["\\Draft", "\\Seen"]));
      }, s.boxes.drafts);
    },

    poke() {
      if (session) want(session, "catchUp");
    },
  };
}
