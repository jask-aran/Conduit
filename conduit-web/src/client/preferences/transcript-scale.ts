/* The transcript's own size (Settings → Appearance), per device, on top of the Interface size: messages, answers and
   bubbles, drawn in their region's unit (foundations.css --scale-transcript-desktop/-phone), so the chrome around
   them keeps its size. */
const KEY = "conduit:transcript-scale";

export const TRANSCRIPT_SCALE_OPTIONS = [0.9, 1, 1.1, 1.2, 1.3] as const;
export type TranscriptScale = typeof TRANSCRIPT_SCALE_OPTIONS[number];

export function transcriptScale(): TranscriptScale {
  try {
    const saved = Number(localStorage.getItem(KEY));
    if (TRANSCRIPT_SCALE_OPTIONS.some((option) => option === saved)) return saved as TranscriptScale;
  } catch { /* unavailable */ }
  return 1;
}

export function applyTranscriptScale(scale = transcriptScale()) {
  const root = document.documentElement.style;
  if (scale === 1) { root.removeProperty("--scale-transcript-desktop"); root.removeProperty("--scale-transcript-phone"); return; }
  root.setProperty("--scale-transcript-desktop", String(scale));
  root.setProperty("--scale-transcript-phone", String(scale));
}

export function saveTranscriptScale(scale: TranscriptScale): TranscriptScale {
  try { localStorage.setItem(KEY, String(scale)); } catch { /* this session only */ }
  applyTranscriptScale(scale);
  return scale;
}
