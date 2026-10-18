#!/usr/bin/env node
/**
 * How the transcript moves on screen while an answer streams, read from the pixels (docs/testing.md, Frame budget):
 * the browser's screencast, each frame matched against the one before for the vertical shift of the text column.
 * Nothing runs in the page but a note of when each code block opens, so the measurement cannot change the timing it
 * measures (visibility-guard.mjs reads layout every frame; this does not). Following, the text only ever moves up,
 * and smoothly: every frame it moved down, reversed within a few frames (an oscillation), or jumped up further than
 * --snap a frame drawn (a snap; --hz, 144 by default) is listed with the time since the last code block opened. A
 * capture spans about two frames at 144Hz, so one whose whole shift is over --snap is listed as a possible snap.
 *
 *   node scripts/probes/screen-shift.mjs ["rich 3000t"] [--phone] [--seconds 25]
 */
import sharp from "sharp";
import { arg, cdpOrigin, flag, loadPlaywright, origin } from "./lib.mjs";

const prompt = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "rich 3000t";
const phone = flag("--phone");
const { chromium } = await loadPlaywright();
const b = await chromium.connectOverCDP(cdpOrigin); const ctx = b.contexts()[0];
const tmp = await ctx.newPage(); await tmp.goto(origin, { waitUntil: "commit" }); await tmp.waitForTimeout(1200);
const api = (url, method, body) => tmp.evaluate(async ([url, method, body]) => (await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json().catch(() => null), [url, method, body]);
const chat = await api("/v0/chats", "POST", { projectId: "test", profileId: "test-stream" }); const id = chat?.id ?? chat?.chat?.id;
await api(`/v0/chats/${id}/models`, "PATCH", { model: "fast-250" });
const page = await ctx.newPage(); await page.bringToFront();
const s = await ctx.newCDPSession(page);
const size = phone ? { width: 412, height: 860, deviceScaleFactor: 2.625, mobile: true } : { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };
await s.send("Emulation.setDeviceMetricsOverride", size);
if (phone) await s.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
const frames = [];
let fences = [];
try {
  await page.goto(`${origin}/chat/${id}`); await page.waitForTimeout(5000);
  // When each code block (a fence, pending or drawn) first appears: wall-clock ms, as the screencast's timestamps are.
  // --log: the transcript's virtualization log (collapse, expand, re-measure) and every backward scroll, on the
  // screencast's clock, printed beside each frame that moved down.
  if (flag("--log")) await page.evaluate(() => { const log = globalThis.__visibilityLog = []; const v = document.querySelector(".message-scroller-viewport"); let last = v.scrollTop;
    v.addEventListener("scroll", () => { const d = v.scrollTop - last; last = v.scrollTop; if (d < -2) log.push({ at: Date.now(), op: "scroll back", by: +d.toFixed(1), top: v.scrollTop, height: v.scrollHeight }); }, { passive: true }); });
  await page.evaluate(() => { const w = window; w.__fences = []; const seen = new WeakSet();
    new MutationObserver(() => { for (const el of document.querySelectorAll(".ui-answer .ui-code")) if (!seen.has(el)) { seen.add(el); w.__fences.push(Date.now()); } })
      .observe(document.querySelector(".thread") ?? document.body, { childList: true, subtree: true }); });
  const column = await page.evaluate(() => { const r = (document.querySelector(".thread") ?? document.body).getBoundingClientRect(); const v = document.querySelector(".message-scroller-viewport").getBoundingClientRect(); return { left: r.left, width: r.width, top: v.top, height: v.height }; });
  s.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => { frames.push({ at: metadata.timestamp * 1000, data }); s.send("Page.screencastFrameAck", { sessionId }).catch(() => {}); });
  await page.evaluate(() => document.querySelector(".composer-keyboard-trigger, [aria-label='Type a message']")?.click());
  const ta = page.locator(".chat-main textarea").first(); await ta.fill(prompt);
  await s.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: size.width, maxHeight: size.height });
  await ta.press("Enter");
  await page.waitForFunction(() => /^(Done|Interrupted|Failed)/.test(document.querySelector(".ui-trace-line")?.textContent ?? ""), null, { timeout: Number(arg("--seconds", 120)) * 1000, polling: 500 }).catch(() => {});
  await page.waitForTimeout(1500);
  await s.send("Page.stopScreencast");
  fences = await page.evaluate(() => window.__fences);
  frames.log = await page.evaluate(() => globalThis.__visibilityLog ?? []);
  frames.column = column;
} finally { await page.close(); await api(`/v0/sessions/${id}`, "DELETE"); await tmp.close(); await b.close(); }

// Grey rows of the text column, the composer and header left out: the viewport's middle 70%.
const { column } = frames;
const decode = async (frame) => { const image = sharp(Buffer.from(frame.data, "base64")); const meta = await image.metadata(); const scale = meta.width / size.width;
  const left = Math.max(0, Math.round(column.left * scale)), width = Math.min(meta.width - left, Math.round(column.width * scale));
  const top = Math.round((column.top + column.height * 0.1) * scale), height = Math.round(column.height * 0.7 * scale);
  const { data } = await image.extract({ left, top, width, height }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data, width, height, scale }; };
