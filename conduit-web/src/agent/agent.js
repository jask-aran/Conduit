import { notice } from "../context/notices.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { templateBackend } from "../chat-backend.js";
import { Connectors } from "./connectors.js";
import { AgentDoc } from "./agent-doc.js";
import { listAsks } from "./asks.js";
import { filedText, InboxText, listInbox } from "./inbox.js";
import { inboxFile, syncInboxFiles } from "./inbox-files.js";
import { promptVars, runInstructions } from "./routines.js";
import { startRoutine } from "./routine-task.js";
import { listRoutines, readRoutine, seedRoutines, settingRule, updateTrigger, writeRoutine } from "./routine-files.js";

const SEED = fileURLToPath(new URL("../../../templates/agent/seed/", import.meta.url));
const TEMPLATE_ID = "agent";
const DIALS = new Set(["quiet", "normal", "chatty"]);
const NOTICES_KEPT = 20;

const hostZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const validZone = (zone) => { try { Intl.DateTimeFormat(undefined, { timeZone: zone }); return true; } catch { return false; } };
const clock = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));

/** What the agent does unless the person says otherwise (agent.json in its folder). */
const DEFAULT_SETTINGS = Object.freeze({
  name: "Agent",
  on: true,
  // How much reaches the person: quiet (urgent only), normal (attention and up), chatty (FYI too).
  dial: "normal",
  // In a turn the person started, edits to their own data through a connector go without an approval (policy.js).
  youAsk: true,
  // Gating connectors decide what needs approval (policy.js); otherwise Conduit's read-action list decides.
  toolsDecide: true,
  // An ask still waiting is pushed once more after this many minutes; 0 never.
  remindMinutes: 10,
  // Background runs stop for the day once they have spent this (USD); 0 is no limit.
  budgetUsdPerDay: 2,
  timezone: null,
  brief: { enabled: true, at: "08:00" },
  // Shown from (and written through to) routines/morning-brief.md and routines/heartbeat.md, which hold them.
  heartbeat: { enabled: true, everyMinutes: 60 },
  // New mail into the context inbox (routines/email.md, packaged with Conduit): opt in, since it reads the person's mail.
  email: { enabled: false },
  // Notifications respect these hours; work continues.
  quietHours: { enabled: true, start: "23:00", end: "07:00" },
  nightlyCompaction: { enabled: true, minTokens: 100000, minShare: 0.25 },
  // The model and effort each kind of background run uses ({ model: "provider/id", thinkingLevel }); null is the
  // home thread's. `other`: check-backs, events, webhooks and runs started by hand.
  work: { brief: null, heartbeat: null, other: null },
});
const LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const WORK = ["brief", "heartbeat", "other"];

/**
 * The hub's persistent agent (docs/plans/persistent-agent.md): one per hub, the
 * Conduit durable agent running as a home thread that never ends, side threads
 * that share its memory, and background runs it is woken into.
 *
 * Its folder is a managed workspace on the hub (so its files and memory are
 * read and edited in Work like any workspace) holding agent.json, its identity
 * and memory files and whatever it writes. Its threads are roaming durable
 * chats in that workspace: their own folder is the agent's, and they reach any
 * device per call. A run is a background subagent of the home thread
 * (server/subagents.js) whose report reaches the home thread only when it
 * matters enough for the person's interruption setting.
 *
 * What pi-durable keeps (schedules, watches, proposals, spend) is `AgentDoc`;
 * the parts that read and write it are memory.js, schedule.js, events.js,
 * chat-tools.js and policy.js, composed in extension.js.
 */
export class PersistentAgent {
  constructor({ runtime, registry, projects, launchLiveSession = null, findChatContext = null }) {
    this.runtime = runtime;
    this.connectors = new Connectors(this);
    this.registry = registry;
    this.projects = projects;
    this.launchLiveSession = launchLiveSession;
    this.findChatContext = findChatContext;
    this.project = null;
    this.cached = null;
    // Settings changes a part needs to act on (schedule.js reseeds the brief and heartbeat).
    this.settingsListeners = new Set();
    runtime.agent = this;
    runtime.agentDial = () => this.settings().dial;
    runtime.agentDay = () => this.today();
    // Prompts: jbot's {{variables}}, and RUN.md for a subagent one of its threads starts (subagents.js).
    runtime.agentVars = () => promptVars(this);
    runtime.agentRunPrompt = async (conversationId) => this.enabled() && await this.describe(conversationId) ? runInstructions(this) : null;
  }

