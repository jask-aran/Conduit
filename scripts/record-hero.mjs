#!/usr/bin/env node
/**
 * Record the public hero against a private local Conduit data root.
 * Run from any directory: node scripts/record-hero.mjs
 * Requirements: the repository's web dependencies, tmux, ffmpeg and Chromium.
 * The scripted Test profile supplies repeatable transcript and tool activity.
 * The file edit is staged by this script after the turn starts; it is demo data.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { terminalSocketName } from "./terminal-lifecycle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = path.join(root, ".hero-state");
const dataRoot = path.join(root, ".hero-data");
const demoRoot = path.join(root, ".hero-demo");
const toolsRoot = path.join(root, ".hero-tools");
const origin = "http://127.0.0.1:4311";
const environment = {
  ...process.env,
  CONDUIT_HOST: "127.0.0.1",
  CONDUIT_PORT: "4311",
  CONDUIT_ADVERTISE_ON_LAN: "false",
  CONDUIT_STATE_DIR: runtime,
  CONDUIT_DATA_ROOT: dataRoot,
  CONDUIT_FILES_ROOT: path.join(dataRoot, "chat/files"),
  CONDUIT_CATALOG_FILE: path.join(dataRoot, "conduit.json"),
  CONDUIT_SESSION_REGISTRY_FILE: path.join(dataRoot, "sessions.json"),
  CONDUIT_PI_AGENT_DIR: path.join(dataRoot, "pi"),
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, env: environment, encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
async function healthy() {
  try { return (await fetch(`${origin}/healthz`)).ok; } catch { return false; }
}
await fs.mkdir(runtime, { recursive: true });
await fs.mkdir(toolsRoot, { recursive: true });
if (!await fs.stat(path.join(root, "conduit-web/node_modules/.bin/vite")).catch(() => null)) {
  throw new Error("Install web dependencies with bash .devcontainer/start-conduit.sh setup");
}
if (!await fs.stat(path.join(toolsRoot, "node_modules/playwright/index.mjs")).catch(() => null)) {
  run("npm", ["install", "--prefix", toolsRoot, "--no-save", "--package-lock=false", "playwright"]);
}
run("bash", [".devcontainer/start-conduit.sh", "build"]);
if (!await healthy()) run("bash", [".devcontainer/start-conduit.sh", "start"]);
if (!await healthy()) throw new Error("Demo server did not answer /healthz on port 4311");

const authFile = path.join(dataRoot, "auth.json");
if (!await fs.stat(authFile).catch(() => null)) {
  run("node", ["scripts/conduit-auth.mjs", "set-password", "--stdin"], {
    input: crypto.randomBytes(32).toString("hex"),
  });
}
const stateFile = path.join(runtime, "session.json");
run("node", ["scripts/conduit-auth.mjs", "mint-session", "--format", "playwright",
  "--origin", origin, "--output", stateFile]);
const storageState = JSON.parse(await fs.readFile(stateFile, "utf8"));
const session = storageState.cookies.find((item) => item.name === "conduit_session");
if (!session) throw new Error("mint-session did not return a Conduit cookie");
async function api(route, method = "GET", body) {
  const response = await fetch(`${origin}${route}`, {
    method,
    headers: { cookie: `${session.name}=${session.value}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const content = await response.text();
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${content}`);
  return content ? JSON.parse(content) : null;
}

// Small local repositories keep every recorded title and file under our control.
for (const [folder, title, description] of [
  ["atlas", "Atlas", "A tiny release notes site."],
  ["beacon", "Beacon", "A compact status page."],
]) {
  const directory = path.join(demoRoot, folder);
  await fs.mkdir(directory, { recursive: true });
  if (!await fs.stat(path.join(directory, ".git")).catch(() => null)) {
    await fs.writeFile(path.join(directory, "README.md"), `# ${title}\n\n${description}\n`);
    if (folder === "atlas") await fs.writeFile(path.join(directory, "site.js"),
      'export const title = "Atlas";\nexport const status = "draft";\n');
    run("git", ["-C", directory, "init", "-q"]);
    run("git", ["-C", directory, "add", "."]);
    run("git", ["-C", directory, "-c", "user.name=Conduit Demo",
      "-c", "user.email=demo@example.invalid", "commit", "-qm", "Seed demo workspace"]);
  }
}
const atlasFile = path.join(demoRoot, "atlas/site.js");
await fs.writeFile(atlasFile, 'export const title = "Atlas";\nexport const status = "draft";\n');

const markerFile = path.join(runtime, "seed.json");
const marker = JSON.parse(await fs.readFile(markerFile, "utf8").catch(() => "{}"));
const projects = (await api("/v0/projects")).projects;
const workspace = {};
for (const [name, folder] of [["Atlas", "atlas"], ["Beacon", "beacon"]]) {
  workspace[name] = projects.find((item) => item.name === name && item.path === path.join(demoRoot, folder))
    || await api("/v0/projects", "POST", { mode: "link", name, path: path.join(demoRoot, folder) });
}
const { chromium } = await import(pathToFileURL(path.join(toolsRoot, "node_modules/playwright/index.mjs")));
let executablePath = process.env.CONDUIT_HERO_CHROME || chromium.executablePath();
if (!await fs.stat(executablePath).catch(() => null)) {
  const cache = path.join(process.env.HOME, ".cache/ms-playwright");
  const folders = (await fs.readdir(cache)).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse();
  executablePath = folders.map((name) => path.join(cache, name, "chrome-linux64/chrome"))
    .find((name) => { try { execFileSync("test", ["-x", name]); return true; } catch { return false; } });
}
if (!executablePath) throw new Error("Set CONDUIT_HERO_CHROME to a Chromium executable");
const browser = await chromium.launch({ headless: true, executablePath, args: ["--disable-webgl"] });
const contextOptions = {
  storageState, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2,
  colorScheme: "dark", serviceWorkers: "block",
};
async function clearWorker(page) {
  await page.evaluate(async () => {
    for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
    for (const key of await caches.keys()) await caches.delete(key);
  });
  await page.reload();
}
async function prepare(page) {
  await page.addStyleTag({ content: `
    .composer-renderer-switch { display: none !important; }
    button[aria-label*="127.0.0.1"] { visibility: hidden !important; }
    .chat-meteors { display: none !important; }
    .workspace-diff-shell { --workspace-diff-navigator-width: 136px !important; }
  ` });
}
async function seedChat(project, title, prompt) {
  const chat = await api("/v0/chats", "POST", { projectId: project.id, profileId: "test-stream" });
  const page = await browser.newPage({ ...contextOptions });
  await page.goto(`${origin}/chat/${chat.id}`);
  await clearWorker(page);
  await prepare(page);
  await page.locator("textarea").fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByText(prompt, { exact: true }).waitFor();
  await page.waitForTimeout(1200);
  await api(`/v0/sessions/${chat.id}`, "PATCH", { name: title });
  await page.close();
  return chat.id;
}
if (!marker.atlasChat) marker.atlasChat = await seedChat(workspace.Atlas, "Plan release notes", "Review the release notes.");
if (!marker.beaconChat) marker.beaconChat = await seedChat(workspace.Beacon, "Check status copy", "Check the status page.");
if (marker.lastHeroChat) {
  await api(`/v0/sessions/${marker.lastHeroChat}`, "DELETE").catch(() => null);
  marker.lastHeroChat = null;
}
for (const chat of workspace.Atlas.sessions || []) {
  if (chat.id !== marker.atlasChat) await api(`/v0/sessions/${chat.id}`, "DELETE").catch((error) => {
    if (!String(error).includes('404 {"error":"chat_not_found"}')) throw error;
  });
}
const heroChat = await api("/v0/chats", "POST", { projectId: workspace.Atlas.id, profileId: "test-stream" });
marker.lastHeroChat = heroChat.id;
await api(`/v0/sessions/${heroChat.id}`, "PATCH", { name: "Polish status copy" });
await api(`/v0/chats/${heroChat.id}/models`, "PATCH", { model: "paced-60", thinkingLevel: "400 tokens" });
const terminals = (await api("/v0/ptys")).ptys;
let terminal = terminals.find((item) => item.projectId === workspace.Atlas.id && item.title === "Atlas checks" && item.status === "running");
if (!terminal) terminal = await api("/v0/ptys", "POST", { projectId: workspace.Atlas.id, title: "Atlas checks" });
const socketName = terminalSocketName(path.join(dataRoot, "remotes.json"));
const tmuxTarget = `c_${terminal.id.replace(/[^a-zA-Z0-9]/g, "")}`;
run("tmux", ["-L", socketName, "send-keys", "-t", tmuxTarget, "C-c"]);
run("tmux", ["-L", socketName, "send-keys", "-t", tmuxTarget,
  'clear; watch -t -n 1 "printf \'Atlas checks running\\n\'; git diff --stat"', "Enter"]);
await fs.writeFile(markerFile, JSON.stringify(marker, null, 2));

const recordingDir = path.join(runtime, "recording");
await fs.mkdir(recordingDir, { recursive: true });
const context = await browser.newContext({
  ...contextOptions, recordVideo: { dir: recordingDir, size: { width: 1440, height: 900 } },
});
await context.addInitScript(() => {
  document.documentElement.style.zoom = "1.15";
  localStorage.setItem("conduit.dashboard.threads:conduit", "computer");
});
const recordingStart = Date.now();
const page = await context.newPage();
page.setDefaultTimeout(6000);
await page.goto(origin);
await clearWorker(page);
await prepare(page);
await page.getByText("Computer", { exact: true }).last().click();
await page.getByText("Plan release notes", { exact: true }).waitFor();
async function installCursor() { await page.evaluate(() => {
  const cursor = document.createElement("div");
  cursor.id = "hero-cursor";
  cursor.style.cssText = "position:fixed;left:0;top:0;width:16px;height:20px;background:#fff;clip-path:polygon(0 0,0 100%,35% 72%,52% 100%,68% 92%,51% 64%,92% 59%);filter:drop-shadow(1px 2px 2px #000);pointer-events:none;z-index:99999;transform:translate(680px,450px)";
  document.body.append(cursor);
}); }
await installCursor();
let pointer = { x: 680, y: 450 };
async function moveTo(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Target is not visible");
  const end = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  for (let step = 1; step <= 12; step++) {
    const fraction = step / 12;
    const eased = fraction * fraction * (3 - 2 * fraction);
    const x = pointer.x + (end.x - pointer.x) * eased;
    const y = pointer.y + (end.y - pointer.y) * eased;
    await page.mouse.move(x, y);
    await page.evaluate(([left, top]) => {
      const cursor = document.getElementById("hero-cursor");
      if (cursor) cursor.style.transform = `translate(${left}px,${top}px)`;
    }, [x, y]);
    await page.waitForTimeout(14);
  }
  pointer = end;
}
async function click(locator) { await moveTo(locator); await locator.click(); }
const videoStart = Date.now();
const setupSeconds = Math.max(0, (videoStart - recordingStart) / 1000);
const until = async (seconds) => page.waitForTimeout(Math.max(0, videoStart + seconds * 1000 - Date.now()));
try {
  await until(2.1);
  await page.goto(`${origin}/chat/${heroChat.id}`);
  await prepare(page);
  await installCursor();
  await click(page.locator('button[aria-label="Computer"]').first());
  await page.getByRole("textbox", { name: "Message the agent" }).fill("Read the release note with 1 tool.");
  await until(4.0);
  await click(page.getByRole("button", { name: "Send message" }));
  await until(5.5);
  await fs.writeFile(atlasFile, 'export const title = "Atlas";\nexport const status = "ready for review";\n');
  await until(6.5);
  await click(page.locator('nav[aria-label="Workspace tools"] button[aria-label="Source Control"]'));
  const resize = page.locator('[aria-label="Resize workspace panel"]');
  await resize.focus();
  for (let step = 0; step < 10; step++) await resize.press("ArrowLeft");
  await page.getByText("site.js", { exact: true }).last().waitFor();
  await click(page.getByText("site.js", { exact: true }).last());
  await until(10.3);
  await click(page.locator('nav[aria-label="Workspace tools"] button[aria-label="Terminal"]'));
  await until(13.5);
  await click(page.locator('button[aria-label="Close workspace panel"]').first());
  await click(page.locator('button[data-sidebar="brand"]'));
  await prepare(page);
  await page.getByText("Computer", { exact: true }).last().click();
  await installCursor();
  await page.getByText("Plan release notes", { exact: true }).waitFor();
  if (!await page.getByText("Codex", { exact: true }).first().isVisible())
    await click(page.locator('button[aria-label="Computer"]').first());
  await until(17.1);
  await page.screenshot({ path: path.join(runtime, "final-frame.png") });
} finally {
  await context.close();
  await browser.close();
}
const videoPath = await page.video().path();
const out = path.join(root, "docs/images");
await fs.mkdir(out, { recursive: true });
run("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(setupSeconds), "-i", videoPath, "-t", "19", "-an", "-c:v", "libx264",
  "-pix_fmt", "yuv420p", "-crf", "22", path.join(out, "hero.mp4")]);
run("ffmpeg", ["-y", "-loglevel", "error", "-ss", "9.5", "-i", path.join(out, "hero.mp4"),
  "-frames:v", "1", path.join(out, "hero-poster.png")]);
const palette = path.join(recordingDir, "palette.png");
run("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(out, "hero.mp4"),
  "-vf", "fps=15,scale=1200:-1:flags=lanczos,palettegen=max_colors=96:stats_mode=diff", palette]);
run("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(out, "hero.mp4"), "-i", palette,
  "-filter_complex", "[0:v]fps=15,scale=1200:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5",
  "-loop", "0", path.join(out, "hero.gif")]);
const bytes = (await fs.stat(path.join(out, "hero.gif"))).size;
const duration = Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration",
  "-of", "default=noprint_wrappers=1:nokey=1", path.join(out, "hero.mp4")]));
run("bash", [".devcontainer/start-conduit.sh", "stop"]);
console.log(JSON.stringify({ duration, gifBytes: bytes, setupSeconds, heroChat: marker.lastHeroChat }));
if (bytes > 8_000_000) throw new Error("hero.gif is over 8 MB; shorten the recording");
if (duration < 15 || duration > 20) throw new Error("hero.mp4 must be 15 to 20 seconds");
