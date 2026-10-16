// PhoneComposer's motion invariants, frame by frame: the phone preview's real transitions and every pair of the gallery card's states, both layouts.
// Run with the gallery served (npm run gallery) and open in headed Chrome on CDP :9222 (node ../scripts/run-windows-chrome-devtools.mjs start),
// from conduit-web: node scripts/motion-check/phone.mjs. It plays each move at 1x (restoring the gallery's speed setting after) and prints
// one line per move: ✓, or ✗ with the invariant it broke (library.css, Motion: snap, squeezed, layers, one spot).
const { chromium } = await import(new URL("../../../.smoke-tools/node_modules/playwright/index.mjs", import.meta.url).href);
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = b.contexts()[0].pages().find((p) => p.url().includes(":5180/gallery.html"));
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
const userSpeed = await page.evaluate(() => localStorage.getItem("gallery:speed"));
await page.evaluate(() => localStorage.setItem("gallery:speed", "1"));
await page.reload(); await page.waitForTimeout(3000);
process.on("exit", () => {});
const restore = async () => { await page.evaluate((v) => { if (v) localStorage.setItem("gallery:speed", v); }, userSpeed); await page.reload(); };
try {
const frame = page.frames().find((f) => f.url().includes("frame=phone"));
// The per-frame probe, installed in a document: watches one .ui-phone-composer for 500ms after act().
const PROBE = `window.__probe = (root, act) => new Promise((res) => {
  const pc = root, bad = new Set(), last = new Map(), first = new Map();
  const parts = () => [...pc.querySelectorAll(".ui-phone-row > .ui-pill"), pc.querySelector(".ui-phone-field")];
  const name = (e) => e.classList.contains("ui-phone-field") ? "field" : (e.querySelector("button")?.getAttribute("aria-label") || "pill");
  const geo = (e) => { const r = e.getBoundingClientRect(); return { w: r.width, x: r.left, h: r.height, o: +getComputedStyle(e).opacity }; };
  parts().forEach((e) => first.set(e, geo(e)));
  act(); const t0 = performance.now(); let n = 0; const frames = [];
  const tick = () => {
    n++;
    const now = performance.now(), dt = now - (window.__lastT ?? now - 16.7); window.__lastT = now;
    for (const e of parts()) { const g = geo(e), p = last.get(e) ?? first.get(e); frames.push([e, g, p, dt]); last.set(e, g); }
    // 1+4: the field's box is never under captions' words or ground: whatever is topmost at its centre is the field.
    const f = pc.querySelector(".ui-phone-field"), fr = f.getBoundingClientRect();
    if (fr.height > 0 && +getComputedStyle(f).opacity > .05) { const top = document.elementFromPoint(fr.left + fr.width * .8, fr.top + fr.height / 2); if (top && !f.contains(top) && pc.contains(top) && top.closest(".ui-voice-captions")) bad.add("layers: captions over the field"); }
    // 4: captions words visible inside the field's box
    const cw = pc.querySelector(".ui-voice-captions > *"); if (cw && fr.height > 0 && +getComputedStyle(f).opacity > .05) { const cr = cw.getBoundingClientRect(), clip = getComputedStyle(cw).clipPath; const visBottom = clip.startsWith("inset") ? cr.bottom - parseFloat(clip.split(" ")[2]) : cr.bottom; if (visBottom > fr.top + 2 && cr.top < fr.bottom && +getComputedStyle(cw.parentElement).opacity > .05) bad.add("one spot: caption words inside the field"); }
    if (performance.now() - t0 < 500) requestAnimationFrame(tick); else {
      // 2/5: no snaps -- per part, the biggest one-frame step is at most 45% of its whole change in width or x.
      const byPart = new Map(); for (const [e, g, p, dt] of frames) { if (!byPart.has(e)) byPart.set(e, []); byPart.get(e).push([g, p, dt]); }
      for (const [e, list] of byPart) for (const k of ["w", "x"]) { const total = list.reduce((sum, [g, p]) => sum + Math.abs(g[k] - p[k]), 0); const step = Math.max(...list.map(([g, p, dt]) => (g.o < .05 && p.o < .05) ? 0 : Math.abs(g[k] - p[k]) * 16.7 / Math.max(16.7, dt))); if (total > 12 && step > total * .45) bad.add("snap: " + name(e) + " " + k + " " + Math.round(step) + "/" + Math.round(total)); }
      // 3: never seen squeezed: a pill drawn (opacity > .3) is at its full width or not moving.
      for (const [e, list] of byPart) { if (e.classList.contains("ui-phone-field") || e.hasAttribute("data-stretch")) continue; const full = Math.max(...list.map(([g]) => g.w), first.get(e).w); if (list.some(([g]) => g.o > .3 && g.w > 1 && g.w < full - 2)) bad.add("squeezed: " + name(e)); }
      res([...bad]);
    }
  };
  requestAnimationFrame(tick);
});`;
await frame.evaluate(PROBE); await page.evaluate(PROBE);
// Preview: drive the app's real controls.
const P = {
  click: (l) => `document.querySelector('.ui-phone-composer button[aria-label="${l}"]').click()`,
  keyboard: () => `document.querySelector('.ui-phone-composer :is(button[aria-label="Close the keyboard"], button[aria-label="Type a message"])').click()`,
  type: (v) => `(() => { const ta = document.querySelector(".composer-wrap textarea"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, ${JSON.stringify(v)}); ta.dispatchEvent(new Event("input", { bubbles: true })); })()`,
  scroll: (up) => `(() => { const s = [...document.querySelectorAll("*")].find((e) => e.scrollHeight > e.clientHeight + 200 && getComputedStyle(e).overflowY !== "visible"); s.scrollTop = ${up ? "s.scrollHeight - s.clientHeight - 400" : "s.scrollHeight"}; s.dispatchEvent(new Event("scroll")); })()`,
};
const step = async (label, js) => { const r = await frame.evaluate((js) => window.__probe(document.querySelector(".ui-phone-composer"), () => eval(js)), js); await page.waitForTimeout(250); console.log(r.length ? "✗" : "✓", "preview", label, r.join("; ")); };
await step("idle → typing", P.click("Type a message"));
await step("typing → draft", P.type("hello there"));
await step("draft → listening", P.click("Start voice dictation")); await page.waitForTimeout(1500);
await step("listening → typing", P.click("Stop voice dictation"));
await step("typing → cleared", P.type(""));
await step("typing → idle", P.click("Close the keyboard"));
await step("idle → typing 2", P.click("Type a message"));
await step("typing → idle 2", P.click("Close the keyboard"));
await step("idle → listening", P.click("Start voice dictation")); await page.waitForTimeout(1500);
await step("listening → typing (dictated)", P.click("Stop voice dictation"));
await step("typing → idle (after dictation)", P.keyboard());
await step("scroll up", P.scroll(true));
await step("away → listening", P.click("Start voice dictation")); await page.waitForTimeout(1500);
await step("away listening → typing", P.click("Stop voice dictation"));
await step("scroll down", P.scroll(false));
await step("idle → listening (2)", P.click("Start voice dictation")); await page.waitForTimeout(1500);
await step("listening → stop (2)", P.click("Stop voice dictation")); await page.waitForTimeout(800);
await step("idle/typing → listening (3)", P.click("Start voice dictation")); await page.waitForTimeout(1500);
await step("listening → stop (3)", P.click("Stop voice dictation"));
// Gallery card: every pair of its states.
const states = ["Idle", "Scrolled up", "Typing", "Typing a draft", "Editing", "Menu open", "Listening"];
for (const layout of [0, 1]) for (const a of states) for (const z of states) { if (a === z) continue;
  const r = await page.evaluate(async ({ layout, a, z }) => {
    const row = [...document.querySelectorAll(".g-states")][layout] ?? null;
    const group = [...document.querySelectorAll("[role=group], .g-states, div")].filter((d) => [...d.children].some((c) => c.textContent === "Menu open" && c.tagName === "BUTTON"))[layout];
    const btn = (t) => [...group.children].find((c) => c.textContent === t);
    btn(a).click(); await new Promise((r) => setTimeout(r, 700));
    const pc = group.parentElement.querySelector(".ui-phone-composer");
    return window.__probe(pc, () => btn(z).click());
  }, { layout, a, z });
  if (r.length) console.log("✗ card" + (layout ? " surface" : ""), a, "→", z, r.join("; "));
}
console.log("card pairs done; errors", errs);
} catch (e) { console.log("ERROR", e.message.split("\n")[0]); } finally { await restore(); }
await b.close();