  get context() { return this.runtime.context; }

  /** The agent's folder: its workspace's working root, once it is enabled. */
  get folder() { return this.project?.workingRoot || null; }

  /** Whether this hub has an agent: its workspace exists. Read at startup, so a hub without one pays nothing. */
  async load() {
    const project = (await this.projects.list()).find((item) => item.slug === "conduit-agent");
    if (!project) return null;
    this.project = project;
    await this.readSettings();
    await this.seedFolder();
    await this.connectors.start();
    void this.followInbox();
    return project;
  }

  /**
   * Keep the context inbox's files (inbox-files.js) in step with the agent's document, from load until `stopFollowing`:
   * each change to the inbox rewrites what changed, in order.
   */
  /*
   * A subagent's anchor only holds its run open, so one the runtime parked after too many unclean exits (pi-durable's
   * restart limit) is safe to start again, and while it is parked its run's reports cannot be delivered. On load, every
   * parked anchor runs again; other parked work waits for the person (the agent page's Needs you).
   */
  async recoverAnchors() {
    const harness = await this.runtime.open();
    const { tasks } = await harness.inspect(this.context);
    for (const task of tasks) {
      if (task.record.kind === "conduit.subagent-anchor" && task.state.kind === "blocked" && task.state.reason === "restart_limit") {
        await harness.retryTask(task.record.id, this.context).catch(() => {});
      }
    }
  }

  async followInbox() {
    if (this.inboxWatch || !this.folder) return;
    void this.recoverAnchors().catch((error) => console.warn("Parked anchors could not be started again", error.message));
    try {
      await this.moveInboxTexts();
      const harness = await this.runtime.open();
      const watch = await harness.watchDoc(AgentDoc, this.context);
      if (!watch) return;
      this.inboxWatch = watch;
      let last = null;
      let pending = Promise.resolve();
      const sync = (value) => {
        const key = JSON.stringify(value?.inbox || {});
        if (key === last) return;
        last = key;
        pending = pending.then(() => syncInboxFiles(this.folder, listInbox(value), { textOf: (entry) => this.entryText(entry),
          lastAnswer: (id) => this.runtime.lastAnswer(id) }))
          .catch((error) => console.warn("The context inbox's files could not be written", error.message));
      };
      sync(watch.value);
      watch.start(async (value) => { sync(value); });
    } catch (error) { console.warn("The context inbox's files are not followed", error.message); }
  }

  /** An entry's text as filed (inbox.js), before or without its file. */
  async entryText(entry) {
    const harness = await this.runtime.open();
    return filedText(harness, entry, this.context);
  }

  /** Once: the texts entries carried in the agent's document become documents of their own (inbox.js, InboxText). */
  async moveInboxTexts() {
    const carrying = Object.values((await this.state()).inbox || {}).filter((entry) => typeof entry.body === "string");
    if (!carrying.length) return;
    await this.update(async (doc, tx) => {
      for (const entry of Object.values(doc.inbox || {})) {
        if (typeof entry.body !== "string") continue;
        if (entry.body) await tx.doc(InboxText, entry.id, entry.body);
        delete entry.body;
      }
    });
  }

  async stopFollowing() { const watch = this.inboxWatch; this.inboxWatch = null; await watch?.stop(); }

  enabled() { return Boolean(this.project); }

  active() { return this.enabled() && this.settings().on !== false; }

