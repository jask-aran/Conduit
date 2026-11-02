import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import { McpClient, StdioTransport, toLlmContent } from "@earendil-works/pi-mcp";

/*
 * The browser document, version 1 (roadmap #7): a Chrome on the hub that the person and Conduit's agents share, one
 * page by its id (`browser:hub`). Its engine is Vercel's agent-browser (Apache-2.0): a native daemon over CDP whose
 * session streams its viewport over a WebSocket (JPEG frames, the page's URL) and takes mouse, key and touch input --
 * its "pair browsing". The person sees and drives it through a pane (the stream, proxied here behind Conduit's
 * sign-in); an agent through agent-browser's own MCP server on the same session (AGENT_BROWSER_SESSION): Conduit's
 * agents load its tools into codemode (`tools()`), other harnesses are given the server itself (`mcpServer()`), so
 * the engine can be swapped for another (Browser Use, a cloud browser) without a tool of Conduit's own in between.
 *
 * agent-browser is vendored (a dependency: its native binaries come in the package); CONDUIT_AGENT_BROWSER names
 * another, and one on the PATH is the last resort. It finds an installed Chrome, Playwright's included, or
 * `agent-browser install` fetches one. The session starts on first use and stays open, across restarts of Conduit.
 */
const SESSION = "conduit-hub";
const IDS = new Set(["hub"]);

const which = (name) => {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const file = path.join(dir, name);
    try { fs.accessSync(file, fs.constants.X_OK); return file; } catch { /* next */ }
  }
  return null;
};
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
});

