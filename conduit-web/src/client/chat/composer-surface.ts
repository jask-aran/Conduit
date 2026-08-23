export type ComposerSurfaceMode = "static" | "frost" | "frosted-live" | "liquid";

export const COMPOSER_SURFACE_STORAGE_KEY = "conduit:composer-surface";
export const COMPOSER_SURFACE_CHANGE_EVENT = "conduit:composer-surface-change";
export const LIQUID_GLASS_RUNTIME_STORAGE_KEY = "conduit:liquid-glass-runtime";
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
    value: "frost",
    label: "Frosted",
    description: "Use native backdrop blur over the live transcript.",
  },
  {
    value: "frosted-live",
    label: "Frosted Live",
    description: "Keep native backdrop blur active over the live transcript during panel motion.",
  },
  {
    value: "liquid",
    label: "Liquid Glass",
    description: "Use the precomputed SVG refraction path over the live transcript.",
  },
];

const isComposerSurfaceMode = (value: string | null): value is ComposerSurfaceMode => value === "static" || value === "frost" || value === "frosted-live" || value === "liquid";

export function liquidGlassRuntimeEnabled(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  return storage.getItem(LIQUID_GLASS_RUNTIME_STORAGE_KEY) === "enabled";
}

export function allowedComposerSurface(
  surface: ComposerSurfaceMode,
  storage: Pick<Storage, "getItem"> = localStorage,
): ComposerSurfaceMode {
  return surface === "liquid" && !liquidGlassRuntimeEnabled(storage) ? "frost" : surface;
}

export function selectedComposerSurface(storage: Pick<Storage, "getItem"> = localStorage): ComposerSurfaceMode {
  const selected = storage.getItem(COMPOSER_SURFACE_STORAGE_KEY);
  if (isComposerSurfaceMode(selected)) return allowedComposerSurface(selected, storage);

  // Keep the previous binary preference stable across the three-way migration.
  // Missing and false both meant Frosted; true meant Liquid Glass.
  return allowedComposerSurface(
    storage.getItem(LEGACY_LIQUID_GLASS_SURFACE_STORAGE_KEY) === "true" ? "liquid" : "frost",
    storage,
  );
}

export function saveComposerSurface(
  surface: ComposerSurfaceMode,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): ComposerSurfaceMode {
  const allowedSurface = allowedComposerSurface(surface, storage);
  storage.setItem(COMPOSER_SURFACE_STORAGE_KEY, allowedSurface);
  // Keep downgrade compatibility with builds that only understand the old toggle.
  storage.setItem(LEGACY_LIQUID_GLASS_SURFACE_STORAGE_KEY, String(allowedSurface === "liquid"));
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<ComposerSurfaceMode>(COMPOSER_SURFACE_CHANGE_EVENT, { detail: allowedSurface }));
  return allowedSurface;
}

export function saveLiquidGlassRuntime(
  enabled: boolean,
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage,
): boolean {
  storage.setItem(LIQUID_GLASS_RUNTIME_STORAGE_KEY, enabled ? "enabled" : "disabled");
  if (enabled) {
    // Enabling the experimental runtime does not reactivate a stale Liquid
    // selection. The material still requires a separate explicit choice.
    storage.setItem(COMPOSER_SURFACE_STORAGE_KEY, "frost");
    storage.setItem(LEGACY_LIQUID_GLASS_SURFACE_STORAGE_KEY, "false");
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<ComposerSurfaceMode>(COMPOSER_SURFACE_CHANGE_EVENT, { detail: "frost" }));
    return true;
  }

  // Match the proven recovery command. The event removes the live surface
  // before Settings reloads into a document that never mounts Liquid.
  storage.removeItem(COMPOSER_SURFACE_STORAGE_KEY);
  storage.removeItem(LEGACY_LIQUID_GLASS_SURFACE_STORAGE_KEY);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<ComposerSurfaceMode>(COMPOSER_SURFACE_CHANGE_EVENT, { detail: "frost" }));
  return false;
}
