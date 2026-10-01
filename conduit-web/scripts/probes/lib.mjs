/**
 * Shared setup for the investigation probes (docs/testing.md, Layout
 * stability and Frame budget). Each probe drives the running local server in
 * one of two browsers:
 *
 * - headless Chromium (default), with a freshly minted session;
 * - `--windows`: the headed Windows Chrome started by
 *   `node scripts/run-windows-chrome-devtools.mjs start`, over CDP on :9222,
 *   already logged in. Use it for anything about pixels, compositing or frame
 *   cost: fractional display scaling only exists there.
 *
 * Probes open a page of their own and close it, so nothing of the reader's is
 * touched; a probe killed mid-run leaves its page open in Windows Chrome.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const origin = process.env.CONDUIT_ORIGIN || "http://127.0.0.1:4310";
export const cdpOrigin = process.env.CONDUIT_CDP || "http://127.0.0.1:9222";
export const arg = (name, fallback) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : fallback; };
export const flag = (name) => process.argv.includes(name);

export async function loadPlaywright() {
  try { return await import("playwright"); } catch {}
  const tools = path.join(root, ".smoke-tools");
  const entry = path.join(tools, "node_modules/playwright/index.mjs");
  if (!await fs.stat(entry).catch(() => null)) {
    const installed = spawnSync("npm", ["install", "--prefix", tools, "--no-save", "--package-lock=false", "playwright"], { stdio: "inherit" });
    if (installed.status !== 0) throw new Error("Could not install playwright into .smoke-tools");
  }
  return import(pathToFileURL(entry).href);
}

async function launchHeadless(chromium) {
  try { return await chromium.launch(); } catch (error) {
    // A cached Chromium from another Playwright version serves as well.
    const cache = path.join(os.homedir(), ".cache/ms-playwright");
    const builds = (await fs.readdir(cache).catch(() => [])).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse();
    for (const build of builds) {
      const executablePath = path.join(cache, build, "chrome-linux64/chrome");
      if (await fs.stat(executablePath).catch(() => null)) return chromium.launch({ executablePath });
    }
    throw error;
  }
}

/**
 * A page on the running server. `width`/`height` size the headless viewport,
 * or try to size the Windows window (the screen caps it; check `innerWidth`).
 */
export async function open({ windows = flag("--windows"), width = 1800, height = 1000 } = {}) {
  if (!(await fetch(`${origin}/healthz`).then((response) => response.ok, () => false))) {
    console.error(`No Conduit at ${origin}: bash .devcontainer/start-conduit.sh start`);
    process.exit(2);
  }
  const { chromium } = await loadPlaywright();
  if (windows) {
    const browser = await chromium.connectOverCDP(cdpOrigin).catch(() => {
      console.error(`No Windows Chrome at ${cdpOrigin}: node scripts/run-windows-chrome-devtools.mjs start`);
      process.exit(2);
    });
    const context = browser.contexts()[0];
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    try {
      const { windowId } = await cdp.send("Browser.getWindowForTarget");
      await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
      await cdp.send("Browser.setWindowBounds", { windowId, bounds: { width, height } });
    } catch {}
    return { browser, context, page, cdp, windows, close: () => page.close().catch(() => {}) };
  }
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-probe-"));
  const storageState = path.join(scratch, "state.json");
  execFileSync("node", ["scripts/conduit-auth.mjs", "mint-session", "--user-agent", "probe", "--format", "playwright", "--origin", origin, "--output", storageState], { cwd: root });
  const browser = await launchHeadless(chromium);
  const context = await browser.newContext({ storageState, viewport: { width, height } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  return { browser, context, page, cdp, windows, close: () => browser.close().catch(() => {}) };
}

/** The ids of the most recent chats, for probes that need some to open. */
export async function recentChats(page, count = 2) {
  if (!page.url().startsWith(origin)) await page.goto(origin);
  return page.evaluate(async (count) => {
    const body = await fetch("/v0/projects").then((response) => response.json());
    return (body.projects ?? body).flatMap((project) => (project.sessions ?? []).map((session) => session.id)).slice(0, count);
  }, count);
}

/** Load `address` (a path, or a full URL) and give it time to settle. */
export async function visit(page, address, settle = 4000) {
  await page.goto(address.startsWith("http") ? address : `${origin}${address}`);
  await page.waitForTimeout(settle);
}

/** The whole viewport as PNG bytes, straight from the compositor. */
export async function capture(cdp, page, clip) {
  const area = clip ?? await page.evaluate(() => ({ x: 0, y: 0, width: innerWidth, height: innerHeight }));
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip: { ...area, scale: 1 } });
  return Buffer.from(data, "base64");
}
