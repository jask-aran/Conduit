import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";

export const TOKEN_PERMISSIONS = [
  { key: "workers_scripts", type: "edit", label: "Workers Scripts Edit", scope: "account" },
  { key: "workers_r2", type: "edit", label: "Workers R2 Storage Edit", scope: "account" },
  { key: "email_routing_addresses", type: "edit", label: "Email Routing Addresses Edit", scope: "account" },
  { key: "email_routing_rules", type: "edit", label: "Email Routing Rules Edit", scope: "zone" },
  { key: "zone", type: "read", label: "Zone Read", scope: "zone" },
];
export const tokenUrl = () => `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(JSON.stringify(TOKEN_PERMISSIONS.map(({ key, type }) => ({ key, type }))))}&name=Conduit%20jbot%20mail`;
export const emailView = (channel) => ({ ...channel.status, tokenUrl: tokenUrl(), permissions: TOKEN_PERMISSIONS.map(({ label }) => label) });

const API = "https://api.cloudflare.com/client/v4";
const TEMPLATE = new URL("../../../templates/agent/mailbox/worker.js", import.meta.url);
const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const addressPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i;
function addressOf(value) {
  if (typeof value !== "string") throw invalid("Enter a valid email address.");
  const address = value.trim().toLowerCase();
  const [local, domain, extra] = address.split("@");
  if (extra !== undefined || !local || local.length > 64 || address.length > 254 || !addressPattern.test(local)
    || local.startsWith(".") || local.endsWith(".") || local.includes("..") || !domainPattern.test(domain || "")) {
    throw invalid("Enter a valid email address.");
  }
  return address;
}
function addresses(values, allowDomain = false) {
  if (!Array.isArray(values)) throw invalid("Use a list of email addresses.");
  return [...new Set(values.map((value) => {
    if (allowDomain && typeof value === "string" && value.trim().startsWith("@")) {
      const domain = value.trim().slice(1).toLowerCase();
      if (!domainPattern.test(domain)) throw invalid("Allow entries must be email addresses or @domain.");
      return `@${domain}`;
    }
    return addressOf(value);
  }))];
}

/** Only a public HTTPS origin can wake the hub. Private hubs still collect by polling. */
export function publicHubUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const ip = host.replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || (url.pathname !== "/" && url.pathname !== "") || host === "localhost" || host.endsWith(".localhost")
      || host.endsWith(".ts.net") || host.endsWith(".local") || (!net.isIP(ip) && !host.includes("."))) return null;
    if (net.isIP(ip) === 6 && !/^[23][0-9a-f]{3}:/i.test(ip)) return null;
    if (net.isIP(ip) === 4) {
      const [a, b] = ip.split(".").map(Number);
      if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return null;
    }
    return url.origin;
  } catch { return null; }
}

