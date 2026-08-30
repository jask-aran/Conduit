export const VOICE_DICTATION_STORAGE_KEY = "conduit:voice-dictation";
export const DEFAULT_VOICE_DICTATION_SETTINGS = Object.freeze({ shortcut: "Ctrl+Shift+D", activation: "push_to_talk", autoSend: false, inputDeviceId: "", captureProfile: "raw", warmMicrophone: false });
const LEGACY_DEFAULT_SHORTCUT = "Super+D";

export const NO_SIGNAL_ERROR_MIN_DURATION_MS = 5_000;

const MODIFIER_ORDER = ["Super", "Ctrl", "Alt", "Shift"];

function keyLabel(key) {
  if (key === " ") return "Space";
  if (key === "Escape") return "Esc";
  if (key.length === 1) return key.toUpperCase();
  return key[0]?.toUpperCase() + key.slice(1);
}

export function shortcutFromKeyboardEvent(event) {
  if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return null;
  const modifiers = [];
  if (event.metaKey) modifiers.push("Super");
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (!modifiers.some((modifier) => modifier !== "Shift")) return null;
  return [...modifiers, keyLabel(event.key)].join("+");
}

export function normalizeShortcut(value) {
  const pieces = String(value || "").split("+").map((piece) => piece.trim()).filter(Boolean);
  if (pieces.length < 2) return DEFAULT_VOICE_DICTATION_SETTINGS.shortcut;
  const rawKey = pieces.at(-1);
  const aliases = new Map([
    ["meta", "Super"], ["cmd", "Super"], ["command", "Super"], ["super", "Super"],
    ["control", "Ctrl"], ["ctrl", "Ctrl"], ["alt", "Alt"], ["option", "Alt"], ["shift", "Shift"],
  ]);
  const modifiers = new Set(pieces.slice(0, -1).map((piece) => aliases.get(piece.toLowerCase())).filter(Boolean));
  if (!modifiers.size || ![...modifiers].some((modifier) => modifier !== "Shift") || !rawKey) {
    return DEFAULT_VOICE_DICTATION_SETTINGS.shortcut;
  }
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), keyLabel(rawKey)].join("+");
}

export function normalizeActivation(value) {
  return value === "toggle" ? "toggle" : DEFAULT_VOICE_DICTATION_SETTINGS.activation;
}

function shortcutParts(shortcut) {
  const pieces = normalizeShortcut(shortcut).split("+");
  return { modifiers: new Set(pieces.slice(0, -1)), key: pieces.at(-1).toLowerCase() };
}

export function matchesShortcut(event, shortcut) {
  const parts = shortcutParts(shortcut);
  const key = keyLabel(event.key).toLowerCase();
  return key === parts.key
    && event.metaKey === parts.modifiers.has("Super")
    && event.ctrlKey === parts.modifiers.has("Ctrl")
    && event.altKey === parts.modifiers.has("Alt")
    && event.shiftKey === parts.modifiers.has("Shift");
}

export function releasesShortcut(event, shortcut) {
  const parts = shortcutParts(shortcut);
  const released = keyLabel(event.key).toLowerCase();
  if (released === parts.key) return true;
  return (released === "meta" && parts.modifiers.has("Super"))
    || (released === "control" && parts.modifiers.has("Ctrl"))
    || (released === "alt" && parts.modifiers.has("Alt"))
    || (released === "shift" && parts.modifiers.has("Shift"));
}

/** @typedef {import("./voice-dictation-types.ts").VoiceDictationSettings} VoiceDictationSettings */

/** @param {Storage=} storage @returns {VoiceDictationSettings} */
export function loadVoiceDictationSettings(storage = globalThis.localStorage) {
  try {
    const stored = JSON.parse(storage?.getItem(VOICE_DICTATION_STORAGE_KEY) || "null");
    const shortcut = normalizeShortcut(stored?.shortcut);
    return {
      shortcut: shortcut === LEGACY_DEFAULT_SHORTCUT ? DEFAULT_VOICE_DICTATION_SETTINGS.shortcut : shortcut,
      activation: normalizeActivation(stored?.activation),
      autoSend: stored?.autoSend === true,
      inputDeviceId: typeof stored?.inputDeviceId === "string" ? stored.inputDeviceId : "",
      captureProfile: stored?.captureProfile === "processed" ? "processed" : "raw",
      warmMicrophone: stored?.warmMicrophone === true,
    };
  } catch {
    return { ...DEFAULT_VOICE_DICTATION_SETTINGS };
  }
}

/** @param {VoiceDictationSettings} settings @param {Storage=} storage @returns {VoiceDictationSettings} */
export function saveVoiceDictationSettings(settings, storage = globalThis.localStorage) {
  const normalized = {
    shortcut: normalizeShortcut(settings.shortcut),
    activation: normalizeActivation(settings.activation),
    autoSend: settings.autoSend === true,
    inputDeviceId: typeof settings.inputDeviceId === "string" ? settings.inputDeviceId : "",
    captureProfile: settings.captureProfile === "processed" ? "processed" : "raw",
    warmMicrophone: settings.warmMicrophone === true,
  };
  storage?.setItem(VOICE_DICTATION_STORAGE_KEY, JSON.stringify(normalized));
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("conduit:ui-preference-change", { detail: {
    key: "voicePreferences",
    value: {
      shortcut: normalized.shortcut,
      activation: normalized.activation,
      autoSend: normalized.autoSend,
      captureProfile: normalized.captureProfile,
    },
  } }));
  return normalized;
}

export function beginDictatedRange(text, cursor, selectionEnd = cursor) {
  const length = String(text).length;
  const start = Math.max(0, Math.min(length, Number(cursor) || 0));
  const end = Math.max(start, Math.min(length, Number(selectionEnd) || 0));
  return { start, end };
}

export function replaceDictatedRange(text, range, transcript) {
  const source = String(text);
  const start = Math.max(0, Math.min(source.length, range.start));
  const end = Math.max(start, Math.min(source.length, range.end));
  const value = String(transcript || "").trim();
  const before = source.slice(0, start);
  const after = source.slice(end);
  const leftSpace = value && /[\p{L}\p{N}]$/u.test(before) && /^[\p{L}\p{N}]/u.test(value) ? " " : "";
  const rightSpace = value && !/^\s/u.test(after) ? " " : "";
  const inserted = `${leftSpace}${value}${rightSpace}`;
  return {
    text: `${before}${inserted}${after}`,
    range: { start, end: start + inserted.length },
  };
}

export function shouldAutoSend({ enabled, final, finalWithinDeadline }) {
  return enabled === true && final === true && finalWithinDeadline === true;
}

export function shouldReportNoSignal({ inputSignalDetected, captureDurationMs }) {
  return inputSignalDetected !== true && Number(captureDurationMs) >= NO_SIGNAL_ERROR_MIN_DURATION_MS;
}

export function audioTransferLost({ audioBytesSent, serverAudioBytes }) {
  return Number.isFinite(audioBytesSent)
    && Number.isFinite(serverAudioBytes)
    && Number(serverAudioBytes) < Number(audioBytesSent);
}
