export const VOICE_WAVEFORM_SAMPLE_COUNT = 48;
export const MAX_RESPONSIVE_BAR_COUNT = 96;
const VOICE_LEVEL_RMS_GAIN = 12;
const VOICE_LEVEL_PEAK_GAIN = 4;
const VOICE_PEAK_RMS_GAIN = 3.2;
const VOICE_PEAK_GAIN = 1.6;

export const clampVoiceLevel = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export function normalizeVoiceLevel(level: { rms: number; peak: number }) {
  return clampVoiceLevel(Math.max(level.rms * VOICE_LEVEL_RMS_GAIN, level.peak * VOICE_LEVEL_PEAK_GAIN));
}

export function normalizeVoicePeak(level: { rms: number; peak: number }) {
  return clampVoiceLevel(Math.max(level.peak * VOICE_PEAK_GAIN, level.rms * VOICE_PEAK_RMS_GAIN));
}

export function emptyWaveformHistory(sampleCount: number) {
  return Array.from({ length: sampleCount }, () => 0);
}

export function compactWaveformBarCount(plotWidth: number, density: number) {
  if (!(plotWidth > 0) || !(density > 0)) return 0;
  return Math.min(MAX_RESPONSIVE_BAR_COUNT, Math.max(1, Math.floor(plotWidth / density)));
}

export function selectWaveformBars(history: number[], count: number, options: { pad?: boolean } = {}) {
  const size = Math.max(1, Math.floor(count));
  const values = history.slice(-size).map(clampVoiceLevel);
  if (values.length >= size || !options.pad) return values.length ? values : [0];
  return [...emptyWaveformHistory(size - values.length), ...values];
}

export function waveformBarHeightPercent(value: number, compact = false) {
  const level = clampVoiceLevel(value);
  return compact ? Math.max(7, 7 + level * 93) : Math.max(8, 8 + level * 86);
}
