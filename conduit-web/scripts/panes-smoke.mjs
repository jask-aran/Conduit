#!/usr/bin/env node
/**
 * Browser smoke test for panes, single-file documents, drag targets and focus, against the running local server.
 * Run from conduit-web/: npm run smoke:panes [-- --project <name>] [--headed]
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
    const builds = (await fs.readdir(cache).catch(() => [])).filter((name) => headed ? /^chromium-\d+$/.test(name) : /^chromium(_headless_shell)?-\d+$/.test(name)).sort().reverse();
    for (const build of builds) {
      const executablePath = path.join(cache, build, build.startsWith("chromium_headless_shell") ? "chrome-headless-shell-linux64/chrome-headless-shell" : "chrome-linux64/chrome");
      if (await fs.stat(executablePath).catch(() => null)) return chromium.launch({ headless: !headed, executablePath });
    }
    throw error;
  }
}

if (!(await fetch(`${origin}/healthz`).then((response) => response.ok, () => false))) {
  console.error(`No Conduit at ${origin}: bash scripts/start-conduit.sh start`);
  process.exit(2);
}
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "panes-smoke-"));
const storageState = path.join(scratch, "state.json");
execFileSync("node", ["scripts/conduit-auth.mjs", "mint-session", "--user-agent", "panes-smoke", "--format", "playwright", "--origin", origin, "--output", storageState], { cwd: root });

const { chromium } = await loadPlaywright();
const browser = await launch(chromium);
const results = [];
let project;

{
  const context = await browser.newContext({ storageState });
  const response = await context.request.get(`${origin}/v0/projects`);
  const projects = (await response.json()).projects ?? [];
  const wanted = argument("--project");
  for (const candidate of projects) {
    // The Chats place has no project page Files list.
    if (wanted ? candidate.name !== wanted : candidate.kind === "unstructured") continue;
    const tree = await (await context.request.get(`${origin}/v0/projects/${encodeURIComponent(candidate.id)}/tree?path=`)).json().catch(() => ({}));
    // Files hides dotfiles until asked, so only the visible ones count.
    const files = (tree.entries ?? []).filter((entry) => entry.type === "file" && !(entry.name ?? entry.path?.split("/").pop() ?? "").startsWith("."));
    if (files.length >= 6) { project = candidate; break; }
  }
  await context.close();
  if (!project) { console.error(`No project${wanted ? ` named ${wanted}` : ""} with six top-level files`); process.exit(2); }
}

async function scenario(name, run) {
  // Room for a chat, a split and the dock at the 16px unit.
  const context = await browser.newContext({ storageState, viewport: { width: 2250, height: 1125 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // A failed request is named by its URL; 403s are places the session may not read (Source Control).
  page.on("console", (message) => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text().slice(0, 200)); });
  // Every file is asked for as text first; media answer 400 and load as media.
  const textFirst = (response) => response.status() === 400 && /\/file\?path=[^&]*$/.test(response.url());
  // A project on the hub itself has no node to read from directly: /direct answers 404, and files go through the hub.
  const notOnNode = (response) => response.status() === 404 && /\/v0\/projects\/[^/]+\/direct\?/.test(response.url());
  page.on("response", (response) => { if (response.status() >= 400 && response.status() !== 403 && !textFirst(response) && !notOnNode(response)) errors.push(`HTTP ${response.status()} ${response.request().method()} ${decodeURIComponent(response.url().replace(origin, "")).slice(0, 160)}`); });
  const failures = [];
  const check = (label, ok, detail = "") => { if (!ok) failures.push(`${label}${detail ? `: ${detail}` : ""}`); };
  let skipped = null;
  try {
    skipped = await run(page, check) ?? null;
  } catch (error) {
    failures.push(`threw: ${error.message}`);
  }
  for (const error of errors) failures.push(`page error: ${error}`);
  results.push({ name, failures, skipped });
  console.log(`${failures.length ? "FAIL" : skipped ? "skip" : "ok  "} ${name}${skipped && !failures.length ? ` (${skipped})` : ""}${failures.map((failure) => `\n       - ${failure}`).join("")}`);
  await context.close();
}

const open = async (page) => {
  await page.goto(`${origin}/project/${project.id}`);
  await page.locator('[data-region="workspace-rail"]').waitFor();
  const dock = await page.evaluate(() => document.querySelector(".workspace-panel")?.getBoundingClientRect().width ?? 0);
  if (dock < 10) await page.locator('[data-region="workspace-rail"] [data-tool="files"]').click();
  const show = page.locator('.workspace-panel [aria-label="Show file navigator"]');
  if (await show.isVisible().catch(() => false)) await show.click();
  await navFiles(page).nth(5).waitFor();
};
const navFiles = (page) => page.locator('.workspace-panel [role="treeitem"][data-path]:not([aria-expanded])');
const until = async (page, fn, arg, timeout = 4000) => page.waitForFunction(fn, arg, { timeout, polling: 50 }).then(() => true, () => false);
const paneViews = (page) => page.evaluate(() => new URL(location.href).searchParams.get("panes")?.split(";") ?? []);
const focusIn = (page) => page.evaluate(() => {
  const active = document.activeElement;
  const column = active?.closest(".ui-file-viewer > .ui-file");
  return active?.closest(".ui-file-viewer") ? `viewer:${column ? [...column.parentElement.children].filter((child) => child.classList.contains("ui-file")).indexOf(column) : "?"}`
    : active?.closest("[data-pane-slot]") ? `slot:${active.tagName}.${String(active.className).slice(0, 40)}` : active?.closest(".workspace-panel") ? "dock" : "main";
});
const fileName = (page, index) => navFiles(page).nth(index).getAttribute("data-path");
// Synthetic events: native drags cannot pause mid-drag.
const dragProbe = (page, source, target, fx, fy = 0.5) => source.elementHandle().then(async (handle) => {
  const box = await target.boundingBox();
  return page.evaluate(([element, x, y]) => {
    const transfer = new DataTransfer();
    element.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    document.elementFromPoint(x, y).dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
    return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const wash = document.querySelector(".ui-drop-wash:not([data-within])")?.getBoundingClientRect();
      done({ pill: document.querySelector(".ui-drag-pill")?.textContent?.trim() ?? null, wash: wash ? { left: Math.round(wash.left), width: Math.round(wash.width) } : null });
      document.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
    })));
  }, [handle, box.x + box.width * fx, box.y + box.height * fy]);
});

await scenario("plain replaces the focused pane with one file and no tabs", async (page, check) => {
  await open(page);
  const name = await fileName(page, 0);
  await navFiles(page).nth(0).click();
  check("viewer in pane A", await until(page, () => document.querySelector(".chat-main .ui-file-viewer")));
  check("viewer has the keyboard", await until(page, () => document.activeElement?.closest(".chat-main .ui-file-viewer"), undefined, 8000), await focusIn(page));
  check("one document without tabs", await page.locator(".ui-file-viewer > .ui-file").count() === 1 && await page.locator(".ui-file-viewer .ui-tab").count() === 0);
  check("file marked focused", await until(page, (path) => document.querySelector(`[data-path="${CSS.escape(path)}"][data-open-file="focused"]`), name));
  await navFiles(page).nth(1).click();
  check("plain replaced the file", await until(page, () => document.querySelectorAll(".ui-file-viewer > .ui-file").length === 1 && document.querySelectorAll("[data-pane-slot]").length === 0));
  check("no file-tab address state", new URL(page.url()).searchParams.getAll("ftabs").length === 0);
});

await scenario("Alt opens another document pane and both survive reload", async (page, check) => {
  await open(page);
  await navFiles(page).nth(0).click();
  await until(page, () => document.querySelector(".chat-main .ui-file-viewer"));
  const before = new URL(page.url()).searchParams.get("focus");
  await navFiles(page).nth(1).click({ modifiers: ["Alt"] });
  check("two document panes", await until(page, () => document.querySelectorAll(".ui-file-viewer").length === 2));
  check("Alt kept the keyboard pane", new URL(page.url()).searchParams.get("focus") === before);
  check("no file columns or tabs", await page.locator(".ui-file-viewer[data-split], .ui-file-viewer .ui-tab").count() === 0);
  const views = await paneViews(page);
  await page.reload();
  check("documents survive reload", await until(page, () => document.querySelectorAll(".ui-file-viewer").length === 2));
  check("same views", JSON.stringify(await paneViews(page)) === JSON.stringify(views));
});

await scenario("Ctrl opens a file document without adding document tabs", async (page, check) => {
  await open(page);
  await navFiles(page).nth(0).click({ modifiers: ["Control"] });
  check("file in a pane beside the session", await until(page, () => document.querySelector("[data-pane-slot] .ui-file-viewer")));
  check("document has no tabs", await page.locator(".ui-file-viewer .ui-tab").count() === 0);
  const before = (await paneViews(page)).length;
  await navFiles(page).nth(0).click({ modifiers: ["Alt"] });
  check("opening an existing document goes to it", (await paneViews(page)).length === before);
});

await scenario("file drag edges open panes and the middle replaces", async (page, check) => {
  await open(page);
  await navFiles(page).nth(0).click();
  await until(page, () => document.querySelector(".chat-main .ui-file-viewer"));
  const viewer = page.locator(".chat-main");
  const box = await viewer.boundingBox();
  const source = navFiles(page).nth(1);
  const left = await dragProbe(page, source, viewer, 0.1);
  check("left third opens a pane", left.pill === "Open in a new pane on the left" && left.wash && Math.abs(left.wash.width - box.width / 3) <= 2, JSON.stringify(left));
  const right = await dragProbe(page, source, viewer, 0.9);
  check("right third opens a pane", right.pill === "Open in a new pane on the right", JSON.stringify(right));
  const middle = await dragProbe(page, source, viewer, 0.5);
  check("middle replaces the document", middle.pill?.startsWith("Open here in place of"), JSON.stringify(middle));
});

await scenario("file panes swap and keyboard focus cycles between them", async (page, check) => {
  await open(page);
  await navFiles(page).nth(0).click();
  await until(page, () => document.querySelector(".chat-main .ui-file-viewer"));
  await navFiles(page).nth(1).click({ modifiers: ["Alt"] });
  await until(page, () => document.querySelectorAll(".ui-file-viewer").length === 2);
  const before = await paneViews(page);
  await page.locator('[data-pane-slot] [aria-label="Swap with the pane beside"]').click();
  check("documents swapped", await until(page, (views) => new URL(location.href).searchParams.get("panes") === views, [...before].reverse().join(";")));
  check("swap finished", await until(page, () => document.querySelectorAll(".chat-main .file-viewer-surface").length === 1));
  await page.locator(".chat-main .file-viewer-surface").click({ position: { x: 200, y: 300 } });
  await page.keyboard.press("Control+Shift+Digit2");
  check("next pane takes focus", await until(page, () => document.activeElement?.closest("[data-pane-slot] .ui-file-viewer")), await focusIn(page));
  await page.keyboard.press("Control+Shift+Digit2");
  check("next pane returns to A", await until(page, () => document.activeElement?.closest(".chat-main .ui-file-viewer")), await focusIn(page));
});

await scenario("summons survive reload and dismiss back to the held dock pane", async (page, check) => {
  const params = new URLSearchParams({ panes: `page:project:${project.id};page:dashboard`, dock: "1" });
  await page.goto(`${origin}/project/${project.id}?${params}`);
  const held = page.locator("[data-pane-slot].main-split");
  await held.waitFor({ state: "visible" });
  const files = page.locator('[data-region="workspace-rail"] [data-tool="files"]');
  await files.click();
  check("summon hides held pane", await until(page, () => document.querySelector("[data-pane-slot]")?.getAttribute("data-docked") === "hidden"));
  await page.reload();
  await page.getByRole("radiogroup", { name: "Folder viewer", exact: true }).waitFor();
  await files.click();
  check("dismiss restores held pane", await until(page, () => document.querySelector("[data-pane-slot]")?.getAttribute("data-docked") === ""));
});

await scenario("replacing an edited file can be cancelled without saving it", async (page, check) => {
  await open(page);
  const textFiles = page.locator('.workspace-panel [role="treeitem"][data-path$=".txt"]:not([aria-expanded])');
  if (await textFiles.count() < 2) return "needs two .txt files for the unsaved-edit check";
  let writes = 0;
  page.on("request", (request) => { if (/\/file\?/.test(request.url()) && ["PUT", "POST", "PATCH", "DELETE"].includes(request.method())) writes++; });
  await textFiles.nth(0).click();
  await page.locator(".chat-main .cm-content").waitFor();
  await textFiles.nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const editor = page.locator('.chat-main .cm-content[contenteditable="true"]');
  await editor.press("End");
  await editor.pressSequentially(" pane-unsaved-probe");
  await page.getByRole("button", { name: "Save file", exact: true }).waitFor();
  const before = await paneViews(page);
  await textFiles.nth(0).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  check("same document after cancel", JSON.stringify(await paneViews(page)) === JSON.stringify(before));
  check("edits retained", (await editor.textContent()).includes("pane-unsaved-probe"));
  check("no file written", writes === 0);
});

await scenario("dragging the dock's edge and a pane's edge resizes them in place", async (page, check) => {
  await open(page);
  await navFiles(page).nth(0).click({ modifiers: ["Alt"] });
  await until(page, () => document.querySelector("[data-pane-slot] .ui-file-viewer"));
  const geometry = () => page.evaluate(() => { const box = (selector) => { const r = document.querySelector(selector)?.getBoundingClientRect(); return r ? { left: Math.round(r.left), right: Math.round(r.right) } : null; }; return { dock: box(".workspace-panel"), main: box(".chat-main"), slot: box("[data-pane-slot]") }; });
  const dragBy = async (selector, dx) => {
    const handle = await page.locator(selector).first().boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
    await page.mouse.down();
    for (let step = 1; step <= 8; step++) await page.mouse.move(handle.x + handle.width / 2 + dx * step / 8, handle.y + 200);
    const mid = await geometry();
    await page.mouse.up();
    await page.waitForTimeout(300);
    return mid;
  };
  const before = await geometry();
  const mid = await dragBy('.ui-resize-edge[data-edge="pane"][data-dock]', -120);
  const after = await geometry();
  check("mid-drag the dock stays at the right edge", mid.dock && Math.abs(mid.dock.right - before.dock.right) <= 2 && mid.dock.left < before.dock.left - 60, JSON.stringify({ before: before.dock, mid: mid.dock }));
  check("the dock took the width", after.dock.left < before.dock.left - 60 && Math.abs(after.dock.right - before.dock.right) <= 2, JSON.stringify({ before: before.dock, after: after.dock }));
  check("the panes gave it up", after.slot.right <= after.dock.left + 2 && after.main.left === before.main.left, JSON.stringify(after));
  const beforePanes = await geometry();
  const midPanes = await dragBy('.ui-resize-edge[data-edge="pane"]:not([data-dock])', -100);
  const afterPanes = await geometry();
  check("mid-drag the panes follow the edge", midPanes.main.right < beforePanes.main.right - 50 && midPanes.slot.right === beforePanes.slot.right, JSON.stringify({ before: beforePanes, mid: midPanes }));
  check("the edge stays where it was dropped", Math.abs(afterPanes.main.right - midPanes.main.right) <= 4 && afterPanes.dock.left === beforePanes.dock.left, JSON.stringify({ mid: midPanes, after: afterPanes }));
});

await scenario("a project page's files open as the navigator's", async (page, check) => {
  await open(page);
  const rows = page.locator('.ui-row[data-density=list][data-doc-view^="files:"]');
  await rows.first().waitFor({ timeout: 4000 }).catch(() => {});
  if (!await rows.count()) return `${project.name}'s page lists no files; try --project <name>`;
  const name = await rows.first().getAttribute("title");
  await rows.first().click();
  check("opened in pane A with the keyboard", await until(page, () => document.activeElement?.closest(".chat-main .ui-file-viewer")), await focusIn(page));
  check("its file", (await paneViews(page)).some((view) => decodeURIComponent(view).includes(name)));
});

await browser.close();
await fs.rm(scratch, { recursive: true, force: true });
const failed = results.filter((result) => result.failures.length);
const skipped = results.filter((result) => result.skipped && !result.failures.length).length;
console.log(`\n${results.length - failed.length - skipped}/${results.length} scenarios passed${skipped ? `, ${skipped} skipped` : ""} (project ${project.name})`);
process.exit(failed.length ? 1 : 0);
