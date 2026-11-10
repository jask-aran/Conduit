import { browserVideo } from "./browser-video.js";
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import { McpClient, StdioTransport, toLlmContent } from "@earendil-works/pi-mcp";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { environmentName } from "../device-api.js";

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
// The hub's own session; a device runs its own (`conduit-device`), so a device that is also a hub keeps them apart.
const HUB_SESSION = "conduit-hub";
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
const POINTER_ACTIONS = {
  click: ["click", "Click"], dblclick: ["click", "Double-click"], hover: ["move", "Hover"],
  fill: ["type", "Type"], type: ["type", "Type"], check: ["click", "Check"],
  uncheck: ["click", "Uncheck"], select: ["click", "Select"], drag: ["down", "Drag"],
  mouse_move: ["move", "Move"], mouse_down: ["down", "Down"], mouse_up: ["up", "Up"],
  mouse_wheel: ["scroll", "Scroll"], scroll: ["scroll", "Scroll"],
};

/** Services › Browser: its stream's frame rate (each viewer's, live) and JPEG quality (the browser's, from its start). */
const DEFAULTS = { fps: 24, quality: 60, codec: "h264", direct: false };
const CODECS = ["h264", "h265", "jpeg"];
const FFMPEG = (() => {
  const name = process.env.CONDUIT_FFMPEG || (process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  if (!path.isAbsolute(name) && !name.includes(path.sep)) return which(name);
  try { fs.accessSync(name, fs.constants.X_OK); return name; } catch { return null; }
})();
const FPS = [10, 24, 30, 60];
const QUALITY = [30, 60, 85];

/** Both browser routes encode on this hub; agent-browser still receives only its own stream options. */
function relay(sockets, request, socket, head, fps, reach, observe = () => {}) {
  sockets.handleUpgrade(request, socket, head, (client) => {
    const query = new URL(request.url, "http://localhost").searchParams;
    const pass = new URLSearchParams();
    for (const key of ["maxFps", "pacing"]) if (query.get(key)) pass.set(key, query.get(key));
    const requested = query.get("codec");
    let codec = FFMPEG && (requested === "h264" || requested === "h265") ? requested : "jpeg";
    const send = (data, binary = false) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary }); };
    const announce = () => send(JSON.stringify({ type: "codec", codec }));
    announce();
    const video = codec === "jpeg" ? null : browserVideo({ binary: FFMPEG, codec,
      fps: Math.max(1, Math.min(60, Number(query.get("maxFps")) || fps)),
      send: (data) => send(data, true), fallback: () => { codec = "jpeg"; announce(); } });
    const held = [];
    let upstream = null;
    let closed = false;
    const closeBoth = () => {
      if (closed) return;
      closed = true;
      video?.close();
      try { client.close(); } catch { /* gone */ }
      try { upstream?.close(); } catch { /* gone */ }
    };
    client.on("message", (data, binary) => {
      if (!binary) { try { observe(JSON.parse(data.toString()), true); } catch { /* forward unchanged */ } }
      if (upstream?.readyState === WebSocket.OPEN) upstream.send(data, { binary });
      else held.push({ data, binary });
    });
    client.on("close", closeBoth);
    client.on("error", closeBoth);
    reach(pass).then((found) => {
      upstream = found;
      upstream.on("error", closeBoth);
      upstream.on("close", closeBoth);
      upstream.on("open", () => {
        if (closed) { upstream.close(); return; }
        for (const { data, binary } of held.splice(0)) upstream.send(data, { binary });
      });
      if (closed) { upstream.close(); return; }
      upstream.on("message", (data, binary) => {
        if (!binary) {
          let event;
          try { event = JSON.parse(data.toString()); } catch { /* pass other text through */ }
          if (event) observe(event, false);
          if (codec !== "jpeg" && event?.type === "frame" && typeof event.data === "string") {
            video.write(event);
            if (codec === "jpeg") send(data);
            return;
          }
        }
        send(data, binary);
      });
    }).catch((error) => {
      send(JSON.stringify({ type: "error", message: error.message }));
      closeBoth();
    });
  });
}

