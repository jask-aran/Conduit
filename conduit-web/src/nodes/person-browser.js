import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { McpClient, StdioTransport, toLlmContent } from "@earendil-works/pi-mcp";

/*
 * Nothing of Browse's leaves the machine. Browse only knows its own machine's browsers, and a relay is one per loopback
 * port; Windows and its WSL share that port, so an environment inside WSL offers none unless CONDUIT_BROWSE says
 * otherwise.
 */
const MCP_MS = 120_000;
const CLI_MS = 15_000;
// A code works once, for ten minutes (Browse's own rule); the wait for it ends with it.
const PAIR_SECONDS = 600;
// Browse's tools the network is given: the browser itself and its sessions. Withheld here, on the machine that would
// run them: a local command with captured credentials (secrets_run), the person's own settings, and what writes files
// to this machine's disk (network capture, recordings).
const OFFERED = new Set(["execute", "status", "session_new", "session_list", "session_use", "session_reset", "session_delete",
  "session_adopt", "session_allowlist", "tabs_cleanup", "secrets_list"]);
export const BROWSE_EXTENSION_URL = "https://chromewebstore.google.com/detail/mfnicocicmmlkpjnaffgihfjhdgjkdjg";

const BROWSE_EXTENSION_ID = BROWSE_EXTENSION_URL.split("/").at(-1);
const readable = (file) => { try { fs.accessSync(file, fs.constants.R_OK); return true; } catch { return false; } };
const insideWsl = () => process.platform === "linux" && os.release().toLowerCase().includes("microsoft");
// The checkout's dependency, or the desktop app's companion bundle, beside this file.
const vendored = () => {
  if (process.env.CONDUIT_BROWSE) return readable(process.env.CONDUIT_BROWSE) ? process.env.CONDUIT_BROWSE : null;
  if (insideWsl()) return null;
  return ["../../node_modules/@opencode/browse/dist/cli.mjs", "./node_modules/@opencode/browse/dist/cli.mjs"]
    .map((file) => fileURLToPath(new URL(file, import.meta.url))).find(readable) ?? null;
};

const installedBrowsers = () => {
  if (process.platform !== "win32") return [];
  const local = process.env.LOCALAPPDATA || "";
  const programs = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], local].filter(Boolean);
  const found = (parts) => programs.map((base) => path.join(base, ...parts)).find(readable);
  return [
    { name: "Chrome", data: path.join(local, "Google", "Chrome", "User Data"), exe: found(["Google", "Chrome", "Application", "chrome.exe"]) },
    { name: "Edge", data: path.join(local, "Microsoft", "Edge", "User Data"), exe: found(["Microsoft", "Edge", "Application", "msedge.exe"]) },
    { name: "Brave", data: path.join(local, "BraveSoftware", "Brave-Browser", "User Data"), exe: found(["BraveSoftware", "Brave-Browser", "Application", "brave.exe"]) },
  ].filter((browser) => browser.exe && readable(browser.data));
};
const profilesWithExtension = () => installedBrowsers().flatMap((browser) => {
  let state = null;
  try { state = JSON.parse(fs.readFileSync(path.join(browser.data, "Local State"), "utf8")); } catch { /* its folders are read instead */ }
  const known = Object.keys(state?.profile?.info_cache ?? {});
  const dirs = (known.length ? known : fs.readdirSync(browser.data).filter((dir) => /^(Default|Profile \d+)$/.test(dir)))
    .filter((dir) => readable(path.join(browser.data, dir, "Extensions", BROWSE_EXTENSION_ID)));
  if (!dirs.length) return [];
  const dir = dirs.includes(state?.profile?.last_used) ? state.profile.last_used : dirs[0];
  return [{ browser: browser.name, exe: browser.exe, dir, name: state?.profile?.info_cache?.[dir]?.name || dir }];
});
const ENV = { OPENCODE_BROWSER_AUTO_UPDATE: "off", OPENCODE_BROWSER_UPDATE_CHECK: "0" };

export class PersonBrowser {
  constructor({ cli = vendored() } = {}) {
    this.cli = cli;
    this.mcp = null;
    this.relay = null;
    this.pairing = null;
  }

  get available() { return Boolean(this.cli); }

