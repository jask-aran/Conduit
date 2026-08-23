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

const SPECULAR_OPACITY = 0.2;
const SPECULAR_SATURATION = 4;

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
  const [filterWidth, setFilterWidth] = createSignal(0);
  const [filterHeight, setFilterHeight] = createSignal(0);

  onMount(() => {
    let lastKey = "";

    const applySize = (width: number, height: number) => {
      setFilterWidth(width);
      setFilterHeight(height);
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
      applySize(Math.round(rect.width), Math.round(rect.height));
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
        <filter id={filterId} color-interpolation-filters="sRGB" primitiveUnits="userSpaceOnUse" x="-8%" y="-12%" width="116%" height="124%">
          <Show when={assetKey()}>
            <feGaussianBlur in="SourceGraphic" stdDeviation={LIQUID_GLASS_BLUR_PX} result="blurred_source" />
            <feImage href={mapHref()} x="0" y="0" width={filterWidth()} height={filterHeight()} preserveAspectRatio="none" result="displacement_map" />
            <feDisplacementMap in="blurred_source" in2="displacement_map" scale={scale()} xChannelSelector="R" yChannelSelector="G" result="displaced" />
            <feColorMatrix in="displaced" type="saturate" values={String(SPECULAR_SATURATION)} result="displaced_saturated" />
            <feImage href={specularHref()} x="0" y="0" width={filterWidth()} height={filterHeight()} preserveAspectRatio="none" result="specular_layer" />
            <feComposite in="displaced_saturated" in2="specular_layer" operator="in" result="specular_saturated" />
            <feComponentTransfer in="specular_layer" result="specular_faded"><feFuncA type="linear" slope={SPECULAR_OPACITY} /></feComponentTransfer>
            <feBlend in="specular_saturated" in2="displaced" mode="normal" result="withSaturation" />
            <feBlend in="specular_faded" in2="withSaturation" mode="normal" />
          </Show>
        </filter>
      </defs>
    </svg>
    <span
      ref={layer}
      class="composer-glass-filter"
      data-liquid-glass-ready={assetKey() ? "true" : "false"}
      data-liquid-glass-asset-key={assetKey() || undefined}
      aria-hidden="true"
      style={assetKey() ? {
        "backdrop-filter": `url(#${filterId})`,
        "-webkit-backdrop-filter": `url(#${filterId})`,
      } : undefined}
    />
    <span class="composer-glass-chrome" aria-hidden="true" />
  </>;
}

export default LiquidGlassSurface;
