export type TranscriptFont = "geist" | "paper-mono";

const KEY = "conduit:transcript-font";

export const TRANSCRIPT_FONT_OPTIONS: readonly { value: TranscriptFont; label: string }[] = [
  { value: "geist", label: "Geist" },
  { value: "paper-mono", label: "Paper Mono" },
];

export function transcriptFont(): TranscriptFont {
  try {
    if (localStorage.getItem(KEY) === "paper-mono") return "paper-mono";
  } catch { /* unavailable */ }
  return "geist";
}

export function applyTranscriptFont(font = transcriptFont()) {
  document.documentElement.dataset.transcriptFont = font;
}

export function saveTranscriptFont(font: TranscriptFont): TranscriptFont {
  try { localStorage.setItem(KEY, font); } catch { /* this session only */ }
  applyTranscriptFont(font);
  return font;
}
