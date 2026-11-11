// Refuse an updater archive an installed client could not open: tauri-plugin-updater's zip crate has default features
// off, so it decompresses only Stored, and a deflated archive fails on the user's machine after it verifies.
//
// Usage: node scripts/check-updater-archive.mjs <archive.nsis.zip>

import { readFileSync } from "node:fs";
import { basename } from "node:path";

const [archive] = process.argv.slice(2);
if (!archive) {
  console.error("Usage: check-updater-archive.mjs <archive>");
  process.exit(1);
}

const STORED = 0;
const LOCAL_HEADER = 0x04034b50;
const bytes = readFileSync(archive);

// Local file headers alone name every entry and its method, without a zip library to install.
const entries = [];
for (let at = 0; at + 30 <= bytes.length;) {
  if (bytes.readUInt32LE(at) !== LOCAL_HEADER) break;
  const method = bytes.readUInt16LE(at + 8);
  const compressed = bytes.readUInt32LE(at + 18);
  const nameLength = bytes.readUInt16LE(at + 26);
  const extraLength = bytes.readUInt16LE(at + 28);
  const name = bytes.subarray(at + 30, at + 30 + nameLength).toString("utf8");
  entries.push({ name, method });
  at += 30 + nameLength + extraLength + compressed;
}

const failures = entries.filter((entry) => entry.method !== STORED);
if (!entries.length || failures.length) {
  const detail = entries.length
    ? failures.map((entry) => `${entry.name} (method ${entry.method})`).join(", ")
    : "no entries found";
  console.error(`${basename(archive)}: the updater can only read Stored entries -- ${detail}`);
  process.exit(1);
}

// An installer nested under directories extracts as a tree the updater cannot find its executable in.
const nested = entries.filter((entry) => entry.name.includes("/") || entry.name.includes("\\"));
if (nested.length) {
  console.error(`${basename(archive)}: entries must be stored by bare name -- ${nested.map((entry) => entry.name).join(", ")}`);
  process.exit(1);
}

console.log(`${basename(archive)}: ${entries.length} stored entry(ies), readable by the updater`);
