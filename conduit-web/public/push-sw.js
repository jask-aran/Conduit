/*
 * The service worker's half of Conduit's push (src/client/platform/push.ts): show what the hub sent, and on a tap bring
 * a Conduit window to the chat it is about. Imported by the generated worker (vite.config.js, workbox.importScripts).
 */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { return; }
  if (data.v !== 1 || typeof data.title !== "string") return;
  const path = typeof data.path === "string" && data.path.startsWith("/") && !data.path.startsWith("//") ? data.path : "/";
  event.waitUntil(self.registration.showNotification(data.title, {
    body: typeof data.body === "string" ? data.body : "",
    tag: `${data.hub || "conduit"}:${data.tag || "agent"}`,
    renotify: true,
    icon: "/pwa-192x192.png",
    data: { path },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.path || "/";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const page = windows.find((client) => client.focused) || windows[0];
    // A page already open keeps its state: it is told where to go rather than reloaded there.
    if (page) {
      await page.focus();
      page.postMessage({ type: "conduit-push-open", path });
      return;
    }
    await self.clients.openWindow(path);
  })());
});
