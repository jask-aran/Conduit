import { MARKDOWN_RENDERER_OPTIONS, MARKDOWN_RENDERER_STORAGE_KEY, type MarkdownRendererId } from "./markdown-settings";
import "./transcript-renderer.css";

export type TranscriptRendererMode = MarkdownRendererId | "incremark-advanced";

export const TRANSCRIPT_RENDERER_STORAGE_KEY = "conduit:transcript-renderer";

export const TRANSCRIPT_RENDERER_OPTIONS: readonly {
  value: TranscriptRendererMode;
  label: string;
  description?: string;
}[] = [
  ...MARKDOWN_RENDERER_OPTIONS,
  {
    value: "incremark-advanced",
    label: "Incremark Advanced",
    description: "Use the Synthetic streaming path unchanged, then freeze and independently virtualize settled blocks.",
  },
];

const MARKDOWN_RENDERER_IDS = new Set<MarkdownRendererId>(MARKDOWN_RENDERER_OPTIONS.map((option) => option.value));

export function isTranscriptRendererMode(value: string | null): value is TranscriptRendererMode {
  return value === "incremark-advanced" || (value != null && MARKDOWN_RENDERER_IDS.has(value as MarkdownRendererId));
}

export function selectedTranscriptRenderer(
  fallback: MarkdownRendererId,
  storage: Pick<Storage, "getItem"> = localStorage,
): TranscriptRendererMode {
  const params = typeof location === "undefined" ? null : new URLSearchParams(location.search);
  const override = params?.get("transcriptRenderer")
    || (params?.get("markdownRenderer") === "incremark-advanced" ? "incremark-advanced" : null);
  if (isTranscriptRendererMode(override)) return override;
  const selected = storage.getItem(TRANSCRIPT_RENDERER_STORAGE_KEY);
  if (isTranscriptRendererMode(selected)) return selected;
  // "current" was written by the first Advanced prototype. Treat it as the
  // canonical Markdown renderer during the migration to one six-way picker.
  return fallback;
}

export function saveTranscriptRenderer(
  renderer: TranscriptRendererMode,
  storage: Pick<Storage, "setItem"> = localStorage,
): TranscriptRendererMode {
  storage.setItem(TRANSCRIPT_RENDERER_STORAGE_KEY, renderer);
  if (renderer !== "incremark-advanced") storage.setItem(MARKDOWN_RENDERER_STORAGE_KEY, renderer);
  return renderer;
}
