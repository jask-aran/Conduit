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
