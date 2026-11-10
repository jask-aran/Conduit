import { LOOPBACK_HOST, PRIVATE_HOST } from "./network-hosts.js";
import fs from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { formatKeybindings, parseKeybindings } from "./keybindings.js";
import { readUiPreferences, UI_PREFERENCE_KEYS } from "./preferences-api.js";

const DEFAULTS = {
  defaultTemplateId: "assistant",
  sessionNameModel: "",
  // The approval model (Settings › AI › Helper models: Review); "" is the naming model's.
  reviewModel: "",
  accountName: "",
  accountHome: "",
  sessionNameThinkingLevel: "off",
  profileModelDefaults: {},
  terminalShortcuts: [],
  sidebarPins: [],
  // The UI preferences (preferences-api.js): each unset until chosen.
  ...Object.fromEntries(UI_PREFERENCE_KEYS.map((key) => [key, null])),
  knownServers: [],
};

const SIDEBAR_PIN_PATTERN = /^(chat|project|terminal):[^\s:][^\s]*$/;

/* The addresses this Conduit knows other Conduits by.
 *
 * A client learns servers one at a time and then has to be told again on every
 * other device it uses. Keeping the directory here means a server that has
 * been told about another one tells every client that connects to it, and a
 * client that knows one the server does not tells the server -- so the first
 * address anyone types is the last time that address has to be typed.
 *
 * It is a convenience, not an authority: nothing here grants access to
 * anything, a client still signs in to each server separately, and a name is
 * just a label. It does mean each server learns where the others are, which is
 * the cost of not maintaining the same list by hand in several places. */
// The same line the client and the auth middleware draw: plain HTTP is
// accepted for an address that cannot leave the machine, or the network it is on.

function validServerOrigin(value) {
  if (typeof value !== "string" || value.length > 253) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.username || url.password) return false;
  if (url.pathname !== "/" || url.search || url.hash) return false;
  return url.protocol === "https:" || (url.protocol === "http:" && (LOOPBACK_HOST.test(url.hostname) || PRIVATE_HOST.test(url.hostname)));
}

export function validKnownServers(input) {
  if (!Array.isArray(input) || input.length > 20) return false;
  const origins = new Set();
  for (const item of input) {
    if (!item || typeof item !== "object") return false;
    if (!validServerOrigin(item.origin)) return false;
    if (typeof item.name !== "string" || item.name.length > 60) return false;
    if (origins.has(item.origin)) return false;
    origins.add(item.origin);
  }
  return true;
}

export function normalizeKnownServers(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const list = [];
  for (const item of input) {
    const origin = item?.origin;
    if (!validServerOrigin(origin) || seen.has(origin)) continue;
    seen.add(origin);
    list.push({ origin, name: typeof item?.name === "string" ? item.name.slice(0, 60) : "" });
  }
  return list.slice(0, 20);
}

function normalizeSidebarPins(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((item) => typeof item === "string"
    && item.length <= 200
    && SIDEBAR_PIN_PATTERN.test(item)))].slice(0, 50);
}

export function validSidebarPins(input) {
  return Array.isArray(input)
    && input.length <= 50
    && input.every((item) => typeof item === "string"
      && item.length <= 200
      && SIDEBAR_PIN_PATTERN.test(item))
    && new Set(input).size === input.length;
}

// The last model somebody chose on a profile, so choosing it once is enough.
// Keyed by profile rather than by backend: "Assistant" and "Coding" are two
// answers to the same question, and sharing one entry between them meant
// picking a model in one silently moved the other.
const normalizeProfileModelDefaults = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([profileId, selection]) => {
    const model = typeof selection?.model === "string" ? selection.model.trim() : "";
    const thinkingLevel = typeof selection?.thinkingLevel === "string" ? selection.thinkingLevel.trim() : "";
    return profileId.length <= 80 && model && model.length <= 200
      ? [[profileId, { model, ...(thinkingLevel && thinkingLevel.length <= 40 ? { thinkingLevel } : {}) }]]
      : [];
  }).slice(0, 20));
};

export function normalizeTerminalShortcuts(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 12).flatMap((item) => {
    const id = typeof item?.id === "string" ? item.id.trim().slice(0, 80) : "";
    const label = typeof item?.label === "string" ? item.label.trim().slice(0, 32) : "";
    const command = typeof item?.command === "string" ? item.command.trim().slice(0, 2048) : "";
    const target = item?.target === "current" || item?.target === "new" ? item.target : null;
    return id && label && command && target ? [{ id, label, command, target, ...(item.onStart === true ? { onStart: true } : {}) }] : [];
  });
}

