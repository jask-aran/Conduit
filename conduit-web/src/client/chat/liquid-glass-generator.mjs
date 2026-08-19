import {
  LIQUID_GLASS_REFRACTIVE_INDEX,
  LIQUID_GLASS_THICKNESS,
} from "./liquid-glass-static.ts";

const DEFAULT_GLASS_THICKNESS = LIQUID_GLASS_THICKNESS;
const DEFAULT_REFRACTIVE_INDEX = LIQUID_GLASS_REFRACTIVE_INDEX;
const DEFAULT_SAMPLE_COUNT = 128;
const DEFAULT_SPECULAR_ANGLE = Math.PI / 3;
const DEFAULT_DPR = 1;

function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function roundKeyNumber(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function physicalDimension(value, dpr) {
  return Math.max(1, Math.round(value * dpr));
}

function convexSquircle(value) {
  return Math.pow(1 - Math.pow(1 - value, 4), 1 / 4);
}

function createRgbaImageData(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill !== undefined) data.fill(fill);
  return { data, width, height };
}

export function calculateDisplacementProfile(glassThickness, bezelWidth, refractiveIndex, samples = DEFAULT_SAMPLE_COUNT) {
  const eta = 1 / refractiveIndex;
  const profile = new Array(samples);
  for (let index = 0; index < samples; index += 1) {
    const sample = index / samples;
    const surface = convexSquircle(sample);
    const delta = sample < 1 ? 0.0001 : -0.0001;
    const derivative = (convexSquircle(sample + delta) - surface) / delta;
    const normalLength = Math.sqrt(derivative * derivative + 1);
    const normalX = -derivative / normalLength;
    const normalY = -1 / normalLength;
    const root = 1 - eta * eta * (1 - normalY * normalY);
    if (root < 0) {
      profile[index] = 0;
      continue;
    }
    const rootLength = Math.sqrt(root);
    const refractedX = -(eta * normalY + rootLength) * normalX;
    const refractedY = eta - (eta * normalY + rootLength) * normalY;
    profile[index] = refractedX * ((glassThickness + surface * bezelWidth) / refractedY);
  }
  return profile;
}

export function profileMaxDisplacement(profile) {
  let maxDisplacement = 0;
  for (const value of profile) maxDisplacement = Math.max(maxDisplacement, Math.abs(value));
  return maxDisplacement;
}

function calculateDisplacementImage(params, profile) {
  const { width, height, radius, bezelWidth, dpr } = params;
  const canvasWidth = physicalDimension(width, dpr);
  const canvasHeight = physicalDimension(height, dpr);
  const image = createRgbaImageData(canvasWidth, canvasHeight);
  new Uint32Array(image.data.buffer).fill(4_278_222_976);

  const objectWidth = width * dpr;
  const objectHeight = height * dpr;
  const scaledRadius = radius * dpr;
  const scaledBezel = bezelWidth * dpr;
  const outerRadius = scaledRadius + 1;
  const radiusSquared = scaledRadius ** 2;
  const outerRadiusSquared = outerRadius ** 2;
  const innerRadiusSquared = (scaledRadius - scaledBezel) ** 2;
  const innerWidth = objectWidth - scaledRadius * 2;
  const innerHeight = objectHeight - scaledRadius * 2;
  const rightEdge = objectWidth - scaledRadius;
  const bottomEdge = objectHeight - scaledRadius;
  const sampleScale = scaledBezel > 0 ? profile.length / scaledBezel : 0;
  const mapScale = 127 / 100;
  const offsetX = (canvasWidth - objectWidth) / 2;
  const offsetY = (canvasHeight - objectHeight) / 2;

  for (let y = 0; y < objectHeight; y += 1) {
    const verticalOutside = y < scaledRadius || y >= bottomEdge;
    const verticalOffset = verticalOutside
      ? y - scaledRadius - (y >= bottomEdge ? innerHeight : 0)
      : 0;
    const verticalOffsetSquared = verticalOffset * verticalOffset;
    const row = Math.round(offsetY + y);
    if (row < 0 || row >= canvasHeight) continue;
    for (let x = 0; x < objectWidth; x += 1) {
      const horizontalOutside = x < scaledRadius || x >= rightEdge;
      const horizontalOffset = horizontalOutside
        ? x - scaledRadius - (x >= rightEdge ? innerWidth : 0)
        : 0;
      const distanceSquared = horizontalOffset * horizontalOffset + verticalOffsetSquared;
      if (distanceSquared > outerRadiusSquared || distanceSquared < innerRadiusSquared) continue;
      const distance = Math.sqrt(distanceSquared);
      const surfaceDepth = scaledRadius - distance;
      const edgeFactor = distanceSquared < radiusSquared ? 1 : outerRadius - distance;
      const displacement = profile[Math.trunc(surfaceDepth * sampleScale)] ?? 0;
      const radialScale = distance !== 0 ? displacement * mapScale * edgeFactor / distance : 0;
      const column = Math.round(offsetX + x);
      if (column < 0 || column >= canvasWidth) continue;
      const pixel = (row * canvasWidth + column) * 4;
      image.data[pixel] = 128 - horizontalOffset * radialScale;
      image.data[pixel + 1] = 128 - verticalOffset * radialScale;
      image.data[pixel + 2] = 0;
      image.data[pixel + 3] = 255;
    }
  }
  return image;
}

