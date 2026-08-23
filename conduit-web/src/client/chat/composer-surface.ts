export type ComposerSurfaceMode = "static" | "static-experimental" | "static-047" | "frost" | "liquid";

export const COMPOSER_SURFACE_STORAGE_KEY = "conduit:composer-surface";
const LEGACY_LIQUID_GLASS_SURFACE_STORAGE_KEY = "conduit:liquid-glass-surface";

export const COMPOSER_SURFACE_OPTIONS: readonly {
  value: ComposerSurfaceMode;
  label: string;
  description: string;
}[] = [
  {
    value: "static",
    label: "Static",
    description: "Use the original glassmorphism composer over an opaque local backing surface, without sampling transcript pixels.",
  },
  {
    value: "static-experimental",
    label: "Static Experimental",
    description: "Test the Static material outside the transcript scroller for compositor performance.",
  },
  {
    value: "static-047",
    label: "Static 0.4.7",
    description: "Use the isolated v0.4.7 Composer, status line, and sibling layout as a historical performance control.",
  },
  {
    value: "frost",
    label: "Frosted",
    description: "Use native backdrop blur over the live transcript.",
  },
  {
    value: "liquid",
    label: "Liquid Glass",
    description: "Use the precomputed SVG refraction path over the live transcript.",
  },
];

const isComposerSurfaceMode = (value: string | null): value is ComposerSurfaceMode => value === "static" || value === "static-experimental" || value === "static-047" || value === "frost" || value === "liquid";

export function selectedComposerSurface(storage: Pick<Storage, "getItem"> = localStorage): ComposerSurfaceMode {
  const selected = storage.getItem(COMPOSER_SURFACE_STORAGE_KEY);
  if (isComposerSurfaceMode(selected)) return selected;

  // Keep the previous binary preference stable across the three-way migration.
  // Missing and false both meant Frosted; true meant Liquid Glass.
  return storage.getItem(LEGACY_LIQUID_GLASS_SURFACE_STORAGE_KEY) === "true" ? "liquid" : "frost";
}

export function saveComposerSurface(
  surface: ComposerSurfaceMode,
  storage: Pick<Storage, "setItem"> = localStorage,
): ComposerSurfaceMode {
  storage.setItem(COMPOSER_SURFACE_STORAGE_KEY, surface);
  // Keep downgrade compatibility with builds that only understand the old toggle.
  storage.setItem(LEGACY_LIQUID_GLASS_SURFACE_STORAGE_KEY, String(surface === "liquid"));
  return surface;
}
