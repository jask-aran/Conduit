export const LIQUID_GLASS_HEIGHT_BUCKETS = [64, 88, 112, 136, 160, 184] as const;
export const LIQUID_GLASS_FAMILIES = {
  desktop: { name: "desktop", width: 760, radius: 24, bezelWidth: 23 },
  mobile: { name: "mobile", width: 388, radius: 18, bezelWidth: 17 },
} as const;
export const LIQUID_GLASS_THICKNESS = 70;
export const LIQUID_GLASS_REFRACTIVE_INDEX = 1.5;
export const LIQUID_GLASS_SCALE_RATIO = 0.7;
export const LIQUID_GLASS_BLUR_PX = 4;

export type LiquidGlassFamilyName = keyof typeof LIQUID_GLASS_FAMILIES;
export type LiquidGlassHeightBucket = (typeof LIQUID_GLASS_HEIGHT_BUCKETS)[number];

export function pickLiquidGlassFamily(width: number): LiquidGlassFamilyName {
  return width < 560 ? "mobile" : "desktop";
}

export function pickLiquidGlassHeight(height: number): LiquidGlassHeightBucket {
  for (const bucket of LIQUID_GLASS_HEIGHT_BUCKETS) {
    if (bucket >= height) return bucket;
  }
  return LIQUID_GLASS_HEIGHT_BUCKETS[LIQUID_GLASS_HEIGHT_BUCKETS.length - 1]!;
}

export function liquidGlassAssetKey(family: LiquidGlassFamilyName, height: LiquidGlassHeightBucket) {
  return `${family}:${height}`;
}

export function liquidGlassDisplacementPath(family: LiquidGlassFamilyName, height: LiquidGlassHeightBucket) {
  return `/glass/composer-${family}-${height}.png`;
}

export function liquidGlassSpecularPath(family: LiquidGlassFamilyName, height: LiquidGlassHeightBucket) {
  return `/glass/composer-${family}-${height}-specular.png`;
}
