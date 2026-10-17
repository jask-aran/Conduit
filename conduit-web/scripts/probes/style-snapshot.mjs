#!/usr/bin/env node
/**
 * Did a change move anything the app draws? Saves the computed styles of every element on a real chat and on home --
 * layout, type, colour, borders, focus rings of each kind of control -- at a fixed 1280x900 viewport in headed
 * Windows Chrome, or compares two saves. Take one before a change and one after (restart in between); two saves with
 * no change between them do not differ. Meteors, orbs, canvases and toasts are left out: they move on their own.
 *
 *   node scripts/probes/style-snapshot.mjs save before.json
 *   node scripts/probes/style-snapshot.mjs save after.json
 *   node scripts/probes/style-snapshot.mjs diff before.json after.json
 */
import fs from "node:fs";
import { cdpOrigin, loadPlaywright, origin } from "./lib.mjs";

const PROPS = ["display", "position", "font-family", "font-size", "font-weight", "line-height", "color", "background-color", "background-image", "border-top-width", "border-top-color", "border-radius", "padding-top", "padding-left", "margin-top", "margin-left", "outline-style", "outline-width", "box-shadow", "width", "height", "gap", "backdrop-filter", "z-index", "overflow-x", "white-space", "text-overflow", "cursor"];
const [mode, a, z] = process.argv.slice(2);
if (mode === "diff") {
  const [before, after] = [a, z].map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
  for (const page of Object.keys(before)) {
    const diffs = []; let unmatched = 0;
    for (const [k, v] of Object.entries(before[page].snap)) { const w = after[page].snap[k]; if (w === undefined) { unmatched++; continue; } if (v === w) continue;
      const x = v.split("|"), y = w.split("|"); diffs.push(`${k.slice(-70)}: ${PROPS.flatMap((p, i) => x[i] === y[i] ? [] : [`${p} ${x[i]} -> ${y[i]}`]).join("; ")}`); }
    console.log(`${page}: ${before[page].count} vs ${after[page].count} elements, ${unmatched} unmatched, ${diffs.length} differ`);
    for (const d of diffs.slice(0, 20)) console.log(`  ${d.slice(0, 240)}`);
    for (const k of Object.keys(before[page].focus)) if (before[page].focus[k] !== after[page].focus[k]) console.log(`  focused ${k}: ${before[page].focus[k]} -> ${after[page].focus[k]}`);
  }
} else if (mode === "save" && a) {
  const { chromium } = await loadPlaywright();
  const b = await chromium.connectOverCDP(cdpOrigin); const ctx = b.contexts()[0]; const cdp = await b.newBrowserCDPSession();
  const tmp = await ctx.newPage(); await tmp.goto(origin, { waitUntil: "commit" }); await tmp.waitForTimeout(1500);
  // The most recent chat outside the Test project: a real transcript.
  const chat = await tmp.evaluate(async () => (await (await fetch("/v0/projects")).json()).projects.flatMap((p) => p.id === "test" ? [] : p.sessions ?? []).sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt)))[0]?.id);
  await tmp.close();
  const result = {};
  for (const [name, path] of [["chat", `/chat/${chat}`], ["home", "/"]]) {
    const { targetId } = await cdp.send("Target.createTarget", { url: `${origin}${path}`, newWindow: true });
    const { windowId } = await cdp.send("Browser.getWindowForTarget", { targetId });
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } }); await cdp.send("Browser.setWindowBounds", { windowId, bounds: { width: 1300, height: 950 } });
    await new Promise((r) => setTimeout(r, 8000));
    const page = ctx.pages().find((p) => p.url().endsWith(path)); await page.bringToFront();
    const ps = await ctx.newCDPSession(page); await ps.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); await page.waitForTimeout(2500);
    result[name] = await page.evaluate((PROPS) => {
      const skip = (e) => e.closest(".solid-meteor-shower, canvas, .thinking-orb, .ui-orb, [data-sonner-toaster]");
      const where = (e) => { const out = []; while (e && e !== document.body) { out.unshift(`${e.tagName.toLowerCase()}${e.parentElement ? [...e.parentElement.children].indexOf(e) : 0}`); e = e.parentElement; } return out.join(">"); };
      const snap = {}; for (const e of document.body.querySelectorAll("*")) { if (skip(e)) continue; const cs = getComputedStyle(e); snap[where(e)] = PROPS.map((p) => cs.getPropertyValue(p)).join("|"); }
      const focus = {}; for (const sel of ["textarea", "button", "a[href]", "[role=button]", "input"]) { const el = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length && !x.disabled); if (!el) continue; el.focus(); const cs = getComputedStyle(el); focus[sel] = [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow].join("|"); el.blur(); }
      return { count: Object.keys(snap).length, snap, focus };
    }, PROPS);
    await page.close();
  }
  fs.writeFileSync(a, JSON.stringify(result)); console.log(`saved ${a}: chat ${result.chat.count} elements, home ${result.home.count}`);
  await b.close();
} else console.log("usage: style-snapshot.mjs save <file> | diff <before> <after>");