  /**
   * The seed files it lacks (never over the person's): memory files, RUN.md, the built-in routines.
   */
  async seedFolder() {
    await fs.mkdir(path.join(this.folder, "diary"), { recursive: true });
    for (const entry of await fs.readdir(SEED, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name === "RUN.md") continue;
      await fs.copyFile(path.join(SEED, entry.name), path.join(this.folder, entry.name), fs.constants.COPYFILE_EXCL).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
    }
    await seedRoutines(this.folder, path.join(SEED, "routines"));
  }

  /** agent.json as last read, over the defaults. */
  settings() {
    const saved = this.cached || {};
    return {
      ...DEFAULT_SETTINGS, ...saved,
      timezone: saved.timezone && validZone(saved.timezone) ? saved.timezone : hostZone(),
      brief: { ...DEFAULT_SETTINGS.brief, ...(saved.brief || {}) },
      heartbeat: { ...DEFAULT_SETTINGS.heartbeat, ...(saved.heartbeat || {}) },
      email: { ...DEFAULT_SETTINGS.email, ...(saved.email || {}) },
      quietHours: { ...DEFAULT_SETTINGS.quietHours, ...(saved.quietHours || {}) },
      nightlyCompaction: { ...DEFAULT_SETTINGS.nightlyCompaction, ...(saved.nightlyCompaction || {}) },
      work: { ...DEFAULT_SETTINGS.work, ...(saved.work || {}) },
    };
  }

  async readSettings() {
    try { this.cached = JSON.parse(await fs.readFile(path.join(this.folder, "agent.json"), "utf8")); }
    catch { this.cached = {}; }
    this.cached ||= {};
    return this.settings();
  }

