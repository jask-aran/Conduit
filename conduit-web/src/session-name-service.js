import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export class SessionNameService {
  constructor({ file, modelCatalog, preferences, now = () => Date.now() }) {
    this.file = path.resolve(file);
    this.modelCatalog = modelCatalog;
    this.preferences = preferences;
    this.now = now;
    this.writeQueue = Promise.resolve();
  }

  append(entry) {
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.appendFile(this.file, `${JSON.stringify(entry)}\n`, "utf8");
    });
    return this.writeQueue;
  }

  recordFallback({ chatId, name }) {
    return this.append({
      requestId: crypto.randomUUID(),
      chatId,
      source: "generation_checkpoint",
      model: null,
      event: "fallback_applied",
      timestamp: new Date(this.now()).toISOString(),
      outcome: "applied",
      name,
    });
  }

  async run({ chatId, cwd, source, message, apply }) {
    const preference = this.preferences.get();
    const requestId = crypto.randomUUID();
    const startedAt = this.now();
    const base = { requestId, chatId, source, model: preference.sessionNameModel || null };
    await this.append({ ...base, event: "requested", timestamp: new Date(startedAt).toISOString() });
    try {
      if (!preference.sessionNameModel) {
        throw Object.assign(new Error("Select a session naming model in General settings."), { code: "session_name_model_required" });
      }
      const name = await this.modelCatalog.generateSessionName(
        cwd,
        preference.sessionNameModel,
        preference.sessionNameThinkingLevel,
        message,
      );
      if (!name) throw Object.assign(new Error("The naming model returned an empty title"), { code: "session_name_empty" });
      const outcome = await apply(name);
      const completedAt = this.now();
      await this.append({
        ...base,
        event: "completed",
        timestamp: new Date(completedAt).toISOString(),
        durationMs: completedAt - startedAt,
        outcome: outcome || "applied",
        name,
      });
      return name;
    } catch (error) {
      const completedAt = this.now();
      await this.append({
        ...base,
        event: "completed",
        timestamp: new Date(completedAt).toISOString(),
        durationMs: completedAt - startedAt,
        outcome: "failed",
        error: String(error?.message || error).slice(0, 1000),
      });
      throw error;
    }
  }
}