// Replace the file atomically with mode 0600, including older files with broader permissions.
async function saveConfig(channel, config) {
  await fs.mkdir(path.dirname(channel.file), { recursive: true });
  const temporary = `${channel.file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, channel.file);
  } finally { await fs.unlink(temporary).catch(() => {}); }
  await channel.reload();
}

export async function patchEmail(channel, patch) {
  if (!channel.ready) throw invalid("Set up email first.");
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw invalid("Use an email settings object.");
  const config = { ...channel.config };
  if (Object.hasOwn(patch, "person")) config.person = addresses(patch.person);
  if (Object.hasOwn(patch, "allow")) config.allow = addresses(patch.allow, true);
  if (Object.hasOwn(patch, "send")) {
    if (typeof patch.send !== "boolean") throw invalid("send must be true or false.");
    config.send = patch.send;
  }
  await saveConfig(channel, config);
  return emailView(channel);
}

/** One request owns this client and its token. No error includes a request or headers. */
function cloudflare(token, fetch) {
  const redact = (value) => String(value).split(token || "\0").join("[redacted]")
    .split(encodeURIComponent(token || "\0")).join("[redacted]");
  async function request(route, permission, { method = "GET", body, exists = false, missing = false } = {}) {
    let response, data;
    try {
      response = await fetch(`${API}${route}`, { method, redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { authorization: `Bearer ${token}`, ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) });
      data = await response.json();
    } catch { throw new Error("Cloudflare did not answer. Check the connection and try again."); }
    if (!response.ok || data.success === false) {
      const message = redact((data.errors || []).map((error) => error.message).filter(Boolean).join("; "));
      if (route.includes("/r2/") && /not enabled|enable.*r2|r2.*enable|not.*subscribed/i.test(message)) {
        throw new Error("Turn on R2 in the Cloudflare dashboard (free tier), then try again.");
      }
      if ([401, 403].includes(response.status) || /permission|unauthori[sz]ed|authentication/i.test(message)) {
        throw new Error(permission ? `The token is missing ${permission}. Give it this permission and try again.`
          : "The token is invalid or inactive. Create an active API token and try again.");
      }
      if (exists && /already (?:exists|owned)|already.*exist/i.test(message)) return null;
      if (missing && response.status === 404) return null;
      throw new Error(`${message || `Cloudflare answered HTTP ${response.status}`}. Check this step in Cloudflare and try again.`);
    }
    return data;
  }
  async function list(route, permission) {
    const items = [];
    let page = 1, pages = 1;
    do {
      const data = await request(`${route}${route.includes("?") ? "&" : "?"}page=${page}`, permission);
      items.push(...(data.result || []));
      pages = data.result_info?.total_pages || 1;
      page++;
    } while (page <= pages);
    return items;
  }
  return { request, list, redact };
}

function matchingRule(rule, address) {
  return rule.matchers?.length === 1 && rule.matchers[0].type === "literal" && rule.matchers[0].field === "to"
    && rule.matchers[0].value?.toLowerCase() === address;
}
const ruleId = (rule) => encodeURIComponent(rule.id || rule.tag);

/** Errors stop at the failed step; the token never leaves this request's closure. */
async function runSteps(channel, token, fetch, run) {
  const steps = [];
  const client = cloudflare(typeof token === "string" ? token.trim() : "", fetch);
  const step = async (id, label, action) => {
    try {
      const detail = await action();
      steps.push({ id, label, ok: true, ...(detail ? { detail: client.redact(detail) } : {}) });
    } catch (error) {
      steps.push({ id, label, ok: false, detail: client.redact(error.message || "This step failed. Try again.") });
      throw new Error("Email setup stopped at the failed step.");
    }
  };
  try {
    await step("token", "Check API token", async () => {
      if (typeof token !== "string" || !token.trim()) throw invalid("Paste an active Cloudflare API token.");
      const data = await client.request("/user/tokens/verify");
      if (data.result?.status !== "active") throw invalid("The token is inactive. Create an active API token and try again.");
    });
    await run(client, step);
  } catch { return { status: 400, steps, email: emailView(channel) }; }
  return { status: 200, steps, email: emailView(channel) };
}

export async function setupEmail({ channel, token, address, person, hubUrl, hubId, fetch = globalThis.fetch, wait = 3000 }) {
  return runSteps(channel, token, fetch, async ({ request, list }, step) => {
    let accountId, zoneId, domain, script, bucket, secret, worker, people;
    await step("zone", "Find email domain", async () => {
      address = addressOf(address);
      people = addresses(person);
      if (!hubId) throw invalid("The hub installation ID is missing. Restart the hub and try again.");
      domain = address.split("@")[1];
      const zones = await list(`/zones?name=${encodeURIComponent(domain)}`, "Zone Read (zone)");
      const zone = zones.find((zone) => zone.name === domain);
      if (!zone) throw invalid(`This token can't see ${domain}: give it the zone, or check the address.`);
      zoneId = zone.id;
      accountId = zone.account.id;
      script = `jbot-mail-${crypto.createHash("sha256").update(address + hubId).digest("hex").slice(0, 8)}`;
      bucket = script;
      secret = channel.config?.address?.toLowerCase() === address && channel.config?.secret ? channel.config.secret : crypto.randomBytes(32).toString("hex");
    });
    const account = `/accounts/${encodeURIComponent(accountId)}`;
    const routing = `/zones/${encodeURIComponent(zoneId)}/email/routing`;
    const scripts = `${account}/workers/scripts/${script}`;
    await step("routing", "Check Email Routing", async () => {
      const data = await request(routing, "Email Routing Rules Edit (zone)");
      if (!data.result?.enabled) throw invalid(`Turn on Email Routing for ${domain} in Cloudflare first (Email > Email Routing); it adds the MX records.`);
    });
    await step("bucket", "Create mail storage", async () => {
      await request(`${account}/r2/buckets`, "Workers R2 Storage Edit (account)", { method: "POST", body: { name: bucket }, exists: true });
    });
    await step("worker", "Deploy mailbox Worker", async () => {
      const bindings = [{ type: "r2_bucket", name: "MAIL", bucket_name: bucket }, { type: "send_email", name: "SEND" },
        { type: "secret_text", name: "HUB_SECRET", text: secret }];
      const publicUrl = publicHubUrl(hubUrl);
      if (publicUrl) bindings.push({ type: "plain_text", name: "HUB_URL", text: publicUrl });
      const body = new FormData();
      body.set("metadata", new Blob([JSON.stringify({ main_module: "worker.js", compatibility_date: "2026-10-01", bindings })], { type: "application/json" }));
      body.set("worker.js", new Blob([await fs.readFile(TEMPLATE, "utf8")], { type: "application/javascript+module" }), "worker.js");
      await request(scripts, "Workers Scripts Edit (account)", { method: "PUT", body });
    });
    await step("url", "Enable mailbox URL", async () => {
      await request(`${scripts}/subdomain`, "Workers Scripts Edit (account)", { method: "POST", body: { enabled: true, previews_enabled: false } });
      const data = await request(`${account}/workers/subdomain`, "Workers Scripts Edit (account)");
      const subdomain = data.result?.subdomain;
      if (typeof subdomain !== "string" || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(subdomain)) {
        throw invalid("Set up a workers.dev subdomain in Cloudflare Workers, then try again.");
      }
      worker = `https://${script}.${subdomain}.workers.dev`;
    });
    await step("rule", "Route email to this hub", async () => {
      const rules = await list(`${routing}/rules`, "Email Routing Rules Edit (zone)");
      const rule = rules.find((rule) => matchingRule(rule, address));
      await request(`${routing}/rules${rule ? `/${ruleId(rule)}` : ""}`, "Email Routing Rules Edit (zone)", {
        method: rule ? "PUT" : "POST", body: { name: `Conduit: ${address}`, enabled: true,
          matchers: [{ type: "literal", field: "to", value: address }], actions: [{ type: "worker", value: [script] }] },
      });
    });
    await step("senders", "Verify reply addresses", async () => {
      const route = `${account}/email/routing/addresses`;
      for (const email of people) await request(route, "Email Routing Addresses Edit (account)", { method: "POST", body: { email }, exists: true });
      const registered = await list(route, "Email Routing Addresses Edit (account)");
      return people.map((email) => {
        const verified = registered.find((item) => item.email?.toLowerCase() === email)?.verified;
        return verified ? `${email}: verified (${verified})` : `Cloudflare emailed ${email} a link; replies to it go out once it's clicked`;
      }).join(". ");
    });
    await step("check", "Check mailbox", async () => {
      // A Worker just deployed takes a few seconds to answer on its workers.dev address.
      let status = 0;
      for (let attempt = 0; attempt < 8 && status !== 200; attempt++) {
        if (attempt) await new Promise((resolve) => setTimeout(resolve, wait));
        try { status = (await fetch(`${worker}/mail`, { headers: { authorization: `Bearer ${secret}` }, redirect: "error", signal: AbortSignal.timeout(15_000) })).status; }
        catch { status = 0; }
      }
      if (status !== 200) throw invalid(status ? `The mailbox answered HTTP ${status}. Wait a minute for the Worker to deploy, then set up again.` : "The mailbox did not answer. Wait a minute for the Worker to deploy, then set up again.");
    });
    await step("save", "Save email settings", async () => {
      const config = { address, worker, secret, person: people, allow: channel.config?.allow || [], send: true,
        setup: { accountId, zoneId, domain, script, bucket } };
      if (JSON.stringify(config).includes(token.trim())) throw invalid("The token must not appear in email settings. Check the addresses and hub URL.");
      await saveConfig(channel, config);
    });
  });
}

