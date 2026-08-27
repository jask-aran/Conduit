import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  defaultTemplateId: "chat",
  sessionNameModel: "",
  sessionNameThinkingLevel: "off",
  terminalShortcuts: [],
};

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
  return { defaultTemplateId, sessionNameModel, sessionNameThinkingLevel, terminalShortcuts };
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
