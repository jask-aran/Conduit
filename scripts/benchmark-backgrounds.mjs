#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = process.argv[2] || "566894326";
if (!/^[a-f\d]{7,40}$/i.test(baseline)) throw new Error("Use a commit hash for the baseline.");
const cli = (...args) => execFileSync(process.execPath, [path.join(root, "scripts/run-windows-chrome-devtools.mjs"), "cli", ...args], { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
const directory = path.join(root, "conduit-web/.cptr/perf");
await fs.mkdir(directory, { recursive: true });
const previous = execFileSync("git", ["show", `${baseline}:conduit-web/src/components/ui/chat-art-draw.ts`], { cwd: root, encoding: "utf8" });
await fs.writeFile(path.join(directory, "baseline-renderer.ts"), previous.replaceAll('"../../../vendor/', '"../../vendor/').replace('"./chat-art"', '"../../src/components/ui/chat-art"'));

async function benchmark() {
  const art = await import("/src/components/ui/chat-art.ts");
  const renderers = { before: await import("/.cptr/perf/baseline-renderer.ts"), after: await import("/src/components/ui/chat-art-draw.ts") };
  await document.fonts.ready;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) throw new Error("Animated benchmark requires reduced motion to be off.");
  art.setChatArt(null);
  const root = document.createElement("main");
  root.className = "ui-shell";
  root.style.cssText = "position:fixed;inset:0;z-index:99999;display:grid;grid-template-columns:650px 1fr;background:#080808;";
  const panes = Array.from({ length: 2 }, () => {
    const pane = document.createElement("section");
    pane.className = "ui-sheet";
    pane.innerHTML = '<div class="ui-chat-column"><h2>Background resize benchmark</h2>' + '<p>Identical text and pane geometry for both renderers. The background stays fixed while the pane changes width.</p>'.repeat(24) + '</div>';
    root.append(pane);
    return pane;
  });
  const legacyStyle = document.createElement("style");
  legacyStyle.textContent = "canvas.ui-chat-art { position:absolute; inset:0; z-index:-1; width:100%; height:100%; border-radius:inherit; pointer-events:none; }";
  document.head.append(legacyStyle);
  document.body.append(root);
  const targets = new Set(panes);
  let measuring = false, counters, source;
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  const shader = WebGL2RenderingContext.prototype.drawArrays;
  CanvasRenderingContext2D.prototype.drawImage = function (...args) {
    if (root.contains(this.canvas)) { source = [args[0].width, args[0].height]; if (measuring) counters.copies++; }
    return draw.apply(this, args);
  };
  WebGL2RenderingContext.prototype.drawArrays = function (...args) { if (measuring) counters.shaders++; return shader.apply(this, args); };
  const observer = new MutationObserver((records) => { if (measuring) counters.resizeWrites += records.filter((record) => record.target instanceof HTMLCanvasElement).length; });
  observer.observe(root, { subtree: true, attributes: true, attributeFilter: ["width", "height"] });
  let visibilityChanges = 0;
  const changed = () => visibilityChanges++;
  document.addEventListener("visibilitychange", changed);
  window.addEventListener("blur", changed);
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const percentile = (list, fraction) => {
    list.sort((a, b) => a - b);
    return Math.round(list[Math.min(list.length - 1, Math.floor(list.length * fraction))] * 100) / 100;
  };
  const trials = [];
  try {
    for (const background of ["picture", "waves"]) for (const renderer of ["before", "after", "after", "before"]) {
      for (const module of Object.values(renderers)) module.syncArt(null, new Set());
      const look = { ...art.chatArtLook, image: background === "picture" ? art.chatArtSet[0].image : "", scene: background === "waves" ? "waves" : undefined, dot: 2, cell: 2, brightness: 0.4, speed: 1 };
      renderers[renderer].syncArt(look, targets);
      await new Promise((resolve) => setTimeout(resolve, 250));
      for (let i = 0; i < 15; i++) await frame();
      const startVisibility = visibilityChanges;
      if (document.hidden) throw new Error("Benchmark tab must remain foreground.");
      counters = { copies: 0, shaders: 0, resizeWrites: 0 };
      const intervals = [], updates = [];
      let last;
      measuring = true;
      for (let index = 0; index < 120; index++) {
        const now = await frame();
        if (last != null) intervals.push(now - last);
        last = now;
        const start = performance.now();
        root.style.gridTemplateColumns = `${650 + 100 * Math.sin(index / 8)}px 1fr`;
        panes[0].getBoundingClientRect();
        updates.push(performance.now() - start);
      }
      measuring = false;
      if (visibilityChanges !== startVisibility) throw new Error("Foreground changed during benchmark; discard this run.");
      if (background === "waves" && counters.shaders < 100) throw new Error(`${renderer} animation stalled: ${counters.shaders} shader frames`);
      trials.push({ background, renderer, frames: 120, intervalMs: { p50: percentile(intervals, .5), p95: percentile(intervals, .95), max: Math.round(Math.max(...intervals) * 100) / 100 }, resizeUpdateMs: { p50: percentile(updates, .5), p95: percentile(updates, .95) }, ...counters, source });
    }
    return { viewport: [innerWidth, innerHeight, devicePixelRatio], reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, userAgent: navigator.userAgent, foregroundChanges: visibilityChanges, trials };
  } finally {
    measuring = false;
    for (const module of Object.values(renderers)) module.syncArt(null, new Set());
    observer.disconnect();
    CanvasRenderingContext2D.prototype.drawImage = draw;
    WebGL2RenderingContext.prototype.drawArrays = shader;
    document.removeEventListener("visibilitychange", changed);
    window.removeEventListener("blur", changed);
    root.remove();
    legacyStyle.remove();
  }
}

const restore = cli("list_pages").match(/^(\d+):.*\[selected\]/m)?.[1];
const opened = cli("new_page", "http://localhost:5181/gallery.html?frame=backgrounds");
const page = opened.match(/^(\d+):.*\[selected\]/m)?.[1];
if (!page) throw new Error(opened);
try {
  cli("select_page", page, "--bringToFront");
  cli("emulate", "--viewport", "1440x900x1");
  const output = cli("evaluate_script", benchmark.toString());
  const json = output.match(/```json\s*([\s\S]*?)```/)?.[1];
  if (!json) throw new Error(output);
  const result = { at: new Date().toISOString(), baseline: execFileSync("git", ["rev-parse", baseline], { cwd: root, encoding: "utf8" }).trim(), current: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), ...JSON.parse(json) };
  const report = path.join(root, "docs/performance/backgrounds-2026-11-15.json");
  await fs.mkdir(path.dirname(report), { recursive: true });
  await fs.writeFile(report, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally {
  cli("close_page", page);
  if (restore) cli("select_page", restore, "--bringToFront");
}
