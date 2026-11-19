#!/usr/bin/env node
/**
 * Browser smoke test for panes, the folder viewer, file documents, drag targets and focus, against the running local server.
 * Run from conduit-web/: npm run smoke:panes [-- --project <name>]
 */
import { arg, open as openSession, origin } from "./probes/lib.mjs";

const viewport = { width: 2250, height: 1125 };
const session = await openSession(viewport);
const storageState = await session.context.storageState();
const scratch = "panes-smoke-scratch.txt";
const api = (method, path, data) => session.context.request.fetch(`${origin}/v0/${path}`, { method, data, headers: { origin, "content-type": "application/octet-stream" } });
const results = [];
let project, files = [], chat, created = false;

async function scenario(name, run) {
  // Room for a chat, two panes and the dock at the 16px unit.
  const context = await session.browser.newContext({ storageState, viewport });
  const page = await context.newPage();
  const errors = [], notes = [];
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
    skipped = await run(page, check, (note) => notes.push(note)) ?? null;
  } catch (error) {
    failures.push(`threw: ${error.message.split("\n")[0]}`);
  }
  for (const error of errors) failures.push(`page error: ${error}`);
  results.push({ name, failures, skipped });
  console.log(`${failures.length ? "FAIL" : skipped ? "skip" : "ok  "} ${name}${skipped && !failures.length ? ` (${skipped})` : ""}${[...notes.map((note) => `note: ${note}`), ...failures].map((line) => `\n       - ${line}`).join("")}`);
  await context.close();
}

const until = async (page, fn, arg, timeout = 4000) => page.waitForFunction(fn, arg, { timeout, polling: 50 }).then(() => true, () => false);
const paneViews = (page) => page.evaluate(() => new URL(location.href).searchParams.get("panes")?.split(";") ?? []);
const where = (page) => page.evaluate(() => { const active = document.activeElement; return `${active?.tagName}${active?.closest(".workspace-panel") ? " in the dock" : active?.closest("[data-pane-slot]") ? " in a side pane" : active?.closest(".chat-main") ? " in pane A" : ""}`; });
const row = (page, scope, path) => page.locator(`${scope} [role="treeitem"][data-path="${path}"]`);
const dockRow = (page, index) => row(page, ".workspace-panel", files[index]);
// A narrow viewer folds its tree after a plain open; this unfolds it.
const showTree = async (page) => { const show = page.locator('.workspace-panel [aria-label="Show file navigator"]'); if (await show.isVisible().catch(() => false)) await show.click(); };
const dockClick = async (page, index, options) => { await showTree(page); await dockRow(page, index).click(options); };
const shows = (page, scope, path) => until(page, ([scope, path]) => [...document.querySelectorAll(`${scope} .ui-file`)].some((file) => file.checkVisibility() && file.textContent.includes(path)), [scope, path]);
const open = async (page) => {
  await page.goto(`${origin}/project/${project.id}`);
  await page.locator('[data-region="workspace-rail"] [data-tool="files"]').click();
  await showTree(page);
  await dockRow(page, 5).waitFor();
};
const editScratch = async (page, scope, text) => {
  await row(page, scope, scratch).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const editor = page.locator(`${scope} .cm-content[contenteditable="true"]`);
  await editor.press("End").then(() => editor.pressSequentially(text));
  await page.locator(scope).getByRole("button", { name: "Save file", exact: true }).waitFor();
  return editor;
};
const countWrites = (page) => { const counter = { writes: 0 }; page.on("request", (request) => { if (/\/file\?/.test(request.url()) && request.method() !== "GET") counter.writes++; }); return counter; };
// Synthetic events: native drags cannot pause mid-drag. `drop` lands it.
const dragProbe = (page, source, target, fx, drop = false) => source.elementHandle().then(async (handle) => {
  const box = await target.boundingBox();
  return page.evaluate(([element, x, y, drop]) => {
    const transfer = new DataTransfer();
    element.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    document.elementFromPoint(x, y).dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
    return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const wash = document.querySelector(".ui-drop-wash:not([data-within])")?.getBoundingClientRect();
      done({ pill: document.querySelector(".ui-drag-pill")?.textContent?.trim() ?? null, wash: wash ? { left: Math.round(wash.left), width: Math.round(wash.width) } : null });
      if (drop) document.elementFromPoint(x, y).dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
      document.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
    })));
  }, [handle, box.x + box.width * fx, box.y + box.height / 2, drop]);
});

