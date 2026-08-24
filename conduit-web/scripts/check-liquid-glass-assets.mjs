import fs from "node:fs";
import path from "node:path";
import {
  LIQUID_GLASS_FAMILIES,
  LIQUID_GLASS_HEIGHT_BUCKETS,
} from "../src/client/chat/liquid-glass-static.ts";
import { LIQUID_GLASS_DISPLACEMENT_SCALES } from "../src/client/chat/liquid-glass-constants.ts";

const glassDir = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, "../public/glass"));

function fail(message) {
  throw new Error(`Liquid Glass asset validation failed: ${message}`);
}

function pngDimensions(filePath) {
  const data = fs.readFileSync(filePath);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => data[index] === byte)) fail(`${filePath} is not a PNG`);
  if (data.toString("ascii", 12, 16) !== "IHDR") fail(`${filePath} has no IHDR chunk`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

if (!fs.existsSync(glassDir)) fail(`missing directory ${glassDir}`);

const expectedFiles = new Set();
const expectedScales = new Set();
for (const family of Object.values(LIQUID_GLASS_FAMILIES)) {
  for (const height of LIQUID_GLASS_HEIGHT_BUCKETS) {
    const key = `${family.name}:${height}`;
    const displacement = `composer-${family.name}-${height}.png`;
    const specular = `composer-${family.name}-${height}-specular.png`;
    expectedFiles.add(displacement);
    expectedFiles.add(specular);
    expectedScales.add(key);
    for (const file of [displacement, specular]) {
      const filePath = path.join(glassDir, file);
      if (!fs.existsSync(filePath)) fail(`missing ${file}`);
      const dimensions = pngDimensions(filePath);
      if (dimensions.width !== family.width || dimensions.height !== height) {
        fail(`${file} is ${dimensions.width}x${dimensions.height}; expected ${family.width}x${height}`);
      }
    }
    const scale = LIQUID_GLASS_DISPLACEMENT_SCALES[key];
    if (!Number.isFinite(scale) || scale <= 0) fail(`missing displacement scale ${key}`);
  }
}

const actualFiles = new Set(fs.readdirSync(glassDir).filter((file) => file.endsWith(".png")));
const unexpectedFiles = [...actualFiles].filter((file) => !expectedFiles.has(file));
const missingFiles = [...expectedFiles].filter((file) => !actualFiles.has(file));
if (unexpectedFiles.length > 0) fail(`unexpected PNGs: ${unexpectedFiles.join(", ")}`);
if (missingFiles.length > 0) fail(`missing PNGs: ${missingFiles.join(", ")}`);

const actualScales = new Set(Object.keys(LIQUID_GLASS_DISPLACEMENT_SCALES));
const unexpectedScales = [...actualScales].filter((key) => !expectedScales.has(key));
const missingScales = [...expectedScales].filter((key) => !actualScales.has(key));
if (unexpectedScales.length > 0) fail(`unexpected displacement scales: ${unexpectedScales.join(", ")}`);
if (missingScales.length > 0) fail(`missing displacement scales: ${missingScales.join(", ")}`);

console.log(`Validated ${expectedFiles.size} Liquid Glass maps and ${expectedScales.size} displacement scales in ${glassDir}`);

