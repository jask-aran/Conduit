import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  defaultTemplateId: "chat",
  sessionNameModel: "",
  sessionNameThinkingLevel: "off",
  terminalShortcuts: [],
  sidebarPins: [],
  sidebarChatLimit: null,
  collapsedProjectIds: null,
  sidebarCollapsed: null,
  markdownRenderer: null,
  transcriptRenderer: null,
  rendererControlsVisible: null,
  composerSurface: null,
  contextMetrics: null,
  meteorField: null,
  incremarkPacing: null,
  shortcutOverrides: null,
  voicePreferences: null,
};

const SIDEBAR_PIN_PATTERN = /^(chat|project|terminal):[^\s:][^\s]*$/;

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
  "transcriptRenderer", "rendererControlsVisible", "composerSurface", "contextMetrics",
  "meteorField", "incremarkPacing", "shortcutOverrides", "voicePreferences",
]);
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

export function validUiPreferencePatch(input = {}) {
  return Object.entries(input).every(([key, value]) => {
    if (!UI_PREFERENCE_KEYS.has(key)) return true;
    if (value == null) return false;
    if (key === "sidebarChatLimit") return Number.isInteger(value) && value >= 5 && value <= 100;
    if (key === "collapsedProjectIds") return stringList(value, 200);
    if (["sidebarCollapsed", "rendererControlsVisible", "meteorField"].includes(key)) return typeof value === "boolean";
    if (key === "markdownRenderer") return oneOf(value, ["marked-stable", "marked", "incremark", "incremark-typewriter", "incremark-synthetic"]);
    if (key === "transcriptRenderer") return oneOf(value, ["marked-stable", "marked", "incremark", "incremark-typewriter", "incremark-synthetic", "incremark-advanced"]);
    if (key === "composerSurface") return oneOf(value, ["static", "frosted-live"]);
    if (key === "contextMetrics") return stringList(value, 40);
    if (key === "incremarkPacing") return oneOf(value, ["adaptive", "fixed", "buffered"]);
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
    terminalShortcuts,
    sidebarPins,
    sidebarChatLimit: nullable("sidebarChatLimit", (value) => Number.isFinite(Number(value))
      ? Math.min(100, Math.max(5, Math.round(Number(value))))
      : null),
    collapsedProjectIds: nullable("collapsedProjectIds", stringArray(200)),
    sidebarCollapsed: nullable("sidebarCollapsed", boolean),
    markdownRenderer: nullable("markdownRenderer", choice(["marked-stable", "marked", "incremark", "incremark-typewriter", "incremark-synthetic"])),
    transcriptRenderer: nullable("transcriptRenderer", choice(["marked-stable", "marked", "incremark", "incremark-typewriter", "incremark-synthetic", "incremark-advanced"])),
    rendererControlsVisible: nullable("rendererControlsVisible", boolean),
    composerSurface: nullable("composerSurface", choice(["static", "frosted-live"])),
    contextMetrics: nullable("contextMetrics", stringArray(40)),
    meteorField: nullable("meteorField", boolean),
    incremarkPacing: nullable("incremarkPacing", choice(["adaptive", "fixed", "buffered"])),
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
