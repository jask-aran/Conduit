import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { createLiquidGlassAsset } from "../src/client/chat/liquid-glass-generator.mjs";

const outputDir = path.resolve(import.meta.dirname, "../public/glass");
const constantsPath = path.resolve(import.meta.dirname, "../src/client/chat/liquid-glass-constants.ts");
const families = [
  { name: "desktop", width: 760, radius: 24, bezelWidth: 23 },
  { name: "mobile", width: 388, radius: 18, bezelWidth: 17 },
];
const heights = [64, 88, 112, 136, 160, 184];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

function encodePng(image) {
  const rowLength = image.width * 4;
  const raw = Buffer.alloc((rowLength + 1) * image.height);
  for (let row = 0; row < image.height; row += 1) {
    const offset = row * (rowLength + 1);
    raw[offset] = 0;
    Buffer.from(image.data.buffer, image.data.byteOffset + row * rowLength, rowLength).copy(raw, offset + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(outputDir, { recursive: true });
const scales = {};
let count = 0;
for (const family of families) {
  for (const height of heights) {
    const asset = createLiquidGlassAsset({
      ...family,
      height,
      glassThickness: 70,
      refractiveIndex: 1.5,
      dpr: 1,
    });
    fs.writeFileSync(path.join(outputDir, `composer-${family.name}-${height}.png`), encodePng(asset.displacement));
    fs.writeFileSync(path.join(outputDir, `composer-${family.name}-${height}-specular.png`), encodePng(asset.specular));
    scales[`${family.name}:${height}`] = asset.maxDisplacement * 0.7;
    count += 2;
  }
}
fs.writeFileSync(constantsPath, `export const LIQUID_GLASS_DISPLACEMENT_SCALES = ${JSON.stringify(scales, null, 2)} as const;\n`);
console.log(`Generated ${count} liquid-glass maps at ${outputDir}`);
