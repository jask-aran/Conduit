/*
 * Mail, as Conduit holds it (docs/plans/email.md): one primitive for every source. An account's adapter syncs its
 * source into the hub's store; the browser and jbot's mail tool read the store through the service and never see a
 * source's own ids, label names or errors. Ids are opaque strings the hub makes; only the hub takes one apart.
 */

/** What an adapter is for. Phase 1 has "gmail" and, for checks and the gallery, "fixture". */
export type MailAccountKind = "gmail" | "fixture";

/** Where an account's sync stands, in words the pane can show. `backfill`: older mail still being read in. */
export interface MailStatus {
  state: "off" | "connecting" | "syncing" | "idle" | "error";
  /** One plain sentence when `state` is "error": what the person can do about it. */
  error?: string;
  backfill?: { done: number; total: number };
  /** When the source last answered, ISO. */
  at?: string;
}

/** How far back something reaches: a count of days, or "all". */
export type MailReach = number | "all";
/** What the person chose for an account's sync. Saved with the account; a change takes effect without a restart. */
export interface MailSync {
  /** The hub reads nothing from the source of its own accord and nothing new arrives; what is held stays readable and searchable, and what the person does (triage, drafts, send, opening a message whose text is not held, a search at the source) still goes, each on a connection of its own. */
  paused: boolean;
  /** Messages newer than this are read in (headers, labels, threads); older mail is found by a search at the source (`remote`). Shortening it only stops reading further back: what is already held stays. Default 1095. */
  since: MailReach;
  /** Messages newer than this have their text fetched, held and searchable; an older one's is fetched when it is opened. Shortening it fetches no more: text already held stays. Never further back than `since`. Default 90. */
  bodies: MailReach;
}
/** What the hub holds of an account, counted when asked. */
export interface MailHeld {
  messages: number; threads: number;
  /** Messages whose text is held. */
  bodies: number;
  /** Bytes on disk: the account's share of the store plus its raw files (the store's share may be an estimate). */
  bytes: number;
  /** The oldest held message's date, ISO; absent when none is held. */
  oldest?: string;
  /** How many messages the source has in all, when it has said. */
  total?: number;
}
export interface MailAccount { id: string; kind: MailAccountKind; address: string; name: string; status: MailStatus; sync: MailSync; held: MailHeld }

/** What a label is for, where every source has one; a label the person made has none. */
export type MailLabelRole = "inbox" | "sent" | "drafts" | "starred" | "important";
/** `id` is the role for a label with one ("inbox"), else an id of the hub's; `name` is what the person reads. */
export interface MailLabel { id: string; name: string; role: MailLabelRole | null; unread: number }

export interface MailParty { name: string; address: string }

/** A thread in a list: what one line needs, without opening it. */
export interface MailThread {
  id: string; account: string; subject: string;
  /** Who wrote in it, oldest first, each once. */
  from: MailParty[];
  /** Its newest message's time (ISO) and the start of its text. */
  date: string; snippet: string;
  count: number; unread: number;
  labels: string[];
  starred: boolean; attachments: boolean; draft: boolean;
}

/** A message in an open thread. `held`: the hub has its body, so `body` answers at once; else it is fetched from the source first. */
export interface MailMessage {
  id: string; thread: string; account: string;
  from: MailParty; to: MailParty[]; cc: MailParty[]; bcc: MailParty[];
  subject: string; date: string; snippet: string;
  unread: boolean; starred: boolean; draft: boolean; labels: string[];
  attachments: boolean; held: boolean;
}

export interface MailAttachment { index: number; filename: string; mimeType: string; size: number }
/**
 * A message's body. `markdown`: its text as the hub reads email (agent/mail-pipeline.js), the person's own words
 * apart from what they quoted (`quoted`: Markdown, empty when nothing was). `html`: the sender's HTML with scripts,
 * event handlers, frames, forms, tracking pixels and hidden parts taken out, for a frame that can run nothing and
 * load nothing (its remote images and styles are still in it: the frame is what keeps them from loading); null for
 * a plain-text message.
 */
export interface MailBody { message: string; markdown: string; quoted: string; html: string | null; attachments: MailAttachment[] }

