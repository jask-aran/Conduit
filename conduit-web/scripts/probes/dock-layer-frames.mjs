#!/usr/bin/env node
/**
 * Does the dock hold still when it switches between beside the panes and over
 * them? Docks pane B, shows it, then flips the rail's layer switch both ways,
 * sampling on every animation frame: the dock surface's left edge and width,
 * its frame's width in the row, pane A's width, and the focus line under the
 * dock. The dock and its line must be constant throughout; pane A should ease
 * monotonically into (or out of) the dock's room.
 *
 * Needs room for two chats and the dock: the sidebar is collapsed first.
 *
 *   node scripts/probes/dock-layer-frames.mjs [--windows]
 */
import { open, recentChats, visit } from "./lib.mjs";

const { page, close } = await open({ width: 1900, height: 1100 });
const [a, b] = await recentChats(page, 2);
await visit(page, `/chat/${a}?pane=chat%3A${b}`);
if (await page.locator(".main-split").count() === 0) { await page.keyboard.press("Control+KeyB"); await page.waitForTimeout(800); }
const beside = page.locator('.workspace-rail [aria-label="Dock beside the panes"]');
if (await beside.count()) await beside.click();
await page.locator('.main-split [aria-label="Move to dock"]').first().click({ timeout: 10_000 });
await page.waitForTimeout(800);
await page.locator('.workspace-rail [aria-label$="(docked)"]').first().click();
await page.waitForTimeout(1200);
await page.keyboard.press("Control+Shift+Digit3");
await page.waitForTimeout(600);

const sample = () => page.evaluate(() => new Promise((done) => {
  const rows = [];
  const t0 = performance.now();
  const tick = () => {
    const dock = document.querySelector(".workspace-panel");
    const surface = dock.querySelector(".workspace-panel-surface").getBoundingClientRect();
    const frame = dock.getBoundingClientRect();
    const line = getComputedStyle(dock, "::after");
    const lineWidth = parseFloat(line.width);
    rows.push([Math.round(performance.now() - t0), surface.left, surface.width, frame.width, document.querySelector(".chat-main").getBoundingClientRect().width, frame.right - parseFloat(line.right) - lineWidth, lineWidth, line.opacity].map((value) => typeof value === "number" ? +value.toFixed(1) : value));
    if (performance.now() - t0 < 500) requestAnimationFrame(tick); else done(rows);
  };
  requestAnimationFrame(tick);
  document.querySelector('.workspace-rail [aria-label^="Dock "][aria-pressed]').click();
}));
for (const label of ["beside → over", "over → beside"]) {
  const rows = await sample();
  const steady = (column) => new Set(rows.map((row) => row[column])).size === 1;
  console.log(`${label}: dock ${steady(1) && steady(2) ? "steady" : "MOVED"}, focus line ${steady(5) && steady(6) ? "steady" : "MOVED"}`);
  console.log("   ms   dock.left dock.w  frame.w  paneA.w  line.left line.w opacity");
  let previous = "";
  for (const row of rows) { const line = row.slice(1).join(" "); if (line !== previous) console.log("   " + row.map(String).join("\t")); previous = line; }
  await page.waitForTimeout(600);
}
await close();
