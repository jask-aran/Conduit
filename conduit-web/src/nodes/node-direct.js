import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import path from "node:path";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { err, FileError } from "@earendil-works/pi-durable/env";
import { installedClientOrigin } from "../native-auth.js";
import { deviceHost } from "../workspace-host.js";
import { readWorkspaceFile, readWorkspaceFileMetadata, resolveInspectorPath } from "../workspace-inspector.js";
import os from "node:os";
import { WebSocketServer } from "ws";
import { PtyOutputBatcher } from "../pty-output-batcher.js";
import { boundProofOf, channelKey, directAddresses, nodeChannel, proofKey, proofOf, verifyGrant } from "./direct.js";
import { decode, encode, HANDLE_METHODS, METHOD_GRANTS } from "./protocol.js";

// The largest file sent, a chunk at a time, and how many are read at once: past either, the hub's way.
const MAX_DIRECT_BYTES = 512 * 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024;
const MAX_READING = 4;
const STATUS = { path_not_found: 404, ENOENT: 404, permission_denied: 403, file_too_large: 413 };
// A terminal's input frame and unsent output, as the hub's terminal socket bounds them (pty-manager.js,
// terminal-stream.js).
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const PENDING_LIMIT = 1024 * 1024;
const dimension = (value, fallback) => {
  const next = Math.trunc(Number(value));
  return Number.isInteger(next) && next >= 1 && next <= 500 ? next : fallback;
};

/**
 * A node answering reads itself, on loopback: what the hub's `GET /v0/projects/:id/file` answers, for a client holding
 * the hub's grant for that place (direct.js). It runs the hub's inspector over this device's disk through `call`, the
 * agent's own guarded environment call, so a grant reaches no further than the hub's calls do: the place must be a
 * shared root, the path inside it, and kept-back files stay kept back.
 */