/**
 * A message being written. It is the hub's from its first save and copied to the source's drafts behind that.
 * `text` is plain text, any quoted original in it. `reply`/`forward`: the message it answers or passes on.
 * `state`: "saved" once the source has it; "failed" says why in `error`.
 */
export interface MailDraft {
  id: string; account: string; thread: string | null;
  to: MailParty[]; cc: MailParty[]; bcc: MailParty[];
  subject: string; text: string;
  reply: string | null; forward: string | null;
  updated: string; state: "saving" | "saved" | "sending" | "failed"; error?: string;
}
export type MailDraftInput = Partial<Pick<MailDraft, "to" | "cc" | "bcc" | "subject" | "text">>;

/** A change to messages: labels put on or taken off (archive is taking "inbox" off; a star is the "starred" label), read or unread, or moved to the source's trash. */
export interface MailChange { threads?: string[]; messages?: string[]; add?: string[]; remove?: string[]; unread?: boolean; trash?: boolean }

/*
 * The hub's HTTP API, every route under a session (auth-middleware.js). Errors are `{ error: <code>, message: <one sentence> }`.
 *
 * GET    /v0/mail/accounts                                   → { accounts: MailAccount[] }
 * POST   /v0/mail/accounts  { kind, address, secret, name? } → 201 { account }; 400 when the source refuses the sign-in
 * DELETE /v0/mail/accounts/:account                          → 204; the hub's copy of its mail goes with it
 * PATCH  /v0/mail/accounts/:account  { name?, sync?: Partial<MailSync> } → { account }; 400 for a reach that is not a positive whole number of days or "all"
 * POST   /v0/mail/accounts/:account/resync                   → { account }; the hub's copy is dropped and read in again (its drafts kept); nothing changes at the source
 * GET    /v0/mail/accounts/:account/labels                   → { labels: MailLabel[] }
 * GET    /v0/mail/threads?account=&label=&unread=1&before=&limit=   → { threads: MailThread[], next: string | null }
 *          newest first; `before` is the `next` of the page above; `label` is a MailLabel id ("inbox" when unsaid), or "all" for every thread
 * GET    /v0/mail/threads/:thread                            → { thread: MailThread, messages: MailMessage[], drafts: MailDraft[] }
 *          messages oldest first; drafts are those written in this thread
 * GET    /v0/mail/messages/:message/body                     → MailBody
 * GET    /v0/mail/messages/:message/attachments/:index       → the file's bytes, as a download
 * POST   /v0/mail/change  MailChange                         → { threads: MailThread[] } as they now stand (one trashed is left out)
 * GET    /v0/mail/search?account=&q=&remote=1&limit=         → { threads: MailThread[] }
 *          without `remote`: what the hub holds, at once. With it: what the source finds too, merged (slower).
 *          `q`: words, and from: to: subject: label: is:unread is:starred has:attachment
 * GET    /v0/mail/drafts?account=                            → { drafts: MailDraft[] }
 * POST   /v0/mail/drafts  { account, reply?, replyAll?, forward?, adopt? } → 201 { draft }: a new one, addressed and quoted for a reply or a
 *          forward; `adopt`: a message that is a draft written at the source, taken over as the hub's (the source's copy is replaced at the next save)
 * PUT    /v0/mail/drafts/:draft  MailDraftInput              → { draft }
 * DELETE /v0/mail/drafts/:draft                              → 204
 * POST   /v0/mail/drafts/:draft/send                         → { sent: true }
 *
 * The hub says when mail changes on the runtime stream: { type: "mail_changed", account, threads?: string[], accounts?: true }
 * (`threads`: these changed, appeared or went; without it, re-read what is shown; `accounts`: an account or its status changed).
 * The client hears it as the window event "conduit:mail-changed" with that object as `detail`.
 */

// ---------------------------------------------------------------------------------------------------------------
// The hub's side. Nothing below reaches the browser.

/**
 * A message as an adapter gives it to the store. `key` and `thread` are the source's stable ids for the message
 * and its thread, as strings (the store makes the hub's ids from them: `<account>.<key>`); `seq` is the source's own
 * ordering number for it where it has one (IMAP: the UID), which only the adapter reads back. `labels` are MailLabel ids.
 */
