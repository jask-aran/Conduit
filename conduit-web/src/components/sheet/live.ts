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
      if (bytes[0] !== FRAME.update) return;
      Y.applyUpdate(doc, bytes.subarray(1), hub);
      tries = 0;
      setState("live");
      setSynced(true);
    };
    next.onclose = (event) => { if (event.code !== STALE) return again(); over = true; setState("stale"); };
  };
  doc.on("update", (update: Uint8Array, origin: unknown) => { if (origin !== hub) send(FRAME.update, update); });
  void connect();
  onCleanup(() => { over = true; clearTimeout(retry); socket?.close(); doc.destroy(); });
  return { doc, state, synced };
}