function calculateSpecularImage(params) {
  const { width, height, radius, bezelWidth, dpr } = params;
  const canvasWidth = physicalDimension(width, dpr);
  const canvasHeight = physicalDimension(height, dpr);
  const image = createRgbaImageData(canvasWidth, canvasHeight, 0);
  const { data } = image;
  const scaledRadius = radius * dpr;
  const scaledBezel = bezelWidth * dpr;
  const outerRadius = scaledRadius + dpr;
  const innerRadius = Math.max(scaledRadius - scaledBezel, 0);
  const radiusSquared = scaledRadius ** 2;
  const outerRadiusSquared = outerRadius ** 2;
  const innerRadiusSquared = innerRadius ** 2;
  const innerWidth = width * dpr - scaledRadius * 2;
  const innerHeight = height * dpr - scaledRadius * 2;
  const rightEdge = width * dpr - scaledRadius;
  const bottomEdge = height * dpr - scaledRadius;
  const cosine = Math.cos(DEFAULT_SPECULAR_ANGLE);
  const sine = Math.sin(DEFAULT_SPECULAR_ANGLE);

  for (let y = 0; y < height * dpr; y += 1) {
    const verticalOutside = y < scaledRadius || y >= bottomEdge;
    const verticalOffset = verticalOutside
      ? y - scaledRadius - (y >= bottomEdge ? innerHeight : 0)
      : 0;
    const verticalOffsetSquared = verticalOffset * verticalOffset;
    const row = y * canvasWidth;
    for (let x = 0; x < width * dpr; x += 1) {
      const horizontalOutside = x < scaledRadius || x >= rightEdge;
      const horizontalOffset = horizontalOutside
        ? x - scaledRadius - (x >= rightEdge ? innerWidth : 0)
        : 0;
      const distanceSquared = horizontalOffset * horizontalOffset + verticalOffsetSquared;
      if (distanceSquared > outerRadiusSquared || distanceSquared < innerRadiusSquared) continue;
      const distance = Math.sqrt(distanceSquared);
      const bevelDepth = (scaledRadius - distance) / dpr;
      if (bevelDepth <= 0) continue;
      const edgeFactor = distanceSquared < radiusSquared ? 1 : 1 - (distance - scaledRadius) / dpr;
      const inverseDistance = distance === 0 ? 0 : 1 / distance;
      const angleFactor = Math.abs((horizontalOffset * cosine - verticalOffset * sine) * inverseDistance);
      const falloff = 1 - (1 - bevelDepth) * (1 - bevelDepth);
      if (falloff <= 0) continue;
      const highlight = angleFactor * Math.sqrt(falloff);
      const intensity = 255 * highlight;
      const pixel = (row + x) * 4;
      data[pixel] = intensity;
      data[pixel + 1] = intensity;
      data[pixel + 2] = intensity;
      data[pixel + 3] = intensity * highlight * edgeFactor;
    }
  }
  return image;
}

export function normalizeLiquidGlassAssetParams(input = {}) {
  const width = Math.max(1, Math.round(positiveNumber(input.width, 1)));
  const height = Math.max(1, Math.round(positiveNumber(input.height, 1)));
  const radius = Math.max(1, Math.min(height / 2, width / 2, positiveNumber(input.radius, 24)));
  const bezelWidth = Math.min(radius, roundKeyNumber(positiveNumber(input.bezelWidth, radius)));
  return {
    width,
    height,
    radius: roundKeyNumber(radius),
    bezelWidth,
    glassThickness: roundKeyNumber(positiveNumber(input.glassThickness, DEFAULT_GLASS_THICKNESS)),
    refractiveIndex: roundKeyNumber(positiveNumber(input.refractiveIndex, DEFAULT_REFRACTIVE_INDEX)),
    dpr: roundKeyNumber(Math.max(1, positiveNumber(input.dpr, DEFAULT_DPR))),
  };
}

export function createLiquidGlassAsset(input = {}) {
  const params = normalizeLiquidGlassAssetParams(input);
  const profile = calculateDisplacementProfile(params.glassThickness, params.bezelWidth, params.refractiveIndex);
  return {
    ...params,
    displacement: calculateDisplacementImage(params, profile),
    specular: calculateSpecularImage(params),
    maxDisplacement: profileMaxDisplacement(profile),
  };
}
