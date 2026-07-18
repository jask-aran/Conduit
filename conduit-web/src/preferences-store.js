import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  defaultTemplateId: "chat",
};

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
  return { defaultTemplateId };
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
