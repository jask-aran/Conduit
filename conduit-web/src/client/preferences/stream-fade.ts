/*
 * How long a word takes to fade in under Incremark Fade: a device setting.
 * It is a custom property on the root the stylesheet reads, so changing it
 * applies to the next word shown without re-rendering anything.
 */
const STREAM_FADE_KEY = "conduit:stream-word-fade-ms";

export const STREAM_FADE_DEFAULT_MS = 200;

export const STREAM_FADE_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 100, label: "Brisk · 100ms" },
  { value: 200, label: "Default · 200ms" },
  { value: 350, label: "Soft · 350ms" },
  { value: 600, label: "Slow · 600ms" },
];

const isOption = (value: number) => STREAM_FADE_OPTIONS.some((option) => option.value === value);

// Read on every streamed frame, so kept rather than read from storage each time.
let current: number | null = null;

export function streamFadeMs(): number {
  if (current != null) return current;
  try {
    const stored = Number(localStorage.getItem(STREAM_FADE_KEY));
    current = isOption(stored) ? stored : STREAM_FADE_DEFAULT_MS;
  } catch {
    current = STREAM_FADE_DEFAULT_MS;
  }
  return current;
}

export function applyStreamFade(ms = streamFadeMs()): void {
  document.documentElement.style.setProperty("--stream-word-fade", `${ms}ms`);
}

export function saveStreamFade(ms: number): number {
  const value = isOption(ms) ? ms : STREAM_FADE_DEFAULT_MS;
  current = value;
  try { localStorage.setItem(STREAM_FADE_KEY, String(value)); } catch { /* this session only */ }
  applyStreamFade(value);
  return value;
}
