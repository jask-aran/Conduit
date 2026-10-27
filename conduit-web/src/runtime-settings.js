import fs from "node:fs/promises";
import path from "node:path";

const DEFAULTS = {
  maxLiveProcesses: 12,
  maxGeneratingProcesses: 2,
};

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

export function normalizeRuntimeSettings(input = {}, fallback = DEFAULTS) {
  return {
    maxLiveProcesses: clampInt(input.maxLiveProcesses, 1, 32, fallback.maxLiveProcesses),
    maxGeneratingProcesses: clampInt(input.maxGeneratingProcesses, 1, 8, fallback.maxGeneratingProcesses),
  };
}

export function defaultsFromEnv(env = process.env) {
  return normalizeRuntimeSettings({
    maxLiveProcesses: env.CONDUIT_MAX_LIVE_PROCESSES,
    maxGeneratingProcesses: env.CONDUIT_MAX_GENERATING_PROCESSES,
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
    // One write at a time, each of the state as it then is (two at once shared the temporary file).
    const write = (this.writing || Promise.resolve()).then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${process.pid}.tmp`;
      await fs.writeFile(temp, `${JSON.stringify(this.settings, null, 2)}\n`, "utf8");
      await fs.rename(temp, this.filePath);
    });
    this.writing = write.catch(() => {});
    await write;
    return this.get();
  }
}
