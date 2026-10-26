import { api } from "../api/client";
import { directRoute, forgetRoute, type Grant } from "../workspace/direct-files";

/**
 * A device's terminal attached on the device itself when it is near (nodes/node-direct.js), as its files are read
 * (direct-files.ts): the hub grants the attach, and the nearest route that proves it is the node is used. The hub
 * offers only routes nobody else on the network can read: this machine, the tailnet, https. Anything else, or any
 * failure before the terminal answers, goes through the hub as before.
 */
const notOnNode = new Set<string>();
const failures = new Map<string, number>();
const RETRY_MS = 2 * 60_000;
const CONNECT_MS = 3000;

export async function directTerminalSocket(
  pty: { id: string; nodeId?: string | null },
  { cols, rows, takeover }: { cols: number; rows: number; takeover: boolean },
): Promise<{ socket: WebSocket; grant: Grant } | null> {
  if (!pty.nodeId || notOnNode.has(pty.id) || Date.now() - (failures.get(pty.id) ?? -Infinity) < RETRY_MS) return null;
  const grant = await api<Grant>(`/v0/ptys/${encodeURIComponent(pty.id)}/direct?origin=${encodeURIComponent(location.origin)}`).catch((error: { error?: string }) => {
    // A hub terminal cannot move to a node; an unavailable node can return.
    if (error?.error === "direct_not_on_node") notOnNode.add(pty.id);
    return null;
  });
  if (!grant) return null;
  try {
    const route = await directRoute(grant);
    if (!route) return null;
    const url = new URL(`${route}/pty`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    // Keep the grant out of the URL and send it before any terminal input.
    socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "attach", grant: grant.token, cols, rows, takeover })), { once: true });
    // A route that answered before may have gone (a laptop moved): not waited on as long as a browser would.
    setTimeout(() => { if (socket.readyState === WebSocket.CONNECTING) socket.close(); }, CONNECT_MS);
    return { socket, grant };
  } catch {
    directTerminalFailed(pty.id, grant);
    return null;
  }
}

export function directTerminalFailed(ptyId: string, grant: Grant) {
  failures.set(ptyId, Date.now());
  forgetRoute(grant);
}
