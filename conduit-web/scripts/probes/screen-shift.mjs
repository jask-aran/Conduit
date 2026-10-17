#!/usr/bin/env node
/**
 * How the transcript moves on screen while an answer streams, read from the pixels (docs/testing.md, Frame budget):
 * the browser's screencast, each frame matched against the one before for the vertical shift of the text column.
 * Nothing runs in the page but a note of when each code block opens, so the measurement cannot change the timing it
 * measures (visibility-guard.mjs reads layout every frame; this does not). Following, the text only ever moves up;
 * every frame it moved down, or reversed within a few frames (an oscillation), is listed with the time since the
 * last code block opened.
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
  await page.evaluate(() => { const w = window; w.__fences = []; const seen = new WeakSet();
    new MutationObserver(() => { for (const el of document.querySelectorAll(".chat-markdown .artifact")) if (!seen.has(el)) { seen.add(el); w.__fences.push(Date.now()); } })
      .observe(document.querySelector(".thread") ?? document.body, { childList: true, subtree: true }); });
  const column = await page.evaluate(() => { const r = (document.querySelector(".thread") ?? document.body).getBoundingClientRect(); const v = document.querySelector(".message-scroller-viewport").getBoundingClientRect(); return { left: r.left, width: r.width, top: v.top, height: v.height }; });
  s.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => { frames.push({ at: metadata.timestamp * 1000, data }); s.send("Page.screencastFrameAck", { sessionId }).catch(() => {}); });
  await page.evaluate(() => document.querySelector(".composer-keyboard-trigger, [aria-label='Type a message']")?.click());
  const ta = page.locator(".chat-main textarea").first(); await ta.fill(prompt);
  await s.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: size.width, maxHeight: size.height });
  await ta.press("Enter");
  await page.waitForFunction(() => /^(Done|Interrupted|Failed)/.test(document.querySelector(".ui-trace-line, .turn-trace-line")?.textContent ?? ""), null, { timeout: Number(arg("--seconds", 120)) * 1000, polling: 500 }).catch(() => {});
  await page.waitForTimeout(1500);
  await s.send("Page.stopScreencast");
  fences = await page.evaluate(() => window.__fences);
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
const range = Math.round(80 * (decoded[0]?.scale ?? 1));
const moves = [];
for (let i = 1; i < decoded.length; i++) { const { dy, cost } = shiftOf(decoded[i - 1], decoded[i], range); moves.push({ at: decoded[i].at, dy: dy / decoded[i].scale, cost }); }
const sinceFence = (at) => { const last = fences.filter((f) => f <= at).at(-1); return last == null ? "-" : `${((at - last) / 1000).toFixed(2)}s after a code block opened`; };
const down = moves.filter((m) => m.dy > 0.5);
// A reversal: up then down (or down then up) within 5 frames, each over 1px.
const reversals = moves.filter((m, i) => m.dy > 1 && moves.slice(Math.max(0, i - 5), i).some((p) => p.dy < -1));
console.log(`"${prompt}" ${phone ? "phone" : "desktop"}: ${frames.length} frames, ${fences.length} code blocks opened`);
console.log(`moved down: ${down.length} frames, ${down.reduce((a, m) => a + m.dy, 0).toFixed(0)}px; up-then-down reversals: ${reversals.length}`);
const t0 = moves[0]?.at ?? 0;
for (const m of down.slice(0, Number(arg("--list", 25)))) {
  const i = moves.indexOf(m); const around = moves.slice(Math.max(0, i - 4), i + 5).map((x) => (x === m ? `[${x.dy.toFixed(0)}]` : x.dy.toFixed(0))).join(" ");
  console.log(`  ${((m.at - t0) / 1000).toFixed(2)}s down ${m.dy.toFixed(1)}px (${sinceFence(m.at)}); shifts around: ${around}`);
}
