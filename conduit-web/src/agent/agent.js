import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { templateBackend } from "../chat-backend.js";
import { AgentDoc } from "./agent-doc.js";

const SEED = fileURLToPath(new URL("../../../templates/agent/seed/", import.meta.url));
const TEMPLATE_ID = "agent";
const DIALS = new Set(["quiet", "normal", "chatty"]);
const NOTICES_KEPT = 20;

const hostZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const validZone = (zone) => { try { Intl.DateTimeFormat(undefined, { timeZone: zone }); return true; } catch { return false; } };
const clock = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));

/** What the agent does unless the person says otherwise (agent.json in its folder). */
export const DEFAULT_SETTINGS = Object.freeze({
  name: "Agent",
  // How much reaches the person: quiet (urgent only), normal (attention and up), chatty (FYI too).
  dial: "normal",
  // Background runs stop for the day once they have spent this (USD); 0 is no limit.
  budgetUsdPerDay: 2,
  timezone: null,
  brief: { enabled: true, at: "08:00" },
  heartbeat: { enabled: true, everyMinutes: 120 },
});

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
    return project;
  }

  enabled() { return Boolean(this.project); }

  /** agent.json as last read, over the defaults. */
  settings() {
    const saved = this.cached || {};
    return {
      ...DEFAULT_SETTINGS, ...saved,
      timezone: saved.timezone && validZone(saved.timezone) ? saved.timezone : hostZone(),
      brief: { ...DEFAULT_SETTINGS.brief, ...(saved.brief || {}) },
      heartbeat: { ...DEFAULT_SETTINGS.heartbeat, ...(saved.heartbeat || {}) },
    };
  }

  async readSettings() {
    try { this.cached = JSON.parse(await fs.readFile(path.join(this.folder, "agent.json"), "utf8")); }
    catch { this.cached = {}; }
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
    await fs.writeFile(path.join(this.folder, "agent.json"), `${JSON.stringify(next, null, 2)}\n`);
    this.cached = next;
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
    await fs.mkdir(path.join(this.folder, "diary"), { recursive: true });
    for (const file of await fs.readdir(SEED)) {
      await fs.copyFile(path.join(SEED, file), path.join(this.folder, file), fs.constants.COPYFILE_EXCL).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
    }
    await this.readSettings();
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
  async describe(conversationId) {
    const harness = await this.runtime.open();
    const state = await this.state();
    if (state.home?.conversationId === conversationId) return { role: "home", chatId: state.home.chatId };
    const record = await harness.commit(async (tx) => tx.conversation(conversationId), this.context);
    if (record?.ownership?.kind === "task") return { role: "run", chatId: null };
    const chat = this.registry.list({ includeHidden: true }).find((item) => item.backend?.agentThread
      && String(item.backend?.opaqueSession) === String(conversationId));
    return chat ? { role: chat.backend.agentThread, chatId: chat.id } : null;
  }

  /**
   * Wake the agent: a background run of the home thread with `task` as its
   * whole brief. `key` makes it idempotent (a schedule's slot, an event's id);
   * `kind` says what woke it (brief, heartbeat, checkback, event, webhook,
   * manual). A run that would go over today's budget is skipped and noticed.
   */
  async wake({ key, kind, title, task }) {
    if (!this.enabled()) throw Object.assign(new Error("This hub has no agent yet"), { code: "agent_not_enabled", status: 409 });
    if (await this.overBudget()) {
      await this.notice("budget", `Skipped ${title || kind}: today's budget of $${this.settings().budgetUsdPerDay} is spent.`);
      return null;
    }
    const { conversationId } = await this.home();
    const harness = await this.runtime.open();
    const conversation = await harness.conversation(conversationId, this.context);
    return conversation.commit((tx) => this.spawnRun(tx, conversationId, { key, kind, title, task }), this.context);
  }

  /** The same, inside a commit on the home conversation (a clock task's): `tx.createTask()` defaults to it. */
  spawnRun(tx, conversationId, { key, kind, title, task }) {
    if (!this.runtime.spawnBackground) throw new Error("Background subagents are not installed");
    return this.runtime.spawnBackground(tx, conversationId, { key, task: runBrief(kind, task), title: title || kind,
      origin: { kind, key }, gate: true });
  }

  /** The agent as the API shows it. */
  async view() {
    if (!this.enabled()) return { enabled: false };
    const state = await this.state();
    return {
      enabled: true,
      settings: this.settings(),
      projectId: this.project.id,
      folder: this.folder,
      home: state.home,
      sides: this.registry.list({ includeHidden: true })
        .filter((chat) => chat.backend?.agentThread === "side" && chat.projectId === this.project.id)
        .map((chat) => ({ chatId: chat.id, title: chat.title || "", updatedAt: chat.updatedAt })),
      spentToday: state.spend[this.today()] || 0,
    };
  }
}

/** A run's brief: what woke it, then its task, then how its answer is read (templates/agent/SYSTEM.md, Runs). */
export const runBrief = (kind, task) => [
  `You were woken for a ${kind === "checkback" ? "check-back" : kind} run, at ${new Date().toISOString()}.`,
  "",
  String(task || "").trim(),
  "",
  "Begin your final answer with NOTHING, FYI:, ATTENTION: or URGENT: as described in your instructions. "
    + "If something needs the person's approval, say exactly what, and do not do it.",
].join("\n");
