import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { LIQUID_GLASS_STATIC_ASSETS, type LiquidGlassStaticAsset } from "./liquid-glass-static";
import { createLiquidGlassAsset, liquidGlassAssetKey } from "./liquid-glass-generator.mjs";

const SEARCHBOX_BLUR = 4;
const SEARCHBOX_SCALE_RATIO = 0.7;
const SEARCHBOX_SPECULAR_OPACITY = 0.2;
const SEARCHBOX_SPECULAR_SATURATION = 4;
const GLASS_THICKNESS = 70;
const REFRACTIVE_INDEX = 1.5;
const BEZEL_WIDTH = 4;
const RUNTIME_CACHE_LIMIT = 8;

type RgbaImage = { data: Uint8ClampedArray; width: number; height: number };
type LiquidGlassAsset = LiquidGlassStaticAsset & {
  displacementUrl: string;
  specularUrl: string;
};

const runtimeAssetCache = new Map<string, LiquidGlassAsset>();
let surfaceId = 0;

function nextSurfaceId() {
  surfaceId += 1;
  return `conduit-liquid-glass-${surfaceId}`;
}

function readRadius(element: HTMLElement, height: number) {
  const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius);
  return Math.max(1, Math.min(height / 2, Number.isFinite(radius) ? radius : 24));
}

function encodeImage(image: RgbaImage) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Liquid glass could not create a 2D canvas context.");
  const imageData = context.createImageData(image.width, image.height);
  imageData.data.set(image.data);
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function rememberRuntimeAsset(asset: LiquidGlassAsset) {
  runtimeAssetCache.delete(asset.key);
  runtimeAssetCache.set(asset.key, asset);
  while (runtimeAssetCache.size > RUNTIME_CACHE_LIMIT) runtimeAssetCache.delete(runtimeAssetCache.keys().next().value!);
}

function findStaticAsset(width: number, height: number, radius: number, dpr: number) {
  return LIQUID_GLASS_STATIC_ASSETS.find((asset) => asset.width === width
    && asset.height === height
    && asset.radius === radius
    && Math.abs(asset.dpr - dpr) < 0.01);
}

function generateRuntimeAsset(width: number, height: number, radius: number, dpr: number) {
  const params = { width, height, radius, bezelWidth: BEZEL_WIDTH, glassThickness: GLASS_THICKNESS, refractiveIndex: REFRACTIVE_INDEX, dpr };
  const key = liquidGlassAssetKey(params);
  const cached = runtimeAssetCache.get(key);
  if (cached) {
    rememberRuntimeAsset(cached);
    return cached;
  }
  const generated = createLiquidGlassAsset(params);
  const asset: LiquidGlassAsset = {
    name: "runtime",
    ...generated,
    mapWidth: generated.displacement.width,
    mapHeight: generated.displacement.height,
    displacementUrl: encodeImage(generated.displacement),
    specularUrl: encodeImage(generated.specular),
  };
  rememberRuntimeAsset(asset);
  return asset;
}

export function LiquidGlassSurface() {
  let layer!: HTMLSpanElement;
  const filterId = nextSurfaceId();
  const [asset, setAsset] = createSignal<LiquidGlassAsset | null>(null);
  const [generationCount, setGenerationCount] = createSignal(0);

  onMount(() => {
    let disposed = false;
    let measurementEnabled = false;
    let revision = 0;
    let lastKey = "";
    let renderAbort: AbortController | undefined;

    const renderForSize = async (width: number, height: number) => {
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      const radius = Math.max(1, Math.min(height / 2, readRadius(layer, height)));
      const staticAsset = findStaticAsset(width, height, radius, dpr)
        || findStaticAsset(width, height, radius, 1);
      const key = staticAsset?.key || liquidGlassAssetKey({ width, height, radius, bezelWidth: BEZEL_WIDTH, glassThickness: GLASS_THICKNESS, refractiveIndex: REFRACTIVE_INDEX, dpr });
      if (key === lastKey) return;
      lastKey = key;
      const request = ++revision;
      renderAbort?.abort();
      if (staticAsset) {
        setAsset(staticAsset);
        return;
      }
      const controller = new AbortController();
      renderAbort = controller;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (disposed || request !== revision || controller.signal.aborted) return;
      try {
        const next = generateRuntimeAsset(width, height, radius, dpr);
        if (disposed || request !== revision || controller.signal.aborted) return;
        setAsset(next);
        setGenerationCount((count) => count + 1);
      } catch (error) {
        if (!disposed && (error as Error)?.name !== "AbortError") console.warn("Liquid glass surface unavailable; using the basic frosted path.", error);
      }
    };

    const measure = () => {
      if (!measurementEnabled) return;
      const rect = layer.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      void renderForSize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)));
    };

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(layer);
      onCleanup(() => observer.disconnect());
    } else {
      window.addEventListener("resize", measure);
      onCleanup(() => window.removeEventListener("resize", measure));
    }
    void (async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (disposed) return;
      measurementEnabled = true;
      measure();
    })();
    onCleanup(() => {
      disposed = true;
      revision += 1;
      renderAbort?.abort();
    });
  });

  return <>
    <svg class="liquid-glass-definitions" color-interpolation-filters="sRGB" aria-hidden="true">
      <defs>
        <filter id={filterId} filterUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
          <Show when={asset()}>{(current) => <>
            <feGaussianBlur in="SourceGraphic" stdDeviation={SEARCHBOX_BLUR} result="blurred_source" />
            <feImage href={current().displacementUrl} x="0" y="0" width={current().width} height={current().height} result="displacement_map" />
            <feDisplacementMap in="blurred_source" in2="displacement_map" scale={current().maxDisplacement * SEARCHBOX_SCALE_RATIO} xChannelSelector="R" yChannelSelector="G" result="displaced" />
            <feColorMatrix in="displaced" type="saturate" values={String(SEARCHBOX_SPECULAR_SATURATION)} result="displaced_saturated" />
            <feImage href={current().specularUrl} x="0" y="0" width={current().width} height={current().height} result="specular_layer" />
            <feComposite in="displaced_saturated" in2="specular_layer" operator="in" result="specular_saturated" />
            <feComponentTransfer in="specular_layer" result="specular_faded"><feFuncA type="linear" slope={SEARCHBOX_SPECULAR_OPACITY} /></feComponentTransfer>
            <feBlend in="specular_saturated" in2="displaced" mode="normal" result="withSaturation" />
            <feBlend in="specular_faded" in2="withSaturation" mode="normal" />
          </>}</Show>
        </filter>
      </defs>
    </svg>
    <span
      ref={layer}
      class="composer-glass-layer"
      data-liquid-glass-ready={asset() ? "true" : "false"}
      data-liquid-glass-generation-count={generationCount()}
      data-liquid-glass-asset-key={asset()?.key || undefined}
      aria-hidden="true"
      style={asset() ? {
        "backdrop-filter": `url(#${filterId})`,
        "-webkit-backdrop-filter": `url(#${filterId})`,
      } : undefined}
    />
  </>;
}

export default LiquidGlassSurface;
