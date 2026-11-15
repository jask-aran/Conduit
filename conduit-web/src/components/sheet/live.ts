import { createSignal, onCleanup } from "solid-js";
import * as Y from "yjs";
import { FRAME, frame } from "@/document-format.js";
import { SHEET_FORMAT } from "@/sheet-format.js";
import type { SheetHost, SheetState } from "./host";

const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 15_000;
// The close code the hub refuses a page with whose format is not the artifact's (server/documents.js).
const STALE = 4426;

/** The hub's live copy of a sheet over the paper's socket and frames (components/document/live.ts, whose handshake names the paper's format and what it holds): a sheet names SHEET_FORMAT and holds nothing more, and has no seats yet. */
export function createLiveSheet(host: SheetHost, id: string) {
  const doc = new Y.Doc(), hub = Symbol("hub");
  // What the hub made for one of this page's own changes is applied as that change's (history.ts): its step's origin.
  let own: (step: number) => unknown = () => hub;
  const [state, setState] = createSignal<SheetState>("connecting"), [synced, setSynced] = createSignal(false);
  let socket: WebSocket | undefined, retry: ReturnType<typeof setTimeout> | undefined, tries = 0, over = false;
  const send = (kind: number, bytes: Uint8Array) => { if (socket?.readyState === WebSocket.OPEN) socket.send(frame(kind, bytes)); };
  const again = () => {
    if (over) return;
    setState("away");
    clearTimeout(retry);
    retry = setTimeout(() => void connect(), Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** tries));
    tries += 1;
  };
  const connect = async () => {
    const next = await host.socket(id).catch(() => null);
    if (!next || over) { next?.close(); return again(); }
    socket = next;
    next.binaryType = "arraybuffer";
    next.onopen = () => { next.send(JSON.stringify({ client: doc.clientID, name: host.author(), format: SHEET_FORMAT })); send(FRAME.have, Y.encodeStateVector(doc)); };
    next.onmessage = (event) => {
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      if (bytes[0] === FRAME.have) return send(FRAME.update, Y.encodeStateAsUpdate(doc, bytes.subarray(1)));
      if (bytes[0] === FRAME.own) Y.applyUpdate(doc, bytes.subarray(5), own(new DataView(bytes.buffer, 1, 4).getUint32(0, true)));
      else if (bytes[0] === FRAME.update) Y.applyUpdate(doc, bytes.subarray(1), hub);
      else return;
      tries = 0;
      setState("live");
      setSynced(true);
    };
    next.onclose = (event) => { if (event.code !== STALE) return again(); over = true; setState("stale"); };
  };
  // Only what was made here goes to the hub: a step's origin is the hub's update too.
  doc.on("update", (update: Uint8Array, _: unknown, __: Y.Doc, transaction: Y.Transaction) => { if (transaction.local) send(FRAME.update, update); });
  void connect();
  onCleanup(() => { over = true; clearTimeout(retry); socket?.close(); doc.destroy(); });
  return { doc, state, synced, own: (origin: (step: number) => unknown) => { own = origin; } };
}
