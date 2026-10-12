/* The terminal's typeface (Settings → Appearance), per device. Meslo only for
   now; when the app moves to components v2, this is the picker behind its
   --font-terminal (gallery Type · Faces offers Paper Mono, Inconsolata, system). */
export type TerminalFont = "meslo";

const KEY = "conduit:terminal-font";

export const TERMINAL_FONT_OPTIONS: readonly { value: TerminalFont; label: string; family: string }[] = [
  { value: "meslo", label: "Meslo", family: '"Conduit Terminal Font", monospace' },
];

export function terminalFont(): TerminalFont {
  try {
    const stored = localStorage.getItem(KEY);
    if (TERMINAL_FONT_OPTIONS.some((option) => option.value === stored)) return stored as TerminalFont;
  } catch { /* unavailable */ }
  return "meslo";
}

export function terminalFontFamily(font = terminalFont()) {
  return TERMINAL_FONT_OPTIONS.find((option) => option.value === font)!.family;
}

export function saveTerminalFont(font: TerminalFont): TerminalFont {
  try { localStorage.setItem(KEY, font); } catch { /* this session only */ }
  return font;
}
