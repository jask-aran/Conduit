import assert from "node:assert/strict";
import test from "node:test";
import { PiAuthBroker } from "../src/pi-auth-broker.js";

function fixture({ login } = {}) {
  const stored = new Map();
  const oauth = { id: "openai-codex", name: "ChatGPT", usesCallbackServer: true };
  const authStorage = {
    reload() {},
    getOAuthProviders() { return [oauth]; },
    async login(providerId, callbacks) { return login?.(providerId, callbacks); },
    set(providerId, credential) { stored.set(providerId, credential); },
    logout(providerId) { stored.delete(providerId); },
    has(providerId) { return stored.has(providerId); },
  };
  const modelRegistry = {
    refresh() {},
    getAll() { return [{ provider: "openai-codex" }, { provider: "openai" }]; },
    getProviderDisplayName(provider) { return provider === "openai" ? "OpenAI" : "ChatGPT"; },
    getProviderAuthStatus(provider) { return stored.has(provider) ? { configured: true, source: "stored" } : { configured: false }; },
  };
  return { stored, authStorage, modelRegistry };
}

test("Pi auth status is redacted and GUI API keys are stored as literal values", async () => {
  const { stored, authStorage, modelRegistry } = fixture();
  const broker = new PiAuthBroker({ authStorage, modelRegistry });
  assert.deepEqual(broker.providers().map((item) => item.id), ["openai", "openai-codex"]);
  await broker.setApiKey("openai", "!literal-$key");
  assert.deepEqual(stored.get("openai"), { type: "api_key", key: "$!literal-$$key" });
  assert.equal(JSON.stringify(broker.providers()).includes("literal"), false);
  assert.equal(broker.providers().find((item) => item.id === "openai").auth.removable, true);
});

test("only the browser that started an OAuth attempt can read its URL or answer its prompt", async () => {
  const { authStorage, modelRegistry } = fixture({
    login: async (_provider, callbacks) => {
      callbacks.onAuth({ url: "https://auth.example.test/secret-state", instructions: "Sign in" });
      const code = await callbacks.onManualCodeInput();
      assert.equal(code, "http://localhost/callback?code=accepted");
    },
  });
  const broker = new PiAuthBroker({ authStorage, modelRegistry });
  broker.start("owner-a", "openai-codex");
  await new Promise((resolve) => setImmediate(resolve));
  const owner = broker.activeFor("owner-a");
  assert.equal(owner.authUrl, "https://auth.example.test/secret-state");
  assert.deepEqual(broker.activeFor("owner-b"), { active: true, owned: false, providerId: "openai-codex" });
  assert.throws(() => broker.respond("owner-b", "nope"), /no authentication prompt/i);
  broker.respond("owner-a", "http://localhost/callback?code=accepted");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(broker.activeFor("owner-a").state, "completed");
});

test("cancelling or expiring an attempt aborts login without retaining its URL", async () => {
  let now = 0;
  const { authStorage, modelRegistry } = fixture({
    login: async (_provider, callbacks) => {
      callbacks.onAuth({ url: "https://auth.example.test/one-time", instructions: "Sign in" });
      await callbacks.onManualCodeInput();
    },
  });
  const broker = new PiAuthBroker({ authStorage, modelRegistry, now: () => now });
  broker.start("owner-a", "openai-codex");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(broker.cancel("owner-a"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(broker.activeFor("owner-a").authUrl, null);

  broker.start("owner-a", "openai-codex");
  await new Promise((resolve) => setImmediate(resolve));
  now = 10 * 60 * 1000 + 1;
  const expired = broker.activeFor("owner-a");
  assert.equal(expired.state, "expired");
  assert.equal(expired.authUrl, null);
});
