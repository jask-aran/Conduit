/**
 * What the first open spends its main thread on: a CPU profile of a cold
 * reload of `/` in a phone-sized page, to the arrival fade, as total time per
 * function (self and inclusive). `--top <n>` (default 30).
 */
import { arg, open, origin } from "./lib.mjs";

const top = Number(arg("--top", "30"));
const { page, cdp, close } = await open({ width: 390, height: 844 });
await page.goto(`${origin}/`, { waitUntil: "load" });
await page.waitForTimeout(2500);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => document.documentElement.dataset.arrival !== "waiting", null, { timeout: 20000 });
const { profile } = await cdp.send("Profiler.stop");
const byId = new Map(profile.nodes.map((node) => [node.id, node]));
const parent = new Map();
for (const node of profile.nodes) for (const child of node.children || []) parent.set(child, node.id);
const self = new Map(); const total = new Map();
const label = (node) => `${node.callFrame.functionName || "(anon)"} ${node.callFrame.url.split("/").pop()}:${node.callFrame.lineNumber + 1}`;
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
await close();
