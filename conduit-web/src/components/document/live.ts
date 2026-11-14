import { createSignal, onCleanup } from "solid-js";
import * as Y from "yjs";
import { FORMAT, FRAME, frame } from "@/document-format.js";
import type { DocumentHost, DocumentState } from "./host";

const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 15_000;

/** The hub's live copy of a document, held here too and merged with it while the socket is up. `synced`: it has held the hub's copy at least once, so it can be shown. */
export function createLiveDocument(host: DocumentHost, id: string) {
  const doc = new Y.Doc(), hub = Symbol("hub");
  const [state, setState] = createSignal<DocumentState>("connecting"), [synced, setSynced] = createSignal(false);
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
    next.onopen = () => { next.send(JSON.stringify({ client: doc.clientID, name: host.author(), format: FORMAT })); send(FRAME.have, Y.encodeStateVector(doc)); };
    next.onmessage = (event) => {
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      if (bytes[0] === FRAME.have) return send(FRAME.update, Y.encodeStateAsUpdate(doc, bytes.subarray(1)));
      Y.applyUpdate(doc, bytes.subarray(1), hub);
      tries = 0;
      setState("live");
      setSynced(true);
    };
    next.onclose = again;
  };
  // What is written while the socket is down is not lost: the next `have` asks for it.
  doc.on("update", (update: Uint8Array, origin: unknown) => { if (origin !== hub) send(FRAME.update, update); });
  void connect();
  onCleanup(() => { over = true; clearTimeout(retry); socket?.close(); doc.destroy(); });
  return { doc, state, synced };
}