export function validTerminalShortcuts(input) {
  return Array.isArray(input)
    && input.length <= 12
    && input.every((item) => typeof item?.id === "string" && item.id.trim().length > 0 && item.id.length <= 80
      && typeof item.label === "string" && item.label.trim().length > 0 && item.label.length <= 32
      && typeof item.command === "string" && item.command.trim().length > 0 && item.command.length <= 2048
      && (item.target === "current" || item.target === "new")
      && (item.onStart === undefined || typeof item.onStart === "boolean"));
}

export function normalizePreferences(input = {}, fallback = DEFAULTS, knownTemplateIds = null) {
  const fallbackId = typeof fallback.defaultTemplateId === "string" && fallback.defaultTemplateId.trim()
    ? fallback.defaultTemplateId.trim()
    : DEFAULTS.defaultTemplateId;
  let defaultTemplateId = typeof input.defaultTemplateId === "string" && input.defaultTemplateId.trim()
    ? input.defaultTemplateId.trim()
    : fallbackId;
  if (Array.isArray(knownTemplateIds) && knownTemplateIds.length > 0 && !knownTemplateIds.includes(defaultTemplateId)) {
    defaultTemplateId = knownTemplateIds.includes(fallbackId) ? fallbackId : knownTemplateIds[0];
  }
  const sessionNameModel = typeof input.sessionNameModel === "string"
    ? input.sessionNameModel.trim()
    : typeof fallback.sessionNameModel === "string" ? fallback.sessionNameModel.trim() : "";
  const reviewModel = typeof input.reviewModel === "string"
    ? input.reviewModel.trim()
    : typeof fallback.reviewModel === "string" ? fallback.reviewModel.trim() : "";
  const sessionNameThinkingLevel = typeof input.sessionNameThinkingLevel === "string" && input.sessionNameThinkingLevel.trim()
    ? input.sessionNameThinkingLevel.trim()
    : typeof fallback.sessionNameThinkingLevel === "string" && fallback.sessionNameThinkingLevel.trim()
      ? fallback.sessionNameThinkingLevel.trim()
      : DEFAULTS.sessionNameThinkingLevel;
  const terminalShortcuts = Array.isArray(input.terminalShortcuts)
    ? normalizeTerminalShortcuts(input.terminalShortcuts)
    : normalizeTerminalShortcuts(fallback.terminalShortcuts);
  const sidebarPins = Array.isArray(input.sidebarPins)
    ? normalizeSidebarPins(input.sidebarPins)
    : normalizeSidebarPins(fallback.sidebarPins);
  // The hub account's name (Settings › Account), whose initials are its picture in the server switcher.
  const accountName = typeof input.accountName === "string" ? input.accountName.trim().slice(0, 60)
    : typeof fallback.accountName === "string" ? fallback.accountName.trim().slice(0, 60) : "";
  // Where they live (Settings › Account): their agent's USER.md `home`, for weather, travel and "near me".
  const accountHome = typeof input.accountHome === "string" ? input.accountHome.trim().slice(0, 120)
    : typeof fallback.accountHome === "string" ? fallback.accountHome.trim().slice(0, 120) : "";
  return {
    defaultTemplateId,
    accountName,
    accountHome,
    sessionNameModel,
    reviewModel,
    sessionNameThinkingLevel,
    profileModelDefaults: normalizeProfileModelDefaults(input.profileModelDefaults ?? fallback.profileModelDefaults),
    terminalShortcuts,
    sidebarPins,
    ...readUiPreferences(input, fallback),
  };
}

export class PreferencesStore {
  constructor(filePath, seed = DEFAULTS, { knownTemplateIds = null, keybindingsFile = null } = {}) {
    this.filePath = filePath;
    this.knownTemplateIds = knownTemplateIds;
    this.preferences = normalizePreferences(seed, DEFAULTS, knownTemplateIds);
    // The shortcut overrides' own file (keybindings.js), beside this one: readable, and edited in place by a person or
    // an agent. They are served in `shortcutOverrides` as before; preferences.json no longer holds them.
    this.keybindingsFile = keybindingsFile || path.join(path.dirname(filePath), "keybindings.json");
    this.keybindingErrors = [];
  }

