import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpClient, StdioTransport, toLlmContent } from "@earendil-works/pi-mcp";

/*
 * The person's own browser on this machine, as agents drive it (a spike, docs/plans/screens-and-device-control.md,
 * "an agent's actions on a device's browser"): their signed-in Chromium, through OpenCode Browse (MIT) -- an extension
 * in that browser paired to a relay on this machine's loopback, and Browse's own MCP server over stdio, which this
 * holds one of. Nothing of Browse's leaves the machine: the hub reaches it through this machine's node (node-agent.js,
 * the `personBrowser` target) or, on the hub itself, directly, and agents through the conduit MCP server's
 * `conduit_browser` (server/person-browser-tool.js).
 *
 * The binary: CONDUIT_BROWSE names one; else `opencode-browser` on the PATH (the package's own second name: `browse`
 * is xdg-open on Linux); else Browse's installer's ~/.local/bin/browse.
 */
const MCP_MS = 120_000;
// Browse's tools the network is given: the browser itself and its sessions. Withheld here, on the machine that would
// run them: a local command with captured credentials (secrets_run), the person's own settings, and what writes files
// to this machine's disk (network capture, recordings).
const OFFERED = new Set(["execute", "status", "session_new", "session_list", "session_use", "session_reset", "session_delete",
  "session_adopt", "session_allowlist", "tabs_cleanup", "secrets_list"]);

const executable = (file) => { try { fs.accessSync(file, fs.constants.X_OK); return file; } catch { return null; } };
const find = () => {
  if (process.env.CONDUIT_BROWSE) return executable(process.env.CONDUIT_BROWSE);
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const file = executable(path.join(dir, process.platform === "win32" ? "opencode-browser.cmd" : "opencode-browser"));
    if (file) return file;
  }
  return executable(path.join(os.homedir(), ".local", "bin", process.platform === "win32" ? "browse.exe" : "browse"));
};

export class PersonBrowser {
  constructor({ binary = find() } = {}) {
    this.binary = binary;
    this.mcp = null;
  }

  get available() { return Boolean(this.binary); }

  client() {
    return this.mcp ??= (async () => {
      const client = new McpClient({ name: "Conduit", version: "1.0.0", requestTimeoutMs: MCP_MS });
      await client.connect(new StdioTransport({ command: this.binary, args: ["mcp"], env: { ...process.env } }));
      client.onClose(() => { this.mcp = null; });
      return client;
    })().catch((error) => { this.mcp = null; throw error; });
  }

  /** Browse's tools as it lists them: `{ name, description, inputSchema }`. */
  async tools() {
    return (await (await this.client()).listTools()).filter((tool) => OFFERED.has(tool.name)).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  }

  /** One of them, called: `{ output, isError }`, output as a model reads it. */
  async call(name, args = {}) {
    if (!OFFERED.has(String(name))) return { output: [{ type: "text", text: `Not a tool Conduit offers of this browser: ${name}.` }], isError: true };
    const result = await (await this.client()).callTool(String(name), args || {}, { timeoutMs: MCP_MS });
    return { output: toLlmContent(result), isError: result.isError === true };
  }

  close() { void this.mcp?.then((client) => client.close()).catch(() => {}); }
}
