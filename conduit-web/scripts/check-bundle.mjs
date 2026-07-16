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
  initialJs: Number(process.env.CONDUIT_BUDGET_INITIAL_JS_GZIP || 180_000),
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
