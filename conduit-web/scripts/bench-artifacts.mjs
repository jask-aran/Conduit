#!/usr/bin/env node
/**
 * How fast the sheet and the paper open and answer, and what appears or moves after their pane first paints, in headless Chrome.
 *
 *   node scripts/bench-artifacts.mjs <sheet|paper|both> [--runs 5] [--cpu 1,4] [--art] [--save <path without extension>]
 *
 * Run from conduit-web/ against CONDUIT_ORIGIN (http://127.0.0.1:4310). The sheet is the owner's "probe-sheet": it types into Z1 and
 * clears it, and checks columns Z on are as found. The paper is a scratch one, "bench scratch" in the Test project, made with 300 blocks
 * and a table and deleted after. Each run is a cold load (a fresh browser context, nothing cached) and a warm one (the same context
 * again), then the interactions, each traced with Chrome's lean categories (devtools.timeline, toplevel, loading), CPU at each --cpu rate.
 * - first: navigation to the pane's first painted frame (the arrival fade starts with the pane in it); usable: the grid's canvas holds
 *   its cells drawn, or the paper's text is editable with its blocks laid out.
 * - pop-in: after first paint, every element that appears or resizes (ResizeObserver), shifts (layout-shift sources), starts a transition
 *   or animation, or font that loads; with the trace's layout-shift score and the time of the last one.
 * - chunks: scripts, styles and fonts not in the page's HTML, with their gzip size and when each arrived.
 * - long tasks: main-thread tasks over 6.94 ms during the load (to usable + 3 s) and each interaction, with what ran in the longest.
 * The background is off (`conduit:chat-art` none), as headless draws WebGL on the CPU; --art keeps this device's default.
 * Medians over runs. Waits for a load average under 2 (up to 2 minutes) before each run and prints it beside the numbers.
 * --save writes <path>.md (the table) and <path>.json (every run, every pop-in, every long task).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { arg, launchHeadless, loadPlaywright, origin, root } from "./probes/lib.mjs";

const which = process.argv[2];
if (!["sheet", "paper", "both"].includes(which)) {
  console.log((await fs.readFile(new URL(import.meta.url), "utf8")).match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ ?\* ?/gm, "").trim());
  process.exit(1);
}
const RUNS = Number(arg("--runs", 5)), RATES = arg("--cpu", "1,4").split(",").map(Number), SAVE = arg("--save"), BUDGET = 6.94, SETTLE = 3000;
const SHEET = "802d93d7cfbe2968", CATEGORIES = ["devtools.timeline", "toplevel", "loading", "blink.user_timing"];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const median = (list) => { const sorted = list.filter((n) => Number.isFinite(n)).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : NaN; };
const calm = async () => { for (let n = 0; n < 24 && os.loadavg()[0] > 2; n += 1) await sleep(5000); return os.loadavg()[0]; };

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "bench-artifacts-")), state = path.join(scratch, "state.json");
execFileSync("node", ["scripts/conduit-auth.mjs", "mint-session", "--user-agent", "probe", "--format", "playwright", "--origin", origin, "--output", state], { cwd: root });
const cookie = JSON.parse(await fs.readFile(state, "utf8")).cookies.map((one) => `${one.name}=${one.value}`).join("; ");
const api = async (method, route, body) => {
  const answer = await fetch(`${origin}${route}`, { method, headers: { cookie, "content-type": "application/json" }, body: body && JSON.stringify(body) });
  if (!answer.ok) throw new Error(`${method} ${route}: ${answer.status} ${await answer.text()}`);
  return answer.status === 204 ? null : answer.headers.get("content-type")?.includes("json") ? answer.json() : answer.text();
};

/** In the page from its first script: when the pane first paints and is usable, and everything that appears or moves after. */
function watch(kind) {
  const bench = window.__bench = { at: {}, pop: [] };
  performance.mark("bench:origin");
  bench.markAt = performance.now();
  const named = (element) => {
    if (!(element instanceof Element)) return element?.nodeName ?? "?";
    const own = (one) => one.tagName.toLowerCase() + ([...one.classList].filter((name) => /^(ui|pane)-/.test(name)).slice(0, 2).map((name) => `.${name}`).join("")) + (one.getAttribute("aria-label") ? `[${one.getAttribute("aria-label").slice(0, 30)}]` : "");
    const self = own(element);
    if (/[.[]/.test(self)) return self;
    const up = element.parentElement?.closest("[class*='ui-'], [aria-label]");
    return up ? `${own(up)} > ${self}` : self;
  };
  const sizes = new WeakMap(), late = new WeakSet(), inPane = (element) => Boolean(element?.closest?.(".pane-artifact, [class*='ui-markup']"));
  const log = (what, element, px) => bench.pop.push({ t: Math.round(performance.now()), what, el: named(element), px, pane: inPane(element) });
  const sizer = new ResizeObserver((entries) => {
    for (const { target, contentRect: { width, height } } of entries) {
      const was = sizes.get(target);
      sizes.set(target, [width, height]);
      if (!was) { if (late.has(target) && width * height > 0) log("appears", target, `${width | 0}x${height | 0}`); }
      else if (Math.abs(was[0] - width) + Math.abs(was[1] - height) >= 1) log(was[0] * was[1] ? "resizes" : "appears", target, `${was[0] | 0}x${was[1] | 0} → ${width | 0}x${height | 0}`);
    }
  });
  // Every element but a drawing's insides, and of the paper only its blocks: their lines move with them.
  const skip = (element) => (element instanceof SVGElement && element.tagName !== "svg") || element.parentElement?.parentElement?.closest(".ui-document-text");
  let count = 0;
  const observe = (element, after) => {
    if (!(element instanceof Element) || skip(element) || count > 6000) return;
    count += 1;
    if (after) late.add(element);
    sizer.observe(element);
    for (const child of element.children) observe(child, after);
  };
  const added = new MutationObserver((records) => { for (const record of records) for (const node of record.addedNodes) observe(node, true); });
  const after = (event) => bench.at.first && event.target instanceof Element && log(event.type === "transitionrun" ? `transition ${event.propertyName}` : `animation ${event.animationName}`, event.target);
  addEventListener("transitionrun", after, true);
  addEventListener("animationstart", after, true);
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (bench.at.first && entry.startTime >= bench.at.first && !entry.hadRecentInput) {
      for (const source of entry.sources) bench.pop.push({ t: Math.round(entry.startTime), what: "shifts", el: named(source.node), px: `${Math.round(Math.hypot(source.currentRect.x - source.previousRect.x, source.currentRect.y - source.previousRect.y))}px, ${Math.round(source.previousRect.height)} → ${Math.round(source.currentRect.height)} high`, score: entry.value, pane: inPane(source.node instanceof Element ? source.node : source.node?.parentElement) });
    }
  }).observe({ type: "layout-shift", buffered: true });
  document.fonts?.addEventListener("loadingdone", (event) => { if (bench.at.first) for (const face of event.fontfaces) log(`font ${face.family} ${face.weight}`, document.body); });
  const drawn = () => {
    const pane = document.querySelector(".pane-artifact");
    if (!pane || pane.dataset.opening !== undefined || pane.dataset.pending !== undefined) return false;
    if (kind === "paper") { const text = pane.querySelector(".ui-document-text[contenteditable='true']"); return Boolean(text?.querySelector("[data-id]")?.textContent && text.getBoundingClientRect().height > 100); }
    // The grid's largest canvas, its first rows' pixels: drawn cells give text's many tones, an empty grid its two or three.
    const canvas = [...pane.querySelectorAll(".ui-spreadsheet-views canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!canvas?.width) return false;
    const pixels = canvas.getContext("2d")?.getImageData(30, 60, Math.min(600, canvas.width - 30), 90).data, tones = new Set();
    for (let at = 0; pixels && at < pixels.length && tones.size < 12; at += 4) tones.add((pixels[at] >> 3) << 10 | (pixels[at + 1] >> 3) << 5 | pixels[at + 2] >> 3);
    return tones.size >= 12;
  };
  const tick = () => {
    const now = performance.now(), arrival = document.documentElement.dataset.arrival;
    if (!bench.at.first && arrival !== "waiting" && document.querySelector(".pane-artifact")) {
      bench.at.first = now;
      observe(document.body, false);
      added.observe(document.body, { childList: true, subtree: true });
    }
    if (bench.at.first && !bench.at.usable && drawn()) bench.at.usable = now;
    if (!bench.at.usable || now - bench.at.usable < 3000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** The renderer's main thread in a trace: tasks over budget, with the longest things inside each; layout shifts. */
function readTrace(buffer, from = 0, to = Infinity) {
  const events = JSON.parse(buffer).traceEvents, threads = new Map(), byThread = new Map();
  for (const event of events) if (event.ph === "M" && event.name === "thread_name") threads.set(`${event.pid}:${event.tid}`, event.args.name);
  for (const event of events) { const key = `${event.pid}:${event.tid}`; if (threads.get(key) === "CrRendererMain") (byThread.get(key) ?? byThread.set(key, []).get(key)).push(event); }
  // A task is a toplevel event no other holds (Chrome names tasks by where they were posted, no longer RunTask).
  const tasksOf = (list) => { const out = []; for (const event of list.filter((one) => one.ph === "X" && one.cat.includes("toplevel") && one.dur).sort((a, b) => a.ts - b.ts)) if (!out.length || event.ts >= out.at(-1).ts + out.at(-1).dur) out.push(event); return out; };
  const [on, all] = [...byThread.values()].map((list) => [list, tasksOf(list)]).sort((a, b) => b[1].reduce((sum, task) => sum + task.dur, 0) - a[1].reduce((sum, task) => sum + task.dur, 0))[0] ?? [[], []];
  const mark = on.find((event) => event.name === "bench:origin"), zero = mark ? mark.ts : all[0]?.ts ?? 0;
  const ms = (ts) => (ts - zero) / 1000;
  const what = (event) => { const data = event.args?.data ?? event.args?.beginData ?? {}; return `${event.name}${data.functionName ? ` ${data.functionName}` : ""}${data.url ? ` ${data.url.split("/").pop().split("?")[0]}${data.lineNumber ? `:${data.lineNumber}` : ""}` : ""}`; };
  const tasks = all.filter((task) => task.dur > BUDGET * 1000 && ms(task.ts) >= from && ms(task.ts) <= to).map((task) => ({
    t: Math.round(ms(task.ts)), ms: +(task.dur / 1000).toFixed(1),
    in: on.filter((event) => event.ph === "X" && event !== task && event.dur > 1000 && event.ts >= task.ts && event.ts + event.dur <= task.ts + task.dur).sort((a, b) => b.dur - a.dur).slice(0, 4).map((event) => `${what(event)} ${(event.dur / 1000).toFixed(1)}`),
  }));
  const shifts = events.filter((event) => event.name === "LayoutShift" && !event.args?.data?.had_recent_input).map((event) => ({ t: Math.round(ms(event.ts)), score: event.args.data.score }));
  return { tasks, shifts, zero: mark ? zero : NaN };
}

const { chromium } = await loadPlaywright();
const browser = await launchHeadless(chromium), version = browser.version();
const gzipped = new Map(), sized = async (url) => gzipped.get(url) ?? gzipped.set(url, await fetch(url, { headers: { cookie } }).then((answer) => answer.arrayBuffer()).then((bytes) => zlib.gzipSync(Buffer.from(bytes), { level: 9 }).length)).get(url);

/** One load of `address` in `page`, traced: its times, pop-in, chunks and long tasks. */
async function load(page, cdp, address, kind) {
  const requests = new Map();
  const sent = ({ requestId, request, timestamp, initiator, type }) => requests.set(requestId, { url: request.url, type, parser: initiator?.type === "parser", start: timestamp });
  const done = ({ requestId, timestamp }) => { const one = requests.get(requestId); if (one) one.end = timestamp; };
  const cached = ({ requestId, response }) => { const one = requests.get(requestId); if (one) one.cache = response.fromDiskCache || response.fromServiceWorker || response.fromPrefetchCache; };
  cdp.on("Network.requestWillBeSent", sent); cdp.on("Network.loadingFinished", done); cdp.on("Network.responseReceived", cached);
  await browser.startTracing(page, { categories: CATEGORIES });
  await page.goto(address);
  await page.waitForFunction(() => window.__bench?.at.usable, null, { timeout: 60000, polling: 100 }).catch(() => {});
  await page.waitForTimeout(SETTLE + 300);
  const trace = await browser.stopTracing();
  cdp.off("Network.requestWillBeSent", sent); cdp.off("Network.loadingFinished", done); cdp.off("Network.responseReceived", cached);
  const bench = await page.evaluate(() => window.__bench), { at } = bench;
  const { tasks, shifts, zero } = readTrace(trace.toString(), 0, (at.usable ?? 60000) + SETTLE);
  const traceZero = zero - bench.markAt * 1000, since = (seconds) => Math.round(seconds * 1000 - traceZero / 1000);
  // The reveal itself (every region's one fade as the launch screen goes) is not a pop-in; what is in the pane is told apart from the rest of the app.
  const all = bench.pop.filter((one) => one.t > at.first + 1 && !(one.t < at.first + 50 && /^animation ui-(arrive|leave)$/.test(one.what))), pop = all.filter((one) => one.pane);
  const chunks = [];
  for (const one of requests.values()) if (["Script", "Stylesheet", "Font"].includes(one.type) && !one.parser && one.url.startsWith(origin)) chunks.push({ file: one.url.replace(origin, ""), start: since(one.start), end: one.end && since(one.end), gz: await sized(one.url), cached: Boolean(one.cache) });
  const late = shifts.filter((shift) => shift.t > at.first);
  return {
    first: Math.round(at.first), usable: Math.round(at.usable), pop: pop.length, elsewhere: all.length - pop.length, lastPop: pop.length ? Math.round(Math.max(...pop.map((one) => one.t)) - at.first) : 0,
    shiftScore: +late.reduce((sum, shift) => sum + shift.score, 0).toFixed(4), allShiftScore: +shifts.reduce((sum, shift) => sum + shift.score, 0).toFixed(4),
    long: tasks.length, longest: Math.max(0, ...tasks.map((task) => task.ms)), tasks, pops: all.map((one) => ({ ...one, t: Math.round(one.t - at.first) })), chunks: chunks.sort((a, b) => a.start - b.start),
    api: [...requests.values()].filter((one) => one.url.includes("/v0/")).map((one) => `${since(one.start)}–${one.end ? since(one.end) : "?"} ${one.url.replace(origin, "").slice(0, 80)}`),
    dialogs: await page.locator("[role=dialog]").count(),
  };
}

/** One interaction, traced: its tasks over budget. `check` says whether it did what it says. */
async function act(page, run) {
  await browser.startTracing(page, { categories: CATEGORIES });
  const check = await run();
  await page.waitForTimeout(400);
  const { tasks } = readTrace((await browser.stopTracing()).toString());
  return { long: tasks.length, longest: Math.max(0, ...tasks.map((task) => task.ms)), over: +tasks.reduce((sum, task) => sum + task.ms - BUDGET, 0).toFixed(1), tasks, check };
}

const box = (page, selector) => page.locator(selector).first().boundingBox();
const address = async (page, at) => { const field = page.locator("input.ui-spreadsheet-address"); await field.click(); await field.fill(at); await page.keyboard.press("Enter"); await page.waitForTimeout(150); };
const closeMenus = async (page) => { await page.keyboard.press("Escape"); await page.waitForTimeout(200); };
const SHEET_ACTS = {
  "wheel 3,000 down, 2,000 across": async (page) => {
    const grid = await box(page, ".ui-spreadsheet-rows");
    await page.mouse.move(grid.x + grid.width / 2, grid.y + grid.height / 2);
    for (let n = 0; n < 50; n += 1) { await page.mouse.wheel(n < 30 ? 0 : 100, n < 30 ? 100 : 0); await page.waitForTimeout(16); }
    return true;
  },
  "arrows across 50 cells": async (page) => { await address(page, "A3"); for (let n = 0; n < 50; n += 1) await page.keyboard.press(n < 25 ? "ArrowRight" : "ArrowDown"); return page.locator("input.ui-spreadsheet-address").inputValue(); },
  "type 20 characters, commit": async (page) => { await address(page, "Z1"); await page.keyboard.type("bench typing twenty!"); await page.keyboard.press("Enter"); await page.waitForTimeout(300); return (await api("GET", `/v0/document/${SHEET}?as=cells&range=Z1`)).cells?.[0]?.input; },
  "open the cell menu": async (page) => { const grid = await box(page, ".ui-spreadsheet-rows"); await page.mouse.click(grid.x + 200, grid.y + 120, { button: "right" }); return page.locator("[role=menu]").first().waitFor({ timeout: 5000 }).then(() => true, () => false); },
  "open a ribbon dropdown": async (page) => { await page.locator(".ui-spreadsheet-slot button[aria-haspopup]:not([disabled])").first().click(); return page.locator("[role=menu], [role=listbox], [role=dialog]").first().waitFor({ timeout: 5000 }).then(() => true, () => false); },
  "select 1,000 cells by drag": async (page) => {
    await address(page, "A1");
    const grid = await box(page, ".ui-spreadsheet-rows"), field = page.locator("input.ui-spreadsheet-address");
    await page.mouse.move(grid.x + 80, grid.y + 45); await page.mouse.down();
    for (let n = 1; n <= 20; n += 1) await page.mouse.move(grid.x + 80 + (grid.width - 100) * n / 20, grid.y + 45 + (grid.height - 60) * n / 20);
    // Held past the corner, the grid scrolls itself to the tab's last cell.
    for (let n = 0; n < 150 && (await field.inputValue()) !== "A:AC"; n += 1) { await page.mouse.move(grid.x + grid.width + 5 + (n % 2), grid.y + grid.height + 5); await page.waitForTimeout(16); }
    await page.mouse.up();
    return field.inputValue();
  },
};
const scroller = (page) => page.evaluate(() => { let at = document.querySelector(".ui-document-text"); while (at && !(at.scrollHeight > at.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(at).overflowY))) at = at.parentElement; at?.setAttribute("data-bench-scroller", ""); return Boolean(at); });
const PAPER_ACTS = {
  "type 200 characters mid-document": async (page) => {
    const block = page.locator(".ui-document-text > p[data-id]").nth(100);
    await block.scrollIntoViewIfNeeded(); await block.click(); await page.keyboard.press("End");
    await page.keyboard.type("Typed by the benchmark, a sentence of plain words at a steady pace, long enough to wrap the line it is typed into and the next, which is what a person writing in the middle of a long paper does all day.".slice(0, 200));
    return (await block.textContent()).includes("Typed by the benchmark");
  },
  "scroll its length": async (page) => {
    await scroller(page);
    const area = await box(page, "[data-bench-scroller]");
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
    await page.evaluate(() => { document.querySelector("[data-bench-scroller]").scrollTop = 0; });
    for (let n = 0; n < 400 && await page.evaluate(() => { const at = document.querySelector("[data-bench-scroller]"); return at.scrollTop + at.clientHeight < at.scrollHeight - 2; }); n += 1) { await page.mouse.wheel(0, 120); await page.waitForTimeout(16); }
    return true;
  },
  "open the block menu": async (page) => {
    const block = await box(page, ".ui-document-text > p[data-id]:nth-child(20)");
    await page.evaluate(() => document.querySelector(".ui-document-text > p[data-id]:nth-child(20)").scrollIntoView({ block: "center" }));
    const at = await box(page, ".ui-document-text > p[data-id]:nth-child(20)");
    await page.mouse.move(at.x + 10, at.y + at.height / 2);
    await page.locator(".ui-document-handle[data-shown] [data-grip]").click({ timeout: 5000 });
    return Boolean(block) && page.locator("[role=menu]").first().waitFor({ timeout: 5000 }).then(() => true, () => false);
  },
  "find": async (page) => { await page.locator(".ui-document-text").click({ position: { x: 20, y: 20 } }); await page.keyboard.press("Control+f"); await page.keyboard.type("paragraph"); for (let n = 0; n < 3; n += 1) await page.keyboard.press("Enter"); return page.locator("input[type=search], [role=search] input, .ui-find input").first().isVisible().catch(() => false); },
};

/** A paper of 300 blocks: headings, paragraphs, lists, code and a 20-row table, as a long working paper has. */
const paperText = () => Array.from({ length: 60 }, (_, n) => [
  `## Section ${n + 1}`,
  `Paragraph ${n} of the benchmark paper, with **bold**, _italic_ and \`code\` spans and a [link](https://example.com/${n}), long enough to run over two lines of a pane.`,
  n % 3 ? `- point one of ${n}\n- point two of ${n}` : "```js\nconst value = compute(" + n + ");\n```",
  `Another paragraph ${n}, plain words that say nothing in particular but take the room a paragraph takes in a real paper.`,
  n === 30 ? `| name | qty | price | note |\n| --- | --- | --- | --- |\n${Array.from({ length: 20 }, (_, row) => `| item ${row} | ${row} | ${row * 1.5} | row ${row} |`).join("\n")}` : `A third paragraph ${n}, to bring the blocks to three hundred.`,
].join("\n\n")).join("\n\n");

const results = {}, started = new Date();
let paper;
try {
  if (which !== "paper") {
    const before = await api("GET", `/v0/document/${SHEET}?as=cells&range=Z1:AC35`);
    if (before.cells?.some((cell) => cell.input)) throw new Error("probe-sheet has values in Z1:AC35: the benchmark types there, so it stops");
  }
  if (which !== "sheet") {
    const project = ((await api("GET", "/v0/projects")).projects ?? []).find((one) => one.name === "Test");
    paper = await api("POST", `/v0/projects/${project.id}/artifacts`, { kind: "paper", name: "bench scratch" });
    await api("POST", `/v0/document/${paper.id}/blocks`, { op: "insert", block: "start", markdown: paperText(), by: "bench" });
  }
  for (const kind of which === "both" ? ["sheet", "paper"] : [which]) for (const rate of RATES) {
    const runs = [], target = `${origin}/?panes=${encodeURIComponent(`artifact:${kind === "sheet" ? SHEET : paper.id}`)}`;
    for (let run = 0; run < RUNS; run += 1) {
      const loadAverage = await calm();
      const context = await browser.newContext({ storageState: state, viewport: { width: 1600, height: 1000 } });
      if (!process.argv.includes("--art")) await context.addInitScript(() => localStorage.setItem("conduit:chat-art", JSON.stringify({ art: "none" })));
      await context.addInitScript(watch, kind);
      const page = await context.newPage(), cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable"); await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      const cold = await load(page, cdp, target, kind), warm = await load(page, cdp, target, kind);
      // A dialog open over a freshly opened artifact is reported (`dialogs`) and taken out, so the interactions can reach it.
      if (warm.dialogs) await page.evaluate(() => { document.querySelectorAll("[role=dialog]").forEach((dialog) => dialog.remove()); for (const at of [document.body, document.documentElement]) at.style.pointerEvents = ""; document.querySelectorAll("[inert], [aria-hidden=true]").forEach((one) => { if (one.closest("#root")) one.inert = false; }); });
      const acts = {};
      for (const [name, run] of Object.entries(kind === "sheet" ? SHEET_ACTS : PAPER_ACTS)) { acts[name] = await act(page, () => run(page).catch((error) => `failed: ${error.message.split("\n")[0]}`)); await closeMenus(page); }
      if (kind === "sheet") { await address(page, "Z1"); await page.keyboard.press("Delete"); await page.waitForTimeout(500); }
      runs.push({ loadAverage: +loadAverage.toFixed(1), cold, warm, acts });
      console.error(`${kind} ${rate}x run ${run + 1}: cold usable ${cold.usable} ms, warm ${warm.usable} ms, load ${loadAverage.toFixed(1)}`);
      await context.close();
    }
    results[`${kind} ${rate}x`] = runs;
  }
} finally {
  if (which !== "paper") { const after = await api("GET", `/v0/document/${SHEET}?as=cells&range=Z1:AC35`).catch(() => null); if (after?.cells?.some((cell) => cell.input)) console.error("probe-sheet still has values in Z1:AC35:", JSON.stringify(after.cells.filter((cell) => cell.input))); }
  if (paper) await api("DELETE", `/v0/document/${paper.id}`).catch((error) => console.error(`The scratch paper ${paper.id} was not deleted: ${error.message}`));
  await api("POST", "/v0/auth/logout").catch(() => {});
  await browser.close();
  await fs.rm(scratch, { recursive: true, force: true });
}

const lines = [`# Sheet and paper benchmark, ${started.toISOString().slice(0, 16)}Z`, "",
  `Headless Chrome ${version} at 1600x1000, DPR 1, against ${origin}; medians of ${RUNS} runs. Headless numbers, not the owner's Windows Chrome${process.argv.includes("--art") ? "" : "; the background off"}.`, ""];
for (const [name, runs] of Object.entries(results)) {
  const m = (pick) => median(runs.map(pick));
  lines.push(`## ${name} (load average ${runs.map((run) => run.loadAverage).join(", ")})`, "", "| Load | First paint ms | Usable ms | Dialogs open | Pop-ins in pane | Elsewhere | Last pop-in in pane, ms after first | Shift score after first | Tasks > 6.94 ms | Longest ms |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const how of ["cold", "warm"]) lines.push(`| ${how} | ${m((run) => run[how].first)} | ${m((run) => run[how].usable)} | ${m((run) => run[how].dialogs)} | ${m((run) => run[how].pop)} | ${m((run) => run[how].elsewhere)} | ${m((run) => run[how].lastPop)} | ${m((run) => run[how].shiftScore)} | ${m((run) => run[how].long)} | ${m((run) => run[how].longest)} |`);
  lines.push("", "| Interaction | Tasks > 6.94 ms | Longest ms | ms over budget | Did it |", "| --- | --- | --- | --- | --- |");
  for (const act of Object.keys(runs[0].acts)) lines.push(`| ${act} | ${m((run) => run.acts[act].long)} | ${m((run) => run.acts[act].longest)} | ${m((run) => run.acts[act].over)} | ${[...new Set(runs.map((run) => String(run.acts[act].check)))].join(", ")} |`);
  const last = runs.at(-1);
  for (const how of ["cold", "warm"]) {
    const inside = last[how].pops.filter((one) => one.pane);
    lines.push("", `Pop-in in the pane, ${how}, last run (ms after first paint; the rest of the app's are in the JSON):`, "", ...inside.slice(0, 60).map((one) => `- ${one.t} ${one.what} ${one.el}${one.px ? ` (${one.px})` : ""}`));
    if (inside.length > 60) lines.push(`- … ${inside.length - 60} more`);
  }
  lines.push("", "Chunks, cold, last run (ms from navigation, gzip bytes):", "", ...last.cold.chunks.map((one) => `- ${one.start}–${one.end} ${one.file} ${one.gz}`));
  lines.push("", "Long tasks, cold load, last run:", "", ...last.cold.tasks.map((task) => `- ${task.t} ms: ${task.ms} ms (${task.in.join("; ")})`));
}
console.log(lines.join("\n"));
if (SAVE) { await fs.writeFile(`${SAVE}.md`, `${lines.join("\n")}\n`); await fs.writeFile(`${SAVE}.json`, JSON.stringify(results, null, 1)); }
