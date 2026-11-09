import { loadPlaywright } from "./lib.mjs";
const { chromium } = await loadPlaywright();
const browser = await chromium.connectOverCDP("http://localhost:9333");
const page = browser.contexts()[0].pages()[0];
const step = process.argv[2];
if (step === "agent") {
  await page.evaluate(() => { history.pushState({}, "", "/agent"); dispatchEvent(new PopStateEvent("popstate")); });
  await page.waitForTimeout(2500);
  console.log(await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean).slice(0, 40).join(" | ")));
}
if (step === "click") { await page.getByRole("button", { name: process.argv[3], exact: false }).first().click(); await page.waitForTimeout(1500); console.log("clicked"); }
if (step === "find") console.log(await page.evaluate((t) => [...document.querySelectorAll("button")].filter((b) => b.innerText.includes(t)).map((b) => b.outerHTML.slice(0, 200)).join("\n"), process.argv[3]), await page.evaluate(() => document.querySelector("meta[name=conduit-build]")?.content || [...document.scripts].map((s) => s.src).filter(Boolean).slice(0, 2).join(" ")));
if (step === "tap") { await page.getByText(process.argv[3], { exact: true }).first().click(); await page.waitForTimeout(1500); console.log("tapped"); }
if (step === "texts") console.log(await page.evaluate(() => document.body.innerText.slice(0, 1500)));
await browser.close().catch(() => {});
process.exit(0);
