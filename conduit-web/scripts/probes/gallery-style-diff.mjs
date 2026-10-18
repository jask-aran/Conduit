// Every element's computed style (and ::before/::after) across two gallery builds, every family at both densities plus
// the phone, phone sidebar and desktop previews, animations held at frame 0. Build each with
// `npx vite build --mode gallery --outDir <dir>`, then: node scripts/probes/gallery-style-diff.mjs <dirA> <dirB>
// --ignore --a,--b leaves custom properties a change meant to rename; --keys lists every differing element's path.
// The live mic level, the aura's level, a wave's bars and the servers' origins are left out: they differ run to run.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { arg, flag, launchHeadless, loadPlaywright } from "./lib.mjs";

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".json": "application/json", ".png": "image/png", ".woff": "font/woff" };
function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const file = path.join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname));
      try { const body = await fs.readFile(file); res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" }); res.end(body); }
      catch { res.writeHead(404); res.end(); }
    });
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}
const [a, b] = process.argv.slice(2).filter((value, index, all) => !value.startsWith("--") && !all[index - 1]?.startsWith("--ignore"));
if (!a || !b) { console.error("usage: gallery-style-diff.mjs <buildA> <buildB> [--ignore --a,--b] [--keys]"); process.exit(2); }
const IGNORE = (arg("--ignore", "") ?? "").split(",").filter(Boolean);
const { chromium } = await loadPlaywright();
const browser = await launchHeadless(chromium);
const origins = [await serve(a), await serve(b)];

// Every element: a path key and its full computed style (pseudo ::before/::after too).
const dumpScript = (ignore) => {
  document.getAnimations().forEach((x) => { try { x.pause(); x.currentTime = 0; } catch {} });
  const out = {};
  const key = (el) => { const parts = []; for (let e = el; e && e !== document.documentElement; e = e.parentElement) { let i = 0; for (let s = e; (s = s.previousElementSibling);) i++; parts.push(`${e.tagName.toLowerCase()}.${[...e.classList].filter((c) => !c.startsWith("solid")).join(".")}[${i}]`); } return parts.reverse().join(">"); };
  const read = (cs) => { const r = []; for (let i = 0; i < cs.length; i++) { const p = cs[i]; if (p === "--voice-level" || p === "--aura-level" || ignore.includes(p)) continue; r.push(`${p}:${cs.getPropertyValue(p).replace(/http:\/\/127\.0\.0\.1:\d+/g, "ORIGIN")}`); } return r.join("\n"); };
  for (const el of document.querySelectorAll("*")) { if (el.matches(".ui-pill-wave > i")) continue;
    const k = key(el);
    out[k] = read(getComputedStyle(el));
    for (const pseudo of ["::before", "::after"]) { const cs = getComputedStyle(el, pseudo); if (cs.content && cs.content !== "none") out[k + pseudo] = read(cs); }
  }
  return out;
};

async function page(origin, setup) {
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1000 } });
  const p = await ctx.newPage();
  await p.addInitScript(setup);
  await p.goto(`${origin}/gallery.html`, { waitUntil: "load" });
  await p.waitForTimeout(2500);
  return p;
}
function compare(label, x, y) {
  let diffs = 0; const shown = []; const props = {};
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) {
    if (!(k in x) || !(k in y)) { diffs++; if (shown.length < 6) shown.push(`  ${k in x ? "only in A" : "only in B"}: ${k.slice(-140)}`); continue; }
    if (x[k] === y[k]) continue;
    const xa = x[k].split("\n"), ya = new Map(y[k].split("\n").map((l) => [l.slice(0, l.indexOf(":")), l]));
    for (const l of xa) { const p = l.slice(0, l.indexOf(":")); if (ya.get(p) !== l) { diffs++; props[p] = (props[p] ?? 0) + 1; if (flag("--keys")) shown.push(`KEY ${k}`); else if (shown.length < 12) shown.push(`  ${k.slice(-110)}\n    A ${l.slice(0, 160)}\n    B ${(ya.get(p) ?? "(none)").slice(0, 160)}`); } }
  }
  console.log(`${diffs ? "DIFF" : "same"} ${label}: ${keys.size} elements${diffs ? `, ${diffs} differences` : ""}`);
  if (diffs) console.log("  props:", JSON.stringify(props)); for (const s of shown) console.log(s);
  return diffs;
}

const families = await (async () => { const p = await page(origins[0], () => {}); const t = await p.$$eval(".g-rail .ui-nav-row", (rows) => rows.map((r) => r.textContent.trim())); await p.context().close(); return t; })();
let total = 0;
for (const family of families) for (const density of ["desktop", "phone"]) {
  const setup = new Function(`localStorage.setItem("gallery:family", ${JSON.stringify(family)}); localStorage.setItem("gallery:stage-density", ${JSON.stringify(density)}); localStorage.setItem("gallery:speed", "1");`);
  const pages = await Promise.all(origins.map((o) => page(o, setup)));
  if (density === "phone") for (const p of pages) { for (const btn of await p.$$('.g-cell-toggle button:text-is("Phone")')) await btn.click(); await p.waitForTimeout(800); }
  if (family === families[0] && density === "desktop") for (const p of pages) { for (const v of ["Phone sidebar", "Desktop"]) await p.click(`.g-toggle button:text-is("${v}")`); await p.waitForTimeout(2000); }
  const dumps = await Promise.all(pages.map((p) => p.evaluate(dumpScript, IGNORE)));
  total += compare(`${family} · ${density}`, dumps[0], dumps[1]);
  if (family === families[0] && density === "desktop") for (const name of ["Phone", "Phone sidebar"]) {
    const frames = await Promise.all(pages.map(async (p) => (await p.$(`iframe[title="${name}"]`))?.contentFrame()));
    if (frames.every(Boolean)) { const d = await Promise.all(frames.map((f) => f.evaluate(dumpScript, IGNORE))); total += compare(`preview ${name}`, d[0], d[1]); }
  }
  await Promise.all(pages.map((p) => p.context().close()));
}
console.log(total ? `TOTAL ${total} differences` : "IDENTICAL");
await browser.close();
process.exit(0);