/** The vendored binary for this machine (agent-browser ships one per platform in its package). */
const vendored = () => {
  const name = `agent-browser-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
  const file = fileURLToPath(new URL(`../../node_modules/agent-browser/bin/${name}`, import.meta.url));
  try { fs.accessSync(file, fs.constants.X_OK); return file; } catch { return null; }
};
// Its MCP tools the shared page must not lose to an agent (closing the session ends the person's page too), or that
// only describe the server itself.
const WITHHELD = new Set(["agent_browser_close", "agent_browser_tools_profiles"]);
const MCP_MS = 60_000;

export class BrowserHost {
  constructor({ binary = process.env.CONDUIT_AGENT_BROWSER || null } = {}) {
    this.binary = binary || vendored() || which(process.platform === "win32" ? "agent-browser.exe" : "agent-browser");
    this.mcp = null;
    this.port = null;
    this.starting = null;
    this.sockets = new WebSocketServer({ noServer: true });
  }

  get available() { return Boolean(this.binary); }
  has(id) { return IDS.has(id); }

  /** One agent-browser command on the shared session; its printed answer. */
  run(args, { timeout = 30_000 } = {}) {
    if (!this.binary) return Promise.reject(Object.assign(new Error("agent-browser is not installed on this hub"), { status: 503, code: "browser_unavailable" }));
    return new Promise((resolve, reject) => execFile(this.binary, ["--session", SESSION, ...args], {
      timeout, maxBuffer: 4 * 1024 * 1024,
      env: process.env,
    }, (error, stdout, stderr) => error
      ? reject(Object.assign(new Error((stderr || stdout || error.message).trim().split("\n").slice(-3).join(" ")), { status: 502 }))
      : resolve(stdout.trim())));
  }

  /**
   * The session and its stream's loopback port. Asking launches the browser if it is not running (on a blank page),
   * and finds it as it was if it is: the daemon outlives a restart of this server, and the page with it.
   */
  start() {
    return this.starting ??= (async () => {
      let status = await this.run(["stream", "status"], { timeout: 60_000 }).catch((error) => {
        // agent-browser is here but found no Chrome: say what fixes it.
        throw /chrome|browser.*not found|executable/i.test(error.message)
          ? Object.assign(new Error(`The hub has no Chrome for its browser. On the hub, run: ${this.binary} install`), { status: 503 }) : error;
      });
      if (!/127\.0\.0\.1:\d+/.test(status)) {
        await this.run(["stream", "enable", "--port", String(await freePort())]);
        status = await this.run(["stream", "status"]);
      }
      const port = Number(status.match(/127\.0\.0\.1:(\d+)/)?.[1]);
      if (!port) throw Object.assign(new Error("The hub's browser did not say where it streams"), { status: 502 });
      this.port = port;
    })().catch((error) => { this.starting = null; throw error; });
  }

  async status() {
    if (!this.available) return { id: "hub", available: false };
    if (!this.starting) return { id: "hub", available: true, running: false };
    await this.start();
    const url = await this.run(["get", "url"]).catch(() => null);
    const title = await this.run(["get", "title"]).catch(() => null);
    return { id: "hub", available: true, running: true, url, title };
  }

  /** What the pane's bar does: go to an address, back, forward, reload; and its size, as the page's viewport. */
  async act(action, value) {
    await this.start();
    if (action === "open") return this.run(["open", String(value)], { timeout: 60_000 });
    if (action === "back" || action === "forward" || action === "reload") return this.run([action]);
    if (action === "viewport") {
      const width = Math.max(320, Math.min(3840, Math.round(Number(value?.width) || 0)));
      const height = Math.max(240, Math.min(2160, Math.round(Number(value?.height) || 0)));
      return this.run(["set", "viewport", String(width), String(height)]);
    }
    throw Object.assign(new Error(`Unknown browser action ${action}`), { status: 400 });
  }

  /** The pane's stream: the session's own, through this server (its sign-in already checked), frames out, input in. */
  handleUpgrade(id, request, socket, head) {
    this.sockets.handleUpgrade(request, socket, head, (client) => {
      const held = [];
      let upstream = null;
      const closeBoth = () => { try { client.close(); } catch { /* gone */ } try { upstream?.close(); } catch { /* gone */ } };
      client.on("message", (data, binary) => { if (upstream?.readyState === WebSocket.OPEN) upstream.send(data, { binary }); else held.push(data); });
      client.on("close", closeBoth);
      this.start().then(() => {
        const query = new URL(request.url, "http://localhost").searchParams;
        const pass = new URLSearchParams();
        for (const key of ["maxFps", "pacing"]) if (query.get(key)) pass.set(key, query.get(key));
        upstream = new WebSocket(`ws://127.0.0.1:${this.port}/${pass.size ? `?${pass}` : ""}`);
        upstream.on("open", () => { for (const data of held.splice(0)) upstream.send(data); });
        upstream.on("message", (data, binary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary }); });
        upstream.on("close", closeBoth);
        upstream.on("error", () => closeBoth());
      }).catch((error) => {
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "error", message: error.message }));
        closeBoth();
      });
    });
  }

  /** agent-browser's MCP server for a harness to start: on the shared session, the core tools. */
  mcpServer() {
    return this.binary ? { command: this.binary, args: ["mcp"], env: { AGENT_BROWSER_SESSION: SESSION } } : null;
  }

  /**
   * agent-browser's MCP tools as Conduit's agents call them (from codemode: `tools.agent_browser_open(...)`), through
   * one long-lived stdio server on the shared session; started again if it goes.
   */
  async tools() {
    if (!this.binary) return [];
    const client = await this.client();
    return (await client.listTools()).filter((tool) => !WITHHELD.has(tool.name)).map((tool) => ({
      name: tool.name, label: tool.title || tool.name, description: tool.description || tool.name,
      parameters: Type.Unsafe({ ...tool.inputSchema, type: "object", properties: tool.inputSchema?.properties || {} }),
      replay: tool.annotations?.readOnlyHint === true ? "safe" : "unsafe",
      execute: async (args, api) => {
        try {
          const result = await (await this.client()).callTool(tool.name, args, { signal: api?.signal, timeoutMs: MCP_MS });
          return { output: toLlmContent(result), isError: result.isError === true };
        } catch (error) { return { output: [{ type: "text", text: `The browser did not answer: ${String(error?.message || error).slice(0, 200)}` }], isError: true }; }
      },
    }));
  }

  client() {
    return this.mcp ??= (async () => {
      const server = this.mcpServer();
      const client = new McpClient({ name: "Conduit", version: "1.0.0", requestTimeoutMs: MCP_MS });
      await client.connect(new StdioTransport({ command: server.command, args: server.args, env: { ...process.env, ...server.env } }));
      client.onClose(() => { this.mcp = null; });
      return client;
    })().catch((error) => { this.mcp = null; throw error; });
  }

  /** This server going: its streams and MCP client close; the browser stays open, found again as it was. */
  close() {
    this.sockets.close();
    void this.mcp?.then((client) => client.close()).catch(() => {});
  }
}