export async function removeEmail({ channel, token, fetch = globalThis.fetch }) {
  return runSteps(channel, token, fetch, async ({ request, list }, step) => {
    const config = channel.config;
    const setup = config?.setup;
    await step("rule", "Remove email route", async () => {
      if (!config) return "Email is already removed.";
      if (!setup) throw invalid("This mailbox has no setup record. Remove its route and Worker in Cloudflare before removing the local settings.");
      const route = `/zones/${encodeURIComponent(setup.zoneId)}/email/routing/rules`;
      const rules = await list(route, "Email Routing Rules Edit (zone)");
      const owned = rules.filter((rule) => matchingRule(rule, config.address)
        && rule.actions?.length === 1 && rule.actions[0].type === "worker" && rule.actions[0].value?.length === 1
        && rule.actions[0].value[0] === setup.script);
      for (const rule of owned) await request(`${route}/${ruleId(rule)}`, "Email Routing Rules Edit (zone)", { method: "DELETE", missing: true });
      if (!owned.length) return "No route points to this Worker. Routes to other hubs stay in place.";
    });
    await step("worker", "Remove mailbox Worker", async () => {
      if (setup) await request(`/accounts/${encodeURIComponent(setup.accountId)}/workers/scripts/${encodeURIComponent(setup.script)}`,
        "Workers Scripts Edit (account)", { method: "DELETE", missing: true });
      return `R2 bucket${setup ? ` ${setup.bucket}` : ""} is retained: it may hold mail.`;
    });
    await step("save", "Remove local email settings", async () => {
      await fs.unlink(channel.file).catch((error) => { if (error.code !== "ENOENT") throw error; });
      await channel.reload();
    });
  });
}
