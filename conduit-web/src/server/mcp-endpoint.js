import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { BrowserTool } from "./browser-host.js";
import { UiTool } from "./ui-control.js";
import { mcpAccess } from "./mcp-access.js";

/*
 * Conduit as an MCP server (roadmap #11): the `ui` and `browser` tools Conduit's own agents have, for every other
 * harness -- Claude Code (given it when Conduit starts one on the hub), Codex and any MCP client (added by hand, from
 * Settings › AI › Tools). Streamable HTTP, stateless: each POST is one JSON-RPC message answered as JSON; there is no
 * server-sent stream, so GET is refused.
 *
 * Who may call it: a Conduit session, as for any route; or the hub's MCP token as a bearer, so a harness need not hold
 * a person's sign-in. The token lives in data/mcp-token (0600), the same across restarts, since Codex's daemon keeps
 * its config longer than this server lives.
 */
const PROTOCOL = "2025-06-18";

export function mcpToken(dataRoot) {
  const file = path.join(dataRoot, "mcp-token");
  try { const token = fs.readFileSync(file, "utf8").trim(); if (token.length >= 32) return token; } catch { /* made below */ }
  const token = crypto.randomBytes(32).toString("base64url");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

/**
 * `beforeAuth`: the bearer's way in, mounted ahead of the sign-in check (anything else falls through to it);
 * `afterAuth`: the same endpoint for a signed-in caller.
 */
export function createMcpEndpoint({ runtime, token, version = "" }) {
  const tools = () => [UiTool(runtime), BrowserTool(runtime)];
  const reply = (id, result) => ({ jsonrpc: "2.0", id, result });
  const fail = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

  const answer = async (message) => {
    const { id, method, params } = message || {};
    if (method === "initialize") {
      return reply(id, { protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : PROTOCOL,
        capabilities: { tools: { listChanged: false } }, serverInfo: { name: "conduit", title: "Conduit", version },
        instructions: "Conduit, the workspace the person is using: see and arrange their panes (ui) and work the hub's browser they share with you (browser)." });
    }
    if (method === "ping") return reply(id, {});
    if (method === "tools/list") {
      return reply(id, { tools: tools().map((tool) => ({ name: tool.name, description: tool.description, inputSchema: JSON.parse(JSON.stringify(tool.parameters)) })) });
    }
    if (method === "tools/call") {
      const tool = tools().find((item) => item.name === params?.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${params?.name}`);
      const result = await tool.execute(params?.arguments || {}, {}, {});
      return reply(id, { content: (result.output || []).map((part) => ({ type: "text", text: part.text ?? "" })), isError: Boolean(result.isError) });
    }
    if (typeof method === "string" && method.startsWith("notifications/")) return null;
    return fail(id, -32601, `Method not found: ${method}`);
  };

  const handle = async (request, response) => {
    const message = request.body;
    if (Array.isArray(message) || !message || typeof message !== "object") return response.status(400).json(fail(null, -32600, "One JSON-RPC message per request"));
    try {
      const out = await answer(message);
      if (out === null || message.id === undefined) return response.status(202).end();
      response.json(out);
    } catch (error) { response.json(fail(message.id, -32603, error?.message || "Internal error")); }
  };
  const refuseGet = (_request, response) => response.status(405).set("Allow", "POST").end();

  const json = express.json({ limit: "256kb" });
  const beforeAuth = express.Router();
  beforeAuth.get("/v0/mcp", (request, response, next) => {
    const bearer = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    return bearer && safeEqual(bearer, token) ? refuseGet(request, response) : next();
  });
  beforeAuth.post("/v0/mcp", (request, response, next) => {
    const bearer = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!bearer || !safeEqual(bearer, token)) return next();
    json(request, response, (error) => error ? response.status(400).json(fail(null, -32700, "Parse error")) : void handle(request, response));
  });
  const afterAuth = express.Router();
  afterAuth.get("/v0/mcp", refuseGet);
  afterAuth.post("/v0/mcp", (request, response) => void handle(request, response));
  // For a signed-in person adding it to another harness (Settings › AI › Tools): where it is, and Codex's entry.
  afterAuth.get("/v0/mcp/access", (_request, response) => response.set("Cache-Control", "no-store").json({
    url: mcpAccess.url,
    codex: `[mcp_servers.conduit]\nurl = "${mcpAccess.url}"\nhttp_headers = { "Authorization" = "Bearer ${mcpAccess.token}" }\n`,
  }));
  return { beforeAuth, afterAuth };
}
