import crypto from "node:crypto";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { issueCertificate } from "./acme.js";
import { cloudflareToken, cloudflareCli } from "./cloudflare.js";

const fail = (code, message) => Object.assign(new Error(message), { code });
const FILES = ["nodes-cert.pem", "nodes-key.pem", "lan-cert.pem", "lan-key.pem"];

export function lanNamesService({ dataRoot, tlsDir = path.join(os.homedir(), ".conduit", "tls"), cfCommand = process.env.CONDUIT_CF_CLI || "cf", hubAddress = () => null, onCertificates = async () => {}, log = console, issue = issueCertificate, providers = { token: cloudflareToken, cli: cloudflareCli } }) {
  const configDir = path.join(dataRoot, "network");
  const configFile = path.join(configDir, "lan-names.json");
  let config = null;
  let loadError;
  try { config = JSON.parse(readFileSync(configFile, "utf8")); }
  catch (error) {
    // JSON parse errors can quote the token. Keep them out of startup logs.
    if (error.code !== "ENOENT") loadError = { code: "lan_config_invalid", message: "Could not read the LAN names config; save the settings again" };
  }
  const makeProvider = (settings) => settings.via === "token" ? providers.token({ token: settings.token }) : providers.cli({ command: cfCommand });
  let currentProvider = config ? makeProvider(config) : null;
  let state = loadError ? "failed" : config ? "ready" : "off";
  let step;
  let error = loadError;
  let timer;
  let job = null;
  let editing = false;
  let reloadPending = false;
  let cfCache = null;
  let cfPending = null;
  const safeMessage = (value, token = config?.token) => String(value).split(token || "\0").join("[redacted]");

  async function atomic(file, content, mode = 0o600) {
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, content, { mode, flag: "wx" });
      await fs.rename(temp, file);
    } finally { await fs.rm(temp, { force: true }); }
  }
  async function save(settings = config) {
    await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
    await fs.chmod(configDir, 0o700);
    await atomic(configFile, `${JSON.stringify(settings, null, 2)}\n`);
  }
  async function certificates() {
    const found = {};
    for (const [kind, prefix] of [["hub", "lan"], ["nodes", "nodes"]]) {
      try {
        const cert = new crypto.X509Certificate(await fs.readFile(path.join(tlsDir, `${prefix}-cert.pem`)));
        found[kind] = { names: cert.subjectAltName?.split(", ").filter((name) => name.startsWith("DNS:")).map((name) => name.slice(4)) || [], validTo: cert.validTo };
      } catch {}
    }
    return found;
  }
  async function cliStatus() {
    if (cfCache && Date.now() - cfCache.at < 60_000) return cfCache.value;
    if (!cfPending) cfPending = (async () => {
      let value;
      try { await providers.cli({ command: cfCommand }).check(); value = { installed: true, signedIn: true }; }
      catch (error) { value = { installed: error.installed !== false, signedIn: false }; }
      cfCache = { at: Date.now(), value };
      return value;
    })().finally(() => { cfPending = null; });
    return cfPending;
  }
  async function status() {
    return {
      configured: Boolean(config),
      ...(config ? { domain: config.domain, via: config.via, tokenSet: Boolean(config.token), hubName: config.hubName } : {}),
      state, ...(step ? { step } : {}), ...(error ? { error } : {}),
      certificates: await certificates(), hubAddress: await hubAddress(), cf: await cliStatus(),
    };
  }
  async function pointHub() {
    if (!config?.hubName) return;
    const address = await hubAddress();
    if (!address) return;
    const record = { type: "A", name: config.domain, content: address, ttl: 60, proxied: false };
    const rows = await currentProvider.records(config.zone, { type: "A", name: config.domain });
    if (rows.some((row) => row.content === address)) return;
    if (rows[0]?.id) await currentProvider.update(config.zone, rows[0].id, record);
    else await currentProvider.create(config.zone, record);
  }
  async function needsCertificate(prefix, name) {
    try {
      const cert = new crypto.X509Certificate(await fs.readFile(path.join(tlsDir, `${prefix}-cert.pem`)));
      const key = crypto.createPrivateKey(await fs.readFile(path.join(tlsDir, `${prefix}-key.pem`)));
      return !cert.checkPrivateKey(key) || !cert.subjectAltName?.split(", ").includes(`DNS:${name}`) || Date.parse(cert.validTo) <= Date.now() + 30 * 86400_000;
    } catch { return true; }
  }
  async function run(force) {
    try {
      state = "issuing";
      error = undefined;
      step = "Checking Cloudflare";
      const targets = [["nodes", `*.${config.domain}`], ...(config.hubName ? [["lan", config.domain]] : [])];
      const due = [];
      for (const target of targets) if (force || await needsCertificate(...target)) due.push(target);
      if (due.length) {
        await currentProvider.check();
        if (!config.accountKey) {
          config.accountKey = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" });
          await save();
        }
        const dns = {
          async present(name, value) {
            const record = await currentProvider.create(config.zone, { type: "TXT", name, content: `"${value}"`, ttl: 60 });
            const id = record?.id || record?.result?.id;
            if (!id) throw new Error("Cloudflare did not return a challenge record ID");
            return id;
          },
          cleanup: (id) => currentProvider.remove(config.zone, id),
        };
        await fs.mkdir(tlsDir, { recursive: true, mode: 0o700 });
        for (const [prefix, name] of due) {
          const result = await issue({ names: [name], dns, accountKey: config.accountKey, log: { info: (message) => { step = safeMessage(message); } } });
          config.accountKey = result.accountKey;
          await save();
          for (const [suffix, content] of [["cert", result.certificate], ["key", result.privateKey]]) {
            const file = `${prefix}-${suffix}.pem`;
            await atomic(path.join(tlsDir, file), content);
            config.files = [...new Set([...(config.files || []), file])];
            await save();
          }
          reloadPending = true;
          await onCertificates();
          reloadPending = false;
        }
      }
      if (reloadPending) {
        await onCertificates();
        reloadPending = false;
      }
      await pointHub();
      state = "ready";
    } catch (cause) {
      state = "failed";
      error = { code: cause.code || "lan_certificate_failed", message: safeMessage(cause.message) };
      log.warn?.(`Conduit LAN names: ${error.message}`);
    } finally { step = undefined; }
  }
  function check(force = false) {
    if (!config || editing || job) return job || Promise.resolve();
    job = run(force).finally(() => { job = null; });
    return job;
  }
  return {
    status,
    provider: () => currentProvider,
    async setup(input = {}) {
      input ||= {};
      if (editing || job) throw fail("lan_names_busy", "LAN names are already being changed; try again when this finishes");
      editing = true;
      try {
        const domain = typeof input.domain === "string" ? input.domain.toLowerCase() : "";
        const labels = domain.split(".");
        // The wildcard is the certificate's common name, which Let's Encrypt takes up to 64 characters.
        if (domain.length > 62 || labels.length < 3 || !labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw fail("lan_domain_invalid", "Use a host name with at least three labels, such as lan.example.com");
        if (!["token", "cf"].includes(input.via)) throw fail("cloudflare_token_invalid", "Choose a Cloudflare token or the Cloudflare CLI");
        const token = input.via === "token" ? (typeof input.token === "string" && input.token.trim() || (config?.via === input.via && config.domain === domain ? config.token : "")) : undefined;
        if (input.via === "token" && !token) throw fail("cloudflare_token_invalid", "Enter a Cloudflare API token");
        const next = { domain, via: input.via, ...(token ? { token } : {}), hubName: input.hubName === true, accountKey: config?.accountKey || null, files: config?.files || [] };
        const provider = makeProvider(next);
        let zone;
        try {
          await provider.check();
          zone = await provider.zoneFor(domain);
        } catch (cause) { throw fail(cause.code || "cloudflare_setup_failed", safeMessage(cause.message, token)); }
        if (!zone) throw fail("cloudflare_zone_not_found", "Cloudflare could not find a zone for this domain");
        if (domain === zone.name) throw fail("lan_domain_is_zone", "Use a name below the zone, such as lan.example.com, to limit the nodes' wildcard key");
        next.zone = zone;
        await save(next);
        config = next;
        currentProvider = provider;
        editing = false;
        void check(true);
        return status();
      } finally { editing = false; }
    },
    start() {
      if (timer) return;
      void check();
      timer = setInterval(() => { void check(); }, 6 * 3600_000);
      timer.unref();
    },
    stop() { clearInterval(timer); timer = null; },
    async remove() {
      if (editing) throw fail("lan_names_busy", "LAN names are already being changed; try again when this finishes");
      editing = true;
      try {
        // Finish cleanup and disk writes before forgetting the config.
        await job;
        for (const file of config?.files || []) if (FILES.includes(file)) await fs.rm(path.join(tlsDir, file), { force: true });
        await fs.rm(configFile, { force: true });
        config = null;
        currentProvider = null;
        state = "off";
        reloadPending = false;
        step = error = undefined;
        await onCertificates();
        return status();
      } finally { editing = false; }
    },
  };
}
