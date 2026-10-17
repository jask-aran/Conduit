// Trace while it streams: does the library's Trace pass through the same states as the app's? The gallery's live
// phone (gallery.html?live=<chat>: the app's own chat store on the real server, drawn with components v2) and the app
// in a window of its own, each on a fresh Test-profile chat, in headed Chrome on CDP :9222. The same prompt is sent from
// each in turn -- the Test profile answers it the same way -- each recording its last trace's Status line and Latest
// line every frame; prints both sequences of what a reader sees change. A state shown 150ms or more on
// one side must show on the other, and the states both show come in the same order (one held a moment may be missed).
// From conduit-web, the gallery served and the server signed in in that Chrome:
//   node scripts/motion-check/trace-stream.mjs ["think 400 3 tools 600t"] [stop]
const { chromium } = await import(new URL("../../../.smoke-tools/node_modules/playwright/index.mjs", import.meta.url).href);
const flag = (name) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv.splice(at, 2)[1] : null; };
// --model <spec>: a real model on the Assistant profile; its two runs differ, so they are printed to read, not compared.
const model = flag("--model");
const prompt = process.argv[2] ?? (model ? "List the files in this folder, then read one of them, then tell me in three sentences what you found." : "think 400 3 tools 600t"), stop = process.argv[3] === "stop";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = b.contexts()[0];
const g = ctx.pages().find((p) => p.url().includes(":5180/gallery.html"));
const back = g.url();
const app = await ctx.newPage(); await app.goto("http://127.0.0.1:4310/", { waitUntil: "commit" }); await app.waitForTimeout(1500);
const api = (url, method, body) => app.evaluate(async ([url, method, body]) => (await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json(), [url, method, body]);
// A chat each: a window does not follow a turn another one sends on its chat (an app bug, not the library's).
const fresh = async () => { const chat = await api("/v0/chats", "POST", { projectId: "test", profileId: model ? "assistant" : "test-stream" }); const id = chat?.id ?? chat?.chat?.id;
  await api(`/v0/chats/${id}/models`, "PATCH", { model: model ?? "fast-250" }); return id; };
const id = await fresh(), phoneId = await fresh();
await app.close();
// The app in its own window, so both pages stay visible (a hidden tab draws no frames).
const cdp = await b.newBrowserCDPSession();
await cdp.send("Target.createTarget", { url: `http://127.0.0.1:4310/chat/${id}`, newWindow: true });
await g.goto(`http://127.0.0.1:5180/gallery.html?live=${phoneId}`); await g.waitForTimeout(2500);
await g.click(".g-toggle button:text-is('Phone · live chat')"); await g.waitForTimeout(5000);
const live = ctx.pages().find((p) => p.url().includes(`:4310/chat/${id}`));
const f = g.frames().find((f) => f.url().includes("frame=live"));
// Also: each answer drawn and then taken away (text that turned out to come before a tool call), and for how long it showed.
const REC = (S) => { const log = window.__log = []; const pulled = window.__pulled = []; const t = (e) => (e?.textContent ?? "").replace(/\s+/g, " ").trim(); let last = "";
  let shown = null;
  const tick = () => {
    const answer = [...document.querySelectorAll(".message-assistant [data-slot=bubble-content]")].filter((e) => t(e)).at(-1);
    if (answer && answer !== shown?.el) shown = { el: answer, at: performance.now(), text: t(answer) };
    else if (shown && !shown.el.isConnected) { pulled.push(`${Math.round(performance.now() - shown.at)}ms "${shown.text.slice(0, 50)}"`); shown = null; }
    else if (shown) shown.text = t(shown.el); const traces = document.querySelectorAll(".turn-trace"); const tr = traces[traces.length - 1];
    const s = tr ? `${t(tr.querySelector(S.line)).replace(/ · \d+(\.\d+)?(ms|s)\b| · \d+m \d+s/g, " · T")} | ${t(tr.querySelector(S.latest)).slice(0, 80)}` : "";
    if (s !== last) { log.push([s, performance.now()]); last = s; } window.__raf = requestAnimationFrame(tick); }; tick(); };
const pulled = {};
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
  const a = await send(live, { line: ".turn-trace-line", latest: ".turn-trace-summary" }, live);
  const z = await send(f, { line: ".ui-trace-line", latest: ".ui-trace-latest" }, g);
  // A state held a moment either side's frames may miss; one shown 150ms or more must show on both, in the same order.
  const show = (list) => list.map(({ state, ms }) => `${state}  ${Math.round(ms)}ms`).join("\n         ");
  console.log("app:    ", show(a)); console.log("library:", show(z));
  console.log("answers taken away -- app:", pulled.app.join(", ") || "none", "· library:", pulled.library.join(", ") || "none");
  const missing = [...a.filter(({ state, ms }) => ms >= 150 && !z.some((x) => x.state === state)).map(({ state }) => `library never shows "${state}"`),
    ...z.filter(({ state, ms }) => ms >= 150 && !a.some((x) => x.state === state)).map(({ state }) => `app never shows "${state}"`)];
  const both = (list, other) => list.map(({ state }) => state).filter((state) => other.some((x) => x.state === state));
  if (both(a, z).join("\n") !== both(z, a).join("\n")) missing.push("the states both show come in a different order");
  if (!model) console.log(missing.length ? `✗ ${missing.join("; ")}` : "✓ same states");
} finally { await live?.close(); await g.goto(back); await b.close(); }