  get() {
    return { ...this.preferences };
  }

  /** Where the shortcuts file is and what in it could not be read, for Settings › Shortcuts. */
  keybindings() {
    return { path: this.keybindingsFile, errors: [...this.keybindingErrors] };
  }

  async load() {
    let stored = null;
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      stored = raw?.shortcutOverrides ?? null;
      this.preferences = normalizePreferences(raw, this.preferences, this.knownTemplateIds);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const read = await this.readKeybindings();
    // Overrides saved before the file: moved into it, and out of preferences.json (the file, when there is one, wins).
    if (!read && this.preferences.shortcutOverrides) await this.save({ shortcutOverrides: this.preferences.shortcutOverrides });
    else if (stored) await this.save({});
    return this.get();
  }

  /** The file's overrides into the preferences; false when there is no file. A file that is not JSON keeps the last. */
  async readKeybindings({ ownSaves = false } = {}) {
    let text;
    try { text = await fs.readFile(this.keybindingsFile, "utf8"); }
    catch (error) { if (error?.code === "ENOENT") { this.keybindingErrors = []; return false; } throw error; }
    // The file as Conduit last wrote it: the overrides already in hand, as recorded, are what it says.
    if (ownSaves && text === this.keybindingsWritten) return true;
    const { overrides, errors } = parseKeybindings(text);
    this.keybindingErrors = errors;
    // A file, even an empty one, is the hub's answer: {} (none), never null, as null tells a client the hub has nothing
    // and it uploads its own copy, which would bring back shortcuts reset on another device.
    if (overrides) this.preferences.shortcutOverrides = overrides;
    return true;
  }

  /**
   * Watch the shortcuts file for edits made outside Conduit; `onChange` has the overrides when they changed. The
   * folder is watched, as a save replaces the file (a rename) and a watch on the file itself would go with it.
   */
  watchKeybindings(onChange) {
    let timer = null;
    let watcher = null;
    const reread = () => {
      timer = null;
      const before = JSON.stringify(this.preferences.shortcutOverrides ?? null);
      void this.readKeybindings({ ownSaves: true }).then(() => {
        const after = this.preferences.shortcutOverrides ?? null;
        if (JSON.stringify(after) !== before) onChange(after || {});
      }).catch((error) => console.warn("Could not read keybindings.json", error.message));
    };
    try {
      watcher = watch(path.dirname(this.keybindingsFile), (_event, name) => {
        if (name && String(name) !== path.basename(this.keybindingsFile)) return;
        clearTimeout(timer);
        timer = setTimeout(reread, 100);
      });
      watcher.on("error", () => {});
    } catch (error) { console.warn("Could not watch keybindings.json", error.message); }
    return () => { clearTimeout(timer); watcher?.close(); };
  }

  async save(patch = {}) {
    this.preferences = normalizePreferences({ ...this.preferences, ...patch }, this.preferences, this.knownTemplateIds);
    // The file is written only when the overrides change: another preference's save leaves a hand edit as it was.
    const keybindings = Object.hasOwn(patch, "shortcutOverrides");
    // One write at a time, each of the state as it then is: two saves at once shared the temporary file, and the
    // second rename found it gone.
    const write = (this.writing || Promise.resolve()).then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      if (keybindings && (this.preferences.shortcutOverrides || await exists(this.keybindingsFile))) {
        const temp = `${this.keybindingsFile}.${process.pid}.tmp`;
        // Remembered, so the watcher knows its own save: read back, a stroke's key is rebuilt from its code and would
        // differ from what the client recorded, replacing it and telling every client of a change that is not one.
        this.keybindingsWritten = formatKeybindings(this.preferences.shortcutOverrides || {});
        await fs.writeFile(temp, this.keybindingsWritten, "utf8");
        await fs.rename(temp, this.keybindingsFile);
        this.keybindingErrors = [];
      }
      const temp = `${this.filePath}.${process.pid}.tmp`;
      await fs.writeFile(temp, `${JSON.stringify({ ...this.preferences, shortcutOverrides: undefined }, null, 2)}\n`, "utf8");
      await fs.rename(temp, this.filePath);
    });
    this.writing = write.catch(() => {});
    await write;
    return this.get();
  }
}

const exists = (file) => fs.access(file).then(() => true, () => false);
