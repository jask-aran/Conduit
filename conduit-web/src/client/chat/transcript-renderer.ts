import "./transcript-renderer.css";

export type TranscriptRendererMode = "current" | "incremark-advanced";

export const TRANSCRIPT_RENDERER_STORAGE_KEY = "conduit:transcript-renderer";

export const TRANSCRIPT_RENDERER_OPTIONS: readonly {
  value: TranscriptRendererMode;
  label: string;
  description: string;
}[] = [
  {
    value: "current",
    label: "Current",
    description: "Use the currently selected Markdown renderer and its existing transcript settlement behavior.",
  },
  {
    value: "incremark-advanced",
    label: "Incremark Advanced",
    description: "Keep the proven Incremark streaming DOM, then freeze its final source in place and virtualize settled blocks independently.",
  },
];

const isTranscriptRendererMode = (value: string | null): value is TranscriptRendererMode =>
  value === "current" || value === "incremark-advanced";

export function selectedTranscriptRenderer(storage: Pick<Storage, "getItem"> = localStorage): TranscriptRendererMode {
  const params = typeof location === "undefined" ? null : new URLSearchParams(location.search);
  const override = params?.get("transcriptRenderer")
    || (params?.get("markdownRenderer") === "incremark-advanced" ? "incremark-advanced" : null);
  if (isTranscriptRendererMode(override)) return override;
  const selected = storage.getItem(TRANSCRIPT_RENDERER_STORAGE_KEY);
  return isTranscriptRendererMode(selected) ? selected : "current";
}

export function saveTranscriptRenderer(
  renderer: TranscriptRendererMode,
  storage: Pick<Storage, "setItem"> = localStorage,
): TranscriptRendererMode {
  storage.setItem(TRANSCRIPT_RENDERER_STORAGE_KEY, renderer);
  return renderer;
}
