import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  maxLiveProcesses: 4,
  idleProcessTtlMs: 120_000,
};

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

export function normalizeRuntimeSettings(input = {}, fallback = DEFAULTS) {
  return {
    maxLiveProcesses: clampInt(input.maxLiveProcesses, 1, 16, fallback.maxLiveProcesses),
    idleProcessTtlMs: clampInt(input.idleProcessTtlMs, 30_000, 3_600_000, fallback.idleProcessTtlMs),
  };
}

export function defaultsFromEnv(env = process.env) {
  return normalizeRuntimeSettings({
    maxLiveProcesses: env.CONDUIT_MAX_LIVE_PROCESSES,
    idleProcessTtlMs: env.CONDUIT_IDLE_PROCESS_TTL_MS,
  }, DEFAULTS);
}

export class RuntimeSettingsStore {
  constructor(filePath, seed = DEFAULTS) {
    this.filePath = filePath;
    this.settings = normalizeRuntimeSettings(seed, DEFAULTS);
  }

  get() {
    return { ...this.settings };
  }

  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      this.settings = normalizeRuntimeSettings(raw, this.settings);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return this.get();
  }

  async save(patch = {}) {
    this.settings = normalizeRuntimeSettings({ ...this.settings, ...patch }, this.settings);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(this.settings, null, 2)}\n`, "utf8");
    await fs.rename(temp, this.filePath);
    return this.get();
  }
}
