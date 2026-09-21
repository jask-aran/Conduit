import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  defaultTemplateId: "assistant",
  sessionNameModel: "",
  sessionNameThinkingLevel: "off",
  profileModelDefaults: {},
  terminalShortcuts: [],
  sidebarPins: [],
  sidebarChatLimit: null,
  collapsedProjectIds: null,
  sidebarCollapsed: null,
  markdownRenderer: null,
  rendererControlsVisible: null,
  composerSurface: null,
  contextMetrics: null,
  meteorField: null,
  incremarkPacing: null,
  transcriptWidth: null,
  transcriptWideBlocks: null,
  codeBlockCollapse: null,
  codeBlockCollapseLines: null,
  codeBlockWidth: null,
  panelMotion: null,
  userMessageCollapse: null,
  chatSort: null,
  shortcutOverrides: null,
  voicePreferences: null,
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
const LOOPBACK_SERVER_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function validServerOrigin(value) {
  if (typeof value !== "string" || value.length > 253) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.username || url.password) return false;
  if (url.pathname !== "/" || url.search || url.hash) return false;
  return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_SERVER_HOSTS.has(url.hostname));
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

export function normalizeSidebarPins(input) {
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

const UI_PREFERENCE_KEYS = new Set([
  "sidebarChatLimit", "collapsedProjectIds", "sidebarCollapsed", "markdownRenderer",
  "rendererControlsVisible", "composerSurface", "contextMetrics",
  "meteorField", "incremarkPacing", "transcriptWidth", "transcriptWideBlocks",
  "codeBlockCollapse", "codeBlockCollapseLines", "codeBlockWidth", "panelMotion",
  "userMessageCollapse", "chatSort",
  "shortcutOverrides", "voicePreferences",
]);
// Reading-surface presets. Free pixel values are deliberately not accepted: the
// shell scales its geometry by density and container width, so only a named
// preset stays correct across devices.
const TRANSCRIPT_WIDTHS = ["compact", "default", "wide", "full"];
const TRANSCRIPT_WIDE_BLOCKS = ["off", "default", "wider", "full"];
const CODE_BLOCK_COLLAPSE_MODES = ["off", "long", "all"];
const CODE_BLOCK_COLLAPSE_LINES = [10, 15, 25, 50];
const CODE_BLOCK_WIDTHS = ["column", "wide"];
const PANEL_MOTIONS = ["translate", "reflow"];
// The retired ids -- marked-stable, incremark, incremark-typewriter,
// incremark-synthetic, incremark-fast -- are deliberately absent. A stored value that is no
// longer a renderer normalizes to null, and the client falls back to its
// default rather than asking for something that no longer exists.
const MARKDOWN_RENDERERS = ["incremark", "marked"];
const USER_MESSAGE_COLLAPSE = ["off", "6", "10", "15", "25"];
const CHAT_SORTS = ["latest", "created"];
const stringList = (value, limit) => Array.isArray(value) && value.length <= limit
  && value.every((item) => typeof item === "string" && item.length <= 200);
const oneOf = (value, choices) => typeof value === "string" && choices.includes(value);
const validShortcutOverrides = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 100) return false;
  return Object.entries(value).every(([commandId, bindings]) => commandId.length <= 100
    && Array.isArray(bindings) && bindings.length <= 4
    && bindings.every((binding) => Array.isArray(binding?.strokes) && binding.strokes.length >= 1 && binding.strokes.length <= 2
      && binding.strokes.every((stroke) => typeof stroke?.code === "string" && stroke.code.length <= 40
        && typeof stroke.key === "string" && stroke.key.length <= 40
        && stringList(stroke.modifiers, 4))));
};
const validVoicePreferences = (value) => value && typeof value === "object" && !Array.isArray(value)
  && typeof value.shortcut === "string" && value.shortcut.length <= 100
  && oneOf(value.activation, ["push_to_talk", "toggle"])
  && typeof value.autoSend === "boolean"
  && oneOf(value.captureProfile, ["raw", "processed"]);
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

export function validUiPreferencePatch(input = {}) {
  return Object.entries(input).every(([key, value]) => {
    if (!UI_PREFERENCE_KEYS.has(key)) return true;
    if (value == null) return false;
    if (key === "sidebarChatLimit") return Number.isInteger(value) && value >= 5 && value <= 100;
    if (key === "collapsedProjectIds") return stringList(value, 200);
    if (["sidebarCollapsed", "rendererControlsVisible", "meteorField"].includes(key)) return typeof value === "boolean";
    if (key === "markdownRenderer") return oneOf(value, MARKDOWN_RENDERERS);
    if (key === "composerSurface") return oneOf(value, ["static", "frosted-live"]);
    if (key === "contextMetrics") return stringList(value, 40);
    if (key === "incremarkPacing") return oneOf(value, ["adaptive", "fixed", "buffered"]);
    if (key === "transcriptWidth") return oneOf(value, TRANSCRIPT_WIDTHS);
    if (key === "transcriptWideBlocks") return oneOf(value, TRANSCRIPT_WIDE_BLOCKS);
    if (key === "codeBlockCollapse") return oneOf(value, CODE_BLOCK_COLLAPSE_MODES);
    if (key === "codeBlockCollapseLines") return CODE_BLOCK_COLLAPSE_LINES.includes(value);
    if (key === "codeBlockWidth") return oneOf(value, CODE_BLOCK_WIDTHS);
    if (key === "panelMotion") return oneOf(value, PANEL_MOTIONS);
    if (key === "userMessageCollapse") return oneOf(value, USER_MESSAGE_COLLAPSE);
    if (key === "chatSort") return oneOf(value, CHAT_SORTS);
    if (key === "shortcutOverrides") return validShortcutOverrides(value);
    if (key === "voicePreferences") return validVoicePreferences(value);
    return false;
  });
}

