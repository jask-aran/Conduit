/**
 * Which renderer draws an answer.
 *
 * Two modes, not the six that used to be selectable. Those six were only ever
 * three implementations: the marked incremental reconciler, a second isolated
 * marked instance, and one Incremark component whose "typewriter", "immediate"
 * and "synthetic" variants were two booleans on the same code. The variants
 * bought nothing a reader could choose between, and every feature added to the
 * transcript had to be built once per emitter or smuggled through an attribute
 * contract, so they are gone.
 *
 * What remains is the renderer answers are drawn with, and one alternate to
 * fall back to if a message renders wrong.
 */
export type MarkdownRendererId = "incremark" | "marked";

/** Incremark is one component; Marked is a separate emitter. */
export function isIncremarkRenderer(value: MarkdownRendererId) {
  return value === "incremark";
}

export const MARKDOWN_RENDERER_STORAGE_KEY = "conduit:markdown-renderer";
export const RENDERER_CONTROLS_VISIBLE_STORAGE_KEY = "conduit:renderer-controls-visible";

export const MARKDOWN_RENDERER_DEFAULT: MarkdownRendererId = "incremark";

export const MARKDOWN_RENDERER_OPTIONS: ReadonlyArray<{
  value: MarkdownRendererId;
  label: string;
  description: string;
}> = [
  {
    value: "incremark",
    label: "Incremark",
    description: "Streams block by block, then freezes a settled message so it is never re-rendered again.",
  },
  {
    value: "marked",
    label: "Marked",
    description: "Reconciles a re-parsed Markdown tree into the live one. The fallback if a message renders wrong.",
  },
];

export function isMarkdownRendererId(value: unknown): value is MarkdownRendererId {
  return value === "incremark" || value === "marked";
}

export function selectedMarkdownRenderer(
  storage: Pick<Storage, "getItem"> = localStorage,
): MarkdownRendererId {
  const override = typeof location === "undefined"
    ? null
    : new URLSearchParams(location.search).get("markdownRenderer");
  if (isMarkdownRendererId(override)) return override;
  // Anything else stored here is one of the retired ids -- "incremark-advanced",
  // "incremark-typewriter", "incremark-synthetic", "incremark-fast",
  // "marked-stable" -- or a stale transcript-renderer value. They all resolve
  // to the default rather than leaving someone on a renderer that no longer
  // exists. "incremark-advanced" retired when its settle-and-freeze shell was
  // merged into the renderer itself; everyone stored under it lands back on the
  // same component.
  const stored = storage.getItem(MARKDOWN_RENDERER_STORAGE_KEY);
  return isMarkdownRendererId(stored) ? stored : MARKDOWN_RENDERER_DEFAULT;
}

export function saveMarkdownRenderer(
  renderer: MarkdownRendererId,
  storage: Pick<Storage, "setItem"> = localStorage,
): MarkdownRendererId {
  const selected = isMarkdownRendererId(renderer) ? renderer : MARKDOWN_RENDERER_DEFAULT;
  storage.setItem(MARKDOWN_RENDERER_STORAGE_KEY, selected);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("conduit:ui-preference-change", {
      detail: { key: "markdownRenderer", value: selected },
    }));
  }
  return selected;
}

export function selectedRendererControlsVisible(
  storage: Pick<Storage, "getItem"> = localStorage,
): boolean {
  return storage.getItem(RENDERER_CONTROLS_VISIBLE_STORAGE_KEY) !== "false";
}

export function saveRendererControlsVisible(
  visible: boolean,
  storage: Pick<Storage, "setItem"> = localStorage,
): boolean {
  storage.setItem(RENDERER_CONTROLS_VISIBLE_STORAGE_KEY, String(visible));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("conduit:ui-preference-change", {
      detail: { key: "rendererControlsVisible", value: visible },
    }));
  }
  return visible;
}
