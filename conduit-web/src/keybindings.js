/**
 * The client keeps its own stroke shape (ShortcutOverrides); this module translates on the hub, so the file is the only
 * place the overrides are written.
 */

const MODIFIERS = { mod: "primary", cmd: "primary", primary: "primary", ctrl: "control", control: "control", alt: "alt", option: "alt", opt: "alt", shift: "shift" };
const MODIFIER_NAMES = { primary: "mod", control: "ctrl", alt: "alt", shift: "shift" };
const MODIFIER_ORDER = ["primary", "control", "alt", "shift"];
const NAMED = {
  enter: "Enter", return: "Enter", escape: "Escape", esc: "Escape", space: "Space", tab: "Tab", backspace: "Backspace",
  delete: "Delete", del: "Delete", insert: "Insert", home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown",
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
  comma: "Comma", ",": "Comma", period: "Period", ".": "Period", plus: "Equal", slash: "Slash", "/": "Slash", backslash: "Backslash",
  "\\": "Backslash", semicolon: "Semicolon", ";": "Semicolon", quote: "Quote", "'": "Quote", backquote: "Backquote",
  "`": "Backquote", minus: "Minus", "-": "Minus", equal: "Equal", "=": "Equal", "[": "BracketLeft", "]": "BracketRight",
};
const CODE_NAMES = {
  Enter: "enter", Escape: "escape", Space: "space", Tab: "tab", Backspace: "backspace", Delete: "delete", Insert: "insert",
  Home: "home", End: "end", PageUp: "pageup", PageDown: "pagedown", ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left",
  ArrowRight: "right", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Semicolon: ";", Quote: "'", Backquote: "`",
  Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
};
// What a stroke's key shows as when it was never pressed (the client's keyLabel, given no key).
const LABELS = { ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", Comma: ",", Escape: "Esc", PageDown: "Page Down", PageUp: "Page Up", Period: ".", Slash: "/" };
const label = (code) => LABELS[code] || (/^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit[0-9]$/.test(code) ? code.slice(5) : code);

const MAX_COMMANDS = 100;
const MAX_BINDINGS = 4;

function parseStroke(text) {
  const parts = text.split("+");
  const keyName = parts.pop();
  const modifiers = new Set();
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (!modifier) throw new Error(`"${part}" is not a modifier (mod, ctrl, alt, shift)`);
    modifiers.add(modifier);
  }
  const lower = keyName.toLowerCase();
  const code = /^[a-z]$/.test(lower) ? `Key${lower.toUpperCase()}`
    : /^[0-9]$/.test(lower) ? `Digit${lower}`
      : /^f([1-9]|1[0-9]|2[0-4])$/.test(lower) ? lower.toUpperCase()
        : NAMED[lower] || (/^[A-Z][A-Za-z0-9]{1,30}$/.test(keyName) ? keyName : null);
  if (!code) throw new Error(`"${keyName || text}" is not a key (the + key is "plus")`);
  return { code, key: label(code), modifiers: MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)) };
}

function parseBinding(text) {
  if (typeof text !== "string") throw new Error("a binding is a string, such as \"mod+shift+g\"");
  const strokes = text.trim().split(/\s+/).filter(Boolean);
  if (strokes.length < 1 || strokes.length > 2) throw new Error(`"${text}" should be one stroke or two`);
  return { strokes: strokes.map(parseStroke) };
}

/** Each entry is read on its own: one bad line costs only itself. */
export function parseKeybindings(text) {
  let value;
  try { value = JSON.parse(text); }
  catch (error) { return { overrides: null, errors: [`Not valid JSON: ${error.message}`] }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { overrides: null, errors: ["The file should hold one object: command ids to bindings"] };
  const overrides = {};
  const errors = [];
  for (const [commandId, entry] of Object.entries(value)) {
    if (commandId.startsWith("//")) continue;
    if (commandId.length > 100) { errors.push(`${commandId.slice(0, 40)}…: command id too long`); continue; }
    if (Object.keys(overrides).length >= MAX_COMMANDS) { errors.push(`${commandId}: more than ${MAX_COMMANDS} commands`); continue; }
    const list = Array.isArray(entry) ? entry : [entry];
    if (list.length > MAX_BINDINGS) { errors.push(`${commandId}: at most ${MAX_BINDINGS} bindings`); continue; }
    try { overrides[commandId] = list.map(parseBinding); }
    catch (error) { errors.push(`${commandId}: ${error.message}`); }
  }
  return { overrides, errors };
}

const strokeText = (stroke) => [...MODIFIER_ORDER.filter((modifier) => stroke.modifiers?.includes(modifier)).map((modifier) => MODIFIER_NAMES[modifier]),
  CODE_NAMES[stroke.code] || (/^Key[A-Z]$/.test(stroke.code) ? stroke.code.slice(3).toLowerCase() : /^Digit[0-9]$/.test(stroke.code) ? stroke.code.slice(5) : stroke.code)].join("+");

export function formatKeybindings(overrides) {
  const file = { "//": "Conduit keyboard shortcuts. Command ids are listed in Settings › Shortcuts. \"mod+shift+g\": mod is ⌘ on a Mac and Ctrl elsewhere, ctrl is the Mac's Control; \"mod+k h\" is a sequence; [] unbinds. Saved changes apply at once." };
  for (const commandId of Object.keys(overrides || {}).sort()) {
    const bindings = overrides[commandId].map((binding) => binding.strokes.map(strokeText).join(" "));
    file[commandId] = bindings.length === 1 ? bindings[0] : bindings;
  }
  return `${JSON.stringify(file, null, 2)}\n`;
}
