#!/usr/bin/env node
/**
 * Browser smoke test for panes, file viewer tabs, drag targets and focus
 * (docs/design/panes-and-rail.md), against the running local server.
 * Run from conduit-web/: npm run smoke:panes [-- --project <name>] [--headed]
 * Read-only: files are opened, never edited; each scenario gets a fresh
 * browser context, so the layout saved in localStorage starts empty.
 * The pure tab rules are test/file-tabs.test.js.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const origin = process.env.CONDUIT_ORIGIN || "http://127.0.0.1:4310";
const argument = (name) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : undefined; };
const headed = process.argv.includes("--headed");

async function loadPlaywright() {
  try { return await import("playwright"); } catch {}
  const tools = path.join(root, ".smoke-tools");
  const entry = path.join(tools, "node_modules/playwright/index.mjs");
  if (!await fs.stat(entry).catch(() => null)) {
    const installed = spawnSync("npm", ["install", "--prefix", tools, "--no-save", "--package-lock=false", "playwright"], { stdio: "inherit" });
    if (installed.status !== 0) throw new Error("Could not install playwright into .smoke-tools");
  }
  return import(pathToFileURL(entry).href);
}
async function launch(chromium) {
  try { return await chromium.launch({ headless: !headed }); } catch (error) {
    // A cached Chromium from another Playwright version serves as well.
    const cache = path.join(os.homedir(), ".cache/ms-playwright");
    const builds = (await fs.readdir(cache).catch(() => [])).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse();
    for (const build of builds) {
      const executablePath = path.join(cache, build, "chrome-linux64/chrome");
      if (await fs.stat(executablePath).catch(() => null)) return chromium.launch({ headless: !headed, executablePath });
    }
    throw error;
  }
}

if (!(await fetch(`${origin}/healthz`).then((response) => response.ok, () => false))) {
  console.error(`No Conduit at ${origin}: bash .devcontainer/start-conduit.sh start`);
  process.exit(2);
}
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "panes-smoke-"));
const storageState = path.join(scratch, "state.json");
execFileSync("node", ["scripts/conduit-auth.mjs", "mint-session", "--user-agent", "panes-smoke", "--format", "playwright", "--origin", origin, "--output", storageState], { cwd: root });

const { chromium } = await loadPlaywright();
const browser = await launch(chromium);
const results = [];
let project;

// A project whose top level holds enough files for every scenario.
{
  const context = await browser.newContext({ storageState });
  const response = await context.request.get(`${origin}/v0/projects`);
  const projects = (await response.json()).projects ?? [];
  const wanted = argument("--project");
  for (const candidate of projects) {
    // The Chats place has no project page Files list; a named one is taken as asked.
    if (wanted ? candidate.name !== wanted : candidate.kind === "unstructured") continue;
    const tree = await (await context.request.get(`${origin}/v0/projects/${encodeURIComponent(candidate.id)}/tree?path=`)).json().catch(() => ({}));
    const files = (tree.entries ?? []).filter((entry) => entry.type === "file");
    if (files.length >= 6) { project = candidate; break; }
  }
  await context.close();
  if (!project) { console.error(`No project${wanted ? ` named ${wanted}` : ""} with six top-level files`); process.exit(2); }
}

async function scenario(name, run) {
  const context = await browser.newContext({ storageState, viewport: { width: 1800, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // A failed request is named by its URL; 403s are places the session may not read (Source Control).
  page.on("console", (message) => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text().slice(0, 200)); });
  // Every file is asked for as text first; media answer 400 and load as media.
  const textFirst = (response) => response.status() === 400 && /\/file\?path=[^&]*$/.test(response.url());
  page.on("response", (response) => { if (response.status() >= 400 && response.status() !== 403 && !textFirst(response)) errors.push(`HTTP ${response.status()} ${response.request().method()} ${decodeURIComponent(response.url().replace(origin, "")).slice(0, 160)}`); });
  const failures = [];
  const check = (label, ok, detail = "") => { if (!ok) failures.push(`${label}${detail ? `: ${detail}` : ""}`); };
  try {
    await run(page, check);
  } catch (error) {
    failures.push(`threw: ${error.message.split("\n")[0]}`);
  }
  for (const error of errors) failures.push(`page error: ${error}`);
  results.push({ name, failures });
  console.log(`${failures.length ? "FAIL" : "ok  "} ${name}${failures.map((failure) => `\n       - ${failure}`).join("")}`);
  await context.close();
}

// Helpers over the page.
const open = async (page) => {
  await page.goto(`${origin}/project/${project.id}`);
  await page.locator(".workspace-rail").waitFor();
  const dock = await page.evaluate(() => document.querySelector(".workspace-panel")?.getBoundingClientRect().width ?? 0);
  if (dock < 10) await page.locator('.workspace-rail [data-tool="files"]').click();
  const show = page.locator('.workspace-panel [aria-label="Show file navigator"]');
  if (await show.isVisible().catch(() => false)) await show.click();
  await navFiles(page).nth(5).waitFor();
};
const navFiles = (page) => page.locator('.workspace-panel [role="treeitem"][data-path]:not([aria-expanded])');
// n columns, each headed by its tab.
const twoColumns = (page) => until(page, () => { const columns = [...document.querySelectorAll(".workspace-file-viewer > .workspace-preview")]; return columns.length === 2 && columns.every((column) => column.querySelector(".pane-tab")); });
const until = async (page, fn, arg, timeout = 4000) => page.waitForFunction(fn, arg, { timeout, polling: 50 }).then(() => true, () => false);
const columns = (page) => page.evaluate(() => [...document.querySelectorAll(".workspace-file-viewer > .workspace-preview")].map((column) =>
  column.classList.contains("file-viewer-empty-side") ? "EMPTY" : [...column.querySelectorAll(".pane-tab")].map((tab) => tab.textContent.trim() + (tab.classList.contains("pane-tab-active") ? "*" : "")).join("|")));
const focusIn = (page) => page.evaluate(() => {
  const active = document.activeElement;
  const column = active?.closest(".workspace-file-viewer > .workspace-preview");
  return active?.closest(".workspace-file-viewer") ? `viewer:${column ? [...column.parentElement.children].filter((child) => child.classList.contains("workspace-preview")).indexOf(column) : "?"}`
    : active?.closest("[data-pane-slot]") ? "slot" : active?.closest(".workspace-panel") ? "dock" : "main";
});
const fileName = (page, index) => navFiles(page).nth(index).getAttribute("data-path");
// A drag's pill and wash mid-drag, from synthetic events (native drags cannot pause).
const dragProbe = (page, source, target, fx, fy = 0.5) => source.elementHandle().then(async (handle) => {
  const box = await target.boundingBox();
  return page.evaluate(([element, x, y]) => {
    const transfer = new DataTransfer();
    element.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    document.elementFromPoint(x, y).dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
    return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const wash = document.querySelector(".doc-drop")?.getBoundingClientRect();
      done({ pill: document.querySelector(".drag-hint")?.textContent?.trim() ?? null, wash: wash ? { left: Math.round(wash.left), width: Math.round(wash.width) } : null });
      document.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
    })));
  }, [handle, box.x + box.width * fx, box.y + box.height * fy]);
});

await scenario("opening a file gives its viewer the keyboard and marks it in Files", async (page, check) => {
  await open(page);
  const name = await fileName(page, 0);
  await navFiles(page).nth(0).click();
  check("viewer opened", await until(page, () => document.querySelector("[data-pane-slot] .workspace-file-viewer")), `${name} -> ${decodeURIComponent(page.url().replace(origin, ""))}`);
  check("focus in the viewer", await until(page, () => document.activeElement?.closest(".workspace-file-viewer")), await focusIn(page));
  check("file bold as focused", await until(page, (path) => document.querySelector(`[data-path="${CSS.escape(path)}"][data-open-file="focused"]`), name));
  await page.locator(".chat-main").first().click({ position: { x: 300, y: 400 } }).catch(() => {});
  check("file still bold once focus leaves", await until(page, (path) => document.querySelector(`[data-path="${CSS.escape(path)}"][data-open-file="shown"]`), name));
});

await scenario("click replaces, Ctrl keeps as a tab, Alt opens a column; tabs survive a reload", async (page, check) => {
  await open(page);
  const names = await Promise.all([0, 1, 2, 3, 4].map((index) => fileName(page, index)));
  await navFiles(page).nth(0).click();
  await until(page, () => document.querySelector(".workspace-file-viewer"));
  await navFiles(page).nth(1).click();
  check("click replaced", await until(page, (n) => document.querySelectorAll(".file-side-tabs .pane-tab").length === 1 && document.querySelector(".file-side-tabs .pane-tab")?.textContent.includes(n), names[1]), JSON.stringify(await columns(page)));
  await navFiles(page).nth(2).click({ modifiers: ["Control"] });
  await navFiles(page).nth(3).click({ modifiers: ["Control"] });
  check("Ctrl added at the end", await until(page, () => document.querySelectorAll(".file-side-tabs .pane-tab").length === 3));
  const one = await columns(page);
  check("tab order", one[0]?.split("|").map((tab) => tab.replace("*", "")).join() === names.slice(1, 4).map((n) => n.split("/").pop()).join(), JSON.stringify(one));
  check("newest active", one[0]?.split("|")[2]?.endsWith("*"), JSON.stringify(one));
  await navFiles(page).nth(4).click({ modifiers: ["Alt"] });
  check("Alt opened a second column", await twoColumns(page), JSON.stringify(await columns(page)));
  check("ftabs in the URL", new URL(page.url()).searchParams.getAll("ftabs").length === 1, page.url());
  const bare = async () => JSON.stringify((await columns(page)).map((column) => column.replaceAll("*", "")));
  const before = await bare();
  await page.reload();
  check("tabs survive a reload", await until(page, (want) => JSON.stringify([...document.querySelectorAll(".workspace-file-viewer > .workspace-preview")].map((column) => [...column.querySelectorAll(".pane-tab")].map((tab) => tab.textContent.trim()).join("|"))) === want, before, 8000), `${before} vs ${await bare()}`);
});

await scenario("swap trades columns; a column's last tab dragged away leaves it empty", async (page, check) => {
  await open(page);
  await navFiles(page).nth(0).click();
  await until(page, () => document.querySelector(".workspace-file-viewer"));
  await navFiles(page).nth(1).click({ modifiers: ["Alt"] });
  await twoColumns(page);
  const [a, b] = await columns(page);
  await page.locator(".file-viewer-swap").click();
  check("swapped", await until(page, (want) => [...document.querySelectorAll(".workspace-file-viewer > .workspace-preview")].map((column) => column.querySelector(".pane-tab")?.textContent.trim()).join() === want, [b, a].map((tab) => tab.replace("*", "")).join()), JSON.stringify(await columns(page)));
  const viewer = page.locator(".workspace-file-viewer > .workspace-preview");
  const left = await viewer.nth(0).boundingBox();
  await viewer.nth(1).locator(".pane-tab").first().dragTo(viewer.nth(0), { targetPosition: { x: left.width * 0.6, y: 300 } });
  check("right column left empty", await until(page, () => document.querySelector(".file-viewer-empty-side")), JSON.stringify(await columns(page)));
  const after = await columns(page);
  check("left column took the tab", after[0]?.split("|").length === 2, JSON.stringify(after));
  check("still one file viewer pane", await page.locator("[data-pane-slot]").count() === 1);
});

await scenario("drag pills and washes name every target", async (page, check) => {
  await open(page);
  await navFiles(page).nth(0).click();
  await until(page, () => document.querySelector("[data-pane-slot] .workspace-file-viewer"));
  const viewer = page.locator("[data-pane-slot]").first();
  const box = await viewer.boundingBox();
  const source = navFiles(page).nth(1);
  const edge = await dragProbe(page, source, viewer, 0.1);
  check("viewer's left fifth opens a pane", edge.pill === "Open in a new pane on the left", JSON.stringify(edge));
  check("wash is the fifth", edge.wash && Math.abs(edge.wash.width - box.width / 5) <= 2 && Math.abs(edge.wash.left - box.x) <= 2, JSON.stringify(edge.wash));
  const right = await dragProbe(page, source, viewer, 0.9);
  check("viewer's right fifth opens a pane", right.pill === "Open in a new pane on the right", JSON.stringify(right));
  const beside = await dragProbe(page, source, viewer, 0.7);
  check("a lone column's right half opens a column", beside.pill === "Open in a new column", JSON.stringify(beside));
  const tab = await dragProbe(page, source, viewer, 0.3);
  check("a column's left half adds a tab", tab.pill === "Add as a tab here", JSON.stringify(tab));
  const main = page.locator(".chat-main").first();
  const replace = await dragProbe(page, source, main, 0.5);
  check("another pane's middle replaces it", replace.pill?.startsWith("Open here in place of"), JSON.stringify(replace));
  const third = await dragProbe(page, source, main, 0.1);
  const mainBox = await main.boundingBox();
  check("another pane's thirds open a pane", third.pill === "Open in a new pane on the left" && third.wash && Math.abs(third.wash.width - mainBox.width / 3) <= 2, JSON.stringify(third));
});

await scenario("split opens an empty column; narrowing folds actions in order into the ⋯", async (page, check) => {
  await open(page);
  await navFiles(page).nth(0).click();
  await until(page, () => document.querySelector(".workspace-file-viewer"));
  await page.locator('.workspace-file-viewer [aria-label="Open this file again beside"]').click();
  check("empty column", await until(page, () => document.querySelector(".file-viewer-empty-side")));
  await navFiles(page).nth(1).click();
  check("a file fills it", await until(page, () => !document.querySelector(".file-viewer-empty-side") && document.querySelectorAll(".workspace-file-viewer > .workspace-preview").length === 2), JSON.stringify(await columns(page)));
  const shares = () => page.evaluate(() => [...document.querySelectorAll(".workspace-file-viewer > .workspace-preview")].map((column) => Math.round(column.getBoundingClientRect().width)));
  const before = await shares();
  const divider = page.locator(".file-viewer-divider");
  for (let step = 0; step < 5; step++) {
    const box = await divider.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 80, box.y + 200, { steps: 4 });
    await page.mouse.up();
  }
  const after = await shares();
  check("divider resizes the columns", after[0] < before[0] - 100, `${before} -> ${after}`);
  await page.waitForTimeout(300);
  const folded = await page.evaluate(() => document.querySelector(".workspace-file-viewer > .workspace-preview .workspace-preview-header")?.dataset.foldedActions ?? "");
  const order = folded.split(",").filter(Boolean).map(Number);
  check("some actions folded", order.length > 0, folded);
  check("folded lowest priority first", order.every((value, index) => index === 0 || value > order[index - 1]) && order[0] === 0, folded);
  check("no header overflows", await page.evaluate(() => [...document.querySelectorAll(".workspace-file-viewer .workspace-preview-header")].every((header) => header.scrollWidth <= header.clientWidth + 1)));
  await page.locator(".workspace-file-viewer .workspace-preview-more").first().click();
  const items = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent.trim()));
  for (const want of ["Wrap lines", "Copy contents", "Copy path"]) check(`⋯ lists ${want}`, items.some((item) => item.startsWith(want)), items.join(" | "));
  check("⋯ lists the folded download", !order.includes(0) || items.some((item) => /download/i.test(item)), items.join(" | "));
  await page.keyboard.press("Escape");
});

await scenario("focus: Alt+] steps tabs across columns; Ctrl+Shift+2 steps panes; closing returns it", async (page, check) => {
  await open(page);
  await navFiles(page).nth(0).click();
  await until(page, () => document.querySelector(".workspace-file-viewer"));
  await navFiles(page).nth(1).click({ modifiers: ["Alt"] });
  await twoColumns(page);
  await page.locator(".workspace-file-viewer > .workspace-preview").nth(0).click({ position: { x: 200, y: 300 } });
  check("click takes column 0", await until(page, () => document.activeElement?.closest(".workspace-file-viewer > .workspace-preview:first-of-type") || document.activeElement?.closest(".workspace-file-viewer") && [...document.querySelectorAll(".workspace-file-viewer > .workspace-preview")][0].contains(document.activeElement)), await focusIn(page));
  const steps = [];
  for (let step = 0; step < 3; step++) { await page.keyboard.press("Alt+BracketRight"); await page.waitForTimeout(250); steps.push(await focusIn(page)); }
  check("Alt+] steps the tabs of both columns", steps.join() === "viewer:1,viewer:0,viewer:1", steps.join());
  await page.keyboard.press("Control+Shift+Digit2");
  check("Ctrl+Shift+2 leaves the viewer for pane A", await until(page, () => !document.activeElement?.closest("[data-pane-slot]")), await focusIn(page));
  await page.keyboard.press("Control+Shift+Digit2");
  check("Ctrl+Shift+2 comes back to the viewer", await until(page, () => document.activeElement?.closest(".workspace-file-viewer")), await focusIn(page));
  const place = () => page.evaluate(() => document.querySelector(".workspace-panel-header")?.textContent?.trim().slice(0, 60));
  const viewerPlace = await place();
  await page.locator("[data-pane-slot] [aria-label='Close this pane']").first().click();
  check("closing returns focus to pane A", await until(page, () => !document.querySelector("[data-pane-slot] .workspace-file-viewer") && !document.activeElement?.closest(".workspace-panel")), await focusIn(page));
  check("the dock names pane A's place", (await place()) === viewerPlace, `${viewerPlace} vs ${await place()}`);
});

await scenario("a project page's files open as the navigator's", async (page, check) => {
  await open(page);
  const rows = page.locator('.split-row[data-doc-view^="files:"]');
  await rows.first().waitFor({ timeout: 4000 }).catch(() => {});
  if (!await rows.count()) return console.log(`     (skipped: ${project.name}'s page lists no files; try --project <name>)`);
  const name = await rows.first().getAttribute("title");
  await rows.first().click();
  check("opened in a viewer with the keyboard", await until(page, () => document.activeElement?.closest("[data-pane-slot] .workspace-file-viewer")), await focusIn(page));
  check("its tab", (await columns(page))[0]?.includes(name), JSON.stringify(await columns(page)));
});

await browser.close();
await fs.rm(scratch, { recursive: true, force: true });
const failed = results.filter((result) => result.failures.length);
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed (project ${project.name})`);
process.exit(failed.length ? 1 : 0);
