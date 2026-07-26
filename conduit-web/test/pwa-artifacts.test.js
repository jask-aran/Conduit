import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Optional post-build gate for issue #27. Skips when dist/ is absent so
 * `npm test` stays green on a clean tree; `npm run build` always enforces the
 * same rules via scripts/check-bundle.mjs.
 */
const dist = path.resolve("dist");
const hasDist = fs.existsSync(path.join(dist, "index.html"));

test("production dist exposes PWA shell without /v0 runtime caching", { skip: !hasDist }, () => {
  const entries = fs.readdirSync(dist);
  const manifest = entries.find((name) => name.endsWith(".webmanifest"));
  const serviceWorker = entries.find((name) => /^(sw|service-worker)\.js$/.test(name));
  assert.ok(manifest, "missing *.webmanifest");
  assert.ok(serviceWorker, "missing root sw.js");
  assert.ok(fs.existsSync(path.join(dist, "pwa-192x192.png")), "missing pwa-192x192.png");
  assert.ok(fs.existsSync(path.join(dist, "pwa-512x512.png")), "missing pwa-512x512.png");

  const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  assert.match(html, /manifest/, "index.html should link the web manifest");
  assert.match(html, /apple-touch-icon|apple-mobile-web-app/, "index.html should carry iOS install metadata");

  const swText = fs.readFileSync(path.join(dist, serviceWorker), "utf8");
  assert.match(swText, /denylist:\[[^\]]*\/v0/, "NavigationRoute denylist must exclude /v0");
  const withoutDenylist = swText.replace(/denylist:\[[^\]]*\]/g, "denylist:[]");
  assert.equal(/\/v0\b/.test(withoutDenylist), false, "sw.js must not mention /v0 outside the denylist");
  assert.equal(/runtimeCaching/i.test(swText), false, "sw.js must not enable Workbox runtimeCaching");
});
