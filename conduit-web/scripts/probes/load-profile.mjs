/**
 * What the first open spends its main thread on: a CPU profile of a cold
 * reload of `--path` (default `/`) in a phone-sized page, to the arrival fade, as total time per
 * function (self and inclusive). `--top <n>` (default 30).
 */
import fs from "node:fs";
import path from "node:path";
import { SourceMapConsumer } from "source-map-js";
import { arg, open, origin } from "./lib.mjs";

// With a build made by \`vite build --sourcemap\`, frames are named from source.
const maps = new Map();
const consumer = (url) => {
  const file = path.join("dist/assets", url.split("/").pop() + ".map");
  if (!maps.has(file)) maps.set(file, fs.existsSync(file) ? new SourceMapConsumer(JSON.parse(fs.readFileSync(file, "utf8"))) : null);
  return maps.get(file);
};

const top = Number(arg("--top", "30"));
const cpu = Number(arg("--cpu", "1"));
const { page, cdp, close } = await open({ width: 390, height: 844 });
await page.goto(`${origin}${arg("--path", "/")}`, { waitUntil: "load" });
await page.waitForTimeout(2500);
if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => document.documentElement.dataset.arrival === "arriving", null, { timeout: 20000, polling: "raf" });
const { profile } = await cdp.send("Profiler.stop");
const byId = new Map(profile.nodes.map((node) => [node.id, node]));
const parent = new Map();
for (const node of profile.nodes) for (const child of node.children || []) parent.set(child, node.id);
const self = new Map(); const total = new Map();
const label = (node) => {
  const { functionName, url, lineNumber, columnNumber } = node.callFrame;
  const original = url && lineNumber >= 0 && consumer(url)?.originalPositionFor({ line: lineNumber + 1, column: columnNumber });
  if (original?.source) return `${original.name || functionName || "(anon)"} ${original.source.replace(/^(\.\.\/)+/, "")}:${original.line}`;
  return `${functionName || "(anon)"} ${url.split("/").pop()}:${lineNumber + 1}`;
};
for (let i = 0; i < profile.samples.length; i += 1) {
  const dt = (profile.timeDeltas[i + 1] ?? 0) / 1000;
  let node = byId.get(profile.samples[i]);
  if (["(idle)", "(program)", "(garbage collector)"].includes(node.callFrame.functionName)) { self.set(node.callFrame.functionName, (self.get(node.callFrame.functionName) || 0) + dt); continue; }
  self.set(label(node), (self.get(label(node)) || 0) + dt);
  const seen = new Set();
  while (node) { const key = label(node); if (!seen.has(key)) { seen.add(key); total.set(key, (total.get(key) || 0) + dt); } node = byId.get(parent.get(node.id)); }
}
const show = (map, title) => { console.log(`-- ${title}`); for (const [key, ms] of [...map].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${ms.toFixed(1).padStart(7)}ms  ${key}`); };
show(self, "self"); show(total, "inclusive");
// `--slices`: for each 50ms of the open, the source frames that ran most in it.
if (process.argv.includes("--slices")) {
  const slices = new Map();
  let at = profile.startTime;
  for (let i = 0; i < profile.samples.length; i += 1) {
    at += profile.timeDeltas[i];
    const dt = (profile.timeDeltas[i + 1] ?? 0) / 1000;
    const slice = Math.floor((at - profile.startTime) / 50000) * 50;
    let node = byId.get(profile.samples[i]);
    if (["(idle)", "(program)"].includes(node.callFrame.functionName)) continue;
    const frames = new Set();
    while (node) { const key = label(node); if (key.includes(" src/")) frames.add(key); node = byId.get(parent.get(node.id)); }
    const bucket = slices.get(slice) || new Map(); slices.set(slice, bucket);
    bucket.set("total", (bucket.get("total") || 0) + dt);
    for (const key of frames) bucket.set(key, (bucket.get(key) || 0) + dt);
  }
  for (const [slice, bucket] of [...slices].sort((a, b) => a[0] - b[0])) {
    if ((bucket.get("total") || 0) < 20) continue;
    const topFrames = [...bucket].filter(([key]) => key !== "total").sort((a, b) => b[1] - a[1]).slice(0, 4).map(([key, ms]) => `${key.replace("src/client/", "")} ${ms.toFixed(0)}`);
    console.log(`${String(slice).padStart(5)}ms busy ${bucket.get("total").toFixed(0)}: ${topFrames.join(" | ")}`);
  }
}
await close();
