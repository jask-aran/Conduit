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

/**
 * The machine at an address, by the hostname Tailscale knows it by ("Desktop", "jask-laptop"), or null when Tailscale
 * cannot say: a tailnet address is asked of `tailscale whois`; any other (a LAN address) is matched to the peer whose
 * direct connection comes from it. Asked once per address for a while: a page refreshing its list must not run the
 * CLI each time.
 */
const machines = new Map();
const json = (stdout) => JSON.parse(stdout.slice(stdout.indexOf("{")) || "{}");
export function tailnetMachine(address, { tailnet = true, run = executeFile } = {}) {
  const cached = machines.get(address);
  if (cached && cached.until > Date.now()) return cached.name;
  const options = { timeout: 5_000, maxBuffer: 1024 * 1024, windowsHide: true };
  const name = (tailnet
    ? run("tailscale", ["whois", "--json", address], options).then(({ stdout }) => {
      const node = json(stdout).Node || {};
      return node.Hostinfo?.Hostname || node.ComputedName || null;
    })
    : run("tailscale", ["status", "--json"], options).then(({ stdout }) => {
      const peer = Object.values(json(stdout).Peer || {}).find((item) => String(item.CurAddr || "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "") === address);
      return peer ? peer.HostName || String(peer.DNSName || "").split(".")[0] || null : null;
    })).catch(() => null);
  machines.set(address, { name, until: Date.now() + 10 * 60_000 });
  return name;
}
