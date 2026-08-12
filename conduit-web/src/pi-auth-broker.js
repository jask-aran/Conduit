import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const ATTEMPT_TTL_MS = 10 * 60 * 1000;
const COMPLETED_ATTEMPT_TTL_MS = 60 * 1000;

function error(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function literalApiKey(value) {
  // Pi deliberately supports `$VAR` and `!command` values in auth.json. Values
  // submitted through Conduit are credentials, never expressions.
  return value.replaceAll("$", () => "$$").replace(/^!/, "$!");
}

async function readAuthFile(file) {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeAuthFile(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.chmod(temporary, 0o600);
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function attemptId() {
  return crypto.randomBytes(18).toString("base64url");
}

function messageFor(errorValue) {
  return errorValue instanceof Error ? errorValue.message : String(errorValue || "Authentication failed");
}

export class PiAuthBroker {
  constructor({ authStorage, modelRegistry, modelRuntime = null, authFile = "", onCredentialsChanged = async () => {}, now = () => Date.now() }) {
    this.authStorage = authStorage;
    this.modelRegistry = modelRegistry;
    this.modelRuntime = modelRuntime;
    this.authFile = String(authFile || "").trim();
    this.onCredentialsChanged = onCredentialsChanged;
    this.now = now;
    this.attempt = null;
  }

  providers() {
    if (this.modelRuntime) {
      const providers = this.modelRuntime.getProviders()
        .filter((provider) => provider.getModels().length > 0 || provider.auth?.oauth)
        .map((provider) => {
          const oauth = provider.auth?.oauth || null;
          const status = this.modelRuntime.getProviderAuthStatus(provider.id);
          const source = status.source === "environment"
            ? "environment"
            : status.source === "stored"
              ? "stored"
              : status.source === "runtime"
                ? "runtime"
                : status.configured ? "managed" : null;
          return {
            id: provider.id,
            label: provider.name || provider.id,
            oauth: Boolean(oauth),
            usesCallbackServer: false,
            auth: {
              configured: status.configured === true,
              source,
              removable: source === "stored",
            },
          };
        });
      return providers.sort((left, right) => left.id.localeCompare(right.id));
    }
    this.authStorage.reload();
    this.modelRegistry.refresh();
    const oauth = new Map(this.authStorage.getOAuthProviders().map((provider) => [provider.id, provider]));
    const providers = new Map();
    for (const model of this.modelRegistry.getAll()) {
      if (!providers.has(model.provider)) providers.set(model.provider, this.modelRegistry.getProviderDisplayName(model.provider));
    }
    for (const [id, provider] of oauth) providers.set(id, provider.name);
    return [...providers].sort(([left], [right]) => left.localeCompare(right)).map(([id, label]) => {
      const stored = this.authStorage.has(id);
      const status = this.modelRegistry.getProviderAuthStatus(id);
      return {
        id,
        label: label || id,
        oauth: oauth.has(id),
        usesCallbackServer: oauth.get(id)?.usesCallbackServer === true,
        auth: {
          configured: stored || status.configured === true,
          source: stored ? "stored" : status.source === "environment" ? "environment" : status.configured ? "managed" : null,
          removable: stored,
        },
      };
    });
  }

  activeFor(owner) {
    this.expire();
    if (!this.attempt) return null;
    if (this.attempt.owner !== owner) return { active: true, owned: false, providerId: this.attempt.providerId };
    const {
      controller: _controller,
      resolveInput: _resolveInput,
      rejectInput: _rejectInput,
      owner: _owner,
      ...view
    } = this.attempt;
    return { ...view, active: ["running", "waiting"].includes(this.attempt.state), owned: true };
  }

  expire() {
    if (!this.attempt || this.attempt.expiresAt > this.now()) return;
    this.cancel(this.attempt.owner, { expired: true });
  }

  start(owner, providerId) {
    this.expire();
    if (this.attempt?.state === "running" || this.attempt?.state === "waiting") {
      throw error("authentication_in_progress", "Another Pi authentication attempt is already in progress", 409);
    }
    let provider;
    if (this.modelRuntime) {
      provider = this.modelRuntime.getProvider(providerId)?.auth?.oauth;
    } else {
      this.authStorage.reload();
      provider = this.authStorage.getOAuthProviders().find((item) => item.id === providerId);
    }
    if (!provider) throw error("oauth_provider_unknown", "This provider does not support browser authentication");
    const attempt = {
      id: attemptId(),
      owner,
      providerId,
      providerLabel: provider.name,
      state: "running",
      message: "Preparing browser authentication…",
      authUrl: null,
      instructions: null,
      deviceCode: null,
      prompt: null,
      createdAt: new Date(this.now()).toISOString(),
      expiresAt: this.now() + ATTEMPT_TTL_MS,
      controller: new AbortController(),
      resolveInput: null,
      rejectInput: null,
      error: null,
    };
    this.attempt = attempt;
    void this.run(attempt);
    return this.activeFor(owner);
  }

  waitForInput(attempt, prompt) {
    attempt.state = "waiting";
    attempt.prompt = prompt;
    return new Promise((resolve, reject) => {
      attempt.resolveInput = (value) => {
        attempt.resolveInput = null;
        attempt.rejectInput = null;
        attempt.prompt = null;
        attempt.state = "running";
        resolve(value);
      };
      attempt.rejectInput = (reason) => {
        attempt.resolveInput = null;
        attempt.rejectInput = null;
        reject(reason);
      };
    });
  }

  async run(attempt) {
    const callbacks = {
      onAuth: (info) => {
        attempt.authUrl = info.url;
        attempt.instructions = info.instructions || "Complete sign-in in your browser, then paste the final redirect URL here.";
        attempt.message = "Complete sign-in in your browser.";
      },
      onDeviceCode: (info) => {
        attempt.deviceCode = {
          userCode: info.userCode,
          verificationUri: info.verificationUri,
          expiresInSeconds: info.expiresInSeconds || null,
        };
        attempt.message = "Open the verification page and enter the displayed code.";
      },
      onPrompt: (prompt) => this.waitForInput(attempt, {
        type: "text",
        message: prompt.message,
        placeholder: prompt.placeholder || "",
      }),
      onManualCodeInput: () => this.waitForInput(attempt, {
        type: "manual_code",
        message: "Paste the complete redirect URL or authorization code after signing in.",
        placeholder: "http://localhost/…",
      }),
      onSelect: (prompt) => this.waitForInput(attempt, {
        type: "select",
        message: prompt.message,
        options: prompt.options.map((item) => ({ id: item.id, label: item.label })),
      }),
      onProgress: (message) => { attempt.message = message; },
      signal: attempt.controller.signal,
    };
    try {
      if (this.modelRuntime) {
        await this.modelRuntime.login(attempt.providerId, "oauth", {
          signal: attempt.controller.signal,
          prompt: (prompt) => this.waitForInput(attempt, {
            type: prompt.type,
            message: prompt.message,
            placeholder: prompt.placeholder || "",
            options: prompt.options?.map((option) => ({ id: option.id, label: option.label })),
          }),
          notify: (event) => {
            if (event.type === "auth_url") {
              attempt.authUrl = event.url;
              attempt.instructions = event.instructions || "Complete sign-in in your browser, then paste the final redirect URL here.";
              attempt.message = "Complete sign-in in your browser.";
            } else if (event.type === "device_code") {
              attempt.deviceCode = {
                userCode: event.userCode,
                verificationUri: event.verificationUri,
                expiresInSeconds: event.expiresInSeconds || null,
              };
              attempt.message = "Open the verification page and enter the displayed code.";
            } else if (event.type === "progress" || event.type === "info") {
              attempt.message = event.message;
            }
          },
        });
      } else {
        await this.authStorage.login(attempt.providerId, callbacks);
      }
      if (this.attempt !== attempt) return;
      attempt.state = "completed";
      attempt.message = "Pi authentication completed.";
      attempt.authUrl = null;
      attempt.deviceCode = null;
      attempt.prompt = null;
      attempt.expiresAt = this.now() + COMPLETED_ATTEMPT_TTL_MS;
      await this.onCredentialsChanged();
    } catch (failure) {
      if (this.attempt !== attempt) return;
      attempt.state = attempt.controller.signal.aborted ? "cancelled" : "failed";
      attempt.error = attempt.controller.signal.aborted ? null : messageFor(failure);
      attempt.message = attempt.error || "Authentication cancelled.";
      attempt.authUrl = null;
      attempt.deviceCode = null;
      attempt.prompt = null;
      attempt.expiresAt = this.now() + COMPLETED_ATTEMPT_TTL_MS;
    }
  }

  respond(owner, value) {
    const attempt = this.attempt;
    if (!attempt || attempt.owner !== owner || !attempt.resolveInput) {
      throw error("authentication_prompt_missing", "There is no authentication prompt for this browser session", 409);
    }
    const input = String(value || "").trim();
    if (!input) throw error("authentication_input_required", "A value is required to continue authentication");
    attempt.resolveInput(input);
    return this.activeFor(owner);
  }

  cancel(owner, { expired = false } = {}) {
    const attempt = this.attempt;
    if (!attempt || attempt.owner !== owner) return false;
    attempt.controller.abort();
    attempt.rejectInput?.(new Error(expired ? "Authentication expired" : "Login cancelled"));
    attempt.state = expired ? "expired" : "cancelled";
    attempt.message = expired ? "Authentication expired. Start again to continue." : "Authentication cancelled.";
    attempt.authUrl = null;
    attempt.deviceCode = null;
    attempt.prompt = null;
    attempt.expiresAt = this.now() + COMPLETED_ATTEMPT_TTL_MS;
    return true;
  }

  async setApiKey(providerId, key) {
    if (this.modelRuntime) {
      const provider = this.modelRuntime.getProvider(providerId);
      if (!provider || !this.authFile) throw error("api_key_provider_unknown", "Choose a provider known to the isolated Pi runtime");
      const value = String(key || "");
      if (!value.trim()) throw error("api_key_required", "API key cannot be empty");
      const auth = await readAuthFile(this.authFile);
      auth[providerId] = { type: "api_key", key: literalApiKey(value) };
      await writeAuthFile(this.authFile, auth);
      await this.modelRuntime.refresh({ allowNetwork: false });
      await this.onCredentialsChanged();
      return;
    }
    this.authStorage.reload();
    this.modelRegistry.refresh();
    const known = new Set(this.modelRegistry.getAll().map((model) => model.provider));
    if (!known.has(providerId)) throw error("api_key_provider_unknown", "Choose a provider known to the isolated Pi runtime");
    const value = String(key || "");
    if (!value.trim()) throw error("api_key_required", "API key cannot be empty");
    this.authStorage.set(providerId, { type: "api_key", key: literalApiKey(value) });
    await this.onCredentialsChanged();
  }

  async remove(providerId) {
    if (this.modelRuntime) {
      if (!this.authFile) return false;
      const auth = await readAuthFile(this.authFile);
      if (!Object.hasOwn(auth, providerId)) return false;
      delete auth[providerId];
      await writeAuthFile(this.authFile, auth);
      await this.modelRuntime.refresh({ allowNetwork: false });
      await this.onCredentialsChanged();
      return true;
    }
    this.authStorage.reload();
    if (!this.authStorage.has(providerId)) return false;
    this.authStorage.logout(providerId);
    await this.onCredentialsChanged();
    return true;
  }
}
