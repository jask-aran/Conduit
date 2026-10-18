#!/usr/bin/env node
/**
 * Does the transcript's virtualization ever show the reader something wrong? (docs/testing.md, Frame budget.) It
 * streams one long Test-profile answer and scrolls it the ways a reader and the app do -- the tail follow, a wheel up
 * through it while it streams, a jump to the top with no input (a programmatic scroll), a wheel back down, Scroll to
 * latest, then the settled answer wheeled from top to bottom -- and checks every frame:
 *
 *   blank   a block -- or a row with none, managed whole -- hidden (data-transcript-visibility) while it intersects
 *           the viewport: the reader sees a hole
 *   moved   the first visible block moved on screen by other than the scroll did: something above it changed
 *           height and the page shifted (one that scroll anchoring absorbs is not counted)
 *   down    while the answer is followed, the page moved down: it only ever moves up as the answer grows
 *   wrong   a hidden block's placeholder height differs from its height once shown (measured as it is revealed)
 *
 * Each is reported per phase, with the frames counted. Run it before and after a change to the transcript's
 * virtualization or layout; the counts must not rise. Frame timing is not measured here (it reads layout every
 * frame); turn-profile.mjs is for that.
 *
 *   node scripts/probes/visibility-guard.mjs ["rich 9000t"] [--phone]
 */
import { cdpOrigin, flag, loadPlaywright, origin } from "./lib.mjs";

