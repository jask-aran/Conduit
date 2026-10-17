// Trace while it streams: does the library's Trace pass through the same states as the app's? The gallery's live
// phone (gallery.html?live=<chat>: the app's own chat store on the real server, drawn with components v2) and the app
// in a window of its own, each on a fresh Test-profile chat, in headed Chrome on CDP :9222. The same prompt is sent from
// each in turn -- the Test profile answers it the same way -- each recording its last trace's Status line and Latest
// line every frame; prints both sequences of what a reader sees change. A state shown 150ms or more on
// one side must show on the other, and the states both show come in the same order (one held a moment may be missed).
// From conduit-web, the gallery served and the server signed in in that Chrome:
//   node scripts/motion-check/trace-stream.mjs ["think 400 3 tools 600t"] [stop] [--budget]
// --budget also traces each side's turn (devtools.timeline, toplevel) and prints its busiest renderer's tasks over 6.94ms,
// each with the trace's state then, what ran in it and the animations running. Other pages in that Chrome share its CPU:
// counts vary several-fold run to run, so read what each slow task was, not how many there were.
const { chromium } = await import(new URL("../../../.smoke-tools/node_modules/playwright/index.mjs", import.meta.url).href);
const flag = (name) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv.splice(at, 2)[1] : null; };
// --model <spec>: a real model on the Assistant profile (--profile coding for codemode scripts); its two runs differ, so they are printed to read, not compared.
const model = flag("--model"), profile = flag("--profile") ?? "assistant";
const budget = process.argv.includes("--budget"); if (budget) process.argv.splice(process.argv.indexOf("--budget"), 1);
const prompt = process.argv[2] ?? (model ? "List the files in this folder, then read one of them, then tell me in three sentences what you found." : "think 400 3 tools 600t"), stop = process.argv[3] === "stop";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = b.contexts()[0];
const g = ctx.pages().find((p) => p.url().includes(":5180/gallery.html"));
const back = g.url();
const app = await ctx.newPage(); await app.goto("http://127.0.0.1:4310/", { waitUntil: "commit" }); await app.waitForTimeout(1500);
const api = (url, method, body) => app.evaluate(async ([url, method, body]) => (await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json(), [url, method, body]);
// A chat each: a window does not follow a turn another one sends on its chat (an app bug, not the library's).
const fresh = async () => { const chat = await api("/v0/chats", "POST", { projectId: "test", profileId: model ? profile : "test-stream" }); const id = chat?.id ?? chat?.chat?.id;
  await api(`/v0/chats/${id}/models`, "PATCH", { model: model ?? "fast-250" }); return id; };
const id = await fresh(), phoneId = await fresh();
await app.close();
// The app in a tab of its own; each side's tab is brought forward as it sends (a hidden tab draws no frames).
const cdp = await b.newBrowserCDPSession();
const appTab = await ctx.newPage(); await appTab.goto(`http://127.0.0.1:4310/chat/${id}`, { waitUntil: "commit" });
await g.goto(`http://127.0.0.1:5180/gallery.html?live=${phoneId}`); await g.waitForTimeout(2500);
await g.click(".g-toggle button:text-is('Phone · live chat')"); await g.waitForTimeout(5000);
const live = appTab;
let f = g.frames().find((f) => f.url().includes("frame=live")), ftab = g, solo;
// Measured, the phone page is opened in a tab of its own, its viewport the gallery frame's: inside the gallery it shares
// its renderer with every card there, whose layers it re-layerizes each frame the transcript scrolls (2-13ms bursts).
if (budget) {
  const [w, h] = await f.evaluate(() => [innerWidth, innerHeight]); const url = f.url();
  await g.goto(back); await g.waitForTimeout(1000);
  solo = await ctx.newPage(); await (await ctx.newCDPSession(solo)).send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 0, mobile: false });
  await solo.goto(url, { waitUntil: "commit" }); await g.waitForTimeout(6000);
  f = solo; ftab = solo;
}
// Also: each answer drawn and then taken away (text that turned out to come before a tool call), and for how long it showed.
const REC = (S) => { const log = window.__log = []; const pulled = window.__pulled = []; const t = (e) => (e?.textContent ?? "").replace(/\s+/g, " ").trim(); let last = "";
  let shown = null;
  const tick = () => {
    const answer = [...document.querySelectorAll(".message-assistant [data-slot=bubble-content]")].filter((e) => t(e)).at(-1);
    if (answer && answer !== shown?.el) shown = { el: answer, at: performance.now(), text: t(answer) };
    else if (shown && !shown.el.isConnected) { pulled.push(`${Math.round(performance.now() - shown.at)}ms "${shown.text.slice(0, 50)}"`); shown = null; }
    else if (shown) shown.text = t(shown.el); const traces = document.querySelectorAll(".turn-trace"); const tr = traces[traces.length - 1];
    const s = tr ? `${t(tr.querySelector(S.line)).replace(/ · \d+(\.\d+)?(ms|s)\b| · \d+m \d+s/g, " · T")} | ${t(tr.querySelector(S.latest)).slice(0, 80)}` : "";
    if (s !== last) { log.push([s, performance.now()]); last = s; performance.mark(`state ${s.split(" | ")[0].replace(/ · .*/, "")}`); } // Whether the transcript scrolled this frame, as marks: a slow frame is told apart by it.
    const sc = window.__sc ??= (() => { let el = tr; while (el && !(el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement; return el; })();
    const top = sc?.scrollTop ?? 0; const moving = top !== window.__top; if (moving !== window.__moving) performance.mark(moving ? "scroll on" : "scroll off"); window.__moving = moving; window.__top = top;
    window.__raf = requestAnimationFrame(tick); }; tick(); };
const pulled = {}, tasks = {};
// The busiest renderer main thread over the turn, and each task on it over budget: the trace's state then (from the
// recorder's "state ..." marks), what ran inside it, its costliest script and the CSS animations running.
const traced = async (run) => {
  if (!budget) return run();
  const events = []; const onData = (d) => events.push(...d.value); cdp.on("Tracing.dataCollected", onData);
  const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "toplevel", "blink.user_timing"] } });
  const out = await run(); await cdp.send("Tracing.end"); await done; cdp.off("Tracing.dataCollected", onData);
  const key = (e) => `${e.pid}:${e.tid}`, task = (e) => e.ph === "X" && e.dur && (e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask");
  const mains = new Set(events.filter((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain").map(key));
  const busy = {}; for (const e of events) if (task(e) && mains.has(key(e))) busy[key(e)] = (busy[key(e)] ?? 0) + e.dur;
  const main = Object.entries(busy).sort((a, z) => z[1] - a[1])[0]?.[0];
  const list = events.filter((e) => e.ph === "X" && key(e) === main).sort((a, z) => a.ts - z.ts || z.dur - a.dur);
  const all = []; let end = -1; for (const e of list) if (task(e) && e.ts >= end) { all.push(e); end = e.ts + e.dur; }
  const marks = events.filter((e) => e.name.startsWith("state ") && `${e.pid}` === main.split(":")[0]).sort((a, z) => a.ts - z.ts);
  const scrolls = events.filter((e) => e.name.startsWith("scroll o") && `${e.pid}` === main.split(":")[0]).sort((a, z) => a.ts - z.ts);
  const scrolling = (ts) => scrolls.findLast((x) => x.ts <= ts)?.name === "scroll on";
  const stateAt = (ts) => { const m = marks.findLast((x) => x.ts <= ts); return m ? [m.name.slice(6), Math.round((ts - m.ts) / 1000)] : ["before", 0]; };
  const anims = {}; for (const e of events) if (e.name === "Animation" && (e.ph === "b" || e.ph === "e") && `${e.pid}` === main.split(":")[0]) { const k = `${e.pid}:${e.id2?.local ?? e.id}`; anims[k] ??= {}; anims[k][e.ph] = e.ts; if (e.ph === "b") anims[k].name = `${e.args?.data?.displayName || e.args?.data?.name}@${String(e.args?.data?.nodeName ?? "").replace(/^\w+ class='([^' ]+).*/, "$1")}`; }
  const per = {}, lines = [];
  for (const t of all) {
    const [state, into] = stateAt(t.ts); per[state] ??= [0, 0]; per[state][0]++;
    if (t.dur <= 6940) continue; per[state][1]++;
    const inside = list.filter((e) => e !== t && !task(e) && e.ts >= t.ts && e.ts < t.ts + t.dur);
    const sum = {}; for (const e of inside) if (!["FunctionCall", "EventDispatch", "TimerFire", "FireAnimationFrame", "RunMicrotasks", "Receive mojo message", "BlinkScheduler_PerformMicrotaskCheckpoint"].includes(e.name)) sum[e.name] = (sum[e.name] ?? 0) + e.dur / 1000;
    const fns = {}; for (const e of inside) if (e.name === "FunctionCall" || e.name === "EvaluateScript") { const d = e.args?.data ?? {}; const k = `${d.functionName || (e.name === "EvaluateScript" ? "load" : "anon")} ${String(d.url).split("/").pop()}:${d.lineNumber}`; fns[k] = (fns[k] ?? 0) + e.dur / 1000; }
    const running = {}; for (const a of Object.values(anims)) if (a.b <= t.ts + t.dur && (a.e ?? Infinity) >= t.ts) running[a.name] = (running[a.name] ?? 0) + 1;
    const top = (o, n) => Object.entries(o).sort((a, z) => z[1] - a[1]).slice(0, n);
    const layout = inside.filter((e) => e.name === "Layout").sort((a, z) => z.dur - a.dur)[0]?.args?.beginData;
    lines.push(`   ${(t.dur / 1000).toFixed(1)}ms  ${state} +${into}ms${scrolling(t.ts) ? " scrolling" : ""}  ${layout ? `[layout ${layout.dirtyObjects}/${layout.totalObjects}] ` : ""}${top(sum, 3).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(", ")}`
      + `${top(fns, 1).map(([k, v]) => ` | script ${k} ${v.toFixed(1)}`).join("")}${Object.keys(running).length ? ` | animating ${top(running, 4).map(([k, n]) => `${k}×${n}`).join(" ")}` : ""}`);
  }
  return { out, tasks: `${all.length} tasks, ${all.filter((e) => e.dur > 6940).length} over 6.94ms, ${all.filter((e) => e.dur > 16700).length} over 16.7ms, longest ${(Math.max(0, ...all.map((e) => e.dur)) / 1000).toFixed(1)}ms`
    + ` (over budget per state: ${Object.entries(per).map(([k, [n, over]]) => `${k} ${over}/${n}`).join(", ")})\n${lines.join("\n")}` };
};
// The window sending is brought forward: a window covered by another draws no frames.
const send = async (page, S, tab) => {
  await tab.bringToFront();
  await page.evaluate(REC, S);
  await page.evaluate(() => document.querySelector(".composer-keyboard-trigger, [aria-label='Type a message']")?.click());
  const ta = page.locator(".chat-main textarea").first(); await ta.fill(prompt); await ta.press("Enter");
  // Stopped at the same point on each side: as it first starts writing.
  if (stop) { await page.waitForFunction(() => /^Writing /.test(window.__log.at(-1) ?? ""), null, { timeout: 60_000 }); await page.evaluate(() => [...document.querySelectorAll("[aria-label='Stop response']")].find((e) => e.getClientRects().length && getComputedStyle(e).opacity !== "0")?.click()); }
  await page.waitForFunction(() => window.__log.length > 2 && /^(Done|Interrupted|Failed) /.test(window.__log.at(-1)?.[0] ?? ""), null, { timeout: 240_000 });
  await page.waitForTimeout(1000); await page.evaluate(() => cancelAnimationFrame(window.__raf));
  pulled[page === live ? "app" : "library"] = await page.evaluate(() => window.__pulled);
  // What a reader sees change: the Status line, and whether the Latest line is a tool's or prose.
  // Each state for how long it showed; a blank Latest line while thinking is the renderer loading, not a state.
  const out = [];
  for (const [[line, at], next] of (await page.evaluate(() => window.__log)).map((entry, i, all) => [entry, all[i + 1]?.[1] ?? entry[1] + 1000])) {
    const [status, latest] = line.split(" | "); if (/^(Thinking|Writing) /.test(status) && !latest) continue;
    const state = `${status} | ${/^(Read|Edited|Ran|Searched|Fetched) /.test(latest) ? latest : latest ? "prose" : ""}`;
    if (out.at(-1)?.state === state) out.at(-1).ms += next - at; else out.push({ state, ms: next - at });
  }
  return out;
};
try {
  const both2 = [await traced(() => send(live, { line: ".turn-trace-line", latest: ".turn-trace-summary" }, live)), await traced(() => send(f, { line: ".ui-trace-line", latest: ".ui-trace-latest" }, ftab))];
  const [a, z] = budget ? both2.map((x) => x.out) : both2;
  if (budget) console.log(`frame budget -- app: ${both2[0].tasks}\nlibrary: ${both2[1].tasks}`);
  // A state held a moment either side's frames may miss; one shown 150ms or more must show on both, in the same order.
  const show = (list) => list.map(({ state, ms }) => `${state}  ${Math.round(ms)}ms`).join("\n         ");
  console.log("app:    ", show(a)); console.log("library:", show(z));
  console.log("answers taken away -- app:", pulled.app.join(", ") || "none", "· library:", pulled.library.join(", ") || "none");
  const missing = [...a.filter(({ state, ms }) => ms >= 150 && !z.some((x) => x.state === state)).map(({ state }) => `library never shows "${state}"`),
    ...z.filter(({ state, ms }) => ms >= 150 && !a.some((x) => x.state === state)).map(({ state }) => `app never shows "${state}"`)];
  const both = (list, other) => list.map(({ state }) => state).filter((state) => other.some((x) => x.state === state));
  if (both(a, z).join("\n") !== both(z, a).join("\n")) missing.push("the states both show come in a different order");
  if (!model) console.log(missing.length ? `✗ ${missing.join("; ")}` : "✓ same states");
} finally { await live?.close(); await solo?.close(); await g.goto(back); await b.close(); }
