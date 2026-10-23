import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { err, FileError } from "@earendil-works/pi-durable/env";
import { installedClientOrigin } from "../native-auth.js";
import { deviceHost } from "../workspace-host.js";
import { readWorkspaceFile, readWorkspaceFileMetadata, resolveInspectorPath } from "../workspace-inspector.js";
import os from "node:os";
import { directAddresses, proofKey, proofOf, verifyGrant } from "./direct.js";
import { decode, encode, HANDLE_METHODS, METHOD_GRANTS } from "./protocol.js";

// A file read whole to answer one request, and how many are read at once: past either, the hub's way.
const MAX_DIRECT_BYTES = 64 * 1024 * 1024;
const MAX_READING = 4;
const STATUS = { path_not_found: 404, ENOENT: 404, permission_denied: 403, file_too_large: 413 };

/**
 * A node answering reads itself, on loopback: what the hub's `GET /v0/projects/:id/file` answers, for a client holding
 * the hub's grant for that place (direct.js). It runs the hub's inspector over this device's disk through `call`, the
 * agent's own guarded environment call, so a grant reaches no further than the hub's calls do: the place must be a
 * shared root, the path inside it, and kept-back files stay kept back.
 */
export function serveDirect({ secret, call, log = console, certificate = null }) {
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
      // A grant is to read: nothing that writes, runs or watches is reached this way, and nothing outside its place.
      if (METHOD_GRANTS[method]?.grant !== "read" || method === "watch") return encode(err(new FileError("permission_denied", `${method} is not a read`)));
      const value = await call(method, decode(args, { FileError }), cwd, context, () => {}, { confine: true });
      if (value?.ok && value.value && typeof value.value.close === "function") {
        const id = `h_${crypto.randomUUID()}`;
        held.set(id, value.value);
        return encode({ ok: true, value: { $handle: id } });
      }
      return encode(value);
    },
  });

  // Answered on loopback and the addresses offered (its networks', its tailnet's) only: never on a public one. Read
  // as each request comes, since a laptop's addresses change, and kept a moment.
  let offered = { at: 0, addresses: new Set() };
  const isOffered = (address) => {
    if (Date.now() - offered.at > 10_000) offered = { at: Date.now(), addresses: new Set(directAddresses(os.networkInterfaces()).map((item) => item.address)) };
    return offered.addresses.has(address);
  };
  let reading = 0;
  const answer = async (request, response) => {
    const arrivedAt = String(request.socket.localAddress || "").replace(/^::ffff:/, "");
    if (!/^127\./.test(arrivedAt) && arrivedAt !== "::1" && !isOffered(arrivedAt)) return request.socket.destroy();
    // The apps' origins are let in; a page's only with a grant that names it (below), and to the challenge.
    const asked = typeof request.headers.origin === "string" ? request.headers.origin : "";
    const letIn = (origin) => {
      if (!origin) return;
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Expose-Headers", "ETag");
    };
    letIn(installedClientOrigin(asked));
    if (request.method === "OPTIONS") {
      // Asked before any grant is shown: what the GET may send. Whether it may read the answer is the GET's to say.
      if (asked && !response.hasHeader("Access-Control-Allow-Origin")) letIn(asked);
      response.writeHead(asked ? 204 : 403, {
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
    // Whether this is the node a grant was for: its answer to the client's challenge, with the grant's nonce. Says
    // nothing about the node to anyone without the hub's word for it.
    if (request.method === "GET" && url.pathname === "/health") {
      const nonce = url.searchParams.get("n");
      const challenge = url.searchParams.get("c");
      if (asked && !response.hasHeader("Access-Control-Allow-Origin")) letIn(asked);
      if (!nonce || !challenge || nonce.length > 64 || challenge.length > 128) return json(200, { ok: true });
      return json(200, { ok: true, proof: proofOf(proofKey(secret, nonce), challenge) });
    }
    if (request.method !== "GET" || url.pathname !== "/file") return json(404, { error: "not_found" });
    const grant = verifyGrant(secret, String(request.headers.authorization || "").replace(/^Bearer\s+/i, ""));
    if (!grant) return json(401, { error: "direct_grant_invalid", message: "This read needs a grant from the hub" });
    if (asked && grant.origin === asked && !response.hasHeader("Access-Control-Allow-Origin")) letIn(asked);
    const relative = url.searchParams.get("path");
    if (!relative) return json(400, { error: "workspace_path_required" });
    if (reading >= MAX_READING) return json(503, { error: "direct_busy", message: "This device is busy; read through the hub" });
    reading += 1;
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
        const content = await resolved.host.read(resolved.relativePath, MAX_DIRECT_BYTES + 1);
        if (content.length > MAX_DIRECT_BYTES) return json(413, { error: "file_too_large", message: "That file is too large to open here" });
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
      reading -= 1;
      for (const handle of held.values()) void handle.close?.(BACKGROUND_CONTEXT);
    }
  };
  const server = http.createServer(answer);
  // Every IPv4 interface, answered only on loopback and the addresses offered (above); nothing is read without the
  // hub's grant whichever way it comes in.
  const listening = new Promise((resolve) => server.listen(0, "0.0.0.0", () => resolve(server.address().port)));
  server.on("error", (error) => log.warn?.(`[conduit-node] direct reads: ${error.message}`));
  // And over https where this machine has a certificate a browser trusts (its tailnet name), for pages, which may not
  // read plain HTTP: the same answers on a port of its own. Renewed daily; resolves to { name, port } or null.
  let secure = null;
  let renew = null;
  const secured = (async () => {
    const first = await certificate?.().catch(() => null);
    if (!first) return null;
    secure = https.createServer({ cert: first.cert, key: first.key }, answer);
    secure.on("error", (error) => log.warn?.(`[conduit-node] direct reads over https: ${error.message}`));
    renew = setInterval(async () => {
      const next = await certificate().catch(() => null);
      if (next) secure.setSecureContext({ cert: next.cert, key: next.key });
    }, 24 * 3600_000);
    renew.unref?.();
    const port = await new Promise((resolve) => secure.listen(0, "0.0.0.0", () => resolve(secure.address().port)));
    return { name: first.name, port };
  })();
  return { listening, secured, close: () => { server.close(); secure?.close(); clearInterval(renew); } };
}
