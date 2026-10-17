#!/usr/bin/env node
/**
 * Where a streamed turn's main-thread time goes, by the trace's state (docs/testing.md, Frame budget). It sends one
 * Test-profile prompt on a fresh chat -- in the library's live phone page (gallery.html?frame=live, the gallery
 * served) or, with --app, the app -- in a tab of its own in headed Windows Chrome, and records a lean trace and a
 * 100us CPU profile of the page until 3s after the turn ends. Per state (Thinking, Writing, Done, ...): how busy the
 * main thread was, frames painted a second, rendering time by phase, rAF callbacks and JS self time by original
 * function. Names come from source maps: build with them first (`npx vite build --mode gallery --sourcemap`, or the
 * app's `npx vite build --sourcemap` and a restart), and without them afterwards.
 *
 *   node scripts/probes/turn-profile.mjs ["think 3000 5 tools 1500t"] [--app]
 */
import fs from "node:fs";
import path from "node:path";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { arg, cdpOrigin, flag, loadPlaywright, origin, root } from "./lib.mjs";

const prompt = process.argv[2]?.startsWith("--") ? "think 3000 5 tools 1500t" : process.argv[2] ?? "think 3000 5 tools 1500t";
const app = flag("--app");
const { chromium } = await loadPlaywright();
const b = await chromium.connectOverCDP(cdpOrigin); const ctx = b.contexts()[0]; const cdp = await b.newBrowserCDPSession();
const tmp = await ctx.newPage(); await tmp.goto(origin, { waitUntil: "commit" }); await tmp.waitForTimeout(1200);
const api = (url, method, body) => tmp.evaluate(async ([url, method, body]) => (await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json().catch(() => null), [url, method, body]);
const chat = await api("/v0/chats", "POST", { projectId: "test", profileId: "test-stream" }); const id = chat?.id ?? chat?.chat?.id;
await api(`/v0/chats/${id}/models`, "PATCH", { model: arg("--model", "fast-250") });
const url = app ? `${origin}/chat/${id}` : `${arg("--gallery", "http://127.0.0.1:5180")}/gallery.html?frame=live&chat=${id}`;
// A tab of its own in the window already open, brought forward (a hidden tab draws no frames), its viewport emulated.
const page = await ctx.newPage(); await page.bringToFront();
await (await ctx.newCDPSession(page)).send("Emulation.setDeviceMetricsOverride", app ? { width: 1280, height: 900, deviceScaleFactor: 0, mobile: false } : { width: 413, height: 858, deviceScaleFactor: 0, mobile: false });
await page.goto(url, { waitUntil: "commit" }); await page.waitForTimeout(7000);
// State marks from a MutationObserver: a rAF of the probe's own would ask for every frame it measures.
await page.evaluate((line) => { let last = ""; new MutationObserver(() => { const s = ([...document.querySelectorAll(".turn-trace")].at(-1)?.querySelector(line)?.textContent ?? "").replace(/\s+/g, " ").trim().replace(/ · .*/, "");
  if (s && s !== last) { last = s; window.__state = s; performance.mark(`state ${s}`); } }).observe(document.body, { subtree: true, childList: true, characterData: true }); }, app ? ".turn-trace-line" : ".ui-trace-line");
const ps = await ctx.newCDPSession(page); await ps.send("Profiler.enable"); await ps.send("Profiler.setSamplingInterval", { interval: 100 });
const events = []; const onData = (d) => events.push(...d.value); cdp.on("Tracing.dataCollected", onData);
const traced = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
await cdp.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "toplevel", "blink.user_timing"] } }); await ps.send("Profiler.start");
await page.evaluate(() => document.querySelector(".composer-keyboard-trigger, [aria-label='Type a message']")?.click());
const ta = page.locator(".chat-main textarea").first(); await ta.fill(prompt); await ta.press("Enter");
await page.waitForFunction(() => /^(Done|Interrupted|Failed)/.test(window.__state ?? ""), null, { timeout: 240_000, polling: 500 });
await page.waitForTimeout(3000); await page.evaluate(() => performance.mark("state end"));
const { profile } = await ps.send("Profiler.stop"); await cdp.send("Tracing.end"); await traced;
await page.close(); await api(`/v0/sessions/${id}`, "DELETE"); await tmp.close(); await b.close();

