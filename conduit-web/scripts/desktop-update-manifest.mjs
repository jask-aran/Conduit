// The manifest an installed desktop client reads before it downloads anything.
//
// It is written by whoever produced the artifacts -- the local Windows build or
// the release workflow -- so there is one description of what a release is and
// no step that assembles this by hand.
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

// One platform for now. A client asks for the key matching its own target, so
// adding macOS or Linux later is another entry, not another manifest.
const manifest = {
  version,
  pub_date: new Date().toISOString(),
  platforms: { "windows-x86_64": { signature, url } },
};

writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${out} for ${version}`);
