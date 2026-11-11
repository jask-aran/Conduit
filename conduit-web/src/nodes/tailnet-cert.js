import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

/** Null where Tailscale will not issue one: the node then offers no https route and pages read through the hub. */
const CLI = process.platform === "win32" ? ["C:\\Program Files\\Tailscale\\tailscale.exe", "tailscale"] : ["tailscale"];

const run = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { timeout: 90_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
});

export async function tailnetCert(home) {
  for (const cli of CLI) {
    let status;
    try { status = JSON.parse(await run(cli, ["status", "--json"])); } catch { continue; }
    const name = String(status?.Self?.DNSName || "").replace(/\.$/, "");
    if (!name || !(status.CertDomains || []).includes(name)) return null;
    const cert = path.join(home, "tailnet.crt");
    const key = path.join(home, "tailnet.key");
    try {
      await run(cli, ["cert", "--cert-file", cert, "--key-file", key, name]);
      return { name, cert: await fs.readFile(cert), key: await fs.readFile(key) };
    } catch { return null; }
  }
  return null;
}