export class BrowserHost {
  constructor({ binary = process.env.CONDUIT_AGENT_BROWSER || null, dataRoot = null, session = HUB_SESSION, onChange = () => {} } = {}) {
    this.session = session;
    // Its own profile on the hub: sites signed in to stay signed in across restarts; clearing its data is a new one.
    this.profile = dataRoot ? path.join(dataRoot, "browser", "profile") : null;
    this.settingsFile = dataRoot ? path.join(dataRoot, "browser", "settings.json") : null;
    this.settings = { ...DEFAULTS };
    try { if (this.settingsFile) this.settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(this.settingsFile, "utf8")) }; } catch { /* defaults */ }
    this.onChange = onChange;
    this.binary = binary || vendored() || which(process.platform === "win32" ? "agent-browser.exe" : "agent-browser");
    this.mcp = null;
    this.port = null;
    this.starting = null;
    this.sockets = new WebSocketServer({ noServer: true });
    this.pointer = null;
    this.viewport = null;
  }

  get available() { return Boolean(this.binary); }
  has(id) { return IDS.has(id); }

  /** One agent-browser command on the shared session; its printed answer. */
  run(args, { timeout = 30_000 } = {}) {
    if (!this.binary) return Promise.reject(Object.assign(new Error("agent-browser is not installed on this hub"), { status: 503, code: "browser_unavailable" }));
    return new Promise((resolve, reject) => execFile(this.binary, ["--session", this.session, ...args], {
      timeout, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, ...this.env() },
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
    if (!this.starting) return { id: "hub", available: true, running: false, fps: this.settings.fps };
    await this.start();
    const url = await this.run(["get", "url"]).catch(() => null);
    const title = await this.run(["get", "title"]).catch(() => null);
    return { id: "hub", available: true, running: true, url, title, fps: this.settings.fps };
  }

  /** What the pane's bar does: go to an address, back, forward, reload; and its size, as the page's viewport. */
  async act(action, value) {
    await this.start();
    if (action === "open") return this.run(["open", String(value)], { timeout: 60_000 });
    if (action === "back" || action === "forward" || action === "reload") return this.run([action]);
    if (action === "restart" || action === "clear") return this.restart({ clear: action === "clear" });
    if (action === "viewport") {
      const width = Math.max(320, Math.min(3840, Math.round(Number(value?.width) || 0)));
      const height = Math.max(240, Math.min(2160, Math.round(Number(value?.height) || 0)));
      return this.run(["set", "viewport", String(width), String(height)]);
    }
    throw Object.assign(new Error(`Unknown browser action ${action}`), { status: 400 });
  }

  /** The pane's stream: the session's own, through this server (its sign-in already checked), frames out, input in. */
  handleUpgrade(id, request, socket, head) {
    relay(this.sockets, request, socket, head, this.settings.fps, async (pass) => {
      await this.start();
      return new WebSocket(`ws://127.0.0.1:${this.port}/${pass.size ? `?${pass}` : ""}`);
    }, (event, input) => {
      // Observe the person's mouse position for coordinate-free mouse tools; never announce their input.
      if (input && event.type === "input_mouse" && Number.isFinite(event.x) && Number.isFinite(event.y)) {
        this.pointer = { x: event.x, y: event.y };
      }
      if (!input && event.type === "frame") {
        const { deviceWidth: width, deviceHeight: height } = event.metadata || {};
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) this.viewport = { width, height };
      }
    });
  }

  /**
   * Text on the signed-in pane stream: { type: "pointer", phase, x, y, at, viewport?: { width, height } }.
   * x/y and viewport use viewport CSS px; at is Unix milliseconds. Non-move phases also carry by: "agent", label.
   * Size comes from the latest frame's deviceWidth/deviceHeight, retained here even for binary video viewers.
   */
  announcePointer(point, phase, label) {
    this.pointer = point;
    const message = JSON.stringify({ type: "pointer", phase, ...point, at: Date.now(),
      ...(phase === "move" ? {} : { by: "agent", label }),
      ...(this.viewport ? { viewport: this.viewport } : {}) });
    for (const client of this.sockets.clients) {
      try { if (client.readyState === WebSocket.OPEN) client.send(message, { binary: false }); } catch { /* viewer gone */ }
    }
  }

  /** Resolve without scrolling or focusing. A slow/missing box must never prevent the actual tool call. */
  async pointerPlan(name, args) {
    const action = POINTER_ACTIONS[name.replace(/^agent_browser_/, "")];
    // Other sessions/namespaces are not the hub's page. Direct MCP harnesses bypass this wrapper entirely.
    if (!action || (args.session && args.session !== this.session) || args.namespace) return null;
    const box = async (selector) => {
      const result = JSON.parse(await this.run(["--json", ...(args.extraArgs || []), "get", "box", selector], { timeout: 250 }));
      if (result.success === false) return null;
      const value = result.data?.box || result.data;
      if (!value || ![value.x, value.y, value.width, value.height].every(Number.isFinite) || value.width <= 0 || value.height <= 0) return null;
      return { x: value.x + value.width / 2, y: value.y + value.height / 2 };
    };
    let timer;
    try {
      return await Promise.race([
        (async () => {
          let point;
          let end = null;
          if (name === "agent_browser_drag") {
            [point, end] = await Promise.all([box(args.source), box(args.target)]);
            if (!end) return null;
          } else if (args.selector) point = await box(args.selector);
          else if (name === "agent_browser_mouse_move") point = { x: args.x, y: args.y };
          else if (name === "agent_browser_scroll") point = this.viewport && { x: this.viewport.width / 2, y: this.viewport.height / 2 };
          else point = this.pointer;
          return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? { point, end, phase: action[0], label: action[1] } : null;
        })(),
        new Promise((resolve) => { timer = setTimeout(() => resolve(null), 275); }),
      ]);
    } catch { return null; } finally { clearTimeout(timer); }
  }

  /** What the session starts with, whoever starts it (the pane, an agent's MCP server): its profile, its stream. */
  env() {
    // Muted: the pane carries no sound, and a page left playing (a video in a closed tab) would sound on the hub's
    // machine -- through WSLg, as Windows' "Remote Audio" -- with no way to stop it from Conduit.
    const args = [process.env.AGENT_BROWSER_ARGS, "--mute-audio"].filter(Boolean).join("\n");
    return { AGENT_BROWSER_SESSION: this.session, AGENT_BROWSER_STREAM_QUALITY: String(this.settings.quality), AGENT_BROWSER_ARGS: args,
      ...(this.profile ? { AGENT_BROWSER_PROFILE: this.profile } : {}) };
  }

  /** agent-browser's MCP server for a harness to start: on the shared session (and its profile), the core tools. */
  mcpServer() {
    return this.binary ? { command: this.binary, args: ["mcp"], env: this.env() } : null;
  }

  /** Services › Browser's settings, and what it shows of the browser. */
  async describe() {
    const version = this.binary ? await new Promise((resolve) => execFile(this.binary, ["--version"], { timeout: 5000 }, (error, stdout) => resolve(error ? null : stdout.trim().replace(/^agent-browser\s*/, "")))) : null;
    return { ...(await this.status()), engine: "Chrome", version, runsOn: "hub", profile: Boolean(this.profile), settings: this.settings, video: Boolean(FFMPEG), choices: { fps: FPS, quality: QUALITY, codec: CODECS } };
  }

  async configure(patch) {
    const next = { ...this.settings };
    if (patch?.fps !== undefined) { if (!FPS.includes(Number(patch.fps))) throw Object.assign(new Error("Frame rate is one of " + FPS.join(", ")), { status: 400 }); next.fps = Number(patch.fps); }
    if (patch?.quality !== undefined) { if (!QUALITY.includes(Number(patch.quality))) throw Object.assign(new Error("Quality is one of " + QUALITY.join(", ")), { status: 400 }); next.quality = Number(patch.quality); }
    // Experimental: pages shown directly, proxied through the hub, rather than the shared browser's picture.
    if (patch?.direct !== undefined) next.direct = patch.direct === true;
    if (patch?.codec !== undefined) { if (!CODECS.includes(patch.codec)) throw Object.assign(new Error("Picture codec is one of " + CODECS.join(", ")), { status: 400 }); next.codec = patch.codec; }
    const restart = next.quality !== this.settings.quality;
    this.settings = next;
    if (this.settingsFile) {
      await fs.promises.mkdir(path.dirname(this.settingsFile), { recursive: true });
      await fs.promises.writeFile(this.settingsFile, `${JSON.stringify(next, null, 2)}\n`);
    }
    // Quality is the browser's from its start: a running one starts again, on the page it was on.
    if (restart && this.starting) await this.restart();
    this.onChange();
    return this.describe();
  }

  /** Closed and started again, back on the page it showed (its profile keeps what it was signed in to). */
  async restart({ clear = false } = {}) {
    const url = this.starting ? await this.run(["get", "url"]).catch(() => null) : null;
    await this.run(["close"]).catch(() => {});
    this.starting = null;
    if (clear && this.profile) await fs.promises.rm(this.profile, { recursive: true, force: true });
    await this.start();
    if (url && url !== "about:blank" && !clear) await this.run(["open", url], { timeout: 60_000 }).catch(() => {});
    this.onChange();
    return this.describe();
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
          const pointer = await this.pointerPlan(tool.name, args);
          if (pointer) {
            this.announcePointer(pointer.point, "move");
            if (pointer.phase !== "move") this.announcePointer(pointer.point, pointer.phase, pointer.label);
          }
          const result = await (await this.client()).callTool(tool.name, args, { signal: api?.signal, timeoutMs: MCP_MS });
          if (pointer?.end && !result.isError) {
            this.announcePointer(pointer.end, "move");
            this.announcePointer(pointer.end, "up", pointer.label);
          }
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


/**
 * A device's browser (roadmap #9), as the hub reaches it: the same calls as the hub's own BrowserHost, answered by the
 * device's node (node-agent.js, its `browser` target), and its stream piped from the device's loopback port through a
 * tunnel on the node's connection -- so any client signed in to the hub sees and drives it.
 */
class RemoteBrowser {
  constructor({ nodeHub, nodeId, tunnelTo }) {
    this.nodeHub = nodeHub;
    this.nodeId = nodeId;
    this.tunnelTo = tunnelTo;
    this.sockets = new WebSocketServer({ noServer: true });
  }

  get available() { return Boolean(this.nodeHub.live.get(this.nodeId)?.browser); }

  async call(method, args = []) {
    if (!this.available) throw Object.assign(new Error("That device's browser is not reachable now"), { status: 503 });
    const result = await this.nodeHub.call(this.nodeId, { target: "browser", method, args, cwd: null },
      withAbortSignal(AbortSignal.timeout(method === "act" || method === "stream" ? 90_000 : 20_000), BACKGROUND_CONTEXT));
    if (!result?.ok) throw Object.assign(new Error(result?.error?.message || "The device did not answer"), { status: 502 });
    return result.value;
  }

  status() { return this.available ? this.call("status").then((value) => ({ ...value, id: this.nodeId })) : Promise.resolve({ id: this.nodeId, available: false }); }
  describe() { return this.call("describe").then((value) => ({ ...value, id: this.nodeId, runsOn: "device", video: Boolean(FFMPEG) })); }
  configure(patch) { return this.call("configure", [patch]); }
  act(action, value) { return this.call("act", [action, value]); }

  handleUpgrade(_id, request, socket, head) {
    relay(this.sockets, request, socket, head, DEFAULTS.fps, async (pass) => {
      const { port } = await this.call("stream");
      // The device's loopback stream travels through its existing node tunnel.
      return new WebSocket(`ws://127.0.0.1:${port}/${pass.size ? `?${pass}` : ""}`, { createConnection: () => this.tunnelTo(this.nodeHub, this.nodeId, { port }) });
    });
  }

  close() { this.sockets.close(); }
}

/** The browsers clients can open: the hub's (`hub`), and each connected device's that offers one (its node id). */
export function createBrowsers({ hub, nodeHub, tunnelTo }) {
  const remote = new Map();
  return {
    get(id) {
      if (id === "hub") return hub;
      if (!nodeHub?.live.get(id)?.browser) return null;
      if (!remote.has(id)) remote.set(id, new RemoteBrowser({ nodeHub, nodeId: id, tunnelTo }));
      return remote.get(id);
    },
    async list() {
      const devices = await nodeHub.listDevices().catch(() => []);
      return [{ id: "hub", name: "Hub", available: hub.available },
        ...devices.flatMap((device) => device.nodes.filter((node) => node.browser).map((node) => ({ id: node.id, name: environmentName(device, node), available: true })))];
    },
    close() { for (const browser of remote.values()) browser.close(); },
  };
}
