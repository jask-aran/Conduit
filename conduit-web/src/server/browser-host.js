import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";

/*
 * The browser document, version 1 (roadmap #7): a Chrome on the hub that the person and Conduit's agents share, one
 * page by its id (`browser:hub`). Its engine is Vercel's agent-browser (Apache-2.0): a native daemon over CDP whose
 * session streams its viewport over a WebSocket (JPEG frames, the page's URL) and takes mouse, key and touch input --
 * its "pair browsing". The person sees and drives it through a pane (the stream, proxied here behind Conduit's
 * sign-in); an agent through the `browser` tool, the same session's commands (snapshot, click @ref, fill, open...).
 *
 * agent-browser is found, not bundled: CONDUIT_AGENT_BROWSER, else `agent-browser` on the PATH (npm i -g
 * agent-browser; it finds an installed Chrome, Playwright's included, or `agent-browser install` fetches one). Without
 * it the pane says how to add it. The session starts on first use and stays open while the server runs.
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

export class BrowserHost {
  constructor({ binary = process.env.CONDUIT_AGENT_BROWSER || null } = {}) {
    this.binary = binary || which(process.platform === "win32" ? "agent-browser.exe" : "agent-browser");
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
      let status = await this.run(["stream", "status"], { timeout: 60_000 });
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

  /** This server going: its streams close; the browser stays open, found again as it was when the server returns. */
  close() {
    this.sockets.close();
  }
}

/** Words of a command line, quotes kept together: `fill @e3 "two words"`. */
const words = (line) => [...String(line).matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)].map((match) => match[1]?.replace(/\\(.)/g, "$1") ?? match[2] ?? match[3]);
// What would take the shared page away or point the tool elsewhere.
const REFUSED = new Set(["close", "quit", "connect", "install", "upgrade", "doctor", "dashboard", "chat", "session"]);

/** Conduit's agents on the hub's browser: the page the person sees in a Browser pane (`browser:hub`). */
export function BrowserTool(runtime) {
  const text = (value, isError = false) => ({ output: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) });
  return defineTool({
    name: "browser",
    description: "The hub's web browser, shared with the person: what you do there they see in a Browser pane, and what they "
      + "do you see. One agent-browser command per call: open <url>; snapshot -i (the page's interactive elements with refs "
      + "such as @e1); click @e2; fill @e3 \"text\"; press Enter; get text @e1; get url; scroll down; back; screenshot. "
      + "Act through snapshot refs rather than coordinates. To have the person watch, open browser:hub with the ui tool.",
    parameters: Type.Object({ command: Type.String({ description: "The command and its arguments, as agent-browser takes them (without the program's name)." }) }),
    replay: "unsafe",
    execute: async ({ command }) => {
      const host = runtime.browserHost;
      if (!host?.available) return text("The hub has no browser: agent-browser is not installed there.", true);
      const args = words(command);
      if (!args.length) return text("Give a command, such as open https://example.com or snapshot -i.", true);
      if (REFUSED.has(args[0]) || args.some((arg) => /^--(session|cdp|profile|config|provider|auto-connect)\b/.test(arg))) {
        return text(`"${args[0]}" is not for the shared browser: it stays open on its own session.`, true);
      }
      try {
        await host.start();
        const out = await host.run(args, { timeout: 60_000 });
        return text(out.length > 30_000 ? `${out.slice(0, 30_000)}\n[cut at 30,000 of ${out.length} characters]` : out || "Done.");
      } catch (error) { return text(error.message, true); }
    },
  });
}
