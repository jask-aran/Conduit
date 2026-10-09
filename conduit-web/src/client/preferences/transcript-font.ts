/* The transcript's typeface (Settings → Appearance), per device: messages,
   the composer's text and the voice captions. The rest of the UI stays Geist. */
export type TranscriptFont = "geist" | "paper-mono";

const KEY = "conduit:transcript-font";

export const TRANSCRIPT_FONT_OPTIONS: readonly { value: TranscriptFont; label: string }[] = [
  { value: "paper-mono", label: "Paper Mono" },
  { value: "geist", label: "Geist" },
];

export function transcriptFont(): TranscriptFont {
  try {
    if (localStorage.getItem(KEY) === "geist") return "geist";
  } catch { /* unavailable */ }
  return "paper-mono";
}

export function applyTranscriptFont(font = transcriptFont()) {
  document.documentElement.dataset.transcriptFont = font;
}

export function saveTranscriptFont(font: TranscriptFont): TranscriptFont {
  try { localStorage.setItem(KEY, font); } catch { /* this session only */ }
  applyTranscriptFont(font);
  return font;
}
