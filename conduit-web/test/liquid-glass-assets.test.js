import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createLiquidGlassAsset } from "../src/client/chat/liquid-glass-generator.mjs";
import { LIQUID_GLASS_DISPLACEMENT_SCALES } from "../src/client/chat/liquid-glass-constants.ts";
import {
  LIQUID_GLASS_FAMILIES,
  LIQUID_GLASS_HEIGHT_BUCKETS,
  pickLiquidGlassFamily,
  pickLiquidGlassHeight,
} from "../src/client/chat/liquid-glass-static.ts";

test("height buckets only change when the composer crosses a known size", () => {
  assert.equal(pickLiquidGlassHeight(72), 88);
  assert.equal(pickLiquidGlassHeight(86), 88);
  assert.equal(pickLiquidGlassHeight(93), 112);
  assert.equal(pickLiquidGlassHeight(200), 184);
});

test("geometry families follow the app's desktop and mobile composer widths", () => {
  assert.equal(pickLiquidGlassFamily(760), "desktop");
  assert.equal(pickLiquidGlassFamily(388), "mobile");
});

test("displacement maps keep a neutral centre and a convex-squircle bezel", () => {
  const asset = createLiquidGlassAsset({ width: 200, height: 80, radius: 24, bezelWidth: 23, glassThickness: 70, refractiveIndex: 1.5, dpr: 1 });
  const center = ((Math.trunc(asset.displacement.height / 2) * asset.displacement.width) + Math.trunc(asset.displacement.width / 2)) * 4;
  assert.equal(asset.displacement.data[center], 128);
  assert.equal(asset.displacement.data[center + 1], 128);
  const edge = (Math.trunc(asset.displacement.height / 2) * asset.displacement.width) * 4;
  assert.notEqual(asset.displacement.data[edge], 128);
  assert.ok(asset.maxDisplacement > 0);
});

test("prebaked PNG maps exist for every family and height bucket", () => {
  const glassDir = path.resolve(import.meta.dirname, "../public/glass");
  for (const family of Object.values(LIQUID_GLASS_FAMILIES)) {
    for (const height of LIQUID_GLASS_HEIGHT_BUCKETS) {
      const displacement = path.join(glassDir, `composer-${family.name}-${height}.png`);
      const specular = path.join(glassDir, `composer-${family.name}-${height}-specular.png`);
      assert.equal(fs.existsSync(displacement), true, displacement);
      assert.equal(fs.existsSync(specular), true, specular);
      assert.ok(LIQUID_GLASS_DISPLACEMENT_SCALES[`${family.name}:${height}`] > 0);
    }
  }
});
