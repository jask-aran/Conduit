/**
 * How many times each of the app's functions ran during one streamed Test-profile turn (docs/testing.md, Frame
 * budget): V8's precise coverage, call counts per function, mapped to source. A count does not vary from run to run
 * as a duration does, so it says exactly what a change removed -- the work per socket message, per frame, per
 * delta. Prints the turn's socket messages and frames, then the functions called most, with calls per message.
 * Build with source maps first (`npx vite build --sourcemap`, and without afterwards).
 *
 *   node scripts/probes/call-counts.mjs ["rich 2000t"] [--phone] [--match <text>] [--top 40]
 */
import fs from "node:fs";
import path from "node:path";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { arg, cdpOrigin, loadPlaywright, origin, root } from "./lib.mjs";

const prompt = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "rich 2000t";
const phone = process.argv.includes("--phone");
const { chromium } = await loadPlaywright();
const b = await chromium.connectOverCDP(cdpOrigin); const ctx = b.contexts()[0];
const tmp = await ctx.newPage(); await tmp.goto(origin, { waitUntil: "commit" }); await tmp.waitForTimeout(1200);
const api = (url, method, body) => tmp.evaluate(async ([url, method, body]) => (await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json().catch(() => null), [url, method, body]);
const chat = await api("/v0/chats", "POST", { projectId: "test", profileId: "test-stream" }); const id = chat?.id ?? chat?.chat?.id;
await api(`/v0/chats/${id}/models`, "PATCH", { model: arg("--model", "fast-250") });
// A tab of its own in the window already open, brought forward (a hidden tab draws no frames), its viewport emulated.
const page = await ctx.newPage(); await page.bringToFront();
const s = await ctx.newCDPSession(page);
await s.send("Emulation.setDeviceMetricsOverride", phone ? { width: 412, height: 860, deviceScaleFactor: 2.625, mobile: true } : { width: 1280, height: 900, deviceScaleFactor: 0, mobile: false });
if (phone) await s.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
let result;
try {
  await page.goto(`${origin}/chat/${id}`); await page.waitForTimeout(5000);
  // Frames counted in the page (a rAF tick), socket messages by the browser (each frame the WebSocket receives).
  await page.evaluate(() => { const w = window; w.__frames = 0; const tick = () => { w.__frames++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  let messages = 0; await s.send("Network.enable"); s.on("Network.webSocketFrameReceived", () => { messages++; });
  await s.send("Profiler.enable");
  await s.send("Profiler.startPreciseCoverage", { callCount: true, detailed: false });
  await s.send("Profiler.takePreciseCoverage"); // zero the counts so far
  await page.evaluate(() => { window.__frames = 0; }); messages = 0;
  await page.evaluate(() => document.querySelector(".composer-keyboard-trigger, [aria-label='Type a message']")?.click());
  const ta = page.locator(".chat-main textarea").first(); await ta.fill(prompt); await ta.press("Enter");
  await page.waitForFunction(() => /^(Done|Interrupted|Failed)/.test(document.querySelector(".ui-trace-line")?.textContent ?? ""), null, { timeout: 240_000, polling: 500 });
  await page.waitForTimeout(1500);
  const { result: coverage } = await s.send("Profiler.takePreciseCoverage");
  const counts = { frames: await page.evaluate(() => window.__frames), messages };
  result = { coverage, counts };
  await s.send("Profiler.stopPreciseCoverage");
} finally { await page.close(); await api(`/v0/sessions/${id}`, "DELETE"); await tmp.close(); await b.close(); }

const maps = {};
const mapOf = (url) => { const file = String(url).split("/").pop().split("?")[0]; if (!file.endsWith(".js")) return null;
  if (!(file in maps)) { const p = ["dist", "dist-gallery"].map((d) => path.join(root, "conduit-web", d, "assets", `${file}.map`)).find((p) => fs.existsSync(p)); maps[file] = p ? { map: new TraceMap(fs.readFileSync(p, "utf8")), lines: null, url } : null; }
  return maps[file]; };
// Offsets to line/column need the script's source: fetched once per bundle from the server.
const sources = {};
const lineCol = async (url, offset) => { if (!(url in sources)) { const text = await (await fetch(url)).text(); const starts = [0]; for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1); sources[url] = starts; }
  const starts = sources[url]; let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; } return { line: lo + 1, column: offset - starts[lo] }; };
const rows = [];
for (const script of result.coverage) { const m = mapOf(script.url); if (!m) continue;
  for (const fn of script.functions) { const count = fn.ranges[0]?.count ?? 0; if (!count) continue;
    const { line, column } = await lineCol(script.url, fn.ranges[0].startOffset);
    const o = originalPositionFor(m.map, { line, column }); const source = o.source?.replace(/^.*?(src\/|node_modules\/)/, "$1");
    rows.push({ count, name: fn.functionName || o.name || "?", where: source ? `${source}:${o.line}` : `${script.url.split("/").pop()}:${line}` }); } }
const match = arg("--match", null);
const shown = rows.filter((r) => !match || `${r.name} ${r.where}`.includes(match)).sort((a, z) => z.count - a.count).slice(0, Number(arg("--top", 40)));
const { messages, frames } = result.counts;
console.log(`"${prompt}": ${messages} socket messages, ${frames} frames`);
for (const r of shown) console.log(`${String(r.count).padStart(9)}  ${(r.count / Math.max(1, messages)).toFixed(1).padStart(7)}/msg  ${(r.count / Math.max(1, frames)).toFixed(1).padStart(7)}/frame  ${r.name}  ${r.where}`);