export interface StoredMessage {
  key: string; thread: string; seq: number | null;
  messageId: string; inReplyTo: string | null; references: string[];
  from: MailParty; to: MailParty[]; cc: MailParty[]; bcc: MailParty[]; replyTo: MailParty[];
  subject: string; date: number; size: number;
  unread: boolean; draft: boolean; labels: string[];
  attachments: boolean;
  /** Known before the body is: the start of its text. The store replaces it when the body is held. */
  snippet?: string;
}

/** What a write changed: the hub's ids of the threads to tell the clients of. `all`: every thread of the account may have (its mail was cleared), so clients re-read what they show. */
export interface StoreChange { threads: string[]; all?: true }

/**
 * The hub's copy (store.js), in SQLite under <dataRoot>/mail/. Every method is synchronous and short; a caller with
 * many rows pages them (500 a call at most) and yields between pages.
 */
export interface MailStore {
  close(): void;

  // What the adapter writes.
  upsertMessages(account: string, messages: StoredMessage[]): StoreChange;
  /** Flags and labels alone, for messages already held; an unknown key is skipped. */
  patchMessages(account: string, patches: { key: string; unread?: boolean; labels?: string[] }[]): StoreChange;
  removeMessages(account: string, keys: string[]): StoreChange;
  /** Every message of the account, its bodies with them (the source renumbered: UIDVALIDITY changed). Labels, cursors and hub drafts stay. */
  clearMessages(account: string): void;
  /** The message's raw RFC 822 bytes, kept on disk, and its text for search and the snippet. */
  holdBody(account: string, key: string, raw: Buffer, parsed: { text: string; attachments: boolean }): StoreChange;
  rawOf(account: string, key: string): Buffer | null;
  putLabels(account: string, labels: Omit<MailLabel, "unread">[]): void;
  /** The adapter's own sync state, by name: JSON, kept with the account. */
  cursor<T = unknown>(account: string, name: string): T | null;
  setCursor(account: string, name: string, value: unknown): void;
  /** The `seq`s held in a range (inclusive), ascending: what a source's own list is compared with to find what went. */
  seqs(account: string, from: number, to: number): number[];
  keysOfSeqs(account: string, seqs: number[]): { seq: number; key: string }[];
  seqsOfKeys(account: string, keys: string[]): { seq: number; key: string }[];
  /** Messages since `since` (ms) whose body is not held, newest first. */
  bodiless(account: string, since: number, limit: number): { key: string; seq: number | null; size: number }[];
  count(account: string): number;
  /** Up to `limit` messages dated before `before` (ms), oldest first, taken out of the hub's copy as `removeMessages` does (a read-in again pages through every one); `count`: how many went. */
  prune(account: string, before: number, limit: number): StoreChange & { count: number };
  /** What is held, from indexed counts; `oldest` in ms, `raw` the held raw files' bytes, `all` every account's messages. */
  held(account: string): { messages: number; threads: number; bodies: number; oldest: number | null; raw: number; all: number };
  /** The database's bytes on disk, every account's. */
  dbBytes(): number;
  /** The adapter's sync state, every name of it. */
  clearCursors(account: string): void;

  // What the service reads and writes.
  labels(account: string): MailLabel[];
  threads(query: { account: string; label?: string; unread?: boolean; before?: string | null; limit?: number }): { threads: MailThread[]; next: string | null };
  /** A message that is the source's copy of a hub draft (the same Message-ID) is left out here and of every thread's `count`: the draft stands for it. */
  thread(id: string): { thread: MailThread; messages: MailMessage[] } | null;
  threadsOf(ids: string[]): MailThread[];
  message(id: string): (MailMessage & { key: string; seq: number | null; messageId: string; inReplyTo: string | null; references: string[]; replyTo: MailParty[] }) | null;
  /** The messages a change names (its threads' and its messages'), as the adapter knows them and as they stood. */
  messagesFor(change: Pick<MailChange, "threads" | "messages">): { account: string; id: string; key: string; unread: boolean; labels: string[] }[];
  /** Threads matching a query of the form the API takes, best first. */
  search(query: { account: string; q: string; limit?: number }): MailThread[];
  drafts(account: string, thread?: string): MailDraft[];
  draft(id: string): (MailDraft & { messageId: string }) | null;
  putDraft(draft: MailDraft & { messageId: string }): void;
  removeDraft(id: string): void;
  /** Every row and file of an account. */
  dropAccount(account: string): void;
}