const prompt = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "rich 9000t";
const phone = flag("--phone");
const { chromium } = await loadPlaywright();
const b = await chromium.connectOverCDP(cdpOrigin); const ctx = b.contexts()[0];
const tmp = await ctx.newPage(); await tmp.goto(origin, { waitUntil: "commit" }); await tmp.waitForTimeout(1200);
const api = (url, method, body) => tmp.evaluate(async ([url, method, body]) => (await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json().catch(() => null), [url, method, body]);
const chat = await api("/v0/chats", "POST", { projectId: "test", profileId: "test-stream" }); const id = chat?.id ?? chat?.chat?.id;
await api(`/v0/chats/${id}/models`, "PATCH", { model: "fast-250" });
// A tab of its own in the window already open, brought forward (a hidden tab draws no frames), its viewport emulated.
const page = await ctx.newPage(); await page.bringToFront();
const s = await ctx.newCDPSession(page);
await s.send("Emulation.setDeviceMetricsOverride", phone ? { width: 412, height: 860, deviceScaleFactor: 2.625, mobile: true } : { width: 1280, height: 900, deviceScaleFactor: 0, mobile: false });
if (phone) await s.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
const results = [];
try {
  await page.goto(`${origin}/chat/${id}`); await page.waitForTimeout(5000);
  // The checks, every frame, in the page.
  await page.evaluate(() => {
    const w = window; const viewport = document.querySelector(".message-scroller-viewport");
    w.__guard = { phase: "start", phases: {} };
    // What the transcript virtualizes: every block of an answer, and each row with none (a prompt, a trace) whole.
    const blocks = () => [...document.querySelectorAll('[data-slot="message-scroller-item"]')].flatMap((row) => {
      const inner = row.querySelectorAll(".chat-markdown > .incremark > *"); return inner.length ? [...inner] : [row]; });
    const placeholders = new WeakMap(); let heights = new Map();
    let anchor = null, anchorTop = 0, anchorScroll = 0;
    const tick = () => {
      const g = w.__guard; const p = g.phases[g.phase] ??= { frames: 0, blankFrames: 0, blankMax: 0, movedFrames: 0, movedPx: 0, movedMax: 0, wrong: 0, wrongPx: 0, revealed: 0 };
      p.frames++;
      const view = viewport.getBoundingClientRect(); const scrollTop = viewport.scrollTop;
      let blank = 0, first = null, firstTop = 0; const now = new Map();
      for (const element of blocks()) {
        // Collapsed (out of layout, its run's height held by a spacer) is neither shown nor a placeholder.
        if (element.getAttribute("data-transcript-visibility") === "collapsed") { placeholders.delete(element); continue; }
        const rect = element.getBoundingClientRect(); now.set(element, [rect.height, element.getAttribute("data-transcript-visibility") ?? "shown", rect.top - view.top]);
        const hidden = element.getAttribute("data-transcript-visibility") === "hidden";
        if (hidden) placeholders.set(element, rect.height);
        else if (placeholders.has(element)) {
          // Only where it shows: a block re-measured out of view (below it) moves nothing the reader sees.
          const was = placeholders.get(element); const delta = Math.abs(rect.height - was); p.revealed++;
          // In view or just above it: a block that grows below the viewport (the streamed tail, re-measured) moves nothing.
          const near = rect.bottom > view.top - 120 && rect.top < view.bottom;
          if (delta > 0.5 && !near) p.offscreen = (p.offscreen ?? 0) + 1;
          if (delta > 0.5 && near) { p.wrong++; p.wrongPx += delta;
            (g.examples ??= []).length < 40 && g.examples.push(`${g.phase}: ${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]}${element.querySelector("[data-collapsed]") ? "[collapsible]" : ""} ${was.toFixed(2)} -> ${rect.height.toFixed(2)} style=${element.style.cssText}`); }
          placeholders.delete(element);
        }
        const inView = rect.bottom > view.top + 1 && rect.top < view.bottom - 1 && rect.height > 0;
        if (inView && hidden) { blank++; (g.blanks ??= []).length < 40 && g.blanks.push(`${g.phase}: ${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]} ${(rect.top - view.top).toFixed(0)}..${(rect.bottom - view.top).toFixed(0)} of ${view.height.toFixed(0)}, scroll ${(scrollTop - (g.lastScrollTop ?? scrollTop)).toFixed(0)}`); }
        if (inView && !hidden && !first) { first = element; firstTop = rect.top; }
      }
      if (blank) { p.blankFrames++; p.blankMax = Math.max(p.blankMax, blank); }
      // Visible movement no scroll explains: the first visible block moved on screen by other than the scroll did.
      // A change above it that scroll anchoring absorbs moves nothing on screen and is not counted.
      if (first && first === anchor) {
        const screen = firstTop - anchorTop;
        // Following, the page only ever moves up as the answer grows: any move down is a jump the reader sees.
        if (/follow/.test(g.phase) && screen > 0.5) { p.downFrames = (p.downFrames ?? 0) + 1; p.downPx = (p.downPx ?? 0) + screen;
          (g.moves ??= []).length < 30 && g.moves.push(`${g.phase}: DOWN ${screen.toFixed(1)} ${first.tagName.toLowerCase()}.${String(first.className).split(" ")[0]} at ${(firstTop - view.top).toFixed(0)}, scroll ${(scrollTop - anchorScroll).toFixed(1)}, max ${(viewport.scrollHeight - viewport.clientHeight - scrollTop).toFixed(0)} from bottom`); } const moved = Math.abs(screen) > 0.5 ? Math.abs(screen + (scrollTop - anchorScroll)) : 0;
        if (moved > 0.5) { (g.moves ??= []).length < 20 && g.moves.push(`${g.phase}: ${first.tagName.toLowerCase()}.${String(first.className).split(" ")[0]} at ${(firstTop - view.top).toFixed(0)} moved ${screen.toFixed(1)}, scroll ${(scrollTop - (g.lastScrollTop ?? scrollTop)).toFixed(0)}`);
          p.movedFrames++;
          for (const [element, [h, state, top]] of now) { const was = heights.get(element); if (was && Math.abs(was[0] - h) > 0.5 && top < firstTop - view.top) g.moves.push(`   changed above: ${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]} ${was[0].toFixed(1)} ${was[1]} -> ${h.toFixed(1)} ${state}`); } p.movedPx += moved; p.movedMax = Math.max(p.movedMax, moved); }
      }
      heights = now; anchor = first; anchorTop = firstTop; anchorScroll = scrollTop; g.lastScrollTop = scrollTop;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const phase = (name) => page.evaluate((name) => { window.__guard.phase = name; }, name);
  const wheel = async (dy, steps, pause = 40) => { const box = await page.locator(".message-scroller-viewport").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy); await page.waitForTimeout(pause); } };
  const state = () => page.evaluate(() => document.querySelector(".ui-trace-line, .turn-trace-line")?.textContent ?? "");
  await page.evaluate(() => document.querySelector(".composer-keyboard-trigger, [aria-label='Type a message']")?.click());
  const ta = page.locator(".chat-main textarea").first(); await ta.fill(prompt); await ta.press("Enter");
  await page.waitForFunction(() => /^Writing/.test(document.querySelector(".ui-trace-line, .turn-trace-line")?.textContent ?? ""), null, { timeout: 60_000 });
  await phase("follow"); await page.waitForTimeout(20_000);
  await phase("wheel up, streaming"); await wheel(-500, 12);
  await page.waitForTimeout(1500);
  await phase("jump to top, no input"); await page.evaluate(() => { document.querySelector(".message-scroller-viewport").scrollTop = 0; });
  await page.waitForTimeout(1500);
  await phase("wheel down, streaming"); await wheel(400, 15);
  await page.waitForTimeout(1000);
  await phase("scroll to latest"); await page.evaluate(() => document.querySelector(".message-scroller-button")?.click());
  await page.waitForTimeout(3000);
  await phase("follow again");
  await page.waitForFunction(() => /^(Done|Interrupted|Failed)/.test(document.querySelector(".ui-trace-line, .turn-trace-line")?.textContent ?? ""), null, { timeout: 300_000, polling: 500 });
  await phase("settling"); await page.waitForTimeout(2500);
  await phase("settled: top"); await page.evaluate(() => { document.querySelector(".message-scroller-viewport").scrollTop = 0; }); await page.waitForTimeout(1000);
  await phase("settled: wheel down"); await wheel(350, 60, 30);
  await page.waitForTimeout(1000);
  results.push(await page.evaluate(() => window.__guard.phases), await state(), await page.evaluate(() => [...(window.__guard.examples ?? []), ...(window.__guard.blanks ?? []).map((b) => "blank " + b), ...(window.__guard.moves ?? []).map((b) => "moved " + b)]));
} finally { await page.close(); await api(`/v0/sessions/${id}`, "DELETE"); await tmp.close(); await b.close(); }

const [phases, last, examples] = results;
console.log(`"${prompt}" ${phone ? "phone" : "desktop"}, ended "${last.replace(/\s+/g, " ").trim()}"`);
console.log("phase                      frames  blank(frames/max)  moved(frames/px/max)  wrong(of revealed/px) [off screen]  down while following(frames/px)");
let blank = 0, moved = 0, wrong = 0, down = 0;
for (const [name, p] of Object.entries(phases)) {
  blank += p.blankFrames; moved += p.movedFrames; wrong += p.wrong; down += p.downFrames ?? 0;
  console.log(`${name.padEnd(26)} ${String(p.frames).padStart(6)}  ${`${p.blankFrames}/${p.blankMax}`.padStart(17)}  ${`${p.movedFrames}/${p.movedPx.toFixed(0)}/${p.movedMax.toFixed(1)}`.padStart(20)}  ${`${p.wrong} of ${p.revealed}/${p.wrongPx.toFixed(0)}`.padStart(21)} [${p.offscreen ?? 0}]  ${p.downFrames ?? 0}/${(p.downPx ?? 0).toFixed(0)}`);
}
if (flag("--examples")) for (const example of examples) console.log("  ", /^(blank|moved)/.test(example) ? example : `wrong ${example}`);
console.log(`total: ${blank} blank frames, ${moved} moved frames, ${wrong} wrong placeholders, ${down} frames moved down while following`);
