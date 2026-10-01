#!/usr/bin/env node
/**
 * Does anything move after the first open's fade starts? Reloads a page and
 * takes screenshots as fast as the compositor gives them for a few seconds,
 * alongside a timeline of attribute changes, animations and transitions (KaTeX
 * internals left out). Compare consecutive frames, or flip through them, to
 * find the moment something shifts and what changed then.
 *
 *   node scripts/probes/reload-settle.mjs --windows --out <dir> [--url <path>] [--seconds 4.5] [--right-half]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { arg, flag, open, recentChats, visit } from "./lib.mjs";

const out = arg("--out");
if (!out) { console.error("--out <dir> is required"); process.exit(2); }
const { page, cdp, close } = await open();
await visit(page, arg("--url") ?? `/chat/${(await recentChats(page, 1))[0]}`);
await cdp.send("Page.enable");
const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `
  window.__events = [];
  const name = (node) => node.tagName.toLowerCase() + (typeof node.className === "string" && node.className ? "." + node.className.split(" ").slice(0, 2).join(".") : "");
  const at = () => Math.round(performance.now());
  new MutationObserver((records) => { for (const record of records) { const element = record.target; if (record.type !== "attributes" || element.closest?.(".katex")) continue; window.__events.push(at() + " " + record.attributeName + " @ " + name(element) + " = " + String(element.getAttribute(record.attributeName)).slice(0, 70)); } }).observe(document, { attributes: true, subtree: true });
  for (const type of ["animationstart", "animationend", "transitionend"]) document.addEventListener(type, (event) => window.__events.push(at() + " " + type + " " + (event.animationName || event.propertyName) + " @ " + name(event.target)), true);
` });
const { width, height } = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
const clip = flag("--right-half") ? { x: width / 2, y: 0, width: width / 2, height, scale: 1 } : { x: 0, y: 0, width, height, scale: 1 };
const within = (promise) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 800))]);
page.reload().catch(() => {});
const shots = [];
const end = Date.now() + Number(arg("--seconds", "4.5")) * 1000;
while (Date.now() < end) {
  try {
    const { data } = await within(cdp.send("Page.captureScreenshot", { format: "png", clip }));
    const time = await within(page.evaluate(() => Math.round(performance.now()))).catch(() => -1);
    shots.push([time, data]);
  } catch {}
}
await page.waitForTimeout(300);
const events = (await page.evaluate(() => window.__events).catch(() => null)) ?? [];
await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
await fs.mkdir(out, { recursive: true });
await Promise.all(shots.map(([time, data], index) => fs.writeFile(path.join(out, `${String(index).padStart(3, "0")}-${time}ms.png`), Buffer.from(data, "base64"))));
await fs.writeFile(path.join(out, "events.txt"), events.join("\n"));
console.log(`${shots.length} frames and ${events.length} events in ${out} (file names are ms since navigation)`);
await close();