/** A change the hub has already made to its copy, for the source: rejected, the service puts its copy back. */
export type RemoteChange =
  | { kind: "labels"; keys: string[]; add: string[]; remove: string[] }
  | { kind: "unread"; keys: string[]; unread: boolean }
  | { kind: "trash"; keys: string[] };

/** Why a source refused, in the hub's terms; `message` is the sentence the person reads. */
export interface MailError extends Error { reason: "credentials" | "network" | "limit" | "unsupported" | "refused" }

export interface MailAdapterContext {
  account: { id: string; kind: MailAccountKind; address: string; name: string };
  /** The person's choices as they stand: read each time, never copied, so a change is followed. The service calls `configure` after one. */
  sync(): MailSync;
  /** The account's secret as the person gave it (Gmail: the app password). */
  secret: string;
  store: MailStore;
  /** Parses raw bytes to what `holdBody` takes (parse.js). */
  parse(raw: Buffer): Promise<{ text: string; attachments: boolean }>;
  /** Tell the clients: these threads changed. */
  changed(change: StoreChange): void;
  status(status: MailStatus): void;
}

/** One account's source (gmail-adapter.js, fixture-adapter.js). It owns its sync: what it reads, it writes to the store. */
export interface MailAdapter {
  /** Signs in once and leaves: rejects with a MailError when the source will not have these credentials. */
  verify(): Promise<void>;
  /** Syncs until stopped, reconnecting by itself; never throws, and says how it stands through `status`. */
  start(): void;
  stop(): Promise<void>;
  apply(change: RemoteChange): Promise<void>;
  /** A message's raw bytes, for one whose body the hub does not hold. */
  raw(key: string): Promise<Buffer>;
  /** Keys of the messages the source itself finds, newest first, each put in the store before this answers. */
  search?(query: string, limit: number): Promise<string[]>;
  send(raw: Buffer, envelope: { from: string; to: string[] }): Promise<void>;
  /** Puts `raw` in the source's drafts in place of any with this Message-ID; null takes it out. */
  saveDraft?(messageId: string, raw: Buffer | null): Promise<void>;
  /** Asks the source for what is new now, without waiting for it to say (after a send). */
  poke?(): void;
  /** `ctx.sync()` changed: stop or resume reading, and read in what a longer reach now covers. A shorter one leaves what is held as it is. */
  configure?(): void;
  /** How many messages the source holds in all, once it has said (kept across a pause). */
  total?(): number | null;
}

/**
 * Mail for the routes and jbot's tool (service.js): accounts and their adapters, the store behind them, and writes
 * that change the hub's copy first and the source behind it.
 */
export interface MailService {
  accounts(): MailAccount[];
  addAccount(input: { kind: MailAccountKind; address: string; secret: string; name?: string }): Promise<MailAccount>;
  removeAccount(id: string): Promise<void>;
  updateAccount(id: string, input: { name?: string; sync?: Partial<MailSync> }): Promise<MailAccount>;
  resync(id: string): Promise<MailAccount>;
  labels(account: string): MailLabel[];
  threads(query: Parameters<MailStore["threads"]>[0]): ReturnType<MailStore["threads"]>;
  thread(id: string): { thread: MailThread; messages: MailMessage[]; drafts: MailDraft[] } | null;
  message(id: string): MailMessage | null;
  body(message: string): Promise<MailBody>;
  attachment(message: string, index: number): Promise<{ filename: string; mimeType: string; content: Buffer } | null>;
  change(change: MailChange): Promise<MailThread[]>;
  search(query: { account: string; q: string; remote?: boolean; limit?: number }): Promise<MailThread[]>;
  drafts(account: string): MailDraft[];
  newDraft(input: { account: string; reply?: string; replyAll?: boolean; forward?: string; adopt?: string } & MailDraftInput): Promise<MailDraft>;
  saveDraft(id: string, input: MailDraftInput): Promise<MailDraft>;
  removeDraft(id: string): Promise<void>;
  sendDraft(id: string): Promise<void>;
  stop(): Promise<void>;
}
