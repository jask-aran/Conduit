/**
 * How long a page takes to be live again after time in the background: opens
 * the most recent chat, pretends the page was hidden for `--away <ms>` (default
 * 6000), and times from its return to each socket opening and the first frame
 * on it. `--rtt <ms>` (default 80).
 */
import { arg, open, origin, recentChats } from "./lib.mjs";

const rtt = Number(arg("--rtt", "80"));
const away = Number(arg("--away", "6000"));
const { page, cdp, close } = await open({ width: 390, height: 844 });
await page.addInitScript(() => {
  const log = []; window.__sockets = log;
  const Native = window.WebSocket;
  window.WebSocket = class extends Native {
    constructor(...args) {
      super(...args);
      const entry = { url: String(args[0]).replace(/^wss?:\/\/[^/]+/, "").slice(0, 60), created: performance.now() };
      log.push(entry);
      this.addEventListener("open", () => { entry.open = performance.now(); });
      this.addEventListener("message", () => { entry.first ??= performance.now(); });
    }
  };
  const NativeSource = window.EventSource;
  window.EventSource = class extends NativeSource {
    constructor(...args) {
      super(...args);
      const entry = { url: "SSE " + String(args[0]).replace(/^https?:\/\/[^/]+/, "").slice(0, 40), created: performance.now() };
      log.push(entry);
      this.addEventListener("open", () => { entry.open = performance.now(); });
      this.addEventListener("message", () => { entry.first ??= performance.now(); });
    }
  };
  let hidden = false;
  Object.defineProperty(document, "visibilityState", { get: () => hidden ? "hidden" : "visible" });
  Object.defineProperty(document, "hidden", { get: () => hidden });
  window.__setHidden = (value) => { hidden = value; document.dispatchEvent(new Event("visibilitychange")); };
});
await page.goto(`${origin}/`, { waitUntil: "load" });
const [chatId] = await recentChats(page, 1);
await page.goto(`${origin}/chat/${chatId}`, { waitUntil: "load" });
await page.waitForTimeout(3000);
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: rtt, downloadThroughput: -1, uploadThroughput: -1 });
await page.evaluate(() => window.__setHidden(true));
await page.waitForTimeout(away);
const back = await page.evaluate(() => { window.__setHidden(false); return performance.now(); });
await page.waitForTimeout(3000);
const sockets = await page.evaluate((back) => window.__sockets.filter((s) => s.created >= back - 1).map((s) => ({ url: s.url, created: Math.round(s.created - back), open: s.open && Math.round(s.open - back), first: s.first && Math.round(s.first - back) })), back);
const requests = await page.evaluate((back) => performance.getEntriesByType("resource").filter((r) => r.startTime >= back - 1).map((r) => `${Math.round(r.startTime - back)}-${Math.round(r.responseEnd - back)} ${r.name.replace(location.origin, "").slice(0, 70)}`), back);
console.log(`rtt ${rtt}ms, away ${away}ms; ms after return:`);
for (const s of sockets) console.log(`socket ${s.url}  created ${s.created}  open ${s.open ?? "-"}  first frame ${s.first ?? "-"}`);
for (const r of requests) console.log(`request ${r}`);
await close();
