import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

export function magicDnsOrigin(status) {
  const dnsName = status?.Self?.DNSName;
  if (typeof dnsName !== "string" || !dnsName) throw new Error("Tailscale did not report this host's MagicDNS name");
  return `https://${dnsName.replace(/\.$/, "")}`;
}

export async function currentMagicDnsOrigin({ run = executeFile } = {}) {
  const { stdout } = await run("tailscale", ["status", "--json"], {
    timeout: 5_000,
    maxBuffer: 128 * 1024,
    windowsHide: true,
  });
  return magicDnsOrigin(JSON.parse(stdout));
}

/**
 * This host's MagicDNS origin, only when Tailscale serves HTTPS on it: the name
 * alone answers nothing, and a device handed it (a head on this desktop, whose
 * WSL runs Tailscale without serve) dialled an address that went nowhere.
 */
export async function servedMagicDnsOrigin({ run = executeFile } = {}) {
  const origin = await currentMagicDnsOrigin({ run });
  const { stdout } = await run("tailscale", ["serve", "status", "--json"], { timeout: 5_000, maxBuffer: 128 * 1024, windowsHide: true });
  const web = JSON.parse(stdout.slice(stdout.indexOf("{")) || "{}").Web || {};
  return Object.hasOwn(web, `${new URL(origin).hostname}:443`) ? origin : null;
}
