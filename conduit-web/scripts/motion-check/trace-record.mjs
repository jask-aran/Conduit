// Trace record: one scripted Test-profile conversation in the app (no model call, the same turns every run), recorded
// for comparing one build of the trace with another -- before and after a cut-over, or a performance change. For each
// turn: the states its trace shows while it streams and for how long (from DOM mutations: the recorder asks for no
// frames of its own), and where the main thread's time went in each state (lean trace and CPU profile). Then every
// trace settled, each step opened (the trace-parity walk). Headed Chrome on CDP :9222, the server signed in there; it
// runs in a tab of its own.
//   node scripts/motion-check/trace-record.mjs save <file> [--phone]
//   node scripts/motion-check/trace-record.mjs diff <before> <after>
import fs from "node:fs";
const { chromium } = await import(new URL("../../../.smoke-tools/node_modules/playwright/index.mjs", import.meta.url).href);

// Thinking, narration and tools; tools alone; thinking alone; stopped as it writes; a tool denied; stopped at a tool; no trace.
const SCRIPT = [
  { prompt: "think 2000 4 tools narrate 900t" },
  { prompt: "3 tools 300t" },
  { prompt: "think 600 400t" },
  { prompt: "think 800 2 tools 1500t", stop: /^Writing/ },
  // Its tool denied, and stopped at its tool, each the moment the approval is asked: the same point every run.
  { prompt: "think 400 approve tool 200t", approval: "Deny" },
  { prompt: "think 300 approve tool 200t", approval: "stop" },
  { prompt: "250t" },
];
const [mode, a, z] = process.argv.slice(2);
const phone = process.argv.includes("--phone");

