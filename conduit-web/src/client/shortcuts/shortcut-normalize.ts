import type {
  ShortcutBinding, ShortcutEnvironment, ShortcutModifier, ShortcutStroke,
} from "./shortcut-types.ts";

const MODIFIER_ORDER: ShortcutModifier[] = ["primary", "control", "alt", "shift"];
const MODIFIER_KEYS = new Set([
  "Alt", "AltGraph", "Control", "Meta", "Shift", "OS", "Super", "Hyper",
]);

const CODE_LABELS: Record<string, string> = {
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  Backspace: "Backspace",
  Comma: ",",
  Delete: "Delete",
  End: "End",
  Enter: "Enter",
  Escape: "Esc",
  Home: "Home",
  Insert: "Insert",
  PageDown: "Page Down",
  PageUp: "Page Up",
  Period: ".",
  Slash: "/",
  Space: "Space",
  Tab: "Tab",
};

export interface KeyboardEventLike {
  key: string;
  code?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

const isApplePlatform = (environment: ShortcutEnvironment) => environment.platform === "macos" || environment.platform === "ios";

export function normalizeModifiers(modifiers: Iterable<ShortcutModifier>): ShortcutModifier[] {
  const unique = new Set(modifiers);
  return MODIFIER_ORDER.filter((modifier) => unique.has(modifier));
}

export function codeForKey(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  const named: Record<string, string> = {
    ",": "Comma",
    ".": "Period",
    "/": "Slash",
    " ": "Space",
    Esc: "Escape",
  };
  return named[key] || key;
}

export function keyLabel(code: string, key = ""): string {
  if (key && key !== "Unidentified" && !MODIFIER_KEYS.has(key)) {
    if (key === " ") return "Space";
    if (key === "Escape") return "Esc";
    if (key.length === 1) return key.toLocaleUpperCase();
    return key;
  }
  if (CODE_LABELS[code]) return CODE_LABELS[code]!;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return code;
}

export function normalizeKeyboardEvent(event: KeyboardEventLike, environment: ShortcutEnvironment): ShortcutStroke | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const code = event.code || codeForKey(event.key);
  if (!code || code === "Unidentified") return null;
  const modifiers: ShortcutModifier[] = [];
  if (isApplePlatform(environment)) {
    if (event.metaKey) modifiers.push("primary");
    if (event.ctrlKey) modifiers.push("control");
  } else if (event.ctrlKey) {
    modifiers.push("primary");
  }
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey) modifiers.push("shift");
  return {
    code,
    key: keyLabel(code, event.key),
    modifiers: normalizeModifiers(modifiers),
  };
}

export function shortcutStroke(code: string, key: string, modifiers: ShortcutModifier[] = []): ShortcutStroke {
  return { code, key: keyLabel(code, key), modifiers: normalizeModifiers(modifiers) };
}

export function shortcutBinding(...strokes: ShortcutStroke[]): ShortcutBinding {
  if (strokes.length < 1 || strokes.length > 2) throw new Error("A shortcut binding must contain one or two strokes");
  return { strokes: strokes as ShortcutBinding["strokes"] };
}

export function strokeIdentity(stroke: ShortcutStroke): string {
  return `${normalizeModifiers(stroke.modifiers).join("+")}:${stroke.code}`;
}

export function bindingIdentity(binding: ShortcutBinding): string {
  return binding.strokes.map(strokeIdentity).join(" ");
}

export function sameStroke(left: ShortcutStroke, right: ShortcutStroke): boolean {
  return strokeIdentity(left) === strokeIdentity(right);
}

export function sameBinding(left: ShortcutBinding, right: ShortcutBinding): boolean {
  return bindingIdentity(left) === bindingIdentity(right);
}

export function bindingStartsWith(binding: ShortcutBinding, prefix: ShortcutBinding): boolean {
  if (prefix.strokes.length >= binding.strokes.length) return false;
  return prefix.strokes.every((stroke, index) => sameStroke(stroke, binding.strokes[index]!));
}

export function formatShortcutStroke(stroke: ShortcutStroke, environment: ShortcutEnvironment): string {
  const apple = isApplePlatform(environment);
  const modifiers = normalizeModifiers(stroke.modifiers).map((modifier) => {
    if (modifier === "primary") return apple ? "⌘" : "Ctrl";
    if (modifier === "control") return "Ctrl";
    if (modifier === "alt") return apple ? "⌥" : "Alt";
    return apple ? "⇧" : "Shift";
  });
  return [...modifiers, keyLabel(stroke.code, stroke.key)].join(" ");
}

export function formatShortcutBinding(binding: ShortcutBinding, environment: ShortcutEnvironment): string {
  return binding.strokes.map((stroke) => formatShortcutStroke(stroke, environment)).join("  ");
}

export function normalizeStoredStroke(value: unknown): ShortcutStroke | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.code !== "string" || !record.code || typeof record.key !== "string" || !Array.isArray(record.modifiers)) return null;
  const modifiers = record.modifiers.filter((modifier): modifier is ShortcutModifier =>
    modifier === "primary" || modifier === "control" || modifier === "alt" || modifier === "shift");
  if (modifiers.length !== record.modifiers.length) return null;
  return shortcutStroke(record.code, record.key, modifiers);
}

export function normalizeStoredBinding(value: unknown): ShortcutBinding | null {
  if (!value || typeof value !== "object") return null;
  const strokes = (value as Record<string, unknown>).strokes;
  if (!Array.isArray(strokes) || strokes.length < 1 || strokes.length > 2) return null;
  const normalized = strokes.map(normalizeStoredStroke);
  if (normalized.some((stroke) => !stroke)) return null;
  return shortcutBinding(...normalized as ShortcutStroke[]);
}

export function isPrintableUnmodifiedStroke(stroke: ShortcutStroke): boolean {
  return stroke.modifiers.length === 0 && (stroke.key.length === 1 || stroke.code === "Space");
}