// The shift that best maps the previous frame onto this one (rows of the previous at y land at y + dy here).
const shiftOf = (a, z, range) => { let best = 0, bestCost = Infinity; const step = Math.max(1, Math.floor(a.width / 160));
  for (let dy = -range; dy <= range; dy++) { let cost = 0, n = 0;
    for (let y = Math.max(0, -dy); y < Math.min(a.height, a.height - dy); y += 2) { const ra = y * a.width, rz = (y + dy) * a.width;
      for (let x = 0; x < a.width; x += step) { cost += Math.abs(a.data[ra + x] - z.data[rz + x]); n++; } }
    cost /= Math.max(1, n); if (cost < bestCost - 1e-9) { bestCost = cost; best = dy; } }
  return { dy: best, cost: bestCost }; };
const decoded = []; for (const frame of frames) decoded.push({ at: frame.at, ...(await decode(frame)) });
// Wide enough for a snap: a frame that jumps further than the range is matched to the wrong offset.
const range = Math.round(Number(arg("--range", 320)) * (decoded[0]?.scale ?? 1));
const moves = [];
// The screencast keeps up with about every other frame at 144Hz, so a shift between two captures is over the frames
// drawn between them: a snap is judged per frame drawn (--hz), not per capture.
const frameMs = 1000 / Number(arg("--hz", 144));
for (let i = 1; i < decoded.length; i++) { const { dy, cost } = shiftOf(decoded[i - 1], decoded[i], range); const spans = Math.max(1, Math.round((decoded[i].at - decoded[i - 1].at) / frameMs));
  moves.push({ at: decoded[i].at, dy: dy / decoded[i].scale, perFrame: dy / decoded[i].scale / spans, spans, cost }); }
const sinceFence = (at) => { const last = fences.filter((f) => f <= at).at(-1); return last == null ? "-" : `${((at - last) / 1000).toFixed(2)}s after a code block opened`; };
const down = moves.filter((m) => m.dy > 0.5);
// A snap: one frame moving the text further than a smooth follow does (the spring's steps are a few pixels to ~20).
const snaps = moves.filter((m) => m.perFrame < -Number(arg("--snap", 40)));
// Spread over the frames between two captures a shift reads smaller than it may have been: a 70px jump in one of two
// frames reads 35px a frame. Each capture whose whole shift is over --snap is listed too, as a possible snap -- the
// per-frame scroll log (scrollTop every frame) tells which it was.
const possible = moves.filter((m) => m.dy < -Number(arg("--snap", 40)) && !snaps.includes(m));
// A reversal: up then down (or down then up) within 5 frames, each over 1px.
const list = (ms) => ms.map((m) => `${((m.at - (moves[0]?.at ?? 0)) / 1000).toFixed(2)}s ${m.dy.toFixed(0)}px over ${m.spans} frames, ${sinceFence(m.at)}`).slice(0, 8).join("; ");
const reversals = moves.filter((m, i) => m.dy > 1 && moves.slice(Math.max(0, i - 5), i).some((p) => p.dy < -1));
console.log(`"${prompt}" ${phone ? "phone" : "desktop"}: ${frames.length} frames, ${fences.length} code blocks opened`);
console.log(`moved down: ${down.length} frames, ${down.reduce((a, m) => a + m.dy, 0).toFixed(0)}px; up-then-down reversals: ${reversals.length}; snaps up over ${arg("--snap", 40)}px a frame: ${snaps.length}${snaps.length ? ` (${list(snaps)})` : ""}; possible snaps (over ${arg("--snap", 40)}px across several frames): ${possible.length}${possible.length ? ` (${list(possible)})` : ""}`);
const t0 = moves[0]?.at ?? 0;
// --frames <dir>: also the frames either side of the first snap of each burst.
if (arg("--frames", null)) { const fs = await import("node:fs"); const dir = arg("--frames", null); fs.mkdirSync(dir, { recursive: true });
  for (const m of snaps.filter((m, k) => k === 0 || m.at - snaps[k - 1].at > 500)) { const i = moves.indexOf(m);
    for (const k of [-1, 0, 1, 4]) if (frames[i + 1 + k]) fs.writeFileSync(`${dir}/snap-${((m.at - t0) / 1000).toFixed(2)}s_${k}.png`, Buffer.from(frames[i + 1 + k].data, "base64")); } }
for (const m of down.slice(0, Number(arg("--list", 25)))) {
  const i = moves.indexOf(m); const around = moves.slice(Math.max(0, i - 4), i + 5).map((x) => (x === m ? `[${x.dy.toFixed(0)}]` : x.dy.toFixed(0))).join(" ");
  for (const e of (frames.log ?? []).filter((e) => Math.abs(e.at - m.at) < 300)) console.log(`      ${((e.at - m.at)).toFixed(0)}ms: ${JSON.stringify(e)}`);
  // --frames <dir>: the frames either side of a move down over 20px, to look at.
  if (arg("--frames", null) && m.dy > 20) { const fs = await import("node:fs"); const dir = arg("--frames", null); fs.mkdirSync(dir, { recursive: true });
    for (const [k, frame] of [[-1, frames[i]], [0, frames[i + 1]], [1, frames[i + 2]]]) if (frame) fs.writeFileSync(`${dir}/${((m.at - t0) / 1000).toFixed(2)}s_${k}.png`, Buffer.from(frame.data, "base64")); }
  console.log(`  ${((m.at - t0) / 1000).toFixed(2)}s down ${m.dy.toFixed(1)}px (${sinceFence(m.at)}); shifts around: ${around}`);
}
