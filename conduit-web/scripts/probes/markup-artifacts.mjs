// Papers in panes: the test paper opens as artifact:test under the pane's one header with Markup's bar centred on its pane; the Test project lists its
// artifacts; New artifact turns the tab into the creator, which makes a paper (a .paper file in the project's folder) and refuses a name already there; Rename renames the file and the tab and
// keeps the editor; a second paper beside has a bar of its own, centred on its own pane; Delete removes the file and the row, and the pane says so.
// Makes "Probe paper" in the Test project and deletes it, with what the hub kept for it.
import fs from "node:fs/promises";
import { open, origin } from "./lib.mjs";

const folder = `${process.env.HOME}/.conduit/data/chat/files/test`, wait = (ms) => new Promise((done) => setTimeout(done, ms));
const { page, close } = await open({ width: 1600, height: 950 });
const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
const there = (file) => fs.stat(`${folder}/${file}`).then(() => true, () => false);
const menu = async (target, item) => { await target.click({ button: "right" }); await page.getByRole("menuitem", { name: item }).click(); };
const centred = () => page.evaluate(() => [...document.querySelectorAll(".pane-artifact")].map((pane) => { const box = pane.getBoundingClientRect(); return Math.round(box.left + box.width / 2); }).join() === [...document.querySelectorAll(".ui-markup-rails")].map((rail) => { const boxes = [...rail.querySelectorAll(".ui-markup-bar")].map((bar) => bar.getBoundingClientRect()), left = Math.min(...boxes.map((box) => box.left)), right = Math.max(...boxes.map((box) => box.right)); return Math.round((left + right) / 2); }).join());
let made;
try {
  await page.goto(`${origin}/?a=artifact:test`);
  await page.waitForSelector(".ui-document-text [data-id]", { timeout: 20000 });
  await wait(1500);
  console.log("one header over the paper, and no dock tool in its pane:", await page.evaluate(() => document.querySelectorAll(".pane-artifact header:not(.ui-document-head)").length === 1 && !document.querySelector(".pane-a-tool-host")));
  console.log("Markup's bar is centred on the pane:", await centred());
  const test = page.locator('[data-doc-view="artifact:test"]'), project = page.locator('.ui-nav-link:has-text("Test")').first();
  if (!(await test.count())) { await page.locator('button[title="Expand Test"]').click(); await test.waitFor(); }
  console.log("the project lists its paper:", (await test.first().textContent()).startsWith("Test document"));
  await menu(project, "New artifact"); await page.fill("#artifact-name", "Probe paper"); await page.keyboard.press("Enter");
  const row = page.locator('[data-doc-view^="artifact:"]:has-text("Probe paper")').first(); await row.waitFor(); await wait(1500);
  made = (await row.getAttribute("data-doc-view")).slice("artifact:".length);
  console.log("New artifact makes the file and opens it in the tab:", await there("Probe paper.paper") && await page.evaluate((id) => location.search.includes(id), made));
  await menu(project, "New artifact"); await page.fill("#artifact-name", "Probe paper"); await page.keyboard.press("Enter"); await wait(800);
  console.log("a name already there is refused in the creator:", await page.evaluate(() => document.querySelector('.ui-pane-home[aria-label="New artifact"]')?.textContent.includes("already there") ?? false));
  await row.click(); await page.waitForSelector(".pane-artifact .ui-document-text"); await wait(800);
  await page.locator(".pane-artifact .ui-document-text").first().click(); await page.keyboard.type("Typed by the probe."); await wait(1200);
  await menu(row, "Rename"); await page.fill("#artifact-rename", "Probe paper two"); await page.keyboard.press("Enter"); await wait(1800);
  console.log("Rename renames the file, with what was typed:", !(await there("Probe paper.paper")) && (await fs.readFile(`${folder}/Probe paper two.paper`, "utf8").catch(() => "")).includes("Typed by the probe."));
  console.log("the tab takes the name and the editor is kept:", await page.evaluate(() => document.querySelector(".pane-artifact [role=tab], .pane-artifact .ui-header-crumb")?.textContent.trim() === "Probe paper two" && document.querySelector(".pane-artifact .ui-document-text")?.textContent.includes("Typed by the probe.")));
  await menu(test.first(), "Open beside"); await wait(2500);
  console.log("two papers, each bar centred on its own pane:", await page.evaluate(() => document.querySelectorAll(".pane-artifact").length === 2) && await centred());
  await menu(page.locator('[data-doc-view^="artifact:"]:has-text("Probe paper two")').first(), "Delete"); await page.getByRole("button", { name: "Delete", exact: true }).last().click(); await wait(2500);
  console.log("Delete removes the file and the row:", !(await there("Probe paper two.paper")) && !(await page.locator('[data-doc-view^="artifact:"]:has-text("Probe paper two")').count()));
  console.log("its pane says it could not be opened:", await page.evaluate(() => [...document.querySelectorAll(".pane-artifact")].some((pane) => pane.textContent.includes("This paper could not be opened"))));
} finally {
  for (const file of ["Probe paper.paper", "Probe paper two.paper"]) await fs.rm(`${folder}/${file}`, { force: true });
  if (made) await fs.rm(`${folder}/.conduit/artifacts/${made}`, { recursive: true, force: true });
  console.log("errors:", JSON.stringify(errors));
  await close();
}