  /** Change agent.json; an invalid value is refused whole. */
  async saveSettings(patch = {}) {
    const next = { ...(this.cached || {}) };
    const before = this.settings().name;
    const fail = (message) => { throw Object.assign(new Error(message), { code: "invalid_agent_settings", status: 400 }); };
    if (patch.name !== undefined) {
      const name = String(patch.name).trim();
      if (!name || name.length > 60) fail("A name of 1 to 60 characters");
      next.name = name;
    }
    if (patch.dial !== undefined) { if (!DIALS.has(patch.dial)) fail("dial is quiet, normal or chatty"); next.dial = patch.dial; }
    if (patch.on !== undefined) { if (typeof patch.on !== "boolean") fail("on is true or false"); next.on = patch.on; }
    if (patch.youAsk !== undefined) { if (typeof patch.youAsk !== "boolean") fail("youAsk is true or false"); next.youAsk = patch.youAsk; }
    if (patch.toolsDecide !== undefined) { if (typeof patch.toolsDecide !== "boolean") fail("toolsDecide is true or false"); next.toolsDecide = patch.toolsDecide; }
    if (patch.remindMinutes !== undefined) {
      const minutes = Number(patch.remindMinutes);
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) fail("remindMinutes is 0 to 1440");
      next.remindMinutes = minutes;
    }
    if (patch.budgetUsdPerDay !== undefined) {
      const budget = Number(patch.budgetUsdPerDay);
      if (!Number.isFinite(budget) || budget < 0 || budget > 1000) fail("budgetUsdPerDay is 0 to 1000");
      next.budgetUsdPerDay = budget;
    }
    if (patch.timezone !== undefined) {
      if (patch.timezone !== null && !validZone(patch.timezone)) fail("timezone is an IANA zone");
      next.timezone = patch.timezone;
    }
    if (patch.brief !== undefined) {
      const brief = { ...this.settings().brief, ...patch.brief };
      if (typeof brief.enabled !== "boolean" || !clock(brief.at)) fail("brief is { enabled, at: \"HH:MM\" }");
      next.brief = brief;
    }
    if (patch.heartbeat !== undefined) {
      const heartbeat = { ...this.settings().heartbeat, ...patch.heartbeat };
      const every = Number(heartbeat.everyMinutes);
      if (typeof heartbeat.enabled !== "boolean" || !Number.isInteger(every) || every < 15 || every > 1440) {
        fail("heartbeat is { enabled, everyMinutes: 15 to 1440 }");
      }
      next.heartbeat = { enabled: heartbeat.enabled, everyMinutes: every };
    }
    if (patch.email !== undefined) {
      const email = { ...this.settings().email, ...patch.email };
      if (typeof email.enabled !== "boolean") fail("email is { enabled }");
      next.email = { enabled: email.enabled };
    }
    if (patch.quietHours !== undefined) {
      const quiet = { ...this.settings().quietHours, ...patch.quietHours };
      if (typeof quiet.enabled !== "boolean" || !clock(quiet.start) || !clock(quiet.end) || quiet.start === quiet.end) {
        fail("quietHours is { enabled, start: \"HH:MM\", end: \"HH:MM\" }, start and end apart");
      }
      next.quietHours = { enabled: quiet.enabled, start: quiet.start, end: quiet.end };
    }
    if (patch.nightlyCompaction !== undefined) {
      const value = { ...this.settings().nightlyCompaction, ...patch.nightlyCompaction };
      if (typeof value.enabled !== "boolean" || !Number.isInteger(value.minTokens) || value.minTokens < 0
        || !Number.isFinite(value.minShare) || value.minShare < 0 || value.minShare > 1) {
        fail("nightlyCompaction is { enabled, minTokens: non-negative integer, minShare: number from 0 to 1 }");
      }
      next.nightlyCompaction = { enabled: value.enabled, minTokens: value.minTokens, minShare: value.minShare };
    }
    if (patch.work !== undefined) {
      const work = { ...this.settings().work };
      for (const [kind, choice] of Object.entries(patch.work || {})) {
        if (!WORK.includes(kind)) fail(`work is { ${WORK.join(", ")} }`);
        if (choice !== null && !(typeof choice?.model === "string" && /^[^/\s]+\/\S+$/.test(choice.model) && LEVELS.has(choice.thinkingLevel))) {
          fail("each work choice is null or { model: \"provider/id\", thinkingLevel }");
        }
        work[kind] = choice && { model: choice.model, thinkingLevel: choice.thinkingLevel };
      }
      next.work = work;
    }
    await fs.writeFile(path.join(this.folder, "agent.json"), `${JSON.stringify(next, null, 2)}\n`);
    // Old clock checkpoints must stay skipped while settings listeners move the clocks forward.
    if (this.settings().on === false && next.on !== false) this.resumedAt = Date.now();
    this.cached = next;
    // The brief's and heartbeat's clocks are their routine files' now: Settings writes through to them.
    if (patch.brief) await this.adjustRoutine("morning-brief", (routine) => ({ ...routine, enabled: next.brief.enabled !== false,
      trigger: next.brief.at ? updateTrigger(routine.trigger, "at", { time: next.brief.at }) : routine.trigger }));
    if (patch.heartbeat) await this.adjustRoutine("heartbeat", (routine) => ({ ...routine, enabled: next.heartbeat.enabled !== false,
      trigger: patch.heartbeat.everyMinutes ? updateTrigger(routine.trigger, "every", { minutes: next.heartbeat.everyMinutes }) : routine.trigger }));
    if (patch.email) await this.adjustRoutine("email", (routine) => ({ ...routine, enabled: next.email.enabled }));
    if (next.name && this.project?.name !== next.name) this.project = await this.projects.rename(this.project.id, next.name).catch(() => this.project) || this.project;
    // The home thread is titled with the name until the person retitles it.
    const home = (await this.state()).home?.chatId;
    if (next.name && next.name !== before && home && this.registry.metadata(home)?.title === before) await this.registry.update(home, { title: next.name }).catch(() => {});
    for (const listener of this.settingsListeners) await listener(this.settings());
    return this.settings();
  }

  /** Today in the agent's time zone, `YYYY-MM-DD`: the day its budget counts. */
  today(at = Date.now()) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: this.settings().timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  }

  async state() {
    const harness = await this.runtime.open();
    return (await harness.snapshot(AgentDoc, this.context)) || AgentDoc.definition.initial();
  }

  /** Change the agent's document in one commit: `change(doc, tx)` returns what the caller gets. */
  async update(change) {
    const harness = await this.runtime.open();
    return harness.commit(async (tx) => change(await tx.doc(AgentDoc), tx), this.context);
  }

  /** Something the attention list says beside the work (a budget reached, a skipped run). */
  async notice(kind, text) {
    await this.update((doc) => {
      doc.notices.push({ id: `n-${doc.next++}`, kind, text, at: new Date().toISOString() });
      doc.notices.splice(0, Math.max(0, doc.notices.length - NOTICES_KEPT));
    });
  }

  async spentToday() { return (await this.state()).spend[this.today()] || 0; }

  /** Whether today's budget is gone: background runs wait for tomorrow (or for the person to raise it). */
  async overBudget() {
    const budget = this.settings().budgetUsdPerDay;
    return budget > 0 && await this.spentToday() >= budget;
  }

  /**
   * Give this hub its agent: its workspace with the seed files, agent.json, and
   * the home thread. Idempotent; an agent that exists is returned as it is.
   */
  async enable({ name } = {}) {
    if (!this.project) {
      this.project = await this.projects.ensure({ slug: "conduit-agent", name: name || DEFAULT_SETTINGS.name, kind: "workspace", origin: "managed" });
    }
    await this.readSettings();
    await this.seedFolder();
    await this.connectors.start();
    void this.followInbox();
    if (name && !this.cached.name) await this.saveSettings({ name });
    else if (!this.cached.name) await this.saveSettings({ name: this.project.name });
    await this.home();
    for (const listener of this.settingsListeners) await listener(this.settings());
    return this.view();
  }

  /** The home thread's chat, made on first use: a roaming durable chat in the agent's workspace. */
  async home() {
    const saved = (await this.state()).home;
    const existing = saved?.chatId && this.registry.metadata(saved.chatId);
    if (existing && saved.conversationId) return { chat: existing, conversationId: saved.conversationId };
    const chat = existing || await this.createThread("home", this.settings().name);
    const conversationId = await this.conversationOf(chat);
    await this.update((doc) => { doc.home = { chatId: chat.id, conversationId }; });
    return { chat, conversationId };
  }

  /** A side thread: one project or recurring topic, sharing the agent's memory and folder. */
  async side(title = "") {
    if (!this.enabled()) throw Object.assign(new Error("This hub has no agent yet"), { code: "agent_not_enabled", status: 409 });
    const chat = await this.createThread("side", title);
    await this.conversationOf(chat);
    return chat;
  }

  async createThread(role, title) {
    const chat = await this.registry.create(this.project, { templateId: TEMPLATE_ID,
      backend: { ...templateBackend({ id: TEMPLATE_ID }), roaming: true, agentThread: role } });
    // A thread is a chat the person may open at once, so it is listed (active) and named from the start.
    return this.registry.update(chat.id, { status: "active", ...(title ? { title } : {}) });
  }

  /** The thread's pi-durable conversation: launching its chat makes one (its opaque session). */
  async conversationOf(chat) {
    const current = this.registry.metadata(chat.id);
    if (!current?.backend?.opaqueSession) {
      if (!this.launchLiveSession) throw new Error("The agent's threads cannot start without the live-session launcher");
      await this.launchLiveSession({ chatId: chat.id, requestedProject: this.project.id });
    }
    return Number(this.registry.metadata(chat.id)?.backend?.opaqueSession) || null;
  }

  /**
   * Who a conversation is to the agent: its `home` thread, a `side` thread, a
   * `run` it was woken into (a child of the home thread), or `null`.
   */
  /** Whose a conversation is, for an approval: the agent's (describe), or else any chat's (`role: "chat"`). */
  async threadOf(conversationId) {
    const described = await this.describe(conversationId);
    if (described) return described;
    const chat = this.registry.list({ includeHidden: true }).find((item) => String(item.backend?.opaqueSession) === String(conversationId));
    return chat ? { role: "chat", chatId: chat.id, title: chat.title || "" } : null;
  }

  async describe(conversationId) {
    const harness = await this.runtime.open();
    const state = await this.state();
    if (state.home?.conversationId === conversationId) return { role: "home", chatId: state.home.chatId };
    const record = await harness.commit(async (tx) => tx.conversation(conversationId), this.context);
    // A run's conversation is a task's (pi-durable's record names that `owner`); a thread's has none.
    if (record?.owner) return { role: "run", chatId: null };
    const chat = this.registry.list({ includeHidden: true }).find((item) => item.backend?.agentThread
      && String(item.backend?.opaqueSession) === String(conversationId));
    return chat ? { role: chat.backend.agentThread, chatId: chat.id } : null;
  }

  /**
   * Wake the agent: a background run of the home thread with `task` as its
   * whole brief. `key` makes it idempotent (a schedule's slot, an event's id);
   * `kind` says what woke it (brief, heartbeat, checkback, event, webhook,
   * manual). A run that would go over today's budget is skipped and noticed. `log: false` keeps it out of jbot's
   * message log (the run says so: run.log), as its routine, watch or webhook asks.
   */
  async wake({ key, kind, title, task, log = true }) {
    if (!this.enabled()) throw Object.assign(new Error("This hub has no agent yet"), { code: "agent_not_enabled", status: 409 });
    if (!this.active()) return null;
    if (kind !== "manual" && await this.overBudget()) {
      await this.notice("budget", `Skipped ${title || kind}: today's budget of $${this.settings().budgetUsdPerDay} is spent.`);
      return null;
    }
    const { conversationId } = await this.home();
    const harness = await this.runtime.open();
    const conversation = await harness.conversation(conversationId, this.context);
    return conversation.commit((tx) => this.active() ? this.spawnRun(tx, conversationId, { key, kind, title, task, log }) : null, this.context);
  }

  /**
   * A routine now, off its clock (Run now): its tasks gather and its run fires whatever its gate says, except a gate of
   * never (only the tasks), and whatever is left of the day's budget: the person asked. Its cursors move as a firing's would;
   * `key` keeps a retried request to one run.
   */
  async fireRoutine(name, key) {
    if (!this.active()) return { error: "agent_off", status: 409 };
    const routine = await readRoutine(this.folder, name).catch((error) => ({ error: error.message }));
    if (!routine) return { error: "routine_not_found", status: 404 };
    if (routine.error) return { error: routine.error, status: 400 };
    const { conversationId } = await this.home();
    const harness = await this.runtime.open();
    const conversation = await harness.conversation(conversationId, this.context);
    const slot = new Date().toISOString();
    const taskId = await conversation.commit(async (tx) => {
      const doc = await tx.doc(AgentDoc);
      const id = await startRoutine(tx, doc, this, conversationId, routine, slot, { force: true,
        ...(key ? { key: `manual:${name}:${key}` } : {}) });
      const current = doc.schedules[`r-${name}`];
      if (current?.nextAt && Date.parse(current.nextAt) <= Date.now()) current.lastAt = current.nextAt;
      return id;
    }, this.context);
    return { ran: routine.gate !== "never", taskId };
  }

  /**
   * An event (routine-files.js EVENTS) starts every routine on that is triggered by it (`trigger: { on: <event> }`):
   * `text` is what its run is shown as an `<event>` block; `key` keeps one event to one run of each.
   */
  async fireEvent(name, { key, text }) {
    if (!this.active() || await this.overBudget()) return [];
    const routines = (await listRoutines(this.folder)).filter((routine) => !routine.error && routine.enabled !== false
      && (Array.isArray(routine.trigger) ? routine.trigger : [routine.trigger]).some((rule) => rule.kind === "on" && rule.event === name));
    if (!routines.length) return [];
    const { conversationId } = await this.home();
    const harness = await this.runtime.open();
    const conversation = await harness.conversation(conversationId, this.context);
    const slot = new Date().toISOString();
    return conversation.commit(async (tx) => {
      const doc = await tx.doc(AgentDoc);
      const ids = [];
      for (const routine of routines) {
        ids.push(await startRoutine(tx, doc, this, conversationId, routine, slot, { key: `event:${routine.name}:${key}`, event: { name, text } }));
      }
      return ids;
    }, this.context);
  }

  /**
   * The same, inside a commit on the home conversation (a clock task's): `tx.createTask()` defaults to it. Every run's
   * system prompt is RUN.md (routines.js), a routine's with its `<routine>` block; `raw` takes `task` as the whole
   * first message (a routine composes its own). `output`: where its report goes (jbot, inbox, both).
   */
  async spawnRun(tx, conversationId, { key, kind, title, task, instructions = null, output = null, raw = false, model = null, thinkingLevel = null, routineTaskId = null, log = true }) {
    if (!this.runtime.spawnBackground) throw new Error("Background subagents are not installed");
    const work = this.settings().work[kind === "brief" || kind === "morning-brief" ? "brief" : kind === "heartbeat" ? "heartbeat" : "other"];
    const chosen = model ? { model, thinkingLevel } : work ? { model: work.model, thinkingLevel: thinkingLevel || work.thinkingLevel } : {};
    return this.runtime.spawnBackground(tx, conversationId, { key, title: title || kind,
      task: raw ? task : await runBrief(kind, task, this.settings().timezone, this.runtime.contextStore), instructions: instructions ?? await runInstructions(this),
      origin: { kind, key, ...(output ? { output } : {}), ...(routineTaskId ? { routineTaskId } : {}), ...(log ? {} : { log: false }) }, gate: true, ...chosen });
  }

  /** The agent as the API shows it. */
  async adjustRoutine(name, change) {
    const routine = await readRoutine(this.folder, name).catch(() => null);
    if (routine) await writeRoutine(this.folder, change(routine));
  }

  /** Settings as the person sees them: the brief's and heartbeat's from their routine files. */
  async shownSettings() {
    const settings = this.settings();
    const [brief, beat, mail] = await Promise.all(["morning-brief", "heartbeat", "email"].map((name) => readRoutine(this.folder, name).catch(() => null)));
    if (mail) settings.email = { enabled: mail.enabled };
    if (brief) settings.brief = { enabled: brief.enabled, at: settingRule(brief.trigger, "at")?.time || settings.brief.at };
    if (beat) settings.heartbeat = { enabled: beat.enabled, everyMinutes: settingRule(beat.trigger, "every")?.minutes ?? settings.heartbeat.everyMinutes };
    return settings;
  }

  /** @returns {Promise<import("./agent-view.js").AgentView>} the view GET /v0/agent sends, attention aside (agent-view.d.ts) */
  async view(state) {
    if (!this.enabled()) return { enabled: false };
    const [current, settings] = await Promise.all([state || this.state(), this.shownSettings()]);
    state = current;
    // Each entry's text is a file in its folder (inbox-files.js, kept in step by followInbox), which the page opens in
    // the file viewer.
    const inbox = listInbox(state);
    return {
      enabled: true,
      settings,
      projectId: this.project.id,
      home: state.home,
      sides: this.registry.list({ includeHidden: true })
        .filter((chat) => chat.backend?.agentThread === "side" && chat.projectId === this.project.id)
        .map((chat) => ({ chatId: chat.id, title: chat.title || "", updatedAt: chat.updatedAt })),
      spentToday: state.spend[this.today()] || 0,
      asks: listAsks(state),
      inbox: inbox.map((entry) => ({ ...entry, file: inboxFile(entry) })),
      rules: Object.values(state.rules || {}).reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }
}

const KIND_WORDS = { manual: "The person asked for this run", checkback: "A check-back you set", event: "An event woke this run",
  webhook: "A webhook woke this run", feed: "A feed's check" };

/** An ad-hoc run's first message: when and why, then its task. How it reports is RUN.md's (its system prompt). */
const runBrief = (kind, task, timeZone, store) => notice(store, "wake-run", {
  now: new Date().toLocaleString("en-AU", { timeZone, dateStyle: "full", timeStyle: "short" }),
  reason: KIND_WORDS[kind] || `A ${kind} run`, task: String(task || "").trim(),
});
