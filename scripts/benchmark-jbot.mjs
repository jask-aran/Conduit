#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { root, directory, prepareHarness, runHeadedBenchmark } from "./headed-benchmark.mjs";

const baseline = process.argv[2] || "566894326";
const cpu = Number(process.argv[3] || 1);
if (!/^[a-f\d]{7,40}$/i.test(baseline) || !Number.isInteger(cpu) || cpu < 1 || cpu > 20) throw new Error("Use a baseline commit hash and CPU slowdown from 1 to 20.");
await prepareHarness();
for (const name of ["jbot-room", "jbot-messages"]) {
  const source = `conduit-web/src/client/dashboard/${name}.tsx`;
  const previous = execFileSync("git", ["show", `${baseline}:${source}`], { cwd: root, encoding: "utf8" });
  const rebased = previous.replace(/from "(\.\.?\/[^\"]+)"/g, (_, specifier) => `from "${specifier === "./jbot-messages" ? "./jbot-messages-before" : "/" + path.posix.relative("conduit-web", path.posix.resolve("/", path.posix.dirname(source), specifier).slice(1))}"`);
  await fs.writeFile(path.join(directory, `${name}-before.tsx`), rebased);
}

async function benchmark() {
  while (!window.harnessReady) await new Promise((resolve) => setTimeout(resolve, 10));
  const nativeFetch = window.fetch.bind(window);
  const read = async (url) => { const response = await nativeFetch(url); if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`); return response.json(); };
  const agent = await read("/v0/agent");
  const messages = await read("/v0/agent/messages?limit=100");
  const ids = messages.messages.filter((message) => message.entryId != null).map((message) => message.id);
  const work = await read(`/v0/agent/work?ids=${encodeURIComponent(ids.join(","))}`);
  const snapshots = new Map([["/v0/agent", agent], ["/v0/agent/messages", messages], ["/v0/agent/work", work]]);
  window.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const snapshot = snapshots.get(url.pathname);
    return snapshot && (!init?.method || init.method === "GET") ? Promise.resolve(new Response(JSON.stringify(snapshot), { headers: { "Content-Type": "application/json" } })) : nativeFetch(input, init);
  };
  const versions = { before: await import("/.cptr/perf/jbot-room-before.tsx"), after: await import("/src/client/dashboard/jbot-room.tsx") };
  const state = await import("/src/client/state/agent.ts");
  await state.refreshAgent();
  await document.fonts.ready;
  const root = document.createElement("main");
  root.className = "ui-shell";
  root.style.cssText = "position:fixed;inset:0;z-index:99999;background:#080808";
  const empty = document.createElement("section"); empty.className = "ui-sheet";
  const dock = document.createElement("aside"); dock.className = "ui-dock"; dock.setAttribute("data-open", ""); dock.style.cssText = "width:722px;transition:none";
  const surface = document.createElement("div"); surface.className = "ui-dock-surface"; dock.append(surface); root.append(empty, dock); document.body.append(root);
  const oldStyle = document.createElement("style");
  oldStyle.textContent = '[data-benchmark-version="before"] [data-jbot-room] .ui-transcript > .ui-transcript-row[data-drawn] { content-visibility:auto; }';
  document.head.append(oldStyle);
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const percentile = (list, fraction) => { list.sort((a, b) => a - b); return Math.round(list[Math.min(list.length - 1, Math.floor(list.length * fraction))] * 100) / 100; };
  const tell = (phase, size) => window.dispatchEvent(new CustomEvent("conduit:panel-geometry-motion", { detail: { phase, source: "workspace", id: 9991, size } }));
  let visibilityChanges = 0, dispose, expectedRows;
  const changed = () => visibilityChanges++;
  document.addEventListener("visibilitychange", changed); window.addEventListener("blur", changed);
  const trials = [];
  try {
    for (const version of ["before", "after", "after", "before"]) {
      root.dataset.benchmarkVersion = version;
      dock.style.width = "722px";
      const composer = document.createElement("div"); composer.className = "ui-composer"; composer.style.height = "80px"; composer.textContent = "Benchmark composer";
      dispose = window.renderBenchmark(() => versions[version].JbotRoom({ header: (title) => { const header = document.createElement("header"); header.className = "ui-pane-header"; header.textContent = title; return header; }, panel: () => null, presentation: "narrow", composerReady: true, composer }), surface);
      let previousRows = -1, stillSince = performance.now();
      const started = performance.now();
      while (true) {
        await frame();
        const rows = surface.querySelectorAll(".ui-transcript-row").length;
        if (rows !== previousRows) { previousRows = rows; stillSince = performance.now(); }
        if (rows && !surface.querySelector(".ui-chat[data-opening]") && performance.now() - stillSince > 300) break;
        if (performance.now() - started > 15000) throw new Error(`${version} Jbot did not settle`);
      }
      expectedRows ??= previousRows;
      if (previousRows !== expectedRows) throw new Error(`Different row counts: ${expectedRows} versus ${previousRows}`);
      const viewport = surface.querySelector(".ui-chat-viewport");
      viewport.scrollTop = viewport.scrollHeight;
      for (let i = 0; i < 15; i++) await frame();
      const intervals = [], updates = [], visible = visibilityChanges;
      if (document.hidden) throw new Error("Benchmark tab must remain foreground.");
      tell("begin", 722);
      let last;
      for (let index = 0; index < 90; index++) {
        const now = await frame(); if (last != null) intervals.push(now - last); last = now;
        const start = performance.now(), width = 600 + 100 * Math.sin(index / 8);
        dock.style.width = `${width}px`;
        tell("change", width);
        dock.getBoundingClientRect();
        updates.push(performance.now() - start);
      }
      tell("end", Number.parseFloat(dock.style.width));
      if (visibilityChanges !== visible) throw new Error("Foreground changed during benchmark; discard this run.");
      trials.push({ version, frames: 90, rows: previousRows, domNodes: surface.querySelectorAll("*").length, hiddenBlocks: surface.querySelectorAll('[data-transcript-visibility="hidden"]').length, intervalMs: { p50: percentile(intervals, .5), p95: percentile(intervals, .95), max: Math.round(Math.max(...intervals) * 100) / 100 }, resizeUpdateMs: { p50: percentile(updates, .5), p95: percentile(updates, .95) } });
      dispose(); dispose = undefined;
    }
    return { viewport: [innerWidth, innerHeight, devicePixelRatio], fixture: { messages: messages.messages.length, runs: messages.runs?.length ?? 0, source: "One live backend snapshot replayed identically; message contents are not saved" }, userAgent: navigator.userAgent, trials };
  } finally {
    dispose?.(); root.remove(); oldStyle.remove(); window.fetch = nativeFetch;
    document.removeEventListener("visibilitychange", changed); window.removeEventListener("blur", changed);
  }
}

const result = { at: new Date().toISOString(), cpuSlowdown: cpu, harness: "Actual JbotRoom and log, fixed header/composer, no backgrounds or populated side panel", baseline: execFileSync("git", ["rev-parse", baseline], { cwd: root, encoding: "utf8" }).trim(), current: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), ...runHeadedBenchmark(benchmark, cpu) };
const report = path.join(root, `docs/performance/jbot-${result.at.slice(0, 10)}${cpu === 1 ? "" : `-cpu${cpu}x`}.json`);
await fs.mkdir(path.dirname(report), { recursive: true });
await fs.writeFile(report, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