  run(args, timeout = CLI_MS) {
    return new Promise((resolve, reject) => execFile(process.execPath, [this.cli, ...args], { timeout, env: { ...process.env, ...ENV }, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => (error ? reject(new Error(String(stderr || error.message).trim().split("\n").at(-1))) : resolve(stdout))));
  }

  async read() {
    try { return JSON.parse(await this.run(["status", "--json"])); } catch { return null; }
  }

  /** The relay, started as this process's child when nothing answers on its port. */
  async ensureRelay() {
    if ((await this.read())?.relay?.running) return;
    if (!this.relay) {
      const child = this.relay = spawn(process.execPath, [this.cli, "serve"], { env: { ...process.env, ...ENV }, stdio: "ignore" });
      child.on("exit", () => { if (this.relay === child) this.relay = null; });
    }
    for (let tries = 0; tries < 20; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if ((await this.read())?.relay?.running) return;
    }
    throw new Error("Browse's relay did not start");
  }

  async status() {
    if (!this.available) return { available: false, browsers: [], pairing: null, extensionUrl: BROWSE_EXTENSION_URL };
    await this.ensureRelay().catch(() => {});
    const read = await this.read();
    const browsers = (read?.extension?.browsers || []).map(({ id, name, connected }) => ({ id: String(id), name: String(name || id), connected: connected === true }));
    return { available: true, relay: read?.relay?.running === true, version: read?.relay?.version || null, browsers, launchable: profilesWithExtension().length > 0,
      pairing: this.pairing ? { code: this.pairing.code, expiresAt: this.pairing.expiresAt } : null, extensionUrl: BROWSE_EXTENSION_URL };
  }

  /** The code already out is given again while it lasts. */
  pair() {
    if (this.pairing) return Promise.resolve({ code: this.pairing.code, expiresAt: this.pairing.expiresAt });
    // One ask at a time: a second before the first's code arrived would start a second child and orphan that code.
    return this.pairingAsked ||= this.askPair().finally(() => { this.pairingAsked = null; });
  }

  async askPair() {
    await this.ensureRelay();
    const child = spawn(process.execPath, [this.cli, "pair", "--wait-seconds", String(PAIR_SECONDS)], { env: { ...process.env, ...ENV }, stdio: ["ignore", "pipe", "pipe"] });
    const code = await new Promise((resolve, reject) => {
      let text = "";
      child.stdout.on("data", (chunk) => { text += chunk; const found = /Pairing code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(text); if (found) resolve(found[1]); });
      child.on("exit", () => reject(new Error("Browse gave no pairing code")));
      child.on("error", reject);
    });
    const pairing = this.pairing = { code, expiresAt: new Date(Date.now() + PAIR_SECONDS * 1000).toISOString(), child };
    // Redeemed or run out: either way the code is spent.
    child.on("exit", () => { if (this.pairing === pairing) this.pairing = null; });
    return { code, expiresAt: pairing.expiresAt };
  }

  async unpair(browser) {
    await this.run(["pair", "--revoke", String(browser)]);
    return this.status();
  }

  async launch() {
    const [profile] = profilesWithExtension();
    if (!profile) throw new Error("No browser here has the OpenCode Browse extension in a profile Conduit can find");
    spawn(profile.exe, [`--profile-directory=${profile.dir}`], { detached: true, stdio: "ignore" }).unref();
    return { launched: `${profile.browser} · ${profile.name}` };
  }

  client() {
    return this.mcp ??= (async () => {
      await this.ensureRelay();
      const client = new McpClient({ name: "Conduit", version: "1.0.0", requestTimeoutMs: MCP_MS });
      await client.connect(new StdioTransport({ command: process.execPath, args: [this.cli, "mcp"], env: { ...process.env, ...ENV } }));
      client.onClose(() => { this.mcp = null; });
      return client;
    })().catch((error) => { this.mcp = null; throw error; });
  }

  async tools() {
    return (await (await this.client()).listTools()).filter((tool) => OFFERED.has(tool.name)).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  }

  async call(name, args = {}) {
    if (!OFFERED.has(String(name))) return { output: [{ type: "text", text: `Not a tool Conduit offers of this browser: ${name}.` }], isError: true };
    const result = await (await this.client()).callTool(String(name), args || {}, { timeoutMs: MCP_MS });
    return { output: toLlmContent(result), isError: result.isError === true };
  }

  close() {
    void this.mcp?.then((client) => client.close()).catch(() => {});
    this.pairing?.child.kill();
    this.relay?.kill();
  }
}
