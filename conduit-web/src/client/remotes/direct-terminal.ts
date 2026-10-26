import { api } from "../api/client";
import { directRoute, forgetRoute, type Grant } from "../workspace/direct-files";

/**
 * A device's terminal attached on the device itself when it is near (nodes/node-direct.js), as its files are read
 * (direct-files.ts): the hub grants the attach, and the nearest route that proves it is the node is used -- this
 * machine, its LAN, its tailnet. The channel is sealed end to end with the key the hub gives with the grant
 * (nodes/direct.js `channelKey`), so a LAN in plain HTTP is as private as the hub's own connection: nobody between
 * this client and the node can read or change what is typed or shown, the grant included. Anything else, or any
 * failure before the terminal answers, goes through the hub as before.
 */
type TerminalGrant = Grant & { channel: string };
const notOnNode = new Set<string>();
const failures = new Map<string, number>();
const RETRY_MS = 2 * 60_000;
const CONNECT_MS = 3000;

export async function directTerminalSocket(
  pty: { id: string; nodeId?: string | null },
  { cols, rows, takeover }: { cols: number; rows: number; takeover: boolean },
): Promise<{ socket: WebSocket; grant: Grant } | null> {
  if (!pty.nodeId || notOnNode.has(pty.id) || Date.now() - (failures.get(pty.id) ?? -Infinity) < RETRY_MS) return null;
  // Sealing needs WebCrypto, which a page has only in a secure context (https, localhost); the apps always do.
  if (!globalThis.crypto?.subtle) return null;
  const grant = await api<TerminalGrant>(`/v0/ptys/${encodeURIComponent(pty.id)}/direct?origin=${encodeURIComponent(location.origin)}`).catch((error: { error?: string }) => {
    // A hub terminal cannot move to a node; an unavailable node can return.
    if (error?.error === "direct_not_on_node") notOnNode.add(pty.id);
    return null;
  });
  if (!grant?.channel) return null;
  try {
    const route = await directRoute(grant);
    if (!route) return null;
    const url = new URL(`${route}/pty`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new SealedSocket(new WebSocket(url), grant, { type: "attach", grant: grant.token, cols, rows, takeover });
    return { socket: socket as unknown as WebSocket, grant };
  } catch {
    directTerminalFailed(pty.id, grant);
    return null;
  }
}

export function directTerminalFailed(ptyId: string, grant: Grant) {
  failures.set(ptyId, Date.now());
  forgetRoute(grant);
}

const JSON_FRAME = 0;
const BYTES_FRAME = 1;
const TO_NODE = 1;
const TO_CLIENT = 2;
const ivFor = (direction: number, count: number) => {
  const iv = new DataView(new ArrayBuffer(12));
  iv.setUint32(0, direction);
  iv.setBigUint64(4, BigInt(count));
  return iv.buffer;
};

/**
 * What the terminal pane uses of a WebSocket, sealed: text frames are its JSON, binary frames its bytes, as on the
 * hub's socket; underneath, every frame is AES-GCM under the grant's channel key, counted each way, so one that was
 * changed, replayed or moved does not open and ends the connection. Sealing and opening are WebCrypto's and so
 * asynchronous: each direction is a queue, so frames keep their order.
 */
class SealedSocket {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  binaryType = "arraybuffer";
  private ready = false;
  private sent = 0;
  private received = 0;
  private sending: Promise<unknown> = Promise.resolve();
  private receiving: Promise<unknown> = Promise.resolve();
  private readonly key: Promise<CryptoKey>;

  constructor(private readonly inner: WebSocket, grant: TerminalGrant, attach: object) {
    const raw = Uint8Array.from(atob(grant.channel.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
    this.key = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    inner.binaryType = "arraybuffer";
    inner.onopen = (event) => {
      // The grant's nonce names the key; the grant itself goes sealed, before anything the pane sends.
      inner.send(JSON.stringify({ type: "seal", nonce: grant.nonce }));
      this.enqueue(JSON_FRAME, new TextEncoder().encode(JSON.stringify(attach)));
      this.ready = true;
      this.onopen?.(event);
    };
    inner.onmessage = (event) => {
      if (typeof event.data === "string") return this.fail();
      const frame = event.data as ArrayBuffer;
      const count = this.received++;
      this.receiving = this.receiving.then(async () => {
        const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivFor(TO_CLIENT, count) }, await this.key, frame));
        const body = plain.subarray(1);
        this.onmessage?.({ data: plain[0] === JSON_FRAME ? new TextDecoder().decode(body) : body.slice().buffer });
      }).catch(() => this.fail());
    };
    inner.onerror = (event) => this.onerror?.(event);
    // Frames still opening are handed over before the close is.
    inner.onclose = (event) => { void this.receiving.then(() => this.onclose?.(event)); };
    // A route that answered before may have gone (a laptop moved): not waited on as long as a browser would.
    setTimeout(() => { if (inner.readyState === WebSocket.CONNECTING) inner.close(); }, CONNECT_MS);
  }

  get readyState() { return this.ready || this.inner.readyState !== WebSocket.OPEN ? this.inner.readyState : WebSocket.CONNECTING; }

  send(data: string | ArrayBufferView | ArrayBuffer) {
    if (typeof data === "string") return this.enqueue(JSON_FRAME, new TextEncoder().encode(data));
    const view = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.enqueue(BYTES_FRAME, view);
  }

  close(code?: number, reason?: string) { this.inner.close(code, reason); }

  private enqueue(kind: number, body: Uint8Array) {
    const count = this.sent++;
    const plain = new Uint8Array(body.length + 1);
    plain[0] = kind;
    plain.set(body, 1);
    this.sending = this.sending.then(async () => {
      const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv: ivFor(TO_NODE, count) }, await this.key, plain);
      if (this.inner.readyState === WebSocket.OPEN) this.inner.send(sealed);
    }).catch(() => this.fail());
  }

  // Something on the way changed a frame, or it was not the node: the pane sees a closed connection (and goes
  // through the hub if the terminal had not answered yet).
  private fail() { if (this.inner.readyState === WebSocket.OPEN || this.inner.readyState === WebSocket.CONNECTING) this.inner.close(4001, "unsealed"); }
}