if (mode === "save" && a) {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9222"); const ctx = b.contexts()[0]; const cdp = await b.newBrowserCDPSession();
  // A tab of its own in the window already open, brought forward (a covered tab draws no frames), closed at the end.
  const page = await ctx.newPage(); await page.bringToFront(); await page.goto("http://127.0.0.1:4310/", { waitUntil: "commit" }); await page.waitForTimeout(1500);
  const api = (url, method, body) => page.evaluate(async ([url, method, body]) => (await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json().catch(() => null), [url, method, body]);
  const created = await api("/v0/chats", "POST", { projectId: "test", profileId: "test-stream" }); const id = created?.id ?? created?.chat?.id;
  await api(`/v0/chats/${id}/models`, "PATCH", { model: "fast-250" });
  await page.goto(`http://127.0.0.1:4310/chat/${id}`, { waitUntil: "commit" });
  const ps = await ctx.newCDPSession(page);
  try {
  // A fixed viewport: the desktop at 1280x900, or a phone (touch, so the phone layout's hover and pointer queries hold).
  await ps.send("Emulation.setDeviceMetricsOverride", phone ? { width: 412, height: 860, deviceScaleFactor: 2.625, mobile: true } : { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  if (phone) await ps.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await page.reload(); await page.waitForTimeout(5000);
  const layout = await page.evaluate(() => matchMedia("(hover: none) and (pointer: coarse)").matches ? "phone" : "desktop");
  await ps.send("Profiler.enable"); await ps.send("Profiler.setSamplingInterval", { interval: 200 });
  const turns = [];
  for (const step of SCRIPT) {
    await page.evaluate(() => {
      const t = (e) => (e?.textContent ?? "").replace(/\s+/g, " ").trim(); let last = ""; const log = window.__log = [];
      window.__mo?.disconnect();
      window.__mo = new MutationObserver(() => { const tr = [...document.querySelectorAll(".turn-trace")].at(-1); if (!tr) return;
        const status = t(tr.querySelector(".turn-trace-line, .ui-trace-line")).replace(/ · \d+(\.\d+)?(ms|s)\b| · \d+m \d+s/g, " · T");
        const latest = t(tr.querySelector(".turn-trace-summary, .ui-trace-latest"));
        const s = `${status} | ${/^(Read|Edited|Ran|Searched|Fetched) /.test(latest) ? latest : latest ? "prose" : ""}`;
        if (s !== last) { last = s; log.push([s, performance.now()]); performance.mark(`state ${status.replace(/ · .*/, "")}`); } });
      window.__mo.observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const events = []; const onData = (d) => events.push(...d.value); cdp.on("Tracing.dataCollected", onData);
    const traced = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
    await cdp.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "toplevel", "blink.user_timing"] } }); await ps.send("Profiler.start");
    await page.evaluate(() => document.querySelector(".composer-keyboard-trigger, [aria-label='Type a message']")?.click());
    const ta = page.locator(".chat-main textarea").first(); await ta.fill(step.prompt); await ta.press("Enter");
    if (step.approval) {
      await page.locator(".question-dock").first().waitFor({ timeout: 30_000 });
      if (step.approval === "stop") await page.evaluate(() => [...document.querySelectorAll("[aria-label='Stop response']")].find((e) => e.getClientRects().length)?.click());
      // Clicked in the page: Playwright does not know the phone viewport is emulated, so its own click aims wide and
      // scrolls the page up and down trying to uncover the option.
      else await page.evaluate((label) => [...document.querySelectorAll(".question-dock [role=option]")].find((o) => o.textContent.includes(label))?.click(), step.approval);
    }
    if (step.stop) {
      await page.waitForFunction((re) => new RegExp(re).test(window.__log.at(-1)?.[0] ?? ""), step.stop.source, { timeout: 60_000, polling: 50 });
      await page.evaluate(() => [...document.querySelectorAll("[aria-label='Stop response']")].find((e) => e.getClientRects().length)?.click());
    }
    await page.waitForFunction(() => /^(Done|Interrupted|Failed) /.test(window.__log.at(-1)?.[0] ?? "") && !document.querySelector("[aria-label='Stop response']"), null, { timeout: 120_000, polling: 100 });
    await page.waitForTimeout(1500); await page.evaluate(() => performance.mark("state end"));
    const { profile } = await ps.send("Profiler.stop"); await cdp.send("Tracing.end"); await traced; cdp.off("Tracing.dataCollected", onData);
    const log = await page.evaluate(() => window.__log);
    // Each state for how long it showed; a blank Latest line while thinking is the renderer loading, not a state.
    const states = [];
    for (const [[line, at], next] of log.map((entry, i, all) => [entry, all[i + 1]?.[1] ?? entry[1] + 1000])) {
      const [status, latest] = line.split(" | "); if (/^(Thinking|Writing) /.test(status) && !latest) continue;
      const state = `${status} | ${latest}`;
      if (states.at(-1)?.state === state) states.at(-1).ms += next - at; else states.push({ state, ms: Math.round(next - at) });
    }
    turns.push({ prompt: step.prompt, states, perf: perfOf(events, profile) });
    console.log(`${step.prompt}: ${states.length} states, ${states.at(-1)?.state}`);
  }
  turns.walk = await walk(page);
  fs.writeFileSync(a, JSON.stringify({ layout, chat: id, turns, walk: turns.walk }, null, 1));
  console.log(`saved ${a} (${layout}, chat ${id}): ${turns.walk.length} settled lines`);
  } finally {
    await api(`/v0/sessions/${id}`, "DELETE").catch(() => {});
    await page.close(); await b.close();
  }
} else if (mode === "diff" && z) {
  const [before, after] = [a, z].map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
  let problems = 0;
  console.log(`layouts: ${before.layout} / ${after.layout}`);
  before.turns.forEach((x, i) => {
    const y = after.turns[i];
    // A state held a moment either side's frames may miss; one shown 150ms or more must show on both, in the same order.
    const missing = [...x.states.filter((s) => s.ms >= 150 && !y.states.some((t) => t.state === s.state)).map((s) => `after never shows "${s.state}"`),
      ...y.states.filter((s) => s.ms >= 150 && !x.states.some((t) => t.state === s.state)).map((s) => `before never shows "${s.state}"`)];
    const both = (l, o) => l.map((s) => s.state).filter((s) => o.some((t) => t.state === s));
    if (both(x.states, y.states).join("\n") !== both(y.states, x.states).join("\n")) missing.push("the states both show come in a different order");
    problems += missing.length;
    console.log(`\n${missing.length ? "✗" : "✓"} ${x.prompt}${missing.length ? `\n  ${missing.join("\n  ")}\n  before: ${x.states.map((s) => `${s.state} ${s.ms}ms`).join("\n          ")}\n  after:  ${y.states.map((s) => `${s.state} ${s.ms}ms`).join("\n          ")}` : ""}`);
    for (const s of Object.keys(x.perf)) { const p = x.perf[s], q = y.perf[s]; if (!q || p.secs < 0.3) continue;
      console.log(`    ${s.padEnd(18)} busy ${p.busy.toFixed(1)}% -> ${q.busy.toFixed(1)}%   frames ${p.fps}/s -> ${q.fps}/s   slow ${p.slow} -> ${q.slow}`); }
  });
  let diffs = 0;
  // Durations differ run to run; what the lines say does not.
  const same = (line) => line?.replace(/(\d+m )?\d+(\.\d+)?(ms|s)\b/g, "T");
  for (let i = 0; i < Math.max(before.walk.length, after.walk.length); i++) { if (same(before.walk[i]) === same(after.walk[i])) continue; diffs++; console.log(`#${i}\n  before: ${before.walk[i]}\n  after:  ${after.walk[i]}`); }
  console.log(`\nsettled: ${before.walk.length} lines, ${diffs} differ`);
  console.log(problems + diffs ? "✗ not the same" : "✓ same states and settled traces");
} else console.log("usage: trace-record.mjs save <file> [--phone] | diff <before> <after>");

// Per state: seconds shown, main thread busy (%), frames painted a second, tasks over 6.94ms, the costliest rendering
// phases, rAF callbacks and functions (minified unless the build has source maps).
function perfOf(events, profile) {
  const marks = events.filter((e) => e.cat?.includes("blink.user_timing") && e.name.startsWith("state ")).sort((p, q) => p.ts - q.ts);
  if (!marks.length) return {};
  const pid = marks[0].pid; const tid = events.find((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain" && e.pid === pid)?.tid;
  const stateAt = (ts) => marks.findLast((m) => m.ts <= ts)?.name.slice(6) ?? "before";
  const isTask = (e) => e.ph === "X" && (e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask");
  const list = events.filter((e) => e.ph === "X" && e.pid === pid && e.tid === tid).sort((p, q) => p.ts - q.ts || q.dur - p.dur);
  const tasks = []; let end = -1; for (const e of list) if (isTask(e) && e.ts >= end) { tasks.push(e); end = e.ts + e.dur; }
  const out = {};
  for (let i = 0; i + 1 < marks.length; i++) { const s = marks[i].name.slice(6); (out[s] ??= { secs: 0, busyMs: 0, frames: 0, slow: 0, phases: {}, raf: {}, self: {} }).secs += (marks[i + 1].ts - marks[i].ts) / 1e6; }
  let j = 0;
  for (const t of tasks) { const o = out[stateAt(t.ts)]; if (!o) continue; o.busyMs += t.dur / 1000; if (t.dur > 6940) o.slow++;
    while (j < list.length && list[j].ts < t.ts) j++;
    const inside = []; for (let k = j; k < list.length && list[k].ts < t.ts + t.dur; k++) if (list[k] !== t && !isTask(list[k])) inside.push(list[k]);
    if (inside.some((e) => e.name === "Paint")) o.frames++;
    for (const e of inside) if (["UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Layerize", "MinorGC", "MajorGC"].includes(e.name)) o.phases[e.name] = (o.phases[e.name] ?? 0) + e.dur / 1000;
    for (const e of inside) if (e.name === "FireAnimationFrame") { const d = inside.find((c) => c.name === "FunctionCall" && c.ts >= e.ts && c.ts < e.ts + e.dur)?.args?.data ?? {};
      const k = `${d.functionName || "?"} ${String(d.url).split("/").pop()}:${d.lineNumber}`; o.raf[k] = (o.raf[k] ?? 0) + e.dur / 1000; } }
  const nodes = new Map(profile.nodes.map((n) => [n.id, n])); let at = profile.startTime;
  for (let i = 0; i < profile.samples.length; i++) { at += profile.timeDeltas[i]; const c = nodes.get(profile.samples[i]).callFrame; const k = c.url ? `${c.functionName || "?"} ${c.url.split("/").pop()}:${c.lineNumber + 1}` : c.functionName;
    if (k === "(idle)" || k === "(program)") continue; const o = out[stateAt(at)]; if (o) o.self[k] = (o.self[k] ?? 0) + profile.timeDeltas[i] / 1000; }
  const top = (r, n) => Object.fromEntries(Object.entries(r).sort((p, q) => q[1] - p[1]).slice(0, n).map(([k, v]) => [k, Math.round(v)]));
  for (const o of Object.values(out)) { o.busy = o.secs ? o.busyMs / o.secs / 10 : 0; o.fps = o.secs ? Math.round(o.frames / o.secs) : 0; o.phases = top(o.phases, 5); o.raf = top(o.raf, 3); o.self = top(o.self, 6); }
  return out;
}

// Every trace settled, each step opened in turn: the trace-parity walk, with either build's classes.
async function walk(page) {
  return page.evaluate(async () => {
    const S = document.querySelector(".ui-trace-line")
      ? { line: ".ui-trace-line", latest: ".ui-trace-latest", head: "button.ui-trace", list: ".turn-trace .ui-trail", row: ".ui-step-item, .ui-trace-error", rowParent: ".ui-trail", rowHead: ".ui-step", rowBody: ".ui-step-body", nestedList: ".ui-trail", discarded: "[data-discarded]" }
      : { line: ".turn-trace-line", latest: ".turn-trace-summary", head: ".turn-trace-header", list: ".turn-trace-body", row: ".trail-row, .tool-step-calls > li", rowParent: ".turn-trace-body, .tool-group-steps, .tool-step-calls", rowHead: ".trail-row-header", rowBody: ".tool-step-content, .text-step-content, .tool-group-steps", nestedList: ".tool-group-steps, .tool-step-calls", discarded: "[data-discarded=true]" };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const t = (e) => (e?.textContent ?? "").replace(/\s+/g, " ").trim();
    const out = [];
    const rows = async (list, depth) => { for (const row of [...list.querySelectorAll(S.row)]) {
      if (row.closest(S.rowParent) !== list.closest(S.rowParent) && row.parentElement !== list) continue;
      const head = row.querySelector(S.rowHead); out.push(`${"  ".repeat(depth)}- ${t(head ?? row).slice(0, 120)}${row.matches(S.discarded) ? " [discarded]" : ""}${head?.getAttribute("aria-label") ? ` {${head.getAttribute("aria-label")}}` : ""}`);
      if (head && head.tagName === "BUTTON" && !head.disabled) { if (head.getAttribute("aria-expanded") !== "true") { head.click(); await wait(250); }
        for (let i = 0; i < 30 && /Loading…/.test(t(row.querySelector(S.rowBody))); i++) await wait(100);
        const body = row.querySelector(S.rowBody); const nested = body?.matches(S.nestedList) ? body : body?.querySelector(S.nestedList);
        if (nested) await rows(nested, depth + 1); else out.push(`${"  ".repeat(depth + 1)}> ${t(body).slice(0, 160)}`); } } };
    for (const trace of document.querySelectorAll(".turn-trace")) {
      // The latest line is one line: the library's is given a line's worth (240 characters), the app's the whole sentence.
      out.push(`TRACE ${t(trace.querySelector(S.line))} | ${t(trace.querySelector(S.latest)).replace(/…$/, "").slice(0, 240)}${trace.querySelector(S.head)?.disabled ? " (no open)" : ""}`);
      const head = trace.querySelector(S.head); if (!head || head.disabled) continue;
      if (head.getAttribute("aria-expanded") !== "true") { head.click(); await wait(400); }
      const list = trace.querySelector(S.list); if (list) await rows(list, 1);
    }
    // What a turn's foot says of how it ended, whichever build draws it.
    for (const e of document.querySelectorAll(".response-status, .turn-stop-row, .ui-message-status, .ui-stop-line")) out.push(`EXTRA ${t(e)}`);
    return out;
  });
}
