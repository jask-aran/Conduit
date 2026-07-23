import crypto from "node:crypto";

const ATTEMPT_TTL_MS = 10 * 60 * 1000;

function publicStatus(status = {}) {
  return {
    configured: status.configured === true,
    source: status.configured ? "stored" : status.source === "environment" ? "environment" : null,
  };
}

function literalApiKey(value) {
  // Pi deliberately supports `$VAR` and `!command` auth-file values. Values
  // entered through Conduit must always remain literal credentials.
  return value.replaceAll("$", () => "$$").replace(/^!/, "$!");
}

function attemptId() {
  return crypto.randomBytes(18).toString("base64url");
}

function toError(error) {
  return error instanceof Error ? error.message : String(error || "Authentication failed");
}

export class PiAuthBroker {
  constructor({ authStorage, modelRegistry, onCredentialsChanged = async () => {}, now = () => Date.now() }) {
    this.authStorage = authStorage;
    this.modelRegistry = modelRegistry;
    this.onCredentialsChanged = onCredentialsChanged;
    this.now = now;
    this.attempt = null;
  }

  providers() {
    this.authStorage.reload();
    this.modelRegistry.refresh();
    const oauth = new Map(this.authStorage.getOAuthProviders().map((provider) => [provider.id, provider]));
    const byId = new Map();
    for (const model of this.modelRegistry.getAll()) {
      if (!byId.has(model.provider)) byId.set(model.provider, this.modelRegistry.getProviderDisplayName(model.provider));
    }
    for (const [id, provider] of oauth) byId.set(id, provider.name);
    return [...byId].sort(([left], [right]) => left.localeCompare(right)).map(([id, label]) => {
      const provider = oauth.get(id);
      return {
        id,
        label: label || id,
        oauth: Boolean(provider),
        usesCallbackServer: provider?.usesCallbackServer === true,
        auth: publicStatus(this.modelRegistry.getProviderAuthStatus(id)),
      };
    });
  }

  activeFor(owner) {
    this.expire();
    if (!this.attempt) return null;
    if (this.attempt.owner !== owner) return { active: true, owned: false, providerId: this.attempt.providerId };
    const { controller: _controller, resolveInput: _resolveInput, rejectInput: _rejectInput, owner: _owner, ...view } = this.attempt;
    return { ...view, active: this.attempt.state === "running" || this.attempt.state === "waiting", owned: true };
  }

  expire() {
    if (!this.attempt || this.attempt.expiresAt > this.now()) return;
    this.cancel(this.attempt.owner, { expired: true });
  }

  start(owner, providerId) {
    this.expire();
    if (this.attempt?.state === "running" || this.attempt?.state === "waiting") {
      const error = new Error("Another Pi authentication attempt is already in progress");
      error.code = "authentication_in_progress";
      throw error;
    }
    const provider = this.authStorage.getOAuthProviders().find((item) => item.id === providerId);
    if (!provider) {
      const error = new Error("This provider does not support browser authentication");
      error.code = "oauth_provider_unknown";
      throw error;
    }
    const controller = new AbortController();
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
      controller,
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
      attempt.rejectInput = (error) => {
        attempt.resolveInput = null;
        attempt.rejectInput = null;
        reject(error);
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
      await this.authStorage.login(attempt.providerId, callbacks);
      if (this.attempt !== attempt) return;
      attempt.state = "completed";
      attempt.message = "Pi authentication completed.";
      attempt.authUrl = null;
      attempt.deviceCode = null;
      attempt.prompt = null;
      attempt.expiresAt = this.now() + 60_000;
      await this.onCredentialsChanged();
    } catch (error) {
      if (this.attempt !== attempt) return;
      attempt.state = attempt.controller.signal.aborted ? "cancelled" : "failed";
      attempt.error = attempt.controller.signal.aborted ? null : toError(error);
      attempt.message = attempt.error || "Authentication cancelled.";
      attempt.authUrl = null;
      attempt.deviceCode = null;
      attempt.prompt = null;
      attempt.expiresAt = this.now() + 60_000;
    }
  }

  respond(owner, value) {
    const attempt = this.attempt;
    if (!attempt || attempt.owner !== owner || !attempt.resolveInput) {
      const error = new Error("There is no authentication prompt for this browser session");
      error.code = "authentication_prompt_missing";
      throw error;
    }
    const input = String(value || "").trim();
    if (!input) {
      const error = new Error("A value is required to continue authentication");
      error.code = "authentication_input_required";
      throw error;
    }
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
    attempt.expiresAt = this.now() + 60_000;
    return true;
  }

  async setApiKey(providerId, key) {
    this.authStorage.reload();
    this.modelRegistry.refresh();
    const known = new Set(this.modelRegistry.getAll().map((model) => model.provider));
    if (!known.has(providerId)) {
      const error = new Error("Choose a provider known to the isolated Pi runtime");
      error.code = "api_key_provider_unknown";
      throw error;
    }
    const value = String(key || "");
    if (!value.trim()) {
      const error = new Error("API key cannot be empty");
      error.code = "api_key_required";
      throw error;
    }
    this.authStorage.set(providerId, { type: "api_key", key: literalApiKey(value) });
    await this.onCredentialsChanged();
  }

  async remove(providerId) {
    this.authStorage.reload();
    if (!this.authStorage.has(providerId)) return false;
    this.authStorage.logout(providerId);
    await this.onCredentialsChanged();
    return true;
  }
}
