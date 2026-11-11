// Cloudflare closes a WebSocket that has carried no frames for roughly 100 seconds, and an idle terminal or live
// session sends nothing. Browsers answer pings at the protocol level, so no client counterpart is needed.
const KEEPALIVE_INTERVAL_MS = 30_000;

export function startWebSocketKeepalive(ws, intervalMs = KEEPALIVE_INTERVAL_MS) {
  const timer = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return;
    // A socket torn down between the readyState check and the frame must not take the server down with it.
    try { ws.ping(); } catch {}
  }, intervalMs);
  timer.unref?.();
  const stop = () => clearInterval(timer);
  ws.on("close", stop);
  ws.on("error", stop);
  return stop;
}
