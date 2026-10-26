import { execFile } from "node:child_process";

const failure = (code, message) => Object.assign(new Error(message), { code });
const rows = (data) => Array.isArray(data) ? data : data?.result || [];
const candidates = (name) => name.replace(/^\*\./, "").split(".").map((_, index, labels) => labels.slice(index).join(".")).filter((name) => name.includes("."));

export function cloudflareToken({ token, fetchImpl = fetch }) {
  const redact = (message) => String(message).split(token || "\0").join("[redacted]");
  async function request(route, method = "GET", body) {
    try {
      const response = await fetchImpl(`https://api.cloudflare.com/client/v4${route}`, {
        method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
      });
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.errors?.[0]?.message || `Cloudflare request failed (${response.status})`);
      return data.result;
    } catch (error) { throw new Error(redact(error.message)); }
  }
  return {
    via: "token",
    async check() {
      try {
        const result = await request("/user/tokens/verify");
        if (result?.status !== "active") throw new Error("The Cloudflare token is not active");
        return { ok: true };
      } catch (error) { throw failure("cloudflare_token_invalid", error.message); }
    },
    async zoneFor(name) {
      for (const candidate of candidates(name)) {
        const zones = await request(`/zones?name=${encodeURIComponent(candidate)}`);
        const zone = zones?.find((zone) => zone.name === candidate);
        if (zone) return { id: zone.id, name: zone.name };
      }
      return null;
    },
    async records(zone, { type, name }) { return rows(await request(`/zones/${zone.id}/dns_records?${new URLSearchParams({ type, name })}`)); },
    create: (zone, record) => request(`/zones/${zone.id}/dns_records`, "POST", record),
    update: (zone, id, record) => request(`/zones/${zone.id}/dns_records/${id}`, "PUT", record),
    remove: (zone, id) => request(`/zones/${zone.id}/dns_records/${id}`, "DELETE"),
  };
}

export function cloudflareCli({ command = "cf" } = {}) {
  async function run(args) {
    const stdout = await new Promise((resolve, reject) => {
      execFile(command, args, { timeout: 30_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
        // Do not expose stderr: a CLI can include credentials in its diagnostics.
        if (error) reject(failure(error.code === "ENOENT" ? "ENOENT" : "cloudflare_cli_failed", "Cloudflare CLI command failed"));
        else resolve(stdout);
      });
    });
    try { return stdout.trim() ? JSON.parse(stdout) : null; }
    catch { throw failure("cloudflare_cli_failed", "Cloudflare CLI did not return valid JSON"); }
  }
  return {
    via: "cf",
    async check() {
      try {
        const who = await run(["auth", "whoami"]);
        if (!who?.authenticated || !who.tokenValid) throw new Error("Sign in to the Cloudflare CLI");
        return { ok: true, ...(typeof who.account === "string" ? { account: who.account } : {}) };
      } catch (error) {
        throw Object.assign(failure("cloudflare_cli_unavailable", "Cloudflare CLI is missing or not signed in"), { installed: error.code !== "ENOENT" });
      }
    },
    async zoneFor(name) {
      for (const candidate of candidates(name)) {
        const zone = rows(await run(["zones", "list", "--name", candidate])).find((zone) => zone.name === candidate);
        if (zone) return { id: zone.id, name: zone.name };
      }
      return null;
    },
    async records(zone, { type, name }) { return rows(await run(["dns", "records", "list", "-z", zone.id, "--type", type, "--name", name])); },
    create: (zone, record) => run(["dns", "records", "create", "-q", "-z", zone.id, "--body", JSON.stringify(record)]),
    update: (zone, id, record) => run(["dns", "records", "edit", id, "-q", "-z", zone.id, "--body", JSON.stringify(record)]),
    // -f: it asks first otherwise, and with nobody to answer deletes nothing and says nothing of it.
    remove: (zone, id) => run(["dns", "records", "delete", id, "-q", "-f", "-z", zone.id]),
  };
}
