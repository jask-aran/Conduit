/**
 * How long the first open takes, and what it waits on: a cold load of `/` in
 * a phone-sized page with a round trip added, timed to the arrival fade, with
 * every request's start and end. `--rtt <ms>` (default 80), `--path <route>`,
 * `--runs <n>` (default 3; the median is reported).
 */
import { arg, open, origin } from "./lib.mjs";

const rtt = Number(arg("--rtt", "80"));
const route = arg("--path", "/");
const runs = Number(arg("--runs", "3"));
const { page, cdp, close } = await open({ width: 390, height: 844 });
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: rtt, downloadThroughput: -1, uploadThroughput: -1 });
await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
await page.addInitScript(() => {
  const marks = {}; window.__load = marks; window.__long = [];
  new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: "longtask", buffered: true });
  const watch = () => {
    const a = document.documentElement?.dataset.arrival;
    if (a && !marks[a]) marks[a] = Math.round(performance.now());
    if (!marks.arriving) requestAnimationFrame(watch);
  };
  watch();
});
await page.goto(`${origin}${route}`, { waitUntil: "load" });
await page.waitForTimeout(3000);
const results = [];
for (let run = 0; run < runs; run += 1) {
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__load?.arriving, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  results.push(await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      arriving: window.__load.arriving ?? null, waiting: window.__load.waiting ?? null,
      dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd),
      long: window.__long,
      requests: performance.getEntriesByType("resource").map((r) => [Math.round(r.startTime), Math.round(r.responseEnd), r.name.replace(location.origin, "").slice(0, 80)]).sort((a, b) => a[0] - b[0]),
    };
  }));
}
results.sort((a, b) => (a.arriving ?? 1e9) - (b.arriving ?? 1e9));
const median = results[Math.floor(results.length / 2)];
console.log(`rtt ${rtt}ms  arriving: ${results.map((r) => r.arriving).join(", ")}  (median run below)`);
console.log(`long tasks ${median.long.map(([t, d]) => `${t}+${d}`).join(" ")}`);
console.log(`dcl ${median.dcl}  load ${median.load}  waiting ${median.waiting}  arriving ${median.arriving}`);
for (const [start, end, name] of median.requests) if (start < (median.arriving ?? 1e9) + 200) console.log(`${String(start).padStart(5)} ${String(end).padStart(5)}  ${name}`);
await close();
