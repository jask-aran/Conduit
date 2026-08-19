import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createLiquidGlassAsset } from "../src/client/chat/liquid-glass-generator.mjs";
import { LIQUID_GLASS_DISPLACEMENT_SCALES } from "../src/client/chat/liquid-glass-constants.ts";
import {
  LIQUID_GLASS_REFRACTIVE_INDEX,
  LIQUID_GLASS_THICKNESS,
  LIQUID_GLASS_FAMILIES,
  LIQUID_GLASS_HEIGHT_BUCKETS,
  pickLiquidGlassFamily,
  pickLiquidGlassHeight,
} from "../src/client/chat/liquid-glass-static.ts";

const pngDimensions = (filePath) => {
  const data = fs.readFileSync(filePath);
  assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
};

test("height buckets only change when the composer crosses a known size", () => {
  assert.equal(pickLiquidGlassHeight(72), 88);
  assert.equal(pickLiquidGlassHeight(86), 88);
  assert.equal(pickLiquidGlassHeight(93), 112);
  assert.equal(pickLiquidGlassHeight(200), 184);
});

test("geometry families follow the app's desktop and mobile composer widths", () => {
  const desktopWidth = LIQUID_GLASS_FAMILIES.desktop.width;
  assert.equal(pickLiquidGlassFamily(desktopWidth - 1), "mobile");
  assert.equal(pickLiquidGlassFamily(desktopWidth), "desktop");
  assert.equal(pickLiquidGlassFamily(LIQUID_GLASS_FAMILIES.mobile.width), "mobile");
});

test("displacement maps keep a neutral centre and a convex-squircle bezel", () => {
  const family = LIQUID_GLASS_FAMILIES.mobile;
  const asset = createLiquidGlassAsset({
    width: family.width,
    height: LIQUID_GLASS_HEIGHT_BUCKETS[1],
    radius: family.radius,
    bezelWidth: family.bezelWidth,
    glassThickness: LIQUID_GLASS_THICKNESS,
    refractiveIndex: LIQUID_GLASS_REFRACTIVE_INDEX,
    dpr: 1,
  });
  const center = ((Math.trunc(asset.displacement.height / 2) * asset.displacement.width) + Math.trunc(asset.displacement.width / 2)) * 4;
  assert.equal(asset.displacement.data[center], 128);
  assert.equal(asset.displacement.data[center + 1], 128);
  const edge = (Math.trunc(asset.displacement.height / 2) * asset.displacement.width) * 4;
  assert.notEqual(asset.displacement.data[edge], 128);
  assert.ok(asset.maxDisplacement > 0);
});

test("generator reads families and buckets from the shared static module", () => {
  const generator = fs.readFileSync(path.resolve(import.meta.dirname, "../scripts/generate-liquid-glass-assets.mjs"), "utf8");
  assert.match(generator, /from "\.\.\/src\/client\/chat\/liquid-glass-static\.ts"/);
  assert.doesNotMatch(generator, /width:\s*760/);
  assert.doesNotMatch(generator, /heights = \[64,/);
});

test("prebaked PNG maps exist for every family and height bucket", () => {
  const glassDir = path.resolve(import.meta.dirname, "../public/glass");
  const expected = new Set();
  for (const family of Object.values(LIQUID_GLASS_FAMILIES)) {
    for (const height of LIQUID_GLASS_HEIGHT_BUCKETS) {
      const displacement = path.join(glassDir, `composer-${family.name}-${height}.png`);
      const specular = path.join(glassDir, `composer-${family.name}-${height}-specular.png`);
      expected.add(path.basename(displacement));
      expected.add(path.basename(specular));
      assert.equal(fs.existsSync(displacement), true, displacement);
      assert.equal(fs.existsSync(specular), true, specular);
      assert.deepEqual(pngDimensions(displacement), { width: family.width, height });
      assert.deepEqual(pngDimensions(specular), { width: family.width, height });
      assert.ok(LIQUID_GLASS_DISPLACEMENT_SCALES[`${family.name}:${height}`] > 0);
    }
  }
  const actual = new Set(fs.readdirSync(glassDir).filter((file) => file.endsWith(".png")));
  assert.deepEqual(actual, expected);
});
