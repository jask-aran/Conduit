#!/usr/bin/env node
/**
 * Does pressing a handle move anything? Presses and holds a resize handle
 * (pane gutter, dock edge), then releases it, recording on every frame how far
 * each formula, table and answer block has moved from where it rested, every
 * DOM mutation by kind, and whether the screen changed at all.
 *
 * The bar is no movement and identical screenshots: pressing only starts a
 * drag. A shift on press is usually a rule that applies only while a handle is
 * held (paint containment, will-change, a compositing layer) snapping text to
 * whole device pixels -- so run it with --windows at the user's scaling.
 *
 *   node scripts/probes/press-shift.mjs --windows [--url <path>] [--selector .main-split-resize] [--index 0] [--out dir]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { arg, capture, open, recentChats, visit } from "./lib.mjs";

const { page, cdp, close } = await open();
const selector = arg("--selector", ".main-split-resize");
const address = arg("--url") ?? await recentChats(page, 2).then(([a, b]) => `/chat/${a}?pane=chat%3A${b}`);
await visit(page, address);
const handles = await page.evaluate((selector) => [...document.querySelectorAll(selector)].map((handle) => { const box = handle.getBoundingClientRect(); return [box.x + box.width / 2, box.y + box.height / 2]; }), selector);
console.log(`${handles.length} × ${selector}, devicePixelRatio ${await page.evaluate(() => devicePixelRatio)}`);
if (!handles.length) { await close(); process.exit(1); }

// What changes pixels on its own -- the meteor field, the orbs' canvases, a
// blinking caret, running animations -- is stilled, so a changed screenshot
// means the layout moved.
await page.addStyleTag({ content: ".solid-meteor-shower, canvas { visibility: hidden !important; } * { caret-color: transparent !important; animation-play-state: paused !important; }" });
await page.waitForTimeout(300);
await page.evaluate(() => {
  const watched = () => [...document.querySelectorAll(".katex-display > .katex, .markdown-table-scroll, .chat-markdown > .incremark > *")];
  const rect = (element) => { const box = element.getBoundingClientRect(); return [box.left, box.top, box.width]; };
  const name = (node) => node.tagName.toLowerCase() + (typeof node.className === "string" && node.className ? "." + node.className.split(" ").slice(0, 2).join(".") : "");
  const elements = watched();
  const base = elements.map(rect);
  window.__probe = { log: [], mutations: {} };
  window.__probe.observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target.nodeType === 3 ? record.target.parentElement : record.target;
      const key = `${record.type} ${record.attributeName ?? ""} @ ${name(target)}`;
      window.__probe.mutations[key] = (window.__probe.mutations[key] ?? 0) + 1;
    }
  });
  window.__probe.observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
  const t0 = performance.now();
  const tick = () => {
    const moved = elements.map((element, index) => {
      const [left, top, width] = rect(element);
      const [l0, t0, w0] = base[index];
      return [index, name(element), +(left - l0).toFixed(3), +(top - t0).toFixed(3), +(width - w0).toFixed(3)];
    }).filter(([, , dx, dy, dw]) => dx || dy || dw);
    window.__probe.log.push([Math.round(performance.now() - t0), moved]);
    if (performance.now() - t0 < 1600) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const [x, y] = handles[Number(arg("--index", "0"))];
const before = await capture(cdp, page);
await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(400);
const held = await capture(cdp, page);
await page.mouse.up(); await page.waitForTimeout(700);
const after = await capture(cdp, page);
const result = await page.evaluate(() => { window.__probe.observer.disconnect(); return window.__probe; });

console.log(`screen unchanged on press: ${before.equals(held)}, after release: ${before.equals(after)}`);
let previous = "";
for (const [time, moved] of result.log) {
  const line = JSON.stringify(moved.slice(0, 8));
  if (line !== previous) console.log(`${String(time).padStart(5)}ms ${moved.length} moved ${line}`);
  previous = line;
}
console.log("mutations:");
for (const [key, count] of Object.entries(result.mutations).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(String(count).padStart(5), key.slice(0, 160));
const out = arg("--out");
if (out) {
  await fs.mkdir(out, { recursive: true });
  await Promise.all([["before", before], ["held", held], ["after", after]].map(([label, png]) => fs.writeFile(path.join(out, `${label}.png`), png)));
  console.log(`screenshots in ${out}`);
}
await close();
