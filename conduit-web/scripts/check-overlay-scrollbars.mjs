// Fast live check. Uses the already-running native Chrome and local server;
// no test server, chat fixture, provider request, or process teardown.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
try {
  const page = browser.contexts()[0].pages().find((p) => p.url().startsWith("http://127.0.0.1:4310/"));
  assert.ok(page, "Open the local app in native Chrome first");
  page.setDefaultTimeout(5000);
  const cdp = await page.context().newCDPSession(page);
  const bar = page.locator(".overlay-scrollbar:popover-open");
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const evidence = new URL("../../.deployment-evidence/scrollbars/", import.meta.url);
  await mkdir(evidence, { recursive: true });
  const screenshot = async (name) => {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    await writeFile(new URL(`${name}.png`, evidence), Buffer.from(data, "base64"));
  };
  async function check(selector, name, axis = "y") {
    const element = page.locator(selector).first();
    await element.waitFor({ state: "visible" });
    const before = await element.evaluate((e) => ({ width: e.clientWidth, height: e.clientHeight, scrollWidth: e.scrollWidth, scrollHeight: e.scrollHeight }));
    assert.ok(axis === "y" ? before.scrollHeight > before.height : before.scrollWidth > before.width, `${name} must overflow`);
    await page.mouse.move(350, 35);
    await pause(40);
    assert.equal(await bar.count(), 0);
    await element.evaluate((e) => { e.scrollTop = 0; e.scrollLeft = 0; });
    const r = await element.boundingBox();
    const x = axis === "y" ? r.x + r.width - 5 : r.x + 40;
    const y = axis === "y" ? r.y + 40 : r.y + r.height - 5;
    // A brief pass must not reveal now or leave a pending reveal behind.
    await page.mouse.move(x, y);
    await pause(60);
    assert.equal(await bar.count(), 0, `${name}: too early`);
    await page.mouse.move(350, 35);
    await pause(220);
    assert.equal(await bar.count(), 0, `${name}: cancelled dwell`);
    await screenshot(`overlay-${name}-hidden`);
    await page.mouse.move(x, y);
    await bar.waitFor({ state: "visible" });
    await screenshot(`overlay-${name}-revealed`);
    assert.equal(await bar.getAttribute("data-axis"), axis);
    const after = await element.evaluate((e) => ({ width: e.clientWidth, height: e.clientHeight }));
    assert.deepEqual(after, { width: before.width, height: before.height }, `${name}: no layout shift`);
    await page.mouse.wheel(axis === "x" ? 40 : 0, axis === "y" ? 40 : 0);
    await pause(40);
    assert.ok(await element.evaluate((e, axis) => axis === "y" ? e.scrollTop > 0 : e.scrollLeft > 0, axis), `${name}: wheel over overlay`);
    await element.evaluate((e) => { e.scrollTop = 0; e.scrollLeft = 0; });
    await pause(40);
    const thumb = await bar.locator(".overlay-scrollbar-thumb").boundingBox();
    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
    await page.mouse.down();
    await page.mouse.move(thumb.x + thumb.width / 2 + (axis === "x" ? 55 : -30), thumb.y + thumb.height / 2 + (axis === "y" ? 55 : -30), { steps: 8 });
    assert.equal(await bar.count(), 1, `${name}: keep drag outside edge`);
    const scrolled = await element.evaluate((e, axis) => axis === "y" ? e.scrollTop : e.scrollLeft, axis);
    assert.ok(scrolled > 0, `${name}: drag scrolls`);
    await page.mouse.up();
    await page.mouse.move(350, 35);
    await pause(40);
    assert.equal(await bar.count(), 0, `${name}: hide after exit`);
    console.log(`${name}: pass-through cancelled; reveal; no layout shift; wheel; drag ${Math.round(scrolled)}px; hide`);
  }
  assert.equal(await page.locator("html[data-overlay-scrollbars]").count(), 1);
  await check(".sidebar-content", "sidebar");
  const toggle = page.getByRole("button", { name: "Toggle workspace panel", exact: true });
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await page.getByRole("tab", { name: "Source Control", exact: true }).click();
  const details = page.getByRole("button", { name: "Details", exact: true });
  if (await details.getAttribute("aria-expanded") !== "true") await details.click();
  await page.getByRole("tab", { name: "Graph", exact: true }).click();
  await check(".workspace-history-list", "graph");
  await page.getByRole("tab", { name: "Files", exact: true }).click();
  await check(".workspace-tree", "files");
  await check(".cm-scroller", "preview");
  await check(".cm-scroller", "preview-horizontal", "x");
} finally {
  await browser.close();
}