const maps = {}; const where = (url, line0, col0) => { const file = String(url).split("/").pop().split("?")[0]; if (!file.endsWith(".js")) return null;
  if (!(file in maps)) { const p = ["dist-gallery", "dist"].map((d) => path.join(root, "conduit-web", d, "assets", `${file}.map`)).find((p) => fs.existsSync(p)); maps[file] = p ? new TraceMap(fs.readFileSync(p, "utf8")) : null; }
  const o = maps[file] && originalPositionFor(maps[file], { line: line0 + 1, column: Math.max(0, col0) }); return o?.source ? `${o.name ?? "?"} ${o.source.replace(/^.*?(src\/|node_modules\/)/, "$1")}:${o.line}` : `${file}:${line0 + 1}`; };
const marks = events.filter((e) => e.cat?.includes("blink.user_timing") && e.name.startsWith("state ")).sort((a, z) => a.ts - z.ts);
const pid = marks[0]?.pid; const tid = events.find((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain" && e.pid === pid)?.tid;
const stateAt = (ts) => marks.findLast((m) => m.ts <= ts)?.name.slice(6) ?? "before";
const isTask = (e) => e.ph === "X" && (e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask");
const list = events.filter((e) => e.ph === "X" && e.pid === pid && e.tid === tid).sort((a, z) => a.ts - z.ts || z.dur - a.dur);
const tasks = []; let end = -1; for (const e of list) if (isTask(e) && e.ts >= end) { tasks.push(e); end = e.ts + e.dur; }
const span = {}; for (let i = 0; i + 1 < marks.length; i++) { const s = marks[i].name.slice(6); span[s] = (span[s] ?? 0) + (marks[i + 1].ts - marks[i].ts) / 1e6; }
const agg = {}; let j = 0;
for (const t of tasks) { const a = agg[stateAt(t.ts)] ??= { busy: 0, frames: 0, phases: {}, raf: {} }; a.busy += t.dur / 1000;
  while (j < list.length && list[j].ts < t.ts) j++;
  const inside = []; for (let k = j; k < list.length && list[k].ts < t.ts + t.dur; k++) if (list[k] !== t && !isTask(list[k])) inside.push(list[k]);
  if (inside.some((e) => e.name === "Paint")) a.frames++;
  for (const e of inside) if (["UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Layerize", "MinorGC", "MajorGC", "IntersectionObserverController::computeIntersections"].includes(e.name)) a.phases[e.name] = (a.phases[e.name] ?? 0) + e.dur / 1000;
  for (const e of inside) if (e.name === "FireAnimationFrame") { const d = inside.find((c) => c.name === "FunctionCall" && c.ts >= e.ts && c.ts < e.ts + e.dur)?.args?.data ?? {};
    const k = where(d.url, (d.lineNumber ?? 1) - 1, (d.columnNumber ?? 1) - 1) ?? d.functionName; a.raf[k] = (a.raf[k] ?? 0) + e.dur / 1000; } }
const nodes = new Map(profile.nodes.map((n) => [n.id, n])); const names = new Map(); const self = {}; let at = profile.startTime;
for (let i = 0; i < profile.samples.length; i++) { at += profile.timeDeltas[i]; const n = nodes.get(profile.samples[i]); const c = n.callFrame;
  if (!names.has(n.id)) names.set(n.id, c.url ? where(c.url, c.lineNumber, c.columnNumber) : c.functionName || "(native)");
  const k = names.get(n.id); if (k === "(idle)" || k === "(program)") continue; const s = stateAt(at); (self[s] ??= {})[k] = (self[s]?.[k] ?? 0) + profile.timeDeltas[i] / 1000; }
const top = (o, n) => Object.entries(o).sort((a, z) => z[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(" | ");
for (const [s, a] of Object.entries(agg)) { const secs = span[s];
  console.log(`\n== ${s}${secs ? ` ${secs.toFixed(1)}s: main thread busy ${(a.busy / secs / 10).toFixed(1)}%, ${(a.frames / secs).toFixed(0)} frames painted/s` : `: ${a.busy.toFixed(0)}ms busy`}`);
  console.log(`   rendering (ms): ${top(a.phases, 8)}\n   rAF (ms): ${top(a.raf, 5)}\n   JS self (ms): ${top(self[s] ?? {}, 10)}`); }
