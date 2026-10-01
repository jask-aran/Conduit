#!/usr/bin/env node
/**
 * Frame budget while an answer streams (docs/testing.md, Frame budget). For
 * each renderer it starts a fresh chat in the Test project, sends one prompt,
 * and records a lean trace (devtools.timeline, toplevel) for the whole stream
 * while sampling how the visible answer grows every frame. It reports how
 * evenly the text appeared, main-thread tasks over 6.94ms (144Hz) and 16.7ms,
 * what ran inside the long ones, layouts per task and DOM churn, then deletes
 * the chat. Use --windows: frame cost only means something headed.
 *
 * The default model is Muse Spark on the Assistant profile -- real streaming,
 * ad hoc, never a fixture. MODEL=<spec> uses the test-stream profile instead.
 * Env: RENDERERS=marked,incremark,incremark-fade  PROMPT=...  MATHFADE=1  SHOT=1
 *
 *   node scripts/probes/stream-budget.mjs --windows
 */
import { open, origin } from "./lib.mjs";

const { page: p, cdp, close } = await open();
const api = (url, method, body) => p.evaluate(async ([url, method, body]) => { const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; }, [url, method, body]);
await p.goto(origin); await p.evaluate(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); });  await p.reload();
const PROMPT = process.env.PROMPT || "Explain how TCP congestion control works in about 450 words: a short intro paragraph, a bulleted list with **bold** terms, a small markdown table comparing Reno and CUBIC, and an inline formula such as $cwnd = cwnd + 1/cwnd$. No code blocks, no headings.";
for (const renderer of (process.env.RENDERERS || "marked,incremark,incremark-fade").split(",")) {
  const muse = !process.env.MODEL; const c = await api("/v0/chats", "POST", { projectId: "test", profileId: muse ? "assistant" : "test-stream" }); const id = c.json?.id ?? c.json?.chat?.id;
  await api(`/v0/chats/${id}/models`, "PATCH", muse ? { model: "openrouter/meta/muse-spark-1.3-contributor", thinkingLevel: "minimal" } : { model: process.env.MODEL });
  await p.evaluate((v) => v ? localStorage.setItem("conduit:stream-math-fade", v) : localStorage.removeItem("conduit:stream-math-fade"), process.env.MATHFADE || ""); await p.goto(`${origin}/chat/${id}?incremarkPacing=${renderer === "incremark-fade" ? "fade" : "buffered"}`); await p.waitForTimeout(3000);
  const box = p.locator(".chat-main [data-part='composer'] textarea").first(); await box.click(); await box.fill(PROMPT);
  const events = []; const onData = (d) => events.push(...d.value); cdp.on("Tracing.dataCollected", onData);
  const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "toplevel"] } });
  const sampling = p.evaluate(() => new Promise((finish) => {
    const el = () => [...document.querySelectorAll(".bubble-assistant .chat-markdown")].at(-1);
    const churn = {}; let added = 0;
    const mo = new MutationObserver((records) => { for (const r of records) { if (!r.target.closest?.(".chat-markdown")) continue; for (const n of r.addedNodes) if (n.nodeType === 1) added++; for (const n of r.removedNodes) if (n.nodeType === 1) { const k = n.tagName.toLowerCase() + (n.className && typeof n.className === "string" ? "." + n.className.split(" ")[0] : ""); churn[k] = (churn[k] ?? 0) + 1; } } });
    mo.observe(document.querySelector(".thread") || document.body, { childList: true, subtree: true });
    const lens = []; let spans = 0; const t0 = performance.now(); let quietSince = null;
    const f = () => { const e = el(); const n = (e?.textContent || "").length; lens.push([performance.now() - t0, n]); spans = Math.max(spans, document.querySelectorAll(".stream-word").length);
      const live = document.querySelector("[aria-label='Stop response']"); if (!live && n > 0) quietSince ??= performance.now(); else quietSince = null;
      if ((quietSince && performance.now() - quietSince > 1500) || performance.now() - t0 > 90000) { mo.disconnect(); const top = [...(el()?.querySelector("[data-incremark-root], .incremark-root") || el()).children]; window.__shape = top.map((c) => c.tagName + ":" + c.querySelectorAll(".incremark-math-block").length).join(" "); finish({ lens, spans, churn, added, shape: window.__shape }); } else requestAnimationFrame(f); };
    requestAnimationFrame(f); }));
  await p.keyboard.press("Enter");
  const { lens, spans, churn, added, shape } = await sampling; console.log("   shape", shape.slice(0, 600));
  await cdp.send("Tracing.end"); await done; cdp.off("Tracing.dataCollected", onData);
  const first = lens.findIndex(([, n]) => n > 0); const lastN = lens.at(-1)[1]; const last = lens.findIndex(([, n]) => n === lastN);
  const win = lens.slice(first, last + 1); const d = win.slice(1).map(([, n], i) => n - win[i][1]);
  let still = 0, pauses = 0, maxStill = 0; for (const x of d) { if (x <= 0) still++; else { if (still >= 12) pauses++; maxStill = Math.max(maxStill, still); still = 0; } }
  const mv = d.filter((x) => x > 0).sort((x, y) => x - y);
  // Variation of growth over 100ms windows: 0 is a perfectly even reveal.
  const buckets = []; for (const [t, n] of win) { const k = Math.floor((t - win[0][0]) / 100); buckets[k] = n; } const rates = buckets.slice(1).map((n, i) => (n ?? 0) - (buckets[i] ?? 0)).filter((x) => Number.isFinite(x));
  const mean = rates.reduce((a, x) => a + x, 0) / rates.length; const cv = Math.sqrt(rates.reduce((a, x) => a + (x - mean) ** 2, 0) / rates.length) / mean;
  const counts = {}; for (const e of events) if (e.ph === "X" && (e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask")) { const k = e.pid + ":" + e.tid; counts[k] = (counts[k] ?? 0) + e.dur; }
  const main = events.filter((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain").map((e) => e.pid + ":" + e.tid).sort((a, b2) => (counts[b2] ?? 0) - (counts[a] ?? 0))[0];
  const tasks = events.filter((e) => e.ph === "X" && (e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask") && e.pid + ":" + e.tid === main && e.dur).map((e) => e.dur / 1000).sort((x, y) => x - y);
  console.log(renderer.padEnd(15), `${lastN} chars in ${((win.at(-1)[0] - win[0][0]) / 1000).toFixed(1)}s  grew ${mv.length}/${d.length} frames  p90 ${mv[Math.floor(mv.length * 0.9)]} max ${mv.at(-1)}  pauses>83ms ${pauses} longest ${(maxStill * 6.94).toFixed(0)}ms  100ms-CV ${cv.toFixed(2)}  spans≤${spans}  tasks>6.94 ${tasks.filter((t) => t > 6.94).length} >16.7 ${tasks.filter((t) => t > 16.7).length} max ${tasks.at(-1)?.toFixed(1)}`);
  { const all = events.filter((e) => e.ph === "X" && (e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask") && e.pid + ":" + e.tid === main && e.dur); const endTs = Math.max(...all.map((e) => e.ts + e.dur)); console.log("   top tasks (ms before trace end):", all.sort((a, b2) => b2.dur - a.dur).slice(0, 6).map((e) => `${(e.dur / 1000).toFixed(1)}@-${((endTs - e.ts) / 1000).toFixed(0)}`).join(" ")); }
  { const all = events.filter((e) => e.ph === "X" && (e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask") && e.pid + ":" + e.tid === main && e.dur > 6940); const inner = events.filter((e) => e.ph === "X" && e.pid + ":" + e.tid === main && e.name !== "RunTask" && e.name !== "ThreadControllerImpl::RunTask"); const agg = {}; for (const t of all) for (const e of inner) if (e.ts >= t.ts && e.ts < t.ts + t.dur) agg[e.name] = (agg[e.name] ?? 0) + e.dur / 1000; console.log("   inside long tasks:", Object.entries(agg).sort((a, b2) => b2[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(", ")); }
  { const onMain = (e) => e.pid + ":" + e.tid === main && e.ph === "X"; const frames = events.filter((e) => onMain(e) && e.name === "FireAnimationFrame").length; const lay = events.filter((e) => onMain(e) && e.name === "Layout"); const forced = lay.filter((e) => e.args?.beginData?.stackTrace || e.args?.data?.stackTrace).length; const tasks = events.filter((e) => onMain(e) && (e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask")); let multi = 0; let tl = 0; for (const t of tasks) { const n = lay.filter((l) => l.ts >= t.ts && l.ts < t.ts + t.dur).length; if (n > 1) multi++; } console.log(`   rAF callbacks ${frames}  Layout ${lay.length} (${(lay.reduce((a, e) => a + e.dur, 0) / 1000).toFixed(0)}ms)  tasks with 2+ layouts ${multi}`); }
  { const all = events.filter((e) => e.ph === "X" && (e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask") && e.pid + ":" + e.tid === main && e.dur); const t0 = Math.min(...all.map((e) => e.ts)); const bins = {}; for (const e of all) if (e.dur > 6940) { const k = Math.floor((e.ts - t0) / 5e6) * 5; bins[k] = (bins[k] ?? 0) + 1; } console.log("   over-budget per 5s:", JSON.stringify(bins)); }
  console.log("   elements added", added, "removed", JSON.stringify(Object.fromEntries(Object.entries(churn).sort((a, b2) => b2[1] - a[1]).slice(0, 12))));
  if (process.env.SHOT) await p.screenshot({ path: `muse-${renderer}.png` });
  await api(`/v0/sessions/${id}`, "DELETE");
}
await close();
