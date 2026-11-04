import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { setupEmail, removeEmail, patchEmail, publicHubUrl, TOKEN_PERMISSIONS, tokenUrl } from "../src/agent/email-setup.js";

const token = "request-only-cloudflare-token";
const address = "bot@example.com";
const person = ["person@example.net"];
const reply = (result, status = 200) => new Response(JSON.stringify({ success: status < 400, result,
  ...(status >= 400 ? { errors: [{ message: `Missing permission: ${token}` }] } : {}) }), { status });

async function fixture(t, { existing = false, denied = false } = {}) {
  const dir = await fs.mkdtemp(path.resolve("test/.email-setup-"));
  const channel = {
    file: path.join(dir, "email.json"), config: null, timer: null,
    get ready() { return Boolean(this.config); },
    get status() {
      const { secret, ...settings } = this.config || {};
      return { configured: this.ready, ...settings };
    },
    async reload() { this.config = await fs.readFile(this.file, "utf8").then(JSON.parse).catch(() => null); },
  };
  t.after(async () => { await fs.unlink(channel.file).catch(() => {}); await fs.rmdir(dir); });
  const calls = [];
  let deployedSecret, deployedScript;
  const fetch = async (input, init = {}) => {
    const url = new URL(input);
    const route = url.pathname.replace("/client/v4", "");
    calls.push({ route, method: init.method || "GET" });
    if (url.hostname.endsWith(".workers.dev")) {
      assert.equal(init.headers.authorization, `Bearer ${deployedSecret}`);
      return reply({ messages: [] });
    }
    assert.equal(url.origin, "https://api.cloudflare.com");
    assert.equal(init.headers.authorization, `Bearer ${token}`);
    if (route === "/user/tokens/verify") return reply({ status: "active" });
    if (route === "/zones") return reply([{ id: "zone", name: "example.com", account: { id: "account" } }]);
    if (route.endsWith("/email/routing")) return reply({ enabled: true });
    if (route.endsWith("/r2/buckets")) return denied ? reply(null, 403) : reply({ name: JSON.parse(init.body).name });
    if (init.body instanceof FormData) {
      const metadata = JSON.parse(await init.body.get("metadata").text());
      deployedSecret = metadata.bindings.find((item) => item.name === "HUB_SECRET").text;
      deployedScript = route.split("/").at(-1);
      assert.match(deployedSecret, /^[a-f0-9]{64}$/);
      assert.equal(metadata.main_module, "worker.js");
      assert.deepEqual(metadata.bindings.find((item) => item.name === "SEND"), { name: "SEND", type: "send_email" });
      assert.equal(metadata.bindings.find((item) => item.name === "HUB_URL")?.text, "https://hub.example.com");
      assert.match(await init.body.get("worker.js").text(), /cloudflare:email/);
      return reply({});
    }
    if (route.endsWith("/workers/subdomain")) return reply({ subdomain: "mailbox" });
    if (route.endsWith("/subdomain")) return reply({ enabled: true });
    if (route.endsWith("/rules") && !init.body) return reply(existing ? [{ id: "rule", matchers: [{ type: "literal", field: "to", value: address }],
      actions: [{ type: "worker", value: [deployedScript] }] }] : []);
    if (route.includes("/rules") && init.body) {
      assert.deepEqual(JSON.parse(init.body).actions, [{ type: "worker", value: [deployedScript] }]);
      return reply({ id: "rule" });
    }
    if (route.endsWith("/email/routing/addresses")) return reply(init.body ? {} : [{ email: person[0], verified: null }]);
    if (init.method === "DELETE") return reply({});
    assert.fail(`Unexpected fake request: ${init.method} ${route}`);
  };
  const setup = () => setupEmail({ channel, token, address, person, hubUrl: "https://hub.example.com", hubId: "stable-hub", fetch });
  return { channel, calls, setup, fetch };
}

function noToken(result) { assert.equal(JSON.stringify(result).includes(token), false); }

test("setup deploys, checks and saves the mailbox without the API token", async (t) => {
  const { channel, calls, setup } = await fixture(t);
  const result = await setup();
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.deepEqual(result.steps.map((step) => step.id), ["token", "zone", "routing", "bucket", "worker", "url", "rule", "senders", "check", "save"]);
  assert.equal(result.email.configured, true);
  assert.equal(result.email.address, address);
  assert.match(result.steps.find((step) => step.id === "senders").detail, /Cloudflare emailed person@example.net a link/);
  assert.ok(calls.some((call) => call.route.endsWith("/rules") && call.method === "POST"));
  const saved = await fs.readFile(channel.file, "utf8");
  assert.equal(saved.includes(token), false);
  assert.equal((await fs.stat(channel.file)).mode & 0o777, 0o600);
  assert.equal(Object.hasOwn(result.email, "secret"), false);
  assert.equal(channel.config.secret, JSON.parse(saved).secret);
  assert.equal(result.email.tokenUrl, tokenUrl());
  assert.equal(result.email.permissions.length, TOKEN_PERMISSIONS.length);
  noToken(result);
});

test("setup updates an existing rule and reuses the secret and allow list", async (t) => {
  const { channel, calls, setup, fetch } = await fixture(t, { existing: true });
  assert.equal((await setup()).status, 200);
  const secret = channel.config.secret;
  await patchEmail(channel, { allow: ["@example.org"], send: false });
  const result = await setup();
  assert.equal(result.status, 200);
  assert.equal(channel.config.secret, secret);
  assert.deepEqual(result.email.allow, ["@example.org"]);
  assert.ok(calls.some((call) => call.route.endsWith("/rules/rule") && call.method === "PUT"));
  noToken(result);
  const removed = await removeEmail({ channel, token, fetch });
  assert.equal(removed.status, 200);
  assert.equal(removed.email.configured, false);
  assert.equal(channel.timer, null);
  assert.match(removed.steps.find((step) => step.id === "worker").detail, /retained: it may hold mail/);
  assert.equal(calls.some((call) => call.route.includes("/r2/") && call.method === "DELETE"), false);
  noToken(removed);
});

test("missing permission returns a plain 400 step with no token or config file", async (t) => {
  const { channel, setup } = await fixture(t, { denied: true });
  const result = await setup();
  assert.equal(result.status, 400);
  assert.equal(result.steps.at(-1).id, "bucket");
  assert.equal(result.steps.at(-1).ok, false);
  assert.equal(result.steps.at(-1).detail, "The token is missing Workers R2 Storage Edit (account). Give it this permission and try again.");
  await assert.rejects(fs.readFile(channel.file), { code: "ENOENT" });
  noToken(result);
});

test("wake URLs omit local, private and tailnet addresses", () => {
  for (const url of ["http://hub.example.com", "https://localhost", "https://127.1", "https://10.0.0.1", "https://172.16.0.1",
    "https://192.168.0.1", "https://100.64.0.1", "https://hub.tailnet.ts.net", "https://[::1]", "https://user:pass@hub.example.com"]) {
    assert.equal(publicHubUrl(url), null, url);
  }
  assert.equal(publicHubUrl("https://hub.example.com/"), "https://hub.example.com");
});
