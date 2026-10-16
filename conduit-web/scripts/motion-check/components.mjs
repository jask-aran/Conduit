// Motion invariants for Disclosure, CodeBlock and DesktopComposer (its slot and toolbar), frame by frame, in the gallery.
// Run with the gallery served (npm run gallery) and open in headed Chrome on CDP :9222 (node ../scripts/run-windows-chrome-devtools.mjs start),
// from conduit-web: node scripts/motion-check/components.mjs. It plays each move at 1x (restoring the gallery's speed setting after) and prints
// one line per move: ✓, or ✗ with the invariant it broke (library.css, Motion: snap, squeezed, layers, one spot).
const { chromium } = await import(new URL("../../../.smoke-tools/node_modules/playwright/index.mjs", import.meta.url).href);
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = b.contexts()[0].pages().find((p) => p.url().includes(":5180/gallery.html"));
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
const userSpeed = await page.evaluate(() => localStorage.getItem("gallery:speed"));
await page.evaluate(() => localStorage.setItem("gallery:speed", "1")); await page.reload(); await page.waitForTimeout(3000);
const PROBE = `window.__probe2 = (spec) => new Promise((res) => {
  // spec: { parts: () => Element[], rigid: () => Element[], spots: () => [Element[], Element[]][], act, ms }
  const bad = new Set(), first = new Map(), hist = new Map();
  const eff = (e) => { let o = 1; for (let n = e; n && n !== document.body; n = n.parentElement) { const c = getComputedStyle(n); o *= +c.opacity; if (c.visibility === "hidden" || c.display === "none") return 0; } return o; };
  const geo = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, o: eff(e) }; };
  const label = (e) => e.getAttribute("aria-label") || e.className.baseVal || e.className || e.tagName;
  const sample = (dt) => { for (const e of spec.parts()) { const g = geo(e); if (!hist.has(e)) { hist.set(e, []); first.set(e, g); } hist.get(e).push([g, dt]); }
    for (const [as, bs] of spec.spots()) for (const a of as) for (const z of bs) { const ga = geo(a), gz = geo(z);
      const overlap = ga.x < gz.x + gz.w && gz.x < ga.x + ga.w && ga.y < gz.y + gz.h && gz.y < ga.y + ga.h;
      if (overlap && ga.o > .05 && gz.o > .05 && ga.w * ga.h > 0 && gz.w * gz.h > 0) bad.add("one spot: " + label(a) + " and " + label(z) + " both showing"); } };
  // 6: a drawn frost never fades through an ancestor (that ancestor would be its backdrop, so it blurs nothing).
  const frost = () => { for (const e of document.querySelectorAll(".ui-frost")) { if (+getComputedStyle(e).opacity < .05 || !e.getClientRects().length || getComputedStyle(e).backdropFilter === "none") continue;
    for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) { const o = +getComputedStyle(n).opacity; if (o > .05 && o < .99) { bad.add("frost under a fade: " + label(e) + " in " + label(n)); break; } } } };
  const sampleAll = (dt) => { sample(dt); frost(); };
  sampleAll(16.7); spec.act(); const t0 = performance.now(); let last = t0;
  const tick = () => { const now = performance.now(); sampleAll(now - last); last = now;
    if (now - t0 < (spec.ms || 600)) return requestAnimationFrame(tick);
    for (const [e, list] of hist) for (const k of ["x", "y", "w", "h"]) {
      const steps = list.slice(1).map(([g, dt], i) => [Math.abs(g[k] - list[i][0][k]), dt, g.o, list[i][0].o]);
      const path = steps.reduce((s, [d]) => s + d, 0);
      const big = Math.max(0, ...steps.map(([d, dt, o, po]) => (o < .05 && po < .05) ? 0 : d * 16.7 / Math.max(16.7, dt)));
      if (path > 12 && big > path * .45) bad.add("snap: " + label(e) + " " + k + " " + Math.round(big) + "/" + Math.round(path)); }
    for (const e of spec.rigid ? spec.rigid() : []) { const list = hist.get(e); if (!list) continue;       const shape = Math.max(...list.map(([g]) => g.h > 1 ? g.w / g.h : 0));
      // squeezed: drawn while its shape (width to height) is off its own -- an even scale is the grow shape, not a squeeze.
      if (list.some(([g]) => g.o > .3 && g.w > 1 && g.h > 1 && g.w / g.h < .92 * shape)) bad.add("squeezed: " + label(e)); }
    res([...bad]); };
  requestAnimationFrame(tick);
});`;
const go = async (fam) => { await page.evaluate((fam) => [...document.querySelectorAll(".g-rail .ui-nav-row")].find((e) => e.textContent.trim() === fam)?.click(), fam); await page.waitForTimeout(700); await page.evaluate(PROBE); };
const report = (name, r) => console.log(r.length ? "✗" : "✓", name, r.join("; "));
try {
  // Disclosure: close and open each, watching its body and the rows after it.
  await go("Transcript");
  const nd = await page.evaluate(() => document.querySelectorAll(".ui-disclosure").length);
  for (let i = 0; i < nd; i++) for (const dir of ["close", "open"]) report(`Disclosure ${i} ${dir}`, await page.evaluate((i) => {
    const d = document.querySelectorAll(".ui-disclosure")[i]; d.scrollIntoView({ block: "center" });
    const after = () => { const n = d.nextElementSibling; return n ? [n] : []; };
    return window.__probe2({ parts: () => [d.querySelector(".ui-disclosure-body"), d.querySelector(".ui-disclosure-header"), ...after()], spots: () => [], act: () => d.querySelector(".ui-disclosure-header").click() });
  }, i));
  // CodeBlock: open and fold each foldable block, watching the pre and what follows the figure.
  await go("CodeBlock");
  const nc = await page.evaluate(() => [...document.querySelectorAll(".ui-code")].filter((c) => c.querySelector(".ui-code-more")).length);
  for (let i = 0; i < Math.min(nc, 6); i++) for (const dir of ["open", "fold"]) report(`CodeBlock ${i} ${dir}`, await page.evaluate((i) => {
    const c = [...document.querySelectorAll(".ui-code")].filter((c) => c.querySelector(".ui-code-more"))[i]; c.scrollIntoView({ block: "center" });
    return window.__probe2({ parts: () => [c.querySelector("pre"), c.querySelector(".ui-code-more"), ...(c.nextElementSibling ? [c.nextElementSibling] : [])], spots: () => [], act: () => c.querySelector(".ui-code-more").click() });
  }, i));
  // DesktopComposer: every pair of the slot's states and of the toolbar's states.
  await go("DesktopComposer");
  for (const set of [["Composer", "Question"], ["Ready", "Working", "Draft in a turn"], ["Off", "Dictating"]]) for (const a of set) for (const z of set) { if (a === z) continue;
    report(`DesktopComposer ${a} → ${z}`, await page.evaluate(async ({ a, z }) => {
      const group = [...document.querySelectorAll(".g-family div")].find((d) => [...d.children].some((c) => c.tagName === "BUTTON" && c.textContent.trim() === a) && [...d.children].some((c) => c.tagName === "BUTTON" && c.textContent.trim() === z));
      const btn = (t) => [...group.children].find((c) => c.textContent.trim() === t);
      group.scrollIntoView({ block: "center" }); btn(a).click(); await new Promise((r) => setTimeout(r, 800));
      let host = group; while (host && !host.querySelector(".ui-composer-slot, .ui-desktop-composer")) host = host.parentElement;
      const slot = host.querySelector(".ui-composer-slot"), comp = host.querySelector(".ui-desktop-composer");
      const toolbarKids = () => [...host.querySelectorAll(".ui-toolbar-primary > *, .ui-toolbar-end > *")];
      return window.__probe2({
        parts: () => [...(slot ? [...slot.children] : []), ...toolbarKids()],
        rigid: () => toolbarKids(),
        spots: () => slot ? [[[...slot.querySelectorAll(".ui-composer-stack")], [...slot.children].filter((c) => !c.classList.contains("ui-composer-stack"))]] : [[toolbarKids().slice(0, 1), toolbarKids().slice(1, 2)]],
        act: () => btn(z).click(), ms: 700 });
    }, { a, z }));
  }
  console.log("errors", errs);
} catch (e) { console.log("ERROR", e.message.split("\n")[0]); }
finally { await page.evaluate((v) => { if (v) localStorage.setItem("gallery:speed", v); }, userSpeed); await page.reload(); await page.waitForTimeout(2500); await page.evaluate(() => [...document.querySelectorAll(".g-rail .ui-nav-row")].find((e) => e.textContent.trim() === "PhoneComposer")?.click()); await b.close(); }
