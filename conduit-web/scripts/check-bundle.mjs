import fs from "node:fs";
import path from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";

const dist = path.resolve("dist");
const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
const initial = new Set([...html.matchAll(/(?:src|href)="\/?([^"]+\.(?:js|css))"/g)].map((match) => match[1]));
const assets = fs.readdirSync(path.join(dist, "assets"))
  .filter((name) => /\.(?:js|css)$/.test(name))
  .map((name) => {
    const relative = `assets/${name}`;
    const bytes = fs.readFileSync(path.join(dist, relative));
    return { file: relative, type: path.extname(name).slice(1), initial: initial.has(relative), raw: bytes.length, gzip: gzipSync(bytes).length, brotli: brotliCompressSync(bytes).length };
  });
const totals = (type) => assets.filter((asset) => asset.initial && asset.type === type).reduce((sum, asset) => sum + asset.gzip, 0);
const initialJs = totals("js");
const initialCss = totals("css");
const lazy = assets.filter((asset) => !asset.initial && asset.type === "js").sort((a, b) => b.gzip - a.gzip);
const report = { initialJsGzip: initialJs, initialCssGzip: initialCss, largestLazyJsGzip: lazy[0]?.gzip || 0, assets };
fs.writeFileSync(path.join(dist, "bundle-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Bundle: initial JS ${initialJs} B gzip, initial CSS ${initialCss} B gzip, largest lazy JS ${report.largestLazyJsGzip} B gzip.`);

const budgets = {
  // Voice diagnostics and the capture lifecycle add bounded client behaviour.
  // Revisit this allowance in the planned performance review instead of
  // hiding evidence behind a size cap.
  initialJs: Number(process.env.CONDUIT_BUDGET_INITIAL_JS_GZIP || 185_000),
  initialCss: Number(process.env.CONDUIT_BUDGET_INITIAL_CSS_GZIP || 80_000),
  lazyJs: Number(process.env.CONDUIT_BUDGET_LAZY_JS_GZIP || 300_000),
};
const failures = [
  ["initial JS", initialJs, budgets.initialJs],
  ["initial CSS", initialCss, budgets.initialCss],
  ["largest lazy JS", report.largestLazyJsGzip, budgets.lazyJs],
].filter(([, actual, budget]) => actual > budget);
if (failures.length) {
  for (const [label, actual, budget] of failures) console.error(`${label} is ${actual} B gzip; budget is ${budget} B.`);
  process.exitCode = 1;
}

// PWA shell: production builds must emit installability artifacts and must not
// teach Workbox to runtime-cache authenticated /v0 surfaces.
const distEntries = fs.readdirSync(dist);
const manifestName = distEntries.find((name) => name.endsWith(".webmanifest"));
const serviceWorkerName = distEntries.find((name) => /^(sw|service-worker)\.js$/.test(name));
const workboxName = distEntries.find((name) => /^workbox-.*\.js$/.test(name));
const pwaFailures = [];
if (!manifestName) pwaFailures.push("missing web manifest (*.webmanifest)");
if (!serviceWorkerName) pwaFailures.push("missing root service worker (sw.js)");
if (!html.includes("manifest")) pwaFailures.push("index.html does not reference a web manifest");
{
  const allJs = assets.map((asset) => fs.readFileSync(path.join(dist, asset.file), "utf8")).join("\n");
  if (!/serviceWorker|navigator\.serviceWorker|workbox|registerSW/i.test(`${html}\n${allJs}`)) {
    pwaFailures.push("no service worker registration found in the production bundle");
  }
}
if (serviceWorkerName) {
  const swText = fs.readFileSync(path.join(dist, serviceWorkerName), "utf8");
  // /v0 must stay on the NavigationRoute denylist so API paths never receive
  // the SPA shell. Strip denylist arrays before rejecting any other /v0 mention
  // (those would be positive runtime cache routes).
  if (!/denylist:\[[^\]]*\\\/v0/.test(swText) && !/denylist:\[[^\]]*\/v0/.test(swText)) {
    pwaFailures.push(`${serviceWorkerName} NavigationRoute denylist does not exclude /v0`);
  }
  const withoutDenylist = swText.replace(/denylist:\[[^\]]*\]/g, "denylist:[]");
  if (/\/v0\b/.test(withoutDenylist)) {
    pwaFailures.push(`${serviceWorkerName} mentions /v0 outside the navigation denylist`);
  }
  if (/runtimeCaching/i.test(swText)) {
    pwaFailures.push(`${serviceWorkerName} enables Workbox runtimeCaching`);
  }
}
for (const icon of ["pwa-192x192.png", "pwa-512x512.png", "favicon.svg"]) {
  if (!fs.existsSync(path.join(dist, icon))) pwaFailures.push(`missing ${icon} in dist/`);
}
const cssAssets = assets.filter((asset) => asset.initial && asset.type === "css");
const cssText = cssAssets.map((asset) => fs.readFileSync(path.join(dist, asset.file), "utf8")).join("\n");
const filterFailures = [];
const frostRule = cssText.match(/\.composer\[data-composer-surface=frost\]\{[^}]+\}/);
if (!frostRule) {
  filterFailures.push("missing .composer[data-composer-surface=frost] rule");
} else {
  if (!/(?<!-webkit-)backdrop-filter:blur\(/.test(frostRule[0])) {
    filterFailures.push("frost rule dropped unprefixed backdrop-filter");
  }
  if (!/-webkit-backdrop-filter:blur\(/.test(frostRule[0])) {
    filterFailures.push("frost rule dropped -webkit-backdrop-filter");
  }
}
const staticRule = cssText.match(/\.composer-surface-shell\[data-composer-surface=(?:"?static"?)\]\s*>\s*\.composer\{[^}]+\}/);
if (!staticRule) {
  filterFailures.push("missing static composer material rule");
} else {
  if (!/(?<!-webkit-)backdrop-filter:blur\(30px\)/.test(staticRule[0])) {
    filterFailures.push("static rule dropped its v0.4.7 unprefixed backdrop-filter");
  }
  if (!/-webkit-backdrop-filter:blur\(30px\)/.test(staticRule[0])) {
    filterFailures.push("static rule dropped its v0.4.7 -webkit-backdrop-filter");
  }
}
if (filterFailures.length) {
  for (const failure of filterFailures) console.error(`CSS: ${failure}`);
  process.exitCode = 1;
} else {
  console.log("CSS: frost and static composers keep unprefixed backdrop-filter.");
}

if (pwaFailures.length) {
  for (const failure of pwaFailures) console.error(`PWA: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`PWA: manifest ${manifestName}, service worker ${serviceWorkerName}, icons present, no /v0 runtime cache.`);
}
