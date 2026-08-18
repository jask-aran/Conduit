import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { LIQUID_GLASS_DISPLACEMENT_SCALES } from "./liquid-glass-constants";
import {
  LIQUID_GLASS_BLUR_PX,
  liquidGlassAssetKey,
  liquidGlassDisplacementPath,
  liquidGlassSpecularPath,
  pickLiquidGlassFamily,
  pickLiquidGlassHeight,
} from "./liquid-glass-static";

let surfaceId = 0;

function nextSurfaceId() {
  surfaceId += 1;
  return `conduit-liquid-glass-${surfaceId}`;
}

function displacementScale(key: string) {
  return LIQUID_GLASS_DISPLACEMENT_SCALES[key as keyof typeof LIQUID_GLASS_DISPLACEMENT_SCALES] ?? 16;
}

export function LiquidGlassSurface() {
  let layer!: HTMLSpanElement;
  const filterId = nextSurfaceId();
  const [assetKey, setAssetKey] = createSignal("");
  const [mapHref, setMapHref] = createSignal("");
  const [specularHref, setSpecularHref] = createSignal("");
  const [scale, setScale] = createSignal(16);

  onMount(() => {
    let lastKey = "";

    const applySize = (width: number, height: number) => {
      const family = pickLiquidGlassFamily(width);
      const bucket = pickLiquidGlassHeight(height);
      const key = liquidGlassAssetKey(family, bucket);
      if (key === lastKey) return;
      lastKey = key;
      setAssetKey(key);
      setMapHref(liquidGlassDisplacementPath(family, bucket));
      setSpecularHref(liquidGlassSpecularPath(family, bucket));
      setScale(displacementScale(key));
    };

    const measure = () => {
      const rect = layer.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      applySize(rect.width, rect.height);
    };

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(layer);
      onCleanup(() => observer.disconnect());
    } else {
      window.addEventListener("resize", measure);
      onCleanup(() => window.removeEventListener("resize", measure));
    }
    measure();
  });

  return <>
    <svg class="liquid-glass-definitions" color-interpolation-filters="sRGB" aria-hidden="true">
      <defs>
        <filter id={filterId} color-interpolation-filters="sRGB" x="-8%" y="-12%" width="116%" height="124%">
          <feImage href={mapHref()} result="map" preserveAspectRatio="none" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale={scale()} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
    <span
      ref={layer}
      class="composer-glass-filter"
      data-liquid-glass-ready={assetKey() ? "true" : "false"}
      data-liquid-glass-generation-count="0"
      data-liquid-glass-asset-key={assetKey() || undefined}
      aria-hidden="true"
      style={assetKey() ? {
        "backdrop-filter": `blur(${LIQUID_GLASS_BLUR_PX}px) url(#${filterId})`,
        "-webkit-backdrop-filter": `blur(${LIQUID_GLASS_BLUR_PX}px) url(#${filterId})`,
      } : undefined}
    />
    <span class="composer-glass-chrome" aria-hidden="true" />
    <Show when={specularHref()}>
      <img class="composer-glass-specular" src={specularHref()} alt="" aria-hidden="true" />
    </Show>
  </>;
}

export default LiquidGlassSurface;
