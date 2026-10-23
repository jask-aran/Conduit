import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { err, FileError } from "@earendil-works/pi-durable/env";
import { installedClientOrigin } from "../native-auth.js";
import { deviceHost } from "../workspace-host.js";
import { readWorkspaceFile, readWorkspaceFileMetadata, resolveInspectorPath } from "../workspace-inspector.js";
import { directId, verifyGrant } from "./direct.js";
import { decode, encode, HANDLE_METHODS, METHOD_GRANTS } from "./protocol.js";

// A file read whole to answer one request: past this, the hub's way (which caps lower still) is no worse.
const MAX_DIRECT_BYTES = 256 * 1024 * 1024;
const STATUS = { path_not_found: 404, ENOENT: 404, permission_denied: 403, file_too_large: 413 };

/**
 * A node answering reads itself, on loopback: what the hub's `GET /v0/projects/:id/file` answers, for a client holding
 * the hub's grant for that place (direct.js). It runs the hub's inspector over this device's disk through `call`, the
 * agent's own guarded environment call, so a grant reaches no further than the hub's calls do: the place must be a
 * shared root, the path inside it, and kept-back files stay kept back.
 */
export function serveDirect({ secret, call, log = console }) {
  // The agent's calls, as the hub's execution environment would make them over the socket; readers opened for one
  // request are that request's, and closed with it.
  const local = (held) => ({
    live: new Map([["self", { ready: true }]]),
    async call(_nodeId, { target, method, args, cwd }, context) {
      if (target !== "env") {
        const handle = held.get(target);
        if (!handle || !HANDLE_METHODS.includes(method)) return encode(err(new FileError("invalid", `No open handle ${target}`)));
        const value = await handle[method](...decode(args, { FileError }), context);
        if (method === "close") held.delete(target);
        return encode(value);
      }
      // A grant is to read: nothing that writes, runs or watches is reached this way.
      if (METHOD_GRANTS[method]?.grant !== "read" || method === "watch") return encode(err(new FileError("permission_denied", `${method} is not a read`)));
      const value = await call(method, decode(args, { FileError }), cwd, context, () => {});
      if (value?.ok && value.value && typeof value.value.close === "function") {
        const id = `h_${crypto.randomUUID()}`;
        held.set(id, value.value);
        return encode({ ok: true, value: { $handle: id } });
      }
      return encode(value);
    },
  });

  const server = http.createServer(async (request, response) => {
    const origin = installedClientOrigin(request.headers.origin);
    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Expose-Headers", "ETag");
    }
    if (request.method === "OPTIONS") {
      response.writeHead(origin ? 204 : 403, {
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Headers": "authorization, if-none-match",
        // A page reaching loopback is asked about first (Private Network Access).
        "Access-Control-Allow-Private-Network": "true",
        "Access-Control-Max-Age": "600",
      });
      return response.end();
    }
    const json = (status, body) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); };
    const url = new URL(request.url || "/", "http://127.0.0.1");
    // Which node this is, for a client choosing among its addresses; no grant needed to ask.
    if (request.method === "GET" && url.pathname === "/health") return json(200, { ok: true, id: directId(secret) });
    if (request.method !== "GET" || url.pathname !== "/file") return json(404, { error: "not_found" });
    const grant = verifyGrant(secret, String(request.headers.authorization || "").replace(/^Bearer\s+/i, ""));
    if (!grant) return json(401, { error: "direct_grant_invalid", message: "This read needs a grant from the hub" });
    const relative = url.searchParams.get("path");
    if (!relative) return json(400, { error: "workspace_path_required" });
    const held = new Map();
    try {
      const root = deviceHost({ hub: local(held), nodeId: "self", place: grant.place, label: grant.label || "" });
      const download = url.searchParams.get("download") === "1";
      if (download || url.searchParams.get("inline") === "1") {
        const resolved = await resolveInspectorPath(root, relative, { kind: "file" });
        const metadata = await readWorkspaceFileMetadata(root, relative);
        const etag = `"${metadata.revision}"`;
        if (request.headers["if-none-match"] === etag) { response.writeHead(304, { ETag: etag }); return response.end(); }
        if (metadata.size > MAX_DIRECT_BYTES) return json(413, { error: "file_too_large", message: "That file is too large to open here" });
        const content = await resolved.host.read(resolved.relativePath);
        const name = encodeURIComponent(path.basename(resolved.relativePath));
        response.writeHead(200, {
          "Content-Type": metadata.mime, "Content-Length": content.length, ETag: etag, "Cache-Control": "private, no-cache",
          "X-Content-Type-Options": "nosniff", "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${name}`,
          ...(metadata.mime === "image/svg+xml" ? { "Content-Security-Policy": "sandbox" } : {}),
        });
        return response.end(content);
      }
      if (url.searchParams.get("metadata") === "1") return json(200, await readWorkspaceFileMetadata(root, relative));
      return json(200, await readWorkspaceFile(root, relative, {
        forceText: url.searchParams.get("force") === "text", preview: url.searchParams.get("preview") === "1",
      }));
    } catch (error) {
      // The hub's error body, so a client cannot tell which way answered.
      if (!response.headersSent) json(error.status || STATUS[error.code] || (error.code ? 400 : 500), {
        error: error.code || "runtime_error", message: error.message, path: error.path, kind: error.kind, mime: error.mime,
        size: error.size, modifiedAt: error.modifiedAt, revision: error.revision, maxBytes: error.maxBytes,
      });
      else response.destroy();
    } finally {
      for (const handle of held.values()) void handle.close?.(BACKGROUND_CONTEXT);
    }
  });
  // Every IPv4 interface: loopback for this machine's app, its networks' and tailnet's addresses for others nearby.
  // Nothing is read without the hub's grant, whichever way it comes in.
  const listening = new Promise((resolve) => server.listen(0, "0.0.0.0", () => resolve(server.address().port)));
  server.on("error", (error) => log.warn?.(`[conduit-node] direct reads: ${error.message}`));
  return { listening, close: () => server.close() };
}
