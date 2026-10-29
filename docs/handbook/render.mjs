// node docs/handbook/render.mjs docs/handbook/jbot-handbook.html (from the repo root): page.html → page.pdf, page-N.png (2x), and a fit line per page.
import { loadPlaywright, launchHeadless } from "/home/jask/Conduit/conduit-web/scripts/probes/lib.mjs";
import path from "node:path";
const html = path.resolve(process.argv[2]);
const base = html.replace(/\.html$/, "");
const { chromium } = await loadPlaywright();
const browser = await launchHeadless(chromium);
const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
await page.goto(`file://${html}`);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
const fits = await page.$$eval(".page", (pages) => pages.map((p) => {
  const foot = p.querySelector(".foot").getBoundingClientRect().top;
  const kids = [...p.querySelectorAll(".body > *")];
  const bottom = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom));
  return ((foot - bottom) * 25.4 / 96).toFixed(1);
}));
const pages = await page.$$(".page");
for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: `${base}-${i + 1}.png` });
await page.pdf({ path: `${base}.pdf`, preferCSSPageSize: true, printBackground: true });
console.log("pdf:", `${base}.pdf`);
fits.forEach((f, i) => console.log(`page ${i + 1} fit: ${f} mm${Number(f) < 0 ? "  OVERFLOW" : ""}`));
await browser.close();
