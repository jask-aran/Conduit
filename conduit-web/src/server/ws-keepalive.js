// Conduit is reached through Cloudflare, which closes a WebSocket that has
// carried no frames in either direction for roughly 100 seconds. An idle
// terminal or live session sends nothing at all, so the connection dies on a
// timer and the browser reattaches with a fresh renderer, which reads as a
// spontaneous refresh. Ping frames count as activity and keep the connection
// outside that window; browsers answer them at the protocol level, so no
// client counterpart is needed.
const KEEPALIVE_INTERVAL_MS = 30_000;

export function startWebSocketKeepalive(ws, intervalMs = KEEPALIVE_INTERVAL_MS) {
  const timer = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return;
    // A socket torn down between the readyState check and the frame must not
    // take the server down with it.
    try { ws.ping(); } catch {}
  }, intervalMs);
  // Keepalive never justifies holding the process open during shutdown.
  timer.unref?.();
  const stop = () => clearInterval(timer);
  ws.on("close", stop);
  ws.on("error", stop);
  return stop;
}

export { KEEPALIVE_INTERVAL_MS };
