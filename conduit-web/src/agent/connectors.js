import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Type } from "@earendil-works/pi-ai";
import { McpClient, StreamableHttpTransport, toLlmContent } from "@earendil-works/pi-mcp";
import { McpOAuthProvider, adaptOAuthProvider, authorizeMcp } from "@earendil-works/pi-mcp/oauth";
/** A request to a connector may be a whole program (Executor's execute reading many messages): minutes, not seconds. */
const CALL_MS = 120_000;

/** The MCP servers the agent can reach the person's accounts through. resourceMetadata: where the server says its
 *  OAuth is described (its 401's `resource_metadata`). */
export const CONNECTORS = [{ id: "executor", label: "Executor", url: "https://mcp.executor.sh/mcp",
  resourceMetadata: "https://mcp.executor.sh/.well-known/oauth-protected-resource/mcp?elicitation_mode=model" }];

export class Connectors {
  constructor(agent) {
    this.agent = agent;
    this.entries = new Map(CONNECTORS.map((info) => [info.id, { info, status: "off", tools: [] }]));
    this.pending = new Map();
  }
  entry(id) {
    const entry = this.entries.get(id);
    if (!entry) throw Object.assign(new Error("Unknown connector"), { status: 404 });
    return entry;
  }
  // Credentials live with the hub's other secrets, not in the agent's folder, which its file tools read and list.
  file(entry) { return path.join(this.agent.runtime.dataRoot, "agent-connectors", `${entry.info.id}.json`); }
  async read(entry) {
    try { return JSON.parse(await fs.readFile(this.file(entry), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
  }
  async write(entry, state) {
    const file = this.file(entry);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temp, JSON.stringify(state), { mode: 0o600, flag: "wx" }); await fs.rename(temp, file); }
    finally { await fs.unlink(temp).catch(() => {}); }
  }
  provider(entry, redirectUrl, store, onRedirect = () => {}) {
    return new McpOAuthProvider({ serverUrl: entry.info.url, redirectUrl, store, onRedirect,
      clientMetadata: { client_name: "Conduit", scope: "mcp offline_access" } });
  }
  async start() {
    this.started = (async () => {
      for (const entry of this.entries.values()) {
        try { if ((await this.read(entry))?.tokens) void this.connect(entry); }
        catch { entry.status = "error"; entry.error = "Cannot read connector credentials"; }
      }
    })();
    await this.started;
    if (!this.timer) { this.timer = setInterval(() => { for (const entry of this.entries.values()) if (entry.status === "error" && entry.authorized) void this.connect(entry); }, 180000); this.timer.unref(); }
  }
  async stop() {
    clearInterval(this.timer); this.timer = null;
    await Promise.all([...this.entries.values()].map((entry) => entry.client?.close().catch(() => {})));
  }
  list() {
    return [...this.entries.values()].map(({ info: { id, label, url }, status, tools, error }) => ({ id, label, url, status, tools: tools.length,
      names: tools.map((tool) => tool.label), ...(error ? { error } : {}) }));
  }
  /** What one connected tool says it does, for a look at what the account reaches. */
  describe(id) { return this.entry(id).tools.map((tool) => ({ name: tool.label, description: tool.description, readOnly: tool.connectorReadOnly })); }
  tools() { return [...this.entries.values()].flatMap((entry) => entry.tools); }
  /** Wait for one still coming up (the hub starting, a reconnect) before anything says it is not connected. */
  async ready(id) {
    await this.started;
    const entry = this.entries.get(id);
    if (entry?.connecting) await entry.connecting;
  }
  async connect(entry) {
    if (entry.connecting) return entry.connecting;
    entry.authorized = true; entry.status = "connecting"; delete entry.error;
    entry.connecting = (async () => {
      let client;
      try {
        const state = await this.read(entry);
        if (!state?.tokens || !state.redirectUrl) throw new Error("Connector credentials are incomplete");
        const store = { load: () => this.read(entry), save: (next) => this.write(entry, { ...next, redirectUrl: state.redirectUrl }) };
        const oauth = this.provider(entry, state.redirectUrl, store);
        client = new McpClient({ name: "Conduit", version: "1.0.0", requestTimeoutMs: 15000 });
        await client.connect(new StreamableHttpTransport({ url: entry.info.url, authProvider: adaptOAuthProvider(oauth), fetch: (url, options) => fetch(url, { ...options, signal: options?.signal || AbortSignal.timeout(CALL_MS) }) }));
        const listed = await client.listTools();
        const names = new Set();
        const tools = listed.map((tool) => {
          const name = `mcp__${entry.info.id}__${tool.name}`.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 64);
          if (names.has(name)) throw new Error("Connector tool names collide");
          names.add(name);
          return { name, label: tool.title || tool.name, description: tool.description || tool.name,
            parameters: Type.Unsafe({ ...tool.inputSchema, type: "object", properties: tool.inputSchema?.properties || {} }),
            connectorReadOnly: tool.annotations?.readOnlyHint === true,
            replay: tool.annotations?.readOnlyHint === true ? "safe" : "unsafe",
            execute: async (args, api) => {
              try {
                const result = await client.callTool(tool.name, args, { signal: api.signal, timeoutMs: CALL_MS });
                return { output: toLlmContent(result), isError: result.isError === true };
              } catch (error) { return { output: [{ type: "text", text: `Connector call failed: ${String(error?.message || error).slice(0, 200)}` }], isError: true }; }
            } };
        });
        if (!entry.authorized) { await client.close(); return; }
        const old = entry.client; entry.client = client; entry.tools = tools; entry.status = "on";
        client.onClose(() => { if (entry.client === client && entry.authorized) { entry.status = "error"; entry.error = "Connector connection closed"; } });
        this.agent.runtime.refreshConnectors?.();
        if (old) await old.close().catch(() => {});
      } catch (error) {
        console.error(`[agent] connector ${entry.info.id} could not connect: ${error?.name}: ${error?.message}`);
        await client?.close().catch(() => {});
        if (entry.authorized) { entry.status = "error"; entry.error = "Connector connection failed"; }
      }
    })().finally(() => { entry.connecting = null; });
    return entry.connecting;
  }
  async begin(id, origin, returnTo) {
    const entry = this.entry(id);
    const state = randomBytes(32).toString("hex");
    const redirectUrl = `${origin}/v0/agent/connectors/${id}/callback`;
    let data = await this.read(entry).catch(() => undefined);
    // Sign-in comes back to the hub at the address the person's client uses (another machine's is another address).
    // A client registered for a different one would be refused there: register again for this one.
    const { clientInformation, ...rest } = data || {};
    data = { ...rest, ...(clientInformation && data.redirectUrl === redirectUrl ? { clientInformation } : {}), serverUrl: entry.info.url, oauthState: state };
    const store = { load: () => data, save: (next) => { data = next; } };
    let authorizationUrl;
    const provider = this.provider(entry, redirectUrl, store, (url) => { authorizationUrl = String(url); });
    await authorizeMcp(provider, { serverUrl: entry.info.url, scope: "mcp offline_access", resourceMetadataUrl: new URL(entry.info.resourceMetadata), skipRefresh: true, signal: AbortSignal.timeout(15000) });
    if (!authorizationUrl) throw new Error("Connector did not provide an authorization URL");
    for (const [key, pending] of this.pending) if (pending.id === id || pending.expires <= Date.now()) this.pending.delete(key);
    this.pending.set(state, { id, provider, data: () => data, redirectUrl, returnTo, expires: Date.now() + 600000 });
    return authorizationUrl;
  }
  /** iss: the authorization response's issuer (RFC 9207), checked against the server's when it says it sends one. */
  async finish(id, state, code, iss) {
    const pending = this.pending.get(state);
    if (!pending || pending.id !== id || pending.expires <= Date.now() || typeof code !== "string" || !code) {
      if (pending?.expires <= Date.now()) this.pending.delete(state);
      throw Object.assign(new Error("Invalid authorization state"), { status: 400 });
    }
    this.pending.delete(state);
    const entry = this.entry(id);
    await authorizeMcp(pending.provider, { serverUrl: entry.info.url, authorizationCode: code, iss: typeof iss === "string" ? iss : undefined,
      resourceMetadataUrl: new URL(entry.info.resourceMetadata), signal: AbortSignal.timeout(15000) });
    await this.write(entry, { ...pending.data(), redirectUrl: pending.redirectUrl });
    await this.connect(entry);
    return pending.returnTo;
  }
  async disconnect(id) {
    const entry = this.entry(id); entry.authorized = false;
    for (const [key, pending] of this.pending) if (pending.id === id) this.pending.delete(key);
    if (entry.connecting) await entry.connecting;
    const client = entry.client; entry.client = null; entry.tools = []; entry.status = "off"; delete entry.error;
    this.agent.runtime.refreshConnectors?.();
    await client?.close().catch(() => {});
    await fs.unlink(this.file(entry)).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}
