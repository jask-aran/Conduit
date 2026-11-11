// The manifest an installed desktop client reads before it downloads anything.
//
// Usage: node scripts/desktop-update-manifest.mjs <version> <url> <sig file> <out>

import { readFileSync, writeFileSync } from "node:fs";

const [version, url, signaturePath, out] = process.argv.slice(2);
if (!version || !url || !signaturePath || !out) {
  console.error("Usage: desktop-update-manifest.mjs <version> <url> <signature file> <out>");
  process.exit(1);
}

const signature = readFileSync(signaturePath, "utf8").trim();
if (!signature) {
  console.error(`Empty signature: ${signaturePath}`);
  process.exit(1);
}

const manifest = {
  version,
  pub_date: new Date().toISOString(),
  // A product name with a space reaches here as a space in the path, which the updater cannot parse.
  platforms: { "windows-x86_64": { signature, url: new URL(url).href } },
};

writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${out} for ${version}`);