export function normalizeTerminalShortcuts(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 12).flatMap((item) => {
    const id = typeof item?.id === "string" ? item.id.trim().slice(0, 80) : "";
    const label = typeof item?.label === "string" ? item.label.trim().slice(0, 32) : "";
    const command = typeof item?.command === "string" ? item.command.trim().slice(0, 2048) : "";
    const target = item?.target === "current" || item?.target === "new" ? item.target : null;
    return id && label && command && target ? [{ id, label, command, target }] : [];
  });
}

export function validTerminalShortcuts(input) {
  return Array.isArray(input)
    && input.length <= 12
    && input.every((item) => typeof item?.id === "string" && item.id.trim().length > 0 && item.id.length <= 80
      && typeof item.label === "string" && item.label.trim().length > 0 && item.label.length <= 32
      && typeof item.command === "string" && item.command.trim().length > 0 && item.command.length <= 2048
      && (item.target === "current" || item.target === "new"));
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
  const nullable = (key, normalize) => input[key] == null
    ? (fallback[key] == null ? null : normalize(fallback[key]))
    : normalize(input[key]);
  const boolean = (value) => typeof value === "boolean" ? value : null;
  const choice = (values) => (value) => values.includes(value) ? value : null;
  const stringArray = (limit = 100) => (value) => Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string" && item.length <= 200))].slice(0, limit)
    : null;
  const plainObject = (value) => value && typeof value === "object" && !Array.isArray(value)
    ? structuredClone(value)
    : null;
  return {
    defaultTemplateId,
    sessionNameModel,
    sessionNameThinkingLevel,
    profileModelDefaults: normalizeProfileModelDefaults(input.profileModelDefaults ?? fallback.profileModelDefaults),
    terminalShortcuts,
    sidebarPins,
    sidebarChatLimit: nullable("sidebarChatLimit", (value) => Number.isFinite(Number(value))
      ? Math.min(100, Math.max(5, Math.round(Number(value))))
      : null),
    collapsedProjectIds: nullable("collapsedProjectIds", stringArray(200)),
    sidebarCollapsed: nullable("sidebarCollapsed", boolean),
    markdownRenderer: nullable("markdownRenderer", choice(MARKDOWN_RENDERERS)),
    rendererControlsVisible: nullable("rendererControlsVisible", boolean),
    composerSurface: nullable("composerSurface", choice(["static", "frosted-live"])),
    contextMetrics: nullable("contextMetrics", stringArray(40)),
    meteorField: nullable("meteorField", boolean),
    incremarkPacing: nullable("incremarkPacing", choice(["adaptive", "fixed", "buffered"])),
    transcriptWidth: nullable("transcriptWidth", choice(TRANSCRIPT_WIDTHS)),
    transcriptWideBlocks: nullable("transcriptWideBlocks", choice(TRANSCRIPT_WIDE_BLOCKS)),
    codeBlockCollapse: nullable("codeBlockCollapse", choice(CODE_BLOCK_COLLAPSE_MODES)),
    codeBlockCollapseLines: nullable("codeBlockCollapseLines", (value) =>
      CODE_BLOCK_COLLAPSE_LINES.includes(value) ? value : null),
    codeBlockWidth: nullable("codeBlockWidth", choice(CODE_BLOCK_WIDTHS)),
    panelMotion: nullable("panelMotion", choice(PANEL_MOTIONS)),
    userMessageCollapse: nullable("userMessageCollapse", choice(USER_MESSAGE_COLLAPSE)),
    chatSort: nullable("chatSort", choice(CHAT_SORTS)),
    shortcutOverrides: nullable("shortcutOverrides", (value) => validShortcutOverrides(value) ? plainObject(value) : null),
    voicePreferences: nullable("voicePreferences", (value) => validVoicePreferences(value) ? plainObject(value) : null),
  };
}

export class PreferencesStore {
  constructor(filePath, seed = DEFAULTS, { knownTemplateIds = null } = {}) {
    this.filePath = filePath;
    this.knownTemplateIds = knownTemplateIds;
    this.preferences = normalizePreferences(seed, DEFAULTS, knownTemplateIds);
  }

  get() {
    return { ...this.preferences };
  }

  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      this.preferences = normalizePreferences(raw, this.preferences, this.knownTemplateIds);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return this.get();
  }

  async save(patch = {}) {
    this.preferences = normalizePreferences({ ...this.preferences, ...patch }, this.preferences, this.knownTemplateIds);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(this.preferences, null, 2)}\n`, "utf8");
    await fs.rename(temp, this.filePath);
    return this.get();
  }
}