try {
  const projects = (await (await api("GET", "projects")).json()).projects ?? [];
  const wanted = arg("--project");
  for (const candidate of projects) {
    // The Chats place has no project page Files list.
    if (wanted ? candidate.name !== wanted : candidate.kind === "unstructured") continue;
    const tree = await (await api("GET", `projects/${encodeURIComponent(candidate.id)}/tree?path=`)).json().catch(() => ({}));
    // Files hides dotfiles until asked, so only the visible ones count.
    files = (tree.entries ?? []).filter((entry) => entry.type === "file" && !entry.path.startsWith(".") && entry.path !== scratch).map((entry) => entry.path);
    if (files.length >= 6) { project = candidate; break; }
  }
  if (!project) throw new Error(`No project${wanted ? ` named ${wanted}` : ""} with six top-level files`);
  const owner = projects.find((candidate) => candidate.kind !== "unstructured" && candidate.sessions?.some((thread) => thread.templateId !== "agent"));
  chat = owner && { project: owner.name, id: owner.sessions.find((thread) => thread.templateId !== "agent").id };
  // The one file edits go into; never saved, removed at the end.
  created = (await api("PUT", `projects/${encodeURIComponent(project.id)}/file?path=${scratch}`, "panes smoke scratch\n")).ok;

  await scenario("the dock's folder viewer opens a plain click inside itself", async (page, check, note) => {
    await open(page);
    const before = await paneViews(page);
    await dockRow(page, 1).click();
    check("file shown in the dock", await shows(page, ".workspace-panel", files[1]));
    check("no pane opened", JSON.stringify(await paneViews(page)) === JSON.stringify(before), JSON.stringify(await paneViews(page)));
    note(`after a plain open the dock's tree ${await dockRow(page, 2).isVisible() ? "stays" : "folds away"}; the keyboard is on ${await where(page)}`);
  });

  await scenario("Alt, Ctrl and Open beside open file document panes; opening one again goes to it", async (page, check) => {
    await open(page);
    await dockRow(page, 1).click({ modifiers: ["Alt"] });
    check("Alt opened a file pane", await until(page, () => document.querySelector("[data-pane-slot] .ui-file-viewer")));
    check("Alt kept the keyboard in the dock", await until(page, () => document.activeElement?.closest(".workspace-panel")), await where(page));
    check("document has no tabs", await page.locator(".ui-file-viewer .ui-tab").count() === 0);
    await dockClick(page, 2, { modifiers: ["Control"] });
    check("Ctrl opened another", await until(page, () => document.querySelectorAll("[data-pane-slot] .ui-file-viewer").length === 2));
    const views = await paneViews(page);
    await dockClick(page, 1, { modifiers: ["Alt"] });
    check("opening it again goes to it", JSON.stringify(await paneViews(page)) === JSON.stringify(views));
    await dockClick(page, 3, { button: "right" });
    await page.getByRole("menuitem", { name: "Open beside", exact: true }).click();
    check("Open beside opened it", await until(page, (path) => new URL(location.href).searchParams.get("panes")?.includes(`:${path}`), files[3]));
    const shown = await paneViews(page);
    await page.reload();
    check("documents survive reload", await until(page, () => document.querySelectorAll(".ui-file-viewer").length === 2, undefined, 8000));
    check("same views", JSON.stringify(await paneViews(page)) === JSON.stringify(shown));
  });

  await scenario("file drag edges open panes and the middle replaces", async (page, check) => {
    await open(page);
    const target = page.locator(".chat-main");
    await until(page, () => { const main = document.querySelector(".chat-main"), same = main.offsetWidth === main.smokeWidth; main.smokeWidth = main.offsetWidth; return same; }); // the dock has eased open
    const left = await dragProbe(page, dockRow(page, 1), target, 0.1), box = await target.boundingBox();
    check("left third opens a pane", left.pill === "Open in a new pane on the left" && left.wash && Math.abs(left.wash.width - box.width / 3) <= 2, JSON.stringify(left));
    const right = await dragProbe(page, dockRow(page, 1), target, 0.9);
    check("right third opens a pane", right.pill === "Open in a new pane on the right", JSON.stringify(right));
    const middle = await dragProbe(page, dockRow(page, 1), target, 0.5);
    check("middle replaces", middle.pill?.startsWith("Open here in place of"), JSON.stringify(middle));
  });

  await scenario("panes swap and keyboard focus cycles between them", async (page, check) => {
    await open(page);
    await dockRow(page, 0).click({ modifiers: ["Alt"] });
    await page.locator("[data-pane-slot] .ui-file-viewer").waitFor();
    const before = await paneViews(page);
    await page.locator('[data-pane-slot] [aria-label="Swap with the pane beside"]').click();
    check("panes swapped", await until(page, (views) => new URL(location.href).searchParams.get("panes") === views, [...before].reverse().join(";")));
    check("swap finished", await until(page, () => document.querySelectorAll(".chat-main .file-viewer-surface").length === 1));
    await page.locator(".chat-main .file-viewer-surface").click({ position: { x: 200, y: 300 } });
    await page.keyboard.press("Control+Shift+Digit2");
    check("next pane takes focus", await until(page, () => document.activeElement?.closest("[data-pane-slot]")), await where(page));
    await page.keyboard.press("Control+Shift+Digit2");
    check("next pane returns to A", await until(page, () => document.activeElement?.closest(".chat-main")), await where(page));
  });

  await scenario("summons survive reload and dismiss back to the held dock pane", async (page, check) => {
    const params = new URLSearchParams({ panes: `page:project:${project.id};page:dashboard`, dock: "1" });
    await page.goto(`${origin}/project/${project.id}?${params}`);
    await page.locator("[data-pane-slot].main-split").waitFor({ state: "visible" });
    const files = page.locator('[data-region="workspace-rail"] [data-tool="files"]');
    await files.click();
    check("summon hides held pane", await until(page, () => document.querySelector("[data-pane-slot]")?.getAttribute("data-docked") === "hidden"));
    await page.reload();
    await page.getByRole("radiogroup", { name: "Folder viewer", exact: true }).waitFor();
    await files.click();
    check("dismiss restores held pane", await until(page, () => document.querySelector("[data-pane-slot]")?.getAttribute("data-docked") === ""));
  });

  await scenario("Move to a pane gives a folder viewer that opens inside itself; pane undo brings the summon back", async (page, check) => {
    await open(page);
    await page.locator('.workspace-panel [aria-label="Move Files to a pane"]').click();
    const folder = `folder:${project.id}`;
    check("a folder pane, the summon gone", await until(page, (folder) => new URL(location.href).searchParams.get("panes")?.split(";").includes(folder) && !new URL(location.href).searchParams.get("summon"), folder));
    const views = await paneViews(page);
    await row(page, "[data-pane-slot]", files[0]).click();
    check("plain opened inside it", await shows(page, "[data-pane-slot]", files[0]));
    check("and no pane", JSON.stringify(await paneViews(page)) === JSON.stringify(views), JSON.stringify(await paneViews(page)));
    await row(page, "[data-pane-slot]", files[1]).click({ modifiers: ["Alt"] });
    check("Alt opened a file pane", await until(page, (count) => new URL(location.href).searchParams.get("panes")?.split(";").length === count, views.length + 1));
    await page.keyboard.press("Control+Alt+z");
    await page.keyboard.press("Control+Alt+z");
    check("undo brought the summon back", await until(page, (folder) => !new URL(location.href).searchParams.get("panes")?.includes(folder), folder) && await until(page, () => new URL(location.href).searchParams.get("summon") === "files"), page.url());
    await page.keyboard.press("Control+Alt+Shift+z");
    check("redo moved it again", await until(page, (folder) => new URL(location.href).searchParams.get("panes")?.includes(folder), folder) && !new URL(page.url()).searchParams.get("summon"));
    await page.reload();
    check("its file is open after reload", await shows(page, "[data-pane-slot]", files[0]));
  });

  await scenario("dragging the dock's header into the row gives a folder pane", async (page, check) => {
    await open(page);
    const dropped = await dragProbe(page, page.locator('.workspace-panel [data-doc-view^="folder:"]').first(), page.locator(".chat-main"), 0.9, true);
    check("the drop says so", dropped.pill === "Open in a new pane on the right", JSON.stringify(dropped));
    check("a folder pane, the summon gone", await until(page, (folder) => new URL(location.href).searchParams.get("panes")?.split(";").includes(folder) && !new URL(location.href).searchParams.get("summon"), `folder:${project.id}`), page.url());
    await row(page, "[data-pane-slot]", files[0]).click();
    check("plain opened inside it", await shows(page, "[data-pane-slot]", files[0]));
  });

  await scenario("an unsaved edit is asked about before a plain open or a pane undo replaces it", async (page, check) => {
    const counter = countWrites(page);
    await open(page);
    await page.locator('.workspace-panel [aria-label="Move Files to a pane"]').click();
    await row(page, "[data-pane-slot]", scratch).waitFor();
    const editor = await editScratch(page, "[data-pane-slot]", " pane-unsaved-probe");
    const views = await paneViews(page);
    for (const [label, act] of [["a plain open", () => row(page, "[data-pane-slot]", files[0]).click()], ["pane undo", () => page.keyboard.press("Control+Alt+z")]]) {
      await act();
      const dialog = page.getByRole("alertdialog"), asked = await dialog.waitFor({ timeout: 3000 }).then(() => true, () => false);
      check(`${label} asked`, asked);
      if (asked) await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      check(`same panes after ${label}`, JSON.stringify(await paneViews(page)) === JSON.stringify(views));
      check(`edit kept after ${label}`, (await editor.textContent().catch(() => "")).includes("pane-unsaved-probe"));
    }
    check("no file written", counter.writes === 0);
  });

  await scenario("an edit survives Files → Changes → Files", async (page, check) => {
    await page.goto(`${origin}/project/${project.id}?panes=${encodeURIComponent(`page:project:${project.id};folder:${project.id}`)}`);
    const changes = page.locator("[data-pane-slot]").getByRole("radio", { name: "Changes" });
    await row(page, "[data-pane-slot]", scratch).waitFor();
    if (await changes.isDisabled()) return `${project.name} has no Changes`;
    const editor = await editScratch(page, "[data-pane-slot]", " modes-probe");
    await changes.click();
    await page.locator("[data-pane-slot]").getByRole("radio", { name: "Files" }).click();
    check("edit kept", (await editor.textContent()).includes("modes-probe"));
  });

  await scenario("the dock's unsaved edit when focus moves to another workspace", async () => "needs a decision: today the edit is dropped without asking");

  await scenario("a chat in pane B names its project in its header", async (page, check) => {
    if (!chat) return "no project holds a chat";
    await page.goto(`${origin}/project/${project.id}?panes=${encodeURIComponent(`page:project:${project.id};chat:${chat.id}`)}`);
    check("names its project", await until(page, (name) => document.querySelector("[data-pane-slot] .ui-pane-header")?.textContent.includes(name), chat.project, 8000), await page.locator("[data-pane-slot] .ui-pane-header").first().textContent().catch(() => "no header"));
  });

  await scenario("dragging the dock's edge and a pane's edge resizes them in place", async (page, check) => {
    await open(page);
    await dockRow(page, 0).click({ modifiers: ["Alt"] });
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

  await scenario("a project page's files replace pane A, which takes the keyboard", async (page, check) => {
    await open(page);
    const rows = page.locator('.ui-row[data-density=list][data-doc-view^="files:"]');
    await rows.first().waitFor({ timeout: 4000 }).catch(() => {});
    if (!await rows.count()) return `${project.name}'s page lists no files; try --project <name>`;
    const name = await rows.first().getAttribute("title");
    await rows.first().click();
    check("opened in pane A with the keyboard", await until(page, () => document.activeElement?.closest(".chat-main .ui-file-viewer")), await where(page));
    check("its file", (await paneViews(page)).some((view) => decodeURIComponent(view).includes(name)));
  });
} catch (error) {
  console.error(error.message);
  results.push({ failures: [error.message] });
} finally {
  if (created) await api("DELETE", `projects/${encodeURIComponent(project.id)}/file?path=${scratch}`);
  await session.close();
}
const failed = results.filter((result) => result.failures.length);
const skipped = results.filter((result) => result.skipped && !result.failures.length).length;
console.log(`\n${results.length - failed.length - skipped}/${results.length} scenarios passed${skipped ? `, ${skipped} skipped` : ""}${project ? ` (project ${project.name})` : ""}`);
process.exit(failed.length ? 1 : 0);
