import http from "node:http";
import { Duplex } from "node:stream";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { ExecutionError, FileError } from "@earendil-works/pi-durable/env";
import { decode, encode } from "./protocol.js";

let tunnels = 0;

/**
 * A byte stream to an endpoint on a device, as `net.connect` gives one here:
 * for a harness that serves its own clients locally -- Codex's daemon socket,
 * OpenCode's loopback service -- so main's adapter connects to it as it would
 * on this machine. `endpoint` is `{ harness }` for the harness's own socket, or
 * `{ port }` on the device's loopback; the device decides what it allows.
 *
 * It lives on one connection to the device: a dropped socket ends it, as a
 * dropped network connection would, and the adapter reconnects as it does.
 * A refused or missing endpoint fails with the code `net` would give
 * (`ECONNREFUSED`, `ENOENT`), so adapters that start a daemon on it still do.
 */
export function tunnelTo(hub, nodeId, endpoint) {
  const node = hub.live.get(nodeId);
  const id = `t${++tunnels}`;
  const key = `${nodeId} ${id}`;
  let open = false;
  const send = (message) => node?.send({ type: "tunnel", tunnel: id, ...message });
  const stream = new Duplex({
    read() {},
    write(chunk, _encoding, done) {
      opened.then(() => { send({ data: Buffer.from(chunk).toString("base64") }); done(); }, done);
    },
    final(done) { opened.then(() => { send({ end: true }); done(); }, () => done()); },
    destroy(cause, done) {
      hub.tunnels.delete(key);
      if (open) send({ end: true });
      done(cause);
    },
  });
  // What sockets offer and HTTP clients call; nothing to tune across the tunnel.
  Object.assign(stream, { setNoDelay() { return stream; }, setKeepAlive() { return stream; }, setTimeout() { return stream; },
    ref() { return stream; }, unref() { return stream; } });
  hub.tunnels.set(key, {
    nodeSocket: node?.socket,
    deliver(message) {
      if (message.data) stream.push(Buffer.from(message.data, "base64"));
      if (message.end) { open = false; stream.push(null); }
    },
    drop() { open = false; stream.destroy(Object.assign(new Error("The device disconnected"), { code: "ECONNRESET" })); },
  });
  const opened = (async () => {
    if (!node?.ready) throw Object.assign(new Error("The device is offline"), { code: "ECONNREFUSED" });
    const result = decode(await hub.call(nodeId, { target: "tunnel", method: "open", args: encode([id, endpoint]), cwd: null },
      withAbortSignal(AbortSignal.timeout(15_000), BACKGROUND_CONTEXT)), { FileError, ExecutionError });
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    if (result.value?.error) throw Object.assign(new Error(result.value.error.message), { code: result.value.error.code });
    open = true;
    stream.emit("connect");
  })();
  opened.catch((cause) => stream.destroy(cause));
  return stream;
}

/**
 * `fetch` to a loopback HTTP service on a device, through a tunnel: what an
 * adapter needs of a Response -- `ok`, `status`, `text()`, `json()`, and
 * `body` to read a stream from.
 */
export function fetchOnDevice(hub, nodeId, url, { method = "GET", headers = {}, body, signal } = {}) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = http.request({
      method, path: `${target.pathname}${target.search}`, headers: { ...headers, host: target.host },
      createConnection: () => tunnelTo(hub, nodeId, { port: Number(target.port) || 80 }),
    }, (response) => {
      const read = async () => { const chunks = []; for await (const chunk of response) chunks.push(chunk); return Buffer.concat(chunks).toString("utf8"); };
      resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode,
        body: response, text: read, json: async () => JSON.parse(await read()) });
    });
    const abort = () => request.destroy(Object.assign(new Error("aborted"), { name: "AbortError" }));
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    request.once("error", (cause) => reject(Object.assign(new TypeError("fetch failed"), { cause })));
    request.end(body);
  });
}