export function serveDirect({ secret, ptySecret = null, call, log = console, certificate = null, shells = null }) {
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
  let offered = { at: 0, addresses: new Map() };
  const reachOf = (address) => {
    if (Date.now() - offered.at > 10_000) offered = { at: Date.now(), addresses: new Map(directAddresses(os.networkInterfaces()).map((item) => [item.address, item.reach])) };
    return offered.addresses.get(address) || null;
  };
  const isOffered = (address) => Boolean(reachOf(address));
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
      // Bound to where it was reached, as the client checks it; unbound as well, for v0.8.7 clients' reads.
      const key = proofKey(secret(), nonce);
      const where = `${request.socket.encrypted ? String(request.socket.servername || "").toLowerCase() : arrivedAt}:${request.socket.localPort}`;
      return json(200, { ok: true, proof: proofOf(key, challenge), bound: boundProofOf(key, challenge, where) });
    }
    if (request.method !== "GET" || url.pathname !== "/file") return json(404, { error: "not_found" });
    const grant = verifyGrant(secret(), String(request.headers.authorization || "").replace(/^Bearer\s+/i, ""));
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
        // Sent a chunk at a time through the node's own guarded reader, confined to the grant's place: the node holds
        // a chunk per read, not the file, and the first bytes go out as soon as they are read.
        const stop = new AbortController();
        request.on("close", () => { if (!response.writableEnded) stop.abort(); });
        const context = withAbortSignal(stop.signal, BACKGROUND_CONTEXT);
        const opened = await call("openBinaryReader", [resolved.relativePath, {}], grant.place, context, () => {}, { confine: true });
        if (!opened?.ok) throw Object.assign(new Error(opened?.error?.message || "That file could not be read"), { code: opened?.error?.code || "permission_denied" });
        const name = encodeURIComponent(path.basename(resolved.relativePath));
        let sent = 0;
        try {
          response.writeHead(200, {
            "Content-Type": metadata.mime, "Content-Length": metadata.size, ETag: etag, "Cache-Control": "private, no-cache",
            "X-Content-Type-Options": "nosniff", "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${name}`,
            ...(metadata.mime === "image/svg+xml" ? { "Content-Security-Policy": "sandbox" } : {}),
          });
          while (sent < metadata.size && !stop.signal.aborted) {
            const chunk = await opened.value.read(sent, Math.min(CHUNK_BYTES, metadata.size - sent), context);
            if (!chunk.ok || !chunk.value.length) break;
            if (!response.write(Buffer.from(chunk.value.buffer, chunk.value.byteOffset, chunk.value.length))) {
              await new Promise((resolve) => {
                const done = () => { response.off("drain", done); response.off("close", done); resolve(); };
                response.on("drain", done);
                response.on("close", done);
              });
            }
            sent += chunk.value.length;
          }
        } finally {
          await opened.value.close?.(BACKGROUND_CONTEXT);
        }
        // Shorter than it said (changed as it was read): the client sees a broken response, never a short file.
        return sent < metadata.size ? response.destroy() : response.end();
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
  /*
   * Terminals attached here directly (plan: direct terminals): a WebSocket at `/pty`, sealed end to end. The client's
   * first frame names the grant's nonce; from then every frame both ways is sealed under the key the hub gave the
   * client and this node works out from that nonce (direct.js `nodeChannel`), the grant itself included. Someone on the
   * network between them, or passing the frames on, can neither read nor change them; a frame that does not open ends
   * the socket. Inside, it speaks what the hub's terminal socket speaks (terminal-stream.js), so a client cannot tell
   * which way it is attached. `shells` keeps who holds each terminal, the hub's clients included (node-agent.js).
   * Keys come from `ptySecret()`, the one this run of the node gave the hub over a link nobody else reads; none, and
   * no terminal is attached here.
   */
  const sockets = shells ? new WebSocketServer({ noServer: true, maxPayload: MAX_INPUT_BYTES + 64 }) : null;
  // A grant attaches once: its nonce is kept until it would have run out anyway.
  const spent = new Map();
  // Sockets not yet attached: few, small and brief, since anyone who reaches the port may open one.
  let unattached = 0;
  const JSON_FRAME = 0;
  const BYTES_FRAME = 1;
  const attachHere = (ws, origin) => {
    let channel = null;
    let nonce = "";
    const send = (message) => { if (channel && ws.readyState === ws.OPEN) ws.send(channel.seal(JSON_FRAME, Buffer.from(JSON.stringify(message)))); };
    const refuse = (code, message, close) => { send({ type: "client_error", code, message }); ws.close(close, code); };
    const output = new PtyOutputBatcher((_id, bytes) => {
      if (ws.readyState !== ws.OPEN) return;
      if (ws.bufferedAmount > PENDING_LIMIT) return ws.close(1013, "Terminal client is too slow");
      ws.send(channel.seal(BYTES_FRAME, bytes));
    });
    // A client that stops answering (a laptop asleep, a network gone) lets go of the terminal within a minute.
    let answered = true;
    ws.on("pong", () => { answered = true; });
    const beat = setInterval(() => {
      if (!answered) return ws.terminate();
      answered = false;
      try { ws.ping(); } catch {}
    }, 20_000);
    beat.unref?.();
    let shell = null;
    let waiting = true;
    unattached += 1;
    const settle = () => { if (waiting) { waiting = false; unattached -= 1; clearTimeout(timer); } };
    const timer = setTimeout(() => ws.close(1008, "attach_expected"), 5000);
    ws.on("message", (data, isBinary) => {
      if (!channel) {
        // The nonce in the clear (it is no secret; the key it names is): from here on, only sealed frames.
        let frame = null;
        try { frame = isBinary || data.length > 1024 ? null : JSON.parse(String(data)); } catch {}
        const key = ptySecret?.();
        nonce = typeof frame?.nonce === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(frame.nonce) ? frame.nonce : "";
        if (frame?.type !== "seal" || !nonce || !key) return ws.close(4001, "direct_grant_invalid");
        channel = nodeChannel(channelKey(key, nonce));
        return;
      }
      const opened = isBinary ? channel.open(Buffer.isBuffer(data) ? data : Buffer.from(data)) : null;
      if (!opened) return ws.close(4001, "unsealed");
      if (waiting) {
        settle();
        let attach = null;
        try { attach = opened.kind === JSON_FRAME && opened.body.length <= 8192 ? JSON.parse(String(opened.body)) : null; } catch {}
        const grant = attach?.type === "attach" ? verifyGrant(ptySecret(), attach.grant, Date.now(), "pty") : null;
        // The key is the grant's own: a sealed channel for one grant never carries another. A page only by the origin
        // the grant names (nothing like CORS holds a WebSocket back); the apps by theirs.
        if (!grant || grant.nonce !== nonce || (origin && !installedClientOrigin(origin) && grant.origin !== origin)) {
          return refuse("direct_grant_invalid", "This terminal needs a grant from the hub", 4001);
        }
        const now = Date.now();
        for (const [used, expires] of spent) if (expires <= now) spent.delete(used);
        if (spent.has(grant.nonce)) return refuse("direct_grant_invalid", "That grant was already used", 4001);
        spent.set(grant.nonce, grant.expires);
        const attached = shells.attach(grant.pty, { takeover: attach.takeover === true, cols: dimension(attach.cols, 80), rows: dimension(attach.rows, 24) }, (event) => {
          if (event.kind === "data") return output.append("pty", event.bytes);
          output.flushAll();
          if (event.kind === "exit") {
            send({ type: "status", status: "exited", exitCode: event.code ?? null, signal: event.signal ?? null });
            send({ type: "control", writable: false });
            return ws.close(1000, "Terminal exited");
          }
          if (event.kind === "taken") refuse("pty_taken_over", "Another Conduit client took control of this terminal", 4010);
        });
        if (attached.error) return refuse(attached.error, attached.message, attached.error === "pty_in_use" ? 4009 : 1011);
        shell = attached;
        if (ws.readyState !== ws.OPEN) return shell.detach();
        send({ type: "status", status: "running", exitCode: null, signal: null });
        send({ type: "control", writable: true });
        return;
      }
      if (!shell) return;
      try {
        // Output so far goes out before input that may change the screen, as on the hub.
        output.flushAll();
        if (opened.kind === BYTES_FRAME) return shell.write(opened.body);
        const command = JSON.parse(String(opened.body));
        if (command.type !== "resize") throw Object.assign(new Error("Unknown terminal control frame"), { code: "pty_control_invalid" });
        shell.resize(dimension(command.cols, 80), dimension(command.rows, 24));
      } catch (error) {
        send({ type: "client_error", code: error.code || "pty_control_invalid", message: error.message || "Terminal control failed" });
      }
    });
    ws.on("close", () => { settle(); clearInterval(beat); output.flushAll(); shell?.detach(); });
    ws.on("error", () => {});
  };
  // On loopback and the addresses offered (its networks', its tailnet's), over http or https: the channel is sealed
  // whichever way it comes.
  const upgrade = (request, socket, head) => {
    const arrivedAt = String(request.socket.localAddress || "").replace(/^::ffff:/, "");
    if (!/^127\./.test(arrivedAt) && arrivedAt !== "::1" && !isOffered(arrivedAt)) return socket.destroy();
    if (!sockets || new URL(request.url || "/", "http://127.0.0.1").pathname !== "/pty") return socket.destroy();
    if (unattached >= 16) return socket.destroy();
    const origin = typeof request.headers.origin === "string" ? request.headers.origin : "";
    sockets.handleUpgrade(request, socket, head, (ws) => attachHere(ws, origin));
  };

  const server = http.createServer(answer);
  server.on("upgrade", upgrade);
  // Every IPv4 interface, answered only on loopback and the addresses offered (above); nothing is read without the
  // hub's grant whichever way it comes in.
  const listening = new Promise((resolve) => server.listen(0, "0.0.0.0", () => resolve(server.address().port)));
  server.on("error", (error) => log.warn?.(`[conduit-node] direct reads: ${error.message}`));
  // And over https, for pages (which may not read plain HTTP), under any name this machine has a certificate a browser
  // trusts for: its tailnet name, from Tailscale (renewed daily), and its name on this network, from the hub
  // (lan-names.js). One port; the name a client asks for picks the certificate.
  const contexts = new Map();
  let secure = null;
  let securePort = null;
  let changed = () => {};
  const startSecure = () => {
    if (secure) return secure.port;
    const server = https.createServer({ SNICallback: (name, done) => done(null, contexts.get(String(name).toLowerCase()) ?? null) }, answer);
    server.on("upgrade", upgrade);
    server.on("error", (error) => log.warn?.(`[conduit-node] direct reads over https: ${error.message}`));
    secure = { server, port: new Promise((resolve) => server.listen(0, "0.0.0.0", () => resolve(server.address().port))) };
    return secure.port;
  };
  const addCertificate = async ({ name, cert, key }) => {
    contexts.set(String(name).toLowerCase(), tls.createSecureContext({ cert, key }));
    securePort = await startSecure();
    changed();
  };
  // Asked again daily once it has one, and every ten minutes until then: Tailscale may come up after the node does
  // (a machine just started), or its HTTPS setting be turned on later.
  let renew = null;
  const tailnet = async () => {
    const found = await certificate?.().catch(() => null);
    if (found) await addCertificate(found).catch((error) => log.warn?.(`[conduit-node] ${error.message}`));
    if (!certificate) return;
    renew = setTimeout(() => void tailnet(), found ? 24 * 3600_000 : 10 * 60_000);
    renew.unref?.();
  };
  void tailnet();
  return {
    listening,
    addCertificate,
    /** Where it answers over https, and under which names: null until it has a certificate. */
    secureRoute: () => (securePort && contexts.size ? { port: securePort, names: [...contexts.keys()] } : null),
    onSecureChange: (fn) => { changed = fn; },
    close: () => { server.close(); secure?.server?.close(); sockets?.close(); clearTimeout(renew); },
  };
}
